// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:GRUNDLAGENTHEORIE — Schritt 1 (deterministisch, kein LLM).
//
// Strategie: docs/h3_grundlagentheorie_parsing_strategy.md.
//
// Diese Stufe produziert ein Datenartefakt für Schritt 2 (REPRODUKTIV_VS_
// DISKURSIV). Primärer Zweck: Indikatoren für die wahrscheinliche Lage von
// Grenzen zwischen Literatur-Reproduktion und Diskussion über Bandbreiten-,
// Frequenz- und Konzentrationsmessung der Verweise.
//
// Drei Komponenten:
//   1. Inline-Citation-Extraktion (Regex) im GRUNDLAGENTHEORIE-Container.
//   2. Bibliografie-Liste am Werk-Ende (Heading-Text-Match, Eintrags-Split,
//      Author/Year-Regex) — befüllt bibliography_entries-Tabelle.
//   3. Cross-Referenz Inline-Citation -> Bibliografie-Eintrag über
//      Familienname + Jahr-Match. Ohne Match = orphan (deskriptiver Befund).
//
// Aggregation in VERWEIS_PROFIL: Bandbreite, Frequenz, Konzentration (HHI),
// ¶-Verteilung, Konsekutiv-Cluster (Reproduktions-Block-Indikator), pro-¶-
// Verweis-Signatur (für Schritt 2 LLM-Input), Coverage-Befunde.
//
// Persistenz:
//   - bibliography_entries (eine Werk-Ebene; idempotent via DELETE-then-INSERT
//     pro document_id, weil Re-Runs in der experimentellen Phase erwartet sind)
//   - function_constructs (VERWEIS_PROFIL pro GRUNDLAGENTHEORIE-Container)
//
// Was NICHT in dieser Stufe passiert: kein LLM, keine Werk-Typ-Klassifikation,
// keine primär/sekundär-Sub-Klassifikation, keine Reviewer-Signale.

import { query, queryOne } from '../../db/index.js';

// ── Container-Auflösung GRUNDLAGENTHEORIE ─────────────────────────

export interface GrundlagentheorieParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
}

export interface GrundlagentheorieContainer {
	headingId: string;
	headingText: string;
	paragraphs: GrundlagentheorieParagraph[];
}

export async function loadGrundlagentheorieContainers(
	documentId: string
): Promise<GrundlagentheorieContainer[]> {
	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
		heading_id: string;
		heading_text: string;
	}>(
		`WITH heading_with_type AS (
		   SELECT de.id AS heading_id,
		          de.char_start,
		          de.char_end,
		          hc.outline_function_type,
		          SUBSTRING(dc.full_text FROM de.char_start + 1
		                                 FOR de.char_end - de.char_start) AS heading_text
		   FROM document_elements de
		   JOIN heading_classifications hc ON hc.element_id = de.id
		   JOIN document_content dc ON dc.naming_id = de.document_id
		   WHERE de.document_id = $1
		     AND de.element_type = 'heading'
		     AND de.section_kind = 'main'
		     AND hc.outline_function_type IS NOT NULL
		     AND COALESCE(hc.excluded, false) = false
		 )
		 SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text,
		        h.heading_id,
		        h.heading_text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 JOIN LATERAL (
		   SELECT hwt.heading_id, hwt.heading_text, hwt.outline_function_type
		   FROM heading_with_type hwt
		   WHERE hwt.char_start <= p.char_start
		   ORDER BY hwt.char_start DESC
		   LIMIT 1
		 ) h ON h.outline_function_type = 'GRUNDLAGENTHEORIE'
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;

	const byHeading = new Map<string, GrundlagentheorieContainer>();
	for (const r of rows) {
		let c = byHeading.get(r.heading_id);
		if (!c) {
			c = {
				headingId: r.heading_id,
				headingText: r.heading_text.trim(),
				paragraphs: [],
			};
			byHeading.set(r.heading_id, c);
		}
		c.paragraphs.push({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
			indexInContainer: c.paragraphs.length,
		});
	}
	return Array.from(byHeading.values());
}

// ── Bibliografie-Detektion + Extraktion ───────────────────────────

// Bibliografie wird primär über section_kind='bibliography' identifiziert
// (DOCX-Parser klassifiziert sie strukturell). Falls section_kind nicht
// gesetzt ist, fällt die Detektion auf Heading-Text-Match zurück.
const BIBLIOGRAPHY_HEADING_RE =
	/^\s*(literaturverzeichnis|literatur(?:\s+und\s+quellen)?|bibliographie|bibliografie|quellenverzeichnis|quellen|referenzen|references)\s*$/i;

// Erstautor-Familienname am Eintrags-Anfang. "Klafki, Wolfgang (2007): …",
// "Helsper, W./Krüger, H.-H. (Hrsg.) (2003): …", "Foucault, M. ([1969] 1973): …".
// Erstautor = erstes Token bis zum ersten Komma oder Schrägstrich.
const BIB_FIRST_AUTHOR_RE = /^([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß'-]+)/;
const BIB_YEAR_RE = /\b((?:18|19|20)\d{2})([a-z])?\b/;

interface BibliographyExtractedEntry {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	rawText: string;
	firstAuthorLastname: string | null;
	year: string | null;
	yearSuffix: string | null;
}

export async function loadBibliographyParagraphs(
	documentId: string
): Promise<Array<{
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
}>> {
	// Primär: section_kind='bibliography' (DOCX-Parser-Klassifikation).
	// Element-Typ kann 'bibliography_entry' sein (eigene Klasse) oder
	// 'paragraph' (Fallback, falls der Parser keine Eintrags-Granularität hat).
	const primary = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.element_type IN ('bibliography_entry', 'paragraph')
		   AND p.section_kind = 'bibliography'
		 ORDER BY p.char_start`,
		[documentId]
	)).rows;
	if (primary.length > 0) {
		return primary.map((r) => ({
			paragraphId: r.paragraph_id,
			charStart: r.char_start,
			charEnd: r.char_end,
			text: r.text.trim(),
		}));
	}

	// Fallback: Heading-Text-Match in section_kind='main', falls der DOCX-Parser
	// die Bibliografie nicht strukturell klassifiziert hat.
	const headings = (await query<{
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT de.char_start,
		        de.char_end,
		        SUBSTRING(dc.full_text FROM de.char_start + 1
		                              FOR de.char_end - de.char_start) AS text
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.document_id = $1
		   AND de.element_type = 'heading'
		   AND de.section_kind = 'main'
		 ORDER BY de.char_start`,
		[documentId]
	)).rows;

	const bibHeadingIdx = headings.findIndex((h) => BIBLIOGRAPHY_HEADING_RE.test(h.text.trim()));
	if (bibHeadingIdx < 0) return [];
	const bibHeading = headings[bibHeadingIdx];
	const nextHeading = headings[bibHeadingIdx + 1];
	const upperBound = nextHeading?.char_start ?? Number.MAX_SAFE_INTEGER;

	const rows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.char_start > $2
		   AND p.char_start < $3
		 ORDER BY p.char_start`,
		[documentId, bibHeading.char_end, upperBound]
	)).rows;

	return rows.map((r) => ({
		paragraphId: r.paragraph_id,
		charStart: r.char_start,
		charEnd: r.char_end,
		text: r.text.trim(),
	}));
}

export function extractAuthorYearFromEntry(
	rawText: string
): { firstAuthorLastname: string | null; year: string | null; yearSuffix: string | null } {
	const m1 = rawText.match(BIB_FIRST_AUTHOR_RE);
	const m2 = rawText.match(BIB_YEAR_RE);
	return {
		firstAuthorLastname: m1?.[1] ?? null,
		year: m2?.[1] ?? null,
		yearSuffix: m2?.[2] ?? null,
	};
}

async function persistBibliography(
	caseId: string,
	documentId: string
): Promise<BibliographyExtractedEntry[]> {
	const paragraphs = await loadBibliographyParagraphs(documentId);
	if (paragraphs.length === 0) return [];

	// Idempotent: bei Re-Run für dasselbe Dokument vorherige Einträge entfernen.
	await query(`DELETE FROM bibliography_entries WHERE document_id = $1`, [documentId]);

	const entries: BibliographyExtractedEntry[] = paragraphs
		.filter((p) => p.text.length >= 5)
		.map((p) => {
			const { firstAuthorLastname, year, yearSuffix } = extractAuthorYearFromEntry(p.text);
			return {
				paragraphId: p.paragraphId,
				charStart: p.charStart,
				charEnd: p.charEnd,
				rawText: p.text,
				firstAuthorLastname,
				year,
				yearSuffix,
			};
		});

	for (const e of entries) {
		await query(
			`INSERT INTO bibliography_entries
			   (case_id, document_id, paragraph_element_id, char_start, char_end,
			    raw_text, first_author_lastname, year, year_suffix)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				caseId,
				documentId,
				e.paragraphId,
				e.charStart,
				e.charEnd,
				e.rawText,
				e.firstAuthorLastname,
				e.year,
				e.yearSuffix,
			]
		);
	}

	return entries;
}

// ── Inline-Citation-Extraktion ─────────────────────────────────────

export interface InlineCitation {
	rawMatch: string;
	authorString: string;
	authorsCanonical: string[];
	year: string;
	yearSuffix: string | null;
	page: string | null;
	paragraphId: string;
	paragraphIndex: number;
	matchOffsetInParagraph: number;
	bibliographyEntryIds: string[];
}

// Mehrautoren-Marker, alle Schreib-Varianten:
//   "et al.", "et. al.", "et al", "et. al"
//   "u.a.", "u. a."
//   "e.a.", "e. a."
const ET_AL_PATTERN = String.raw`(?:et\.?\s+al\.?|u\.?\s*a\.|e\.?\s*a\.)`;

// Author-Familienname:
//   - all-caps Akronym ("UNESCO", "BUND", "OECD") oder
//   - Standard-Form ("Klafki", "Allolio-Näcke", "O'Connor")
// Lowercase-Prefix für Adelsformen / Doppelnamen ("von Saldern", "da Costa").
const NAME_PREFIX = String.raw`(?:(?:von|de|da|le|la|van|der|den|du|del)\s+)?`;
const SINGLE_NAME = String.raw`(?:[A-ZÄÖÜ]{2,}|[A-ZÄÖÜ][a-zäöüß][A-ZÄÖÜa-zäöüß'-]*)`;
// Bis zu drei zusammenhängende groß-anfangende Wörter als Familienname
// ("Castro Varela", "United Nations", "Kiwi Menrath").
const FAMILY_NAME = String.raw`${NAME_PREFIX}${SINGLE_NAME}(?:\s+${SINGLE_NAME}){0,2}`;

const AUTHOR_PATTERN = String.raw`${FAMILY_NAME}(?:\s+${ET_AL_PATTERN})?(?:\s*(?:[\/&]|\bund\b)\s*${FAMILY_NAME})*`;
const YEAR_PATTERN = String.raw`(?:18|19|20)\d{2}`;
const PAGE_PATTERN = String.raw`[\dff.,\s–-]+`;

// Narrativer Stil: "Klafki (2007)", "Klafki et al. (2023)", "Cramer & Drahmann (2019)".
const CITATION_NARRATIVE_RE = new RegExp(
	String.raw`\b(${AUTHOR_PATTERN})\s*\(\s*(${YEAR_PATTERN})([a-z])?(?:\s*[\/-]\s*(?:18|19|20)?\d{2}[a-z]?)?(?:\s*[:,]\s*(?:S\.\s*)?(${PAGE_PATTERN}))?\s*\)`,
	'g'
);

// Klammer-Block: alle (...) im Text. Jeder Block kann mehrere Citations
// enthalten ("(Bohnsack et al., 2010; Bohnsack, 2017)") — wird unten
// pro Block sub-iteriert.
const PAREN_BLOCK_RE = /\(([^()]+)\)/g;

// Sub-Citation innerhalb eines Klammer-Blocks. Sucht überall im Block-Inhalt
// nach Author-Year-Patterns, ohne strikten Anker — Trenner wie "; ", ", ",
// "vgl. ", "kritisch dazu siehe " etc. werden dadurch implizit toleriert.
const SUB_CITATION_RE = new RegExp(
	String.raw`\b(${AUTHOR_PATTERN}),?\s+(${YEAR_PATTERN})([a-z])?(?:\s*[\/-]\s*(?:18|19|20)?\d{2}[a-z]?)?(?:\s*[:,]\s*(?:S\.\s*)?(${PAGE_PATTERN}))?`,
	'g'
);

// Stop-Liste deutscher Wörter, die durch das Sub-Citation-Pattern fälschlich
// als Author-Familienname gematcht werden — typisch in Datums-/Zeit-Klammern
// ("Anfang 2022", "Jahr 2022") oder am Satzanfang als groß-geschriebene
// Substantive/Determinatoren/Präpositionen. Erstwurf, kann iterativ wachsen.
const AUTHOR_STOP_WORDS = new Set<string>([
	// Zeit-/Datums-Ausdrücke
	'Anfang', 'Beginn', 'Ende', 'Mitte', 'Schluss', 'Stand',
	'Jahr', 'Tag', 'Monat', 'Woche', 'Stunde',
	'Phase', 'Stufe', 'Etappe', 'Periode', 'Zeitraum',
	// Monate
	'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
	'August', 'September', 'Oktober', 'November', 'Dezember',
	// Akademische Container-Begriffe
	'Studie', 'Untersuchung', 'Forschung', 'Analyse',
	'Beispiel', 'Kapitel', 'Abschnitt', 'Punkt', 'Teil',
	// Citation-Marker
	'Vgl', 'Siehe', 'Ebd', 'Hrsg', 'Hg', 'Etc', 'Bzw',
	// Determinatoren / Pronomina (Satzanfang)
	'Der', 'Die', 'Das', 'Den', 'Dem', 'Des',
	'Ein', 'Eine', 'Einer', 'Eines', 'Einem', 'Einen',
	'Diese', 'Dieser', 'Dieses', 'Diesen', 'Diesem',
	'Jene', 'Jener', 'Jenes', 'Jenen', 'Jenem',
	// Präpositionen
	'Im', 'Am', 'Um', 'In', 'An', 'Auf', 'Über', 'Unter', 'Vor', 'Nach',
	'Neben', 'Bei', 'Mit', 'Aus', 'Ohne', 'Durch', 'Für', 'Wegen',
	// Konjunktionen
	'Und', 'Oder', 'Aber', 'Wenn', 'Weil',
]);

function splitAuthorString(s: string): string[] {
	return s
		.replace(/\s+et\.?\s+al\.?/i, '')
		.replace(/\s+u\.?\s*a\./i, '')
		.replace(/\s+e\.?\s*a\./i, '')
		.split(/\s*(?:[\/&]|\bund\b)\s*/)
		.map((a) => a.trim())
		.filter(Boolean);
}

export function extractInlineCitations(
	paragraph: GrundlagentheorieParagraph
): Array<Omit<InlineCitation, 'bibliographyEntryIds'>> {
	const found: Array<Omit<InlineCitation, 'bibliographyEntryIds'>> = [];
	const seenOffsets = new Set<number>();

	const pushCitation = (
		offset: number,
		rawMatch: string,
		authorString: string,
		year: string,
		yearSuffix: string | null,
		page: string | null
	) => {
		if (seenOffsets.has(offset)) return;
		const authorsCanonical = splitAuthorString(authorString);
		if (authorsCanonical.length === 0) return;
		// Stop-Liste-Filter über alle Wörter im Erst-Author (Mehrwort-Familien-
		// namen wie "Castro Varela" sind erlaubt, aber sobald ein Bestandteil
		// ein deutsches Datum-/Determinatoren-Wort ist, ist es False-Positive).
		const firstAuthorWords = authorsCanonical[0].split(/\s+/);
		if (firstAuthorWords.some((w) => AUTHOR_STOP_WORDS.has(w))) return;
		seenOffsets.add(offset);
		found.push({
			rawMatch,
			authorString,
			authorsCanonical,
			year,
			yearSuffix,
			page,
			paragraphId: paragraph.paragraphId,
			paragraphIndex: paragraph.indexInContainer,
			matchOffsetInParagraph: offset,
		});
	};

	// Stufe 1: narrative "Author (Jahr)" patterns
	CITATION_NARRATIVE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = CITATION_NARRATIVE_RE.exec(paragraph.text)) !== null) {
		pushCitation(
			m.index,
			m[0],
			m[1].trim(),
			m[2].trim(),
			m[3] ? m[3].trim() : null,
			m[4] ? m[4].trim() : null
		);
	}

	// Stufe 2: Klammer-Blöcke, jeder kann mehrere Sub-Citations enthalten
	PAREN_BLOCK_RE.lastIndex = 0;
	let blockMatch: RegExpExecArray | null;
	while ((blockMatch = PAREN_BLOCK_RE.exec(paragraph.text)) !== null) {
		const blockContent = blockMatch[1];
		const blockOffset = blockMatch.index + 1;
		SUB_CITATION_RE.lastIndex = 0;
		let sm: RegExpExecArray | null;
		while ((sm = SUB_CITATION_RE.exec(blockContent)) !== null) {
			pushCitation(
				blockOffset + sm.index,
				sm[0],
				sm[1].trim(),
				sm[2].trim(),
				sm[3] ? sm[3].trim() : null,
				sm[4] ? sm[4].trim() : null
			);
		}
	}

	return found.sort((a, b) => a.matchOffsetInParagraph - b.matchOffsetInParagraph);
}

// ── Cross-Referenz Inline -> Bibliografie ──────────────────────────

interface BibIndexEntry {
	id: string;
	first_author_lastname: string | null;
	year: string | null;
	year_suffix: string | null;
}

async function loadBibliographyIndex(documentId: string): Promise<BibIndexEntry[]> {
	return (await query<BibIndexEntry>(
		`SELECT id, first_author_lastname, year, year_suffix
		 FROM bibliography_entries
		 WHERE document_id = $1
		   AND first_author_lastname IS NOT NULL
		   AND year IS NOT NULL`,
		[documentId]
	)).rows;
}

function resolveCitation(
	citation: Omit<InlineCitation, 'bibliographyEntryIds'>,
	bibIndex: BibIndexEntry[]
): string[] {
	if (citation.authorsCanonical.length === 0) return [];
	const lastname = citation.authorsCanonical[0];
	const year = citation.year;
	const suffix = citation.yearSuffix;

	const matches = bibIndex.filter(
		(e) => e.first_author_lastname === lastname && e.year === year
	);
	if (suffix) {
		const exact = matches.filter((e) => e.year_suffix === suffix);
		if (exact.length > 0) return exact.map((e) => e.id);
	}
	return matches.map((e) => e.id);
}

// ── Verweisprofil-Aggregation ──────────────────────────────────────

export interface ParagraphCitationSignature {
	paragraphId: string;
	paragraphIndex: number;
	citationCount: number;
	authorsAtParagraph: string[];
	dominantAuthor: string | null;
	citationDensityPerKChars: number;
}

export interface AuthorMentionStats {
	author: string;
	mentions: number;
	paragraphIds: string[];
	firstParagraphIndex: number;
}

export interface VerweisProfile {
	containerHeading: string;
	citationCount: number;
	paragraphCount: number;
	uniqueAuthorCount: number;
	citations: InlineCitation[];
	byAuthor: AuthorMentionStats[];
	byParagraph: ParagraphCitationSignature[];
	firstMentionOrder: string[];
	density: {
		paragraphsWithCitation: number;
		paragraphsWithoutCitation: number;
		maxCitationsInOneParagraph: number;
		meanCitationsPerParagraph: number;
		hhi: number;
		topAuthorShare: number;
		top3AuthorShare: number;
		maxConsecutiveParagraphsDominatedByAuthor: number;
		consecutiveDominanceAuthor: string | null;
	};
	coverage: {
		totalCitations: number;
		resolvedCitations: number;
		orphanCitations: number;
	};
}

function buildVerweisProfile(
	container: GrundlagentheorieContainer,
	bibIndex: BibIndexEntry[]
): VerweisProfile {
	// 1. Inline-Citations + Cross-Reference
	const citations: InlineCitation[] = [];
	for (const p of container.paragraphs) {
		for (const raw of extractInlineCitations(p)) {
			citations.push({
				...raw,
				bibliographyEntryIds: resolveCitation(raw, bibIndex),
			});
		}
	}

	// 2. Aggregation by author
	const authorMap = new Map<
		string,
		{ author: string; mentions: number; paragraphIds: Set<string>; firstParagraphIndex: number }
	>();
	const firstMention: string[] = [];
	for (const c of citations) {
		for (const author of c.authorsCanonical) {
			let entry = authorMap.get(author);
			if (!entry) {
				entry = {
					author,
					mentions: 0,
					paragraphIds: new Set<string>(),
					firstParagraphIndex: c.paragraphIndex,
				};
				authorMap.set(author, entry);
				firstMention.push(author);
			}
			entry.mentions += 1;
			entry.paragraphIds.add(c.paragraphId);
		}
	}
	const byAuthor: AuthorMentionStats[] = Array.from(authorMap.values())
		.map((e) => ({
			author: e.author,
			mentions: e.mentions,
			paragraphIds: Array.from(e.paragraphIds),
			firstParagraphIndex: e.firstParagraphIndex,
		}))
		.sort((a, b) => b.mentions - a.mentions || a.firstParagraphIndex - b.firstParagraphIndex);

	// 3. By-Paragraph-Signaturen
	const byParagraph: ParagraphCitationSignature[] = container.paragraphs.map((p) => {
		const cs = citations.filter((c) => c.paragraphId === p.paragraphId);
		const authorCount = new Map<string, number>();
		for (const c of cs) {
			for (const a of c.authorsCanonical) {
				authorCount.set(a, (authorCount.get(a) ?? 0) + 1);
			}
		}
		let dominant: string | null = null;
		let dominantCount = 0;
		for (const [a, n] of authorCount) {
			if (n > dominantCount) {
				dominant = a;
				dominantCount = n;
			}
		}
		const charLength = Math.max(1, p.charEnd - p.charStart);
		return {
			paragraphId: p.paragraphId,
			paragraphIndex: p.indexInContainer,
			citationCount: cs.length,
			authorsAtParagraph: Array.from(authorCount.keys()),
			dominantAuthor: dominant,
			citationDensityPerKChars: Number(((cs.length / charLength) * 1000).toFixed(3)),
		};
	});

	// 4. Konzentrationsmaße über Citations (HHI über alle Author-Mentions)
	const totalMentions = citations.reduce((acc, c) => acc + c.authorsCanonical.length, 0);
	let hhi = 0;
	let topShare = 0;
	let top3Share = 0;
	if (totalMentions > 0) {
		const shares = byAuthor.map((a) => a.mentions / totalMentions);
		hhi = shares.reduce((acc, s) => acc + s * s, 0);
		topShare = shares[0] ?? 0;
		top3Share = shares.slice(0, 3).reduce((acc, s) => acc + s, 0);
	}

	// 5. Konsekutiv-Dominanz: längste Kette aufeinanderfolgender ¶,
	// in denen der gleiche Autor dominiert (Reproduktions-Block-Indikator).
	let maxConsec = 0;
	let consecAuthor: string | null = null;
	let runAuthor: string | null = null;
	let runLength = 0;
	for (const sig of byParagraph) {
		if (sig.dominantAuthor && sig.dominantAuthor === runAuthor) {
			runLength += 1;
		} else {
			runAuthor = sig.dominantAuthor;
			runLength = sig.dominantAuthor ? 1 : 0;
		}
		if (runLength > maxConsec && runAuthor) {
			maxConsec = runLength;
			consecAuthor = runAuthor;
		}
	}

	// 6. Density-Felder
	const paragraphsWithCitation = byParagraph.filter((b) => b.citationCount > 0).length;
	const maxCitationsInOneParagraph = byParagraph.reduce(
		(acc, b) => Math.max(acc, b.citationCount),
		0
	);
	const meanCitationsPerParagraph =
		container.paragraphs.length > 0 ? citations.length / container.paragraphs.length : 0;

	// 7. Coverage
	const resolved = citations.filter((c) => c.bibliographyEntryIds.length > 0).length;

	return {
		containerHeading: container.headingText,
		citationCount: citations.length,
		paragraphCount: container.paragraphs.length,
		uniqueAuthorCount: authorMap.size,
		citations,
		byAuthor,
		byParagraph,
		firstMentionOrder: firstMention,
		density: {
			paragraphsWithCitation,
			paragraphsWithoutCitation: container.paragraphs.length - paragraphsWithCitation,
			maxCitationsInOneParagraph,
			meanCitationsPerParagraph: Number(meanCitationsPerParagraph.toFixed(3)),
			hhi: Number(hhi.toFixed(4)),
			topAuthorShare: Number(topShare.toFixed(4)),
			top3AuthorShare: Number(top3Share.toFixed(4)),
			maxConsecutiveParagraphsDominatedByAuthor: maxConsec,
			consecutiveDominanceAuthor: consecAuthor,
		},
		coverage: {
			totalCitations: citations.length,
			resolvedCitations: resolved,
			orphanCitations: citations.length - resolved,
		},
	};
}

async function persistVerweisProfile(
	caseId: string,
	documentId: string,
	container: GrundlagentheorieContainer,
	profile: VerweisProfile
): Promise<string> {
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: profile,
	};
	const anchorIds = container.paragraphs.map((p) => p.paragraphId);
	if (anchorIds.length === 0) {
		throw new Error(
			`VERWEIS_PROFIL: Container "${container.headingText}" hat keine Paragraphen.`
		);
	}
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'GRUNDLAGENTHEORIE', 'VERWEIS_PROFIL', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			anchorIds,
			JSON.stringify(profile),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error(`Failed to persist VERWEIS_PROFIL for ${container.headingText}`);
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface GrundlagentheoriePassResult {
	caseId: string;
	documentId: string;
	bibliography: {
		entryCount: number;
		parsedAuthorYear: number;
		unparsedRawOnly: number;
	};
	containers: Array<{
		headingId: string;
		headingText: string;
		paragraphCount: number;
		profile: VerweisProfile;
		verweisProfileConstructId: string;
	}>;
}

export async function runGrundlagentheoriePass(
	caseId: string,
	options: { persistConstructs?: boolean } = {}
): Promise<GrundlagentheoriePassResult> {
	const persistConstructs = options.persistConstructs !== false;

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const containers = await loadGrundlagentheorieContainers(documentId);
	if (containers.length === 0) {
		throw new Error(
			`Werk ${documentId} hat keinen GRUNDLAGENTHEORIE-Container — ` +
			`erst FUNKTIONSTYP_ZUWEISEN-Vor-Heuristik laufen oder Outline-UI manuell setzen.`
		);
	}

	// Bibliografie: persistConstructs=true => INSERT (idempotent), sonst nur lesen.
	let bibEntries: BibliographyExtractedEntry[] = [];
	if (persistConstructs) {
		bibEntries = await persistBibliography(caseId, documentId);
	} else {
		const existing = await loadBibliographyIndex(documentId);
		bibEntries = existing.map((e) => ({
			paragraphId: '',
			charStart: 0,
			charEnd: 0,
			rawText: '',
			firstAuthorLastname: e.first_author_lastname,
			year: e.year,
			yearSuffix: e.year_suffix,
		}));
	}
	const parsedAuthorYear = bibEntries.filter(
		(e) => e.firstAuthorLastname && e.year
	).length;

	const bibIndex = await loadBibliographyIndex(documentId);

	const out: GrundlagentheoriePassResult['containers'] = [];
	for (const c of containers) {
		const profile = buildVerweisProfile(c, bibIndex);
		let constructId = '';
		if (persistConstructs) {
			constructId = await persistVerweisProfile(caseId, documentId, c, profile);
		}
		out.push({
			headingId: c.headingId,
			headingText: c.headingText,
			paragraphCount: c.paragraphs.length,
			profile,
			verweisProfileConstructId: constructId,
		});
	}

	return {
		caseId,
		documentId,
		bibliography: {
			entryCount: bibEntries.length,
			parsedAuthorYear,
			unparsedRawOnly: bibEntries.length - parsedAuthorYear,
		},
		containers: out,
	};
}
