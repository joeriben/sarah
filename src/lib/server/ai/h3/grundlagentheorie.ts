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
//
// Klammer-zentrierte Heuristik (statt Author-Pattern-Karneval):
// Diagnostisches Merkmal eines Verweises ist die Verweis-Struktur in
// der Klammer — 4-Ziffer-Year (mit/ohne Seiten-Tail) oder Verweis-Marker
// (aaO/a.a.O./ebd.). Author-Familienname wird sekundär aus dem Sub-Block
// selbst oder aus dem Fließtext direkt vor der Klammer extrahiert.

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

// Klammer-Block: alle (...) im Text — non-greedy, keine geschachtelten Klammern.
const PAREN_BLOCK_RE = /\(([^()]+)\)/g;

// 4-Ziffer-Year: 18xx/19xx/20xx, optional mit Suffix-Buchstabe.
const YEAR_RE = /\b((?:18|19|20)\d{2})([a-z])?\b/;

// Year-Range "1833–1911" / "1833-1911" — typisch Lebensdaten oder Zeitraum,
// kein Verweis. Wird vor der Verweis-Klassifikation aus dem Sub-Block-Inhalt
// rausgeschnitten, damit die einzelnen Years nicht fälschlich als Citation-
// Year gefangen werden.
const YEAR_RANGE_RE = /\b(?:18|19|20)\d{2}\s*[–-]\s*(?:18|19|20)?\d{2}\b/g;

// Verweis-Marker als Year-Ersatz. Treffer auf "ebd.", "ebda.", "aaO",
// "a.a.O.", "ders.", "dies." — gleichwertig zu einer Year-Position
// (kein konkreter Jahrgang, aber ein gerichteter Verweis-Anker).
const REFERENCE_MARKER_RE = /\b(?:ebd\.?|ebda\.?|a\.?\s*a\.?\s*O\.?|aaO|ders\.?|dies\.?)\b/i;

// Seiten-Tail nach Year/Marker. Trenner-Sequenz akzeptiert mehrere Trenner
// (z.B. ", S. 3" = `,` + `S.`), dann arabische/römische Ziffer + optional
// Range/`f`/`ff`. `S.`/`p.` darf einzeln stehen, ebenfalls `,`/`;`/`:`.
const PAGE_TAIL_RE = /^\s*(?:[,:;]\s*)?(?:S\.?|p\.?)?\s*([IVXLCDMivxlcdm]+|\d{1,4})((?:\s*[–-]\s*\d{1,4})?(?:\s*ff?\.?)?)/;

// Datums-/Zeit-Phrasen-Stop-Wörter, die die Author-Position einer Klammer-
// Citation belegen können ("(Stand 2022)", "(Anfang 2022)", "(Im Jahr 2022)").
// Die Klammer-Heuristik ist robust gegen False-Positive-Wartung, aber diese
// kleine Liste fängt die typische Datums-Klammer-Klasse vor der Year-
// Position ab, ohne zur Stop-Liste-Wartung des alten Author-Patterns
// zurückzukehren. Greift nur am ANFANG des Sub-Block-Author-Teils.
const DATE_PHRASE_STOPWORDS = new Set<string>([
	'Stand', 'Anfang', 'Beginn', 'Ende', 'Mitte', 'Schluss',
	'Jahr', 'Jahrgang', 'Tag', 'Monat', 'Woche',
	'Im', 'Am', 'Um', 'Seit', 'Bis', 'Vor', 'Nach', 'Ab',
	'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
	'August', 'September', 'Oktober', 'November', 'Dezember',
]);

// Author-Teil VOR Year/Marker innerhalb eines Sub-Blocks. Greift greedy
// alles vor dem Year, trimmt dann auf den Familiennamen. Beispiele:
//   "Klafki, 2007"           → "Klafki"
//   "Klafki & Meyer, 2007"   → "Klafki & Meyer"
//   "Bohnsack et al. 2010"   → "Bohnsack et al."
//   "vgl. Klafki 2007"       → "vgl. Klafki" (Präfix wird gestrippt)
// Author-Marker-Präfixe werden vor der Author-Extraktion entfernt.
const CITATION_PREFIX_RE = /^\s*(?:vgl\.?|siehe|s\.|cf\.?|kritisch\s+dazu|auch|so\s+(?:auch|schon|bereits)|hierzu)\s+/i;

// Mehrautoren-Marker im Author-Teil, alle Schreib-Varianten.
const ET_AL_RE = /\s+(?:et\.?\s+al\.?|u\.?\s*a\.|e\.?\s*a\.)/i;

// Author-Splitter für authorsCanonical (mehrere Autoren in EINEM Verweis).
const AUTHOR_SPLIT_RE = /\s*(?:[\/&]|\bund\b)\s*/;

// Sub-Block-Trenner innerhalb einer Klammer: Semikolon ist eindeutig,
// Komma nur wenn es nicht der Seiten-Trenner ist (vor 4-Ziffer-Year ist
// Komma der Author-Year-Trenner; nach Year ist Komma der Page-Trenner).
// Wir splitten primär per `;`, dann per `,` mit der Heuristik:
// Komma trennt nur, wenn der Folge-Block selbst ein Year/Marker enthält.
function splitParenIntoSubBlocks(content: string): string[] {
	const semiBlocks = content.split(/\s*;\s*/);
	const out: string[] = [];
	for (const sb of semiBlocks) {
		// Komma-Split nur, wenn es einen weiteren Year/Marker im Folge-Teil gibt.
		// Erkennung: nach jedem Komma prüfen, ob das Folge-Stück eigenes Year/Marker hat.
		const parts = sb.split(/\s*,\s*/);
		if (parts.length === 1) {
			out.push(sb);
			continue;
		}
		// Greedy-Reassemble: starte mit parts[0], hänge folgende Teile an,
		// bis ein Teil mit Year/Marker beginnt — dann ist das ein neuer Sub-Block.
		let buf = parts[0];
		for (let i = 1; i < parts.length; i++) {
			const next = parts[i];
			// "Beginnt mit Author + Year" oder reine Year-Klammer?
			// Heuristik: enthält der Teil ein 4-Ziffer-Year UND beginnt er mit
			// einem Großbuchstaben oder Verweis-Marker — separater Sub-Block.
			const startsLikeNewCitation =
				(YEAR_RE.test(next) && /^\s*(?:[A-ZÄÖÜ]|vgl\.|siehe|s\.|cf\.|ebd|ders|dies)/i.test(next)) ||
				REFERENCE_MARKER_RE.test(next.split(/\s+/)[0] ?? '');
			if (startsLikeNewCitation) {
				out.push(buf);
				buf = next;
			} else {
				buf += ', ' + next;
			}
		}
		out.push(buf);
	}
	return out.map((s) => s.trim()).filter(Boolean);
}

// Author aus Sub-Block oder Fließtext extrahieren.
// Im Sub-Block: alles vor Year/Marker, Präfixe gestrippt, "et al." entfernt.
// Aus Fließtext (für reine Year-Klammer "(2007)"): bis zu 4 Tokens vor `(`,
// die mit Großbuchstabe beginnen und über `&`/`/`/`und` verbunden sind.
function extractAuthorFromSubBlock(subBlock: string, yearOffset: number): string {
	const beforeYear = subBlock.slice(0, yearOffset).trim();
	if (!beforeYear) return '';
	let s = beforeYear.replace(CITATION_PREFIX_RE, '');
	s = s.replace(ET_AL_RE, '').trim();
	// Trailing-Komma vom Author-Year-Trenner.
	s = s.replace(/[,;]\s*$/, '').trim();
	return s;
}

// Plausibilitätsprüfung: Author-Teil eines Sub-Blocks darf nicht aussehen
// wie ein freier Fließsatz. Heuristiken:
//   - leere Klammer-Sätze ("vgl. ", "siehe") nach Präfix-Strip: kein Author
//   - >5 Wörter (typische Author-Konstruktion ist max. 3 Wörter pro Author,
//     plus Trenner und et al.; >5 Wörter im Author-Teil = Fließsatz)
//   - erstes Token in DATE_PHRASE_STOPWORDS = Datums-Klammer
function isPlausibleAuthorString(s: string): boolean {
	if (!s) return false;
	const tokens = s.split(/\s+/);
	if (tokens.length === 0) return false;
	const first = tokens[0].replace(/[.,;:]$/, '');
	if (DATE_PHRASE_STOPWORDS.has(first)) return false;
	// Erstes Token muss mit Großbuchstabe, Adels-Prefix oder Anonymisierungs-
	// Marker `[NAME_…]` beginnen. Lowercase-Akronyme (bpb, adyard) bleiben
	// damit weiterhin außen vor — konsistent mit der vorigen Heuristik.
	if (!/^(?:[A-ZÄÖÜ]|von|de|da|le|la|van|der|den|du|del|\[)/.test(first)) return false;
	// Lowercase-Wort-Anteil im Author-Teil: typische Citation hat max. 1
	// Lowercase-Token (Adels-Prefix oder "und"). Mehr deutet auf Fließsatz
	// hin ("Facebook im Vergleich knackte im Jahr 2022"). "et al."/"u.a."
	// wurde vorher schon abgestreift.
	const lcConnectors = new Set(['und', 'von', 'de', 'da', 'le', 'la', 'van', 'der', 'den', 'du', 'del']);
	const lcCount = tokens.filter(
		(t) => /^[a-zäöüß]/.test(t) && !lcConnectors.has(t.replace(/[.,;:]$/, '').toLowerCase())
	).length;
	if (lcCount > 1) return false;
	return true;
}

function extractAuthorFromFlow(textBefore: string): string {
	// Backwards bis zu 60 Zeichen, dann letzte Author-ähnliche Sequenz.
	// Akzeptiert: Tokens mit Großbuchstabe, optional Adels-Prefix (von/de/da/…),
	// verbunden mit `&` / `/` / `und`, optional gefolgt von `et al.`.
	const tail = textBefore.slice(-80);
	const m = tail.match(
		/((?:(?:von|de|da|le|la|van|der|den|du|del)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß'-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß'-]*){0,2}(?:\s+(?:et\.?\s+al\.?|u\.?\s*a\.|e\.?\s*a\.))?(?:\s*(?:[\/&]|\bund\b)\s*(?:(?:von|de|da|le|la|van|der|den|du|del)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß'-]*)*)\s*$/u
	);
	if (!m) return '';
	return m[1].replace(ET_AL_RE, '').trim();
}

function splitAuthorString(s: string): string[] {
	if (!s) return [];
	return s
		.replace(ET_AL_RE, '')
		.split(AUTHOR_SPLIT_RE)
		.map((a) => a.trim())
		.filter(Boolean);
}

// Aus dem Author-String den Familiennamen für Bibliografie-Cross-Ref ziehen.
// Greift das letzte groß-geschriebene Token (Adels-Prefix wird mitgenommen,
// wenn als Doppelname-Bestandteil erkennbar).
function familyNameOf(author: string): string {
	const trimmed = author.trim();
	if (!trimmed) return '';
	// "Castro Varela" → "Castro Varela" (Mehrwort bleibt erhalten — bibliography_entries
	// hat den Mehrwort-Namen typisch auch als Erstauthor).
	// "von Saldern" → "von Saldern".
	return trimmed;
}

export function extractInlineCitations(
	paragraph: GrundlagentheorieParagraph
): Array<Omit<InlineCitation, 'bibliographyEntryIds'>> {
	const found: Array<Omit<InlineCitation, 'bibliographyEntryIds'>> = [];
	const text = paragraph.text;

	PAREN_BLOCK_RE.lastIndex = 0;
	let blockMatch: RegExpExecArray | null;
	while ((blockMatch = PAREN_BLOCK_RE.exec(text)) !== null) {
		const blockContent = blockMatch[1];
		const blockOffsetInText = blockMatch.index + 1; // +1 für die öffnende Klammer
		const textBeforeBlock = text.slice(0, blockMatch.index);

		const subBlocks = splitParenIntoSubBlocks(blockContent);
		// Cursor für Sub-Block-Position innerhalb des Klammer-Inhalts.
		let cursor = 0;

		for (const sub of subBlocks) {
			const subStartInBlock = blockContent.indexOf(sub, cursor);
			const subOffset = subStartInBlock < 0 ? cursor : subStartInBlock;
			cursor = subOffset + sub.length;

			// Year-Range "1833–1911" (Lebensdaten/Zeitraum) — kein Verweis.
			// Sub-Block, der nur Year-Range enthält und sonst nichts Citation-
			// Artiges, wird übersprungen. Range-Treffer maskieren wir aus dem
			// Sub-Block, bevor das Single-Year-Pattern greift.
			YEAR_RANGE_RE.lastIndex = 0;
			let cleanedSub = sub;
			let rangeM: RegExpExecArray | null;
			while ((rangeM = YEAR_RANGE_RE.exec(sub)) !== null) {
				cleanedSub =
					cleanedSub.slice(0, rangeM.index) +
					'_'.repeat(rangeM[0].length) +
					cleanedSub.slice(rangeM.index + rangeM[0].length);
			}
			const yearMatch = cleanedSub.match(YEAR_RE);
			const markerMatch = sub.match(REFERENCE_MARKER_RE);

			let year: string;
			let yearSuffix: string | null;
			let anchorOffsetInSub: number;
			let anchorLength: number;

			if (yearMatch && yearMatch.index !== undefined) {
				year = yearMatch[1];
				yearSuffix = yearMatch[2] ?? null;
				anchorOffsetInSub = yearMatch.index;
				anchorLength = yearMatch[0].length;
			} else if (markerMatch && markerMatch.index !== undefined) {
				// Verweis-Marker statt Year — kein konkreter Jahrgang, aber
				// gerichteter Anker. Year bleibt leer als Marker für "marker-only".
				year = '';
				yearSuffix = null;
				anchorOffsetInSub = markerMatch.index;
				anchorLength = markerMatch[0].length;
			} else {
				// Kein Year, kein Marker → kein Verweis.
				continue;
			}

			// Page-Tail direkt nach Year/Marker (^-Anker, akzeptiert mehrere Trenner).
			const afterAnchor = sub.slice(anchorOffsetInSub + anchorLength);
			const pageMatch = afterAnchor.match(PAGE_TAIL_RE);
			let page: string | null = null;
			if (pageMatch) {
				page = ((pageMatch[1] ?? '') + (pageMatch[2] ?? '')).trim() || null;
			}

			// Author primär aus Sub-Block (vor Year/Marker), sekundär aus Fließtext.
			let authorString = extractAuthorFromSubBlock(sub, anchorOffsetInSub);
			let authorFromFlow = false;
			if (!authorString && year) {
				// Reine Year-Klammer "(2007)" — nur wenn es der ERSTE Sub-Block ist
				// (sonst stammt der Fließtext-Author vom vorigen Sub-Block).
				if (subBlocks.indexOf(sub) === 0) {
					authorString = extractAuthorFromFlow(textBeforeBlock);
					authorFromFlow = true;
				}
			}

			// Plausibilitäts-Filter für Sub-Block-Author. Greift nicht für
			// Fließtext-Author (dessen Pattern ist bereits eng) und nicht für
			// Marker-only (z.B. "(ebd.)" — kein Author erwartet).
			if (year && authorString && !authorFromFlow) {
				if (!isPlausibleAuthorString(authorString)) continue;
			}

			// Marker-only ohne Author-Quelle — droppen (z.B. "(im Jahr 2022)" das
			// als Marker durchrutscht; muss aber selten vorkommen).
			if (!year && !authorString) continue;

			const authorsCanonical = splitAuthorString(authorString).map(familyNameOf);
			const finalAuthors =
				authorsCanonical.length > 0 ? authorsCanonical : ['unknown'];

			found.push({
				rawMatch: sub.trim(),
				authorString: authorString || 'unknown',
				authorsCanonical: finalAuthors,
				year,
				yearSuffix,
				page,
				paragraphId: paragraph.paragraphId,
				paragraphIndex: paragraph.indexInContainer,
				matchOffsetInParagraph: blockOffsetInText + subOffset + anchorOffsetInSub,
			});
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
	if (!citation.year) return []; // Marker-only (ebd./aaO) hat keinen Bib-Anker.
	const lastname = citation.authorsCanonical[0];
	if (lastname === 'unknown') return [];
	const year = citation.year;
	const suffix = citation.yearSuffix;
	// Erstes Token vergleichen — Mehrwort-Inline-Authors ("Castro Varela")
	// matchen so auch eine Bib-Entry, die nur "Castro" als first_author_lastname
	// trägt (BIB_FIRST_AUTHOR_RE erfasst nur das erste Token).
	const inlineFirst = lastname.split(/\s+/)[0];

	const matches = bibIndex.filter(
		(e) => e.first_author_lastname === inlineFirst && e.year === year
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
