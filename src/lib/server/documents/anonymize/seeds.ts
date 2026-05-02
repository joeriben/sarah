// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Deterministischer Seed-Extraktor für die Anonymisierung (Use Case 1).
//
// Port von sacanev/backend/privacy.py @ d474667 — Konzept identisch
// (Frontmatter-Window-Scan + Label-getriggerte Person-Name-Extraktion +
// Regex-basierte Email-/Matrikel-/Student-ID-Extraktion), erweitert um
// breite Mehrsprachigkeit (DE/EN/FR/ES/IT/PT/NL/PL/CS/SV/DA/NO/FI/EL/
// TR/RU/JA/ZH/AR — soweit Label-basiert sinnvoll greifbar).
//
// Aufgabe: aus dem Volltext eines Dokuments diejenigen Strings finden,
// die später durch Platzhalter ersetzt werden müssen UND danach als
// PII-Seeds für den Failsafe-Tripwire persistiert bleiben.

export type SeedCategory =
	| 'person_name'
	| 'email'
	| 'matrikel'
	| 'student_id'
	| 'institution'
	| 'project'
	| 'self_citation';

export type SeedRole = 'author' | 'supervisor' | 'examiner' | 'subject' | 'other' | null;

export type SeedSource =
	| 'frontmatter_label'
	| 'regex_email'
	| 'regex_matrikel'
	| 'regex_student_id'
	| 'llm_assisted';

export interface ReplacementSeed {
	category: SeedCategory;
	role: SeedRole;
	value: string;          // Originalwert wie im Dokument
	variants: string[];     // alternative Schreibweisen
	replacement: string;    // [NAME_001] etc.
	source: SeedSource;
}

// ── Patterns ──────────────────────────────────────────────────────────

// Akademische Titel & Anredeformen, die bei Namens-Heuristik herausgekürzt
// werden (sonst würde "Prof. Dr. Max Mustermann" als 4-Token-Name geparst).
// Multi-language: deutsche, englische, romanische, slawische Titel.
const TITLE_PREFIX_RE =
	/\b(?:prof(?:essor)?|dr|ph\.?\s*d|m\.?\s*a|b\.?\s*a|m\.?\s*sc|b\.?\s*sc|hon|priv[.-]?doz|sir|mr|mrs|ms|mme|m\.|sra|sr|dipl[.-]?ing|mag|doc|kand|ass)\.?(?=\b)/gi;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// Matrikel/Student-ID-Patterns — explizit gelabelt (z.B. "Matrikelnummer:
// 12345678"). Kein freier Number-Scan, weil False-Positives auf Datums-
// und Seitennummern.
const STUDENT_ID_RE =
	/\b(?:matrikel(?:nummer|nr\.?)?|student(?:en)?(?:nummer|id|number)|registration\s*number|n(?:o|um)\.?\s*(?:d[''']?)?(?:étudiant|estudiante|matr[ií]cula)|n[ºo°]?\s*matr[ií]cul[oa]|registrazione|n[uú]mero\s*de\s*matr[íi]cula)\s*[:#-]?\s*([A-Z]?\d[\d\s./-]{3,}\d)\b/gi;

// Stoppt das Frontmatter-Fenster, sobald die erste eigentliche Kapitel-
// überschrift kommt. Multi-language: "Einleitung / Introduction / Resumen
// / Introduzione / Wstęp / Inledning / 序論 / 引言 / المقدمة" usw.
const FRONTMATTER_STOP_RE =
	/^\s*(?:\d+(?:\.\d+)*\s+)?(?:einleitung|einf(?:ue|ü)hrung|introduction|introduzione|introducci[oó]n|introdu[cç][aã]o|inleiding|wst[eę]p|[uú]vod|inledning|indledning|innledning|johdanto|εισαγωγή|giri[şs]|введение|序論|序論|序章|引言|前言|序|chapter\s+1|chapitre\s+1|kapitel\s+1|cap[ií]tulo\s+1|capitolo\s+1|hoofdstuk\s+1|rozdzia[lł]\s+1|kapitola\s+1|kapitel\s+ett|αʹ\s*κεφάλαιο|глава\s+1|第一章|الفصل\s+الأول|المقدمة|مقدمة)\b/im;

// Token-Klasse für plausible Namen (groß-anfangende Wörter, Initialen,
// Bindestriche). Cyrillic + Greek + CJK + Arabisch via expliziter Range.
const NAME_TOKEN_RE =
	/[A-ZÄÖÜÅÆØÉÈÊËÍÌÎÏÓÒÔÕÚÙÛÝÇŁŃŚŹŻŠČĆĐÀ-ɏͰ-ϿЀ-ӿ一-鿿぀-ゟ゠-ヿ؀-ۿ][A-Za-zÄÖÜäöüßåæøéèêëíìîïóòôõúùûýçłńśźżšščćđÀ-ɏͰ-ϿЀ-ӿ一-鿿぀-ゟ゠-ヿ؀-ۿ.'’-]{1,}|[A-Z]\./g;

// Wörter, die an einem "Name"-Slot stehen, aber sicher KEIN Personenname sind.
// Multi-language Hochschul-/Arbeits-Vokabular.
const NAME_BLOCKLIST = new Set([
	// DE
	'arbeit', 'abschlussarbeit', 'bachelor', 'bachelorarbeit', 'master', 'masterarbeit',
	'diplomarbeit', 'magisterarbeit', 'doktorarbeit', 'dissertation', 'habilitation',
	'einleitung', 'fachbereich', 'fakultaet', 'fakultät', 'hochschule', 'institut',
	'lehrstuhl', 'seminar', 'thesis', 'universitaet', 'universität', 'department',
	// EN
	'university', 'college', 'school', 'institute', 'faculty', 'chair', 'introduction',
	// FR
	'université', 'universite', 'faculté', 'faculte', 'école', 'ecole', 'institut',
	'département', 'departement', 'mémoire', 'memoire',
	// ES
	'universidad', 'facultad', 'escuela', 'instituto', 'departamento', 'tesis',
	// IT
	'università', 'universita', 'facoltà', 'facolta', 'scuola', 'istituto', 'dipartimento', 'tesi',
	// PT
	'universidade', 'faculdade', 'escola', 'instituto', 'departamento', 'tese', 'dissertação',
	// NL
	'universiteit', 'faculteit', 'school', 'instituut', 'afdeling', 'scriptie',
	// PL
	'uniwersytet', 'wydział', 'wydzial', 'instytut', 'katedra', 'praca',
	// SV/DA/NO/FI
	'universitet', 'fakultet', 'institut', 'institution', 'avhandling', 'opinnäytetyö',
	// CS
	'univerzita', 'fakulta', 'ústav', 'ustav', 'katedra', 'práce', 'prace'
]);

interface LabelPattern {
	pattern: RegExp;
	role: SeedRole;
}

// Label-Patterns: Wort/Phrase, die VOR einem Namen steht.
// Mehrsprachig, "max. 2-3 Termini pro Sprache" (User-Setzung).
const NAME_LABELS: LabelPattern[] = [
	// Author-Labels — sehr spezifisch (beste Vertrauenswürdigkeit)
	{
		pattern: /\b(?:vorgelegt|eingereicht|verfasst|abgegeben|presented|submitted|prepared|written|presented[ée]e?|soumis(?:e)?|pr[ée]sent[ée]e?|elaborada\s+por|presentada|presentato|apresentado|ingeleverd|przedstawiona\s+przez|zlo[zż]ony\s+przez|inskickad|indleveret|innlevert|esitetty)\s+(?:von|by|par|de|por|da|door|przez|av|af|tarafından|представлена)\b/i,
		role: 'author'
	},
	// Author / Verfasser — Generic
	{
		pattern: /\b(?:autor(?:in)?|author|verfasser(?:in)?|bearbeiter(?:in)?|kandidat(?:in)?|student(?:in)?|name|auteur(?:e)?|autore|autora?|auteur|tekijä|skribent|forfatter|szerz[oő]|αυτή|yazar|автор)\b/i,
		role: 'author'
	},
	// Supervisor / Betreuer / Gutachter
	{
		pattern: /\b(?:betreuer(?:in)?|erstgutachter(?:in)?|zweitgutachter(?:in)?|drittgutachter(?:in)?|pr(?:ue|ü)fer(?:in)?|gutachter(?:in)?|supervisor|advisor|examiner|director\s+of\s+studies|directeur(?:\s+de\s+th[èe]se)?|directrice|directora?|relatore|relatrice|orientador(?:a)?|begeleider|promotor|promotorin|opiekun|veiledere?|handledare|ohjaaja|επιβλέπων|epibl[eé]p[ōo]n|jury)\b/i,
		role: 'supervisor'
	}
];

// Reines "Author:"-Label auf eigener Zeile (Name folgt auf Folgezeile).
const NEXT_LINE_NAME_LABEL_RE =
	/^(?:vorgelegt\s+von|eingereicht\s+von|verfasst\s+von|submitted\s+by|presented\s+by|written\s+by|prepared\s+by|autor(?:in)?|author|verfasser(?:in)?|name|nom|nombre|nome|naam|imi[eę]\s+i\s+nazwisko|jméno|navn|namn|nimi|όνομα|ad|имя|nom\s+de\s+l[''']auteur|nombre\s+del\s+autor)\s*:?\s*$/i;

// ── Frontmatter ──────────────────────────────────────────────────────

export function extractFrontmatter(text: string, maxChars = 10000): string {
	const window = text.slice(0, maxChars);
	const m = FRONTMATTER_STOP_RE.exec(window);
	if (m && m.index > 200) {
		return window.slice(0, m.index);
	}
	return window;
}

// ── Plausibility: looksLikePersonName ────────────────────────────────

export function stripTitles(value: string): string {
	return collapseSpaces(value.replace(TITLE_PREFIX_RE, '')).replace(/^[ ,;:.-]+|[ ,;:.-]+$/g, '');
}

export function collapseSpaces(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

export function looksLikePersonName(value: string): boolean {
	let cleaned = stripTitles(value);
	cleaned = cleaned.replace(/\([^)]*\)/g, '');
	const lower = cleaned.toLowerCase();
	for (const term of NAME_BLOCKLIST) {
		if (lower.includes(term)) return false;
	}
	const normalized = cleaned.replace(/,/g, ' ');
	const tokens = normalized.match(NAME_TOKEN_RE) ?? [];
	if (tokens.length < 2 || tokens.length > 5) return false;
	const tokenText = tokens.join(' ');
	if (tokenText.length < 5) return false;
	for (const t of tokens) {
		if (!t.endsWith('.') && !/^[A-ZÄÖÜÅÆØÀ-ɏͰ-ϿЀ-ӿ一-鿿぀-ゟ゠-ヿ؀-ۿ]/.test(t)) {
			return false;
		}
	}
	return true;
}

// ── Person Name Candidates ───────────────────────────────────────────

interface PersonNameCandidate {
	role: SeedRole;
	value: string;
}

export function personNameCandidates(frontmatter: string): PersonNameCandidate[] {
	const lines = frontmatter
		.split(/\r?\n/)
		.map((l) => collapseSpaces(l.replace(/^[ \-*\t]+|[ \-*\t]+$/g, '')));

	const candidates: PersonNameCandidate[] = [];

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx];
		if (!line) continue;

		for (const lbl of NAME_LABELS) {
			const m = lbl.pattern.exec(line);
			if (!m) continue;
			const tail = line.slice(m.index + m[0].length).replace(/^[ :,\-\t]+/, '');
			if (tail && looksLikePersonName(tail)) {
				candidates.push({ role: lbl.role, value: tail });
			} else if (idx + 1 < lines.length && looksLikePersonName(lines[idx + 1])) {
				candidates.push({ role: lbl.role, value: lines[idx + 1] });
			}
		}

		if (NEXT_LINE_NAME_LABEL_RE.test(line) && idx + 1 < lines.length && looksLikePersonName(lines[idx + 1])) {
			candidates.push({ role: 'author', value: lines[idx + 1] });
		}
	}

	return candidates;
}

// ── Variants ─────────────────────────────────────────────────────────

function splitName(value: string): { firstNames: string[]; lastName: string } {
	const cleaned = stripTitles(value);
	if (cleaned.includes(',')) {
		const [last, rest] = cleaned.split(',', 2);
		const firstTokens = rest.match(NAME_TOKEN_RE) ?? [];
		const lastTokens = last.match(NAME_TOKEN_RE) ?? [];
		if (firstTokens.length > 0 && lastTokens.length > 0) {
			return { firstNames: firstTokens, lastName: lastTokens.join(' ') };
		}
	}
	const tokens = cleaned.match(NAME_TOKEN_RE) ?? [];
	if (tokens.length < 2) return { firstNames: [], lastName: '' };
	return { firstNames: tokens.slice(0, -1), lastName: tokens[tokens.length - 1] };
}

export function nameVariants(value: string): string[] {
	const variants: string[] = [];
	for (const cand of [value, stripTitles(value)]) {
		const c = collapseSpaces(cand.replace(/^[ ,;:\-]+|[ ,;:\-]+$/g, ''));
		if (c && !variants.includes(c)) variants.push(c);
	}
	const { firstNames, lastName } = splitName(value);
	if (firstNames.length > 0 && lastName) {
		const first = firstNames.join(' ');
		const candidates = [
			`${first} ${lastName}`,
			`${lastName}, ${first}`,
			`${firstNames[0][0]}. ${lastName}`,
			lastName // Nachname allein — riskant für False-Positives, aber wichtig für UC2
		];
		for (const c of candidates) {
			if (!variants.includes(c)) variants.push(c);
		}
	}
	return variants.sort((a, b) => b.length - a.length);
}

// ── Identifier cleanup ───────────────────────────────────────────────

function cleanIdentifier(value: string, category: SeedCategory): string {
	let cleaned = collapseSpaces(value).replace(/^\s+|\s+$/g, '');
	if (category === 'person_name') {
		cleaned = cleaned.split(/\s+(?:matrikel|student(?:en)?nummer|student\s*id|matr[ií]cula)\b/i)[0];
		cleaned = cleaned.replace(/\([^)]*\)/g, '');
		cleaned = cleaned.replace(/^[ ,;:.\-]+|[ ,;:.\-]+$/g, '');
		return looksLikePersonName(cleaned) ? cleaned : '';
	}
	if (category === 'matrikel' || category === 'student_id') {
		return collapseSpaces(cleaned).replace(/^[ .,/;\-]+|[ .,/;\-]+$/g, '');
	}
	return cleaned;
}

function normalizeIdentifierKey(value: string, category: SeedCategory): string {
	if (category === 'person_name') {
		return stripTitles(value).toLowerCase().replace(/,/g, ' ');
	}
	return collapseSpaces(value).toLowerCase();
}

// ── Build Seeds ──────────────────────────────────────────────────────

export interface BuildSeedsOptions {
	/** First N chars used as frontmatter window. Default 10000. */
	frontmatterMaxChars?: number;
}

export function buildSeeds(text: string, opts: BuildSeedsOptions = {}): ReplacementSeed[] {
	const frontmatter = extractFrontmatter(text, opts.frontmatterMaxChars ?? 10000);

	const raw: { category: SeedCategory; role: SeedRole; value: string; source: SeedSource }[] = [];

	for (const c of personNameCandidates(frontmatter)) {
		raw.push({ category: 'person_name', role: c.role, value: c.value, source: 'frontmatter_label' });
	}
	for (const m of text.matchAll(EMAIL_RE)) {
		raw.push({ category: 'email', role: null, value: m[0], source: 'regex_email' });
	}
	for (const m of text.matchAll(STUDENT_ID_RE)) {
		// Capture group 1 = die eigentliche Nummer (ohne Label).
		raw.push({ category: 'student_id', role: null, value: m[1], source: 'regex_student_id' });
	}

	const seeds: ReplacementSeed[] = [];
	const seen = new Set<string>();
	const counters: Record<SeedCategory, number> = {
		person_name: 0,
		email: 0,
		matrikel: 0,
		student_id: 0,
		institution: 0,
		project: 0,
		self_citation: 0
	};

	for (const r of raw) {
		const cleaned = cleanIdentifier(r.value, r.category);
		if (!cleaned) continue;
		const key = `${r.category}:${normalizeIdentifierKey(cleaned, r.category)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		counters[r.category]++;
		const idx = String(counters[r.category]).padStart(3, '0');
		const replacement = ({
			person_name: `[NAME_${idx}]`,
			email: `[EMAIL_${idx}]`,
			student_id: `[STUDENT_ID_${idx}]`,
			matrikel: `[MATRIKEL_${idx}]`,
			institution: `[INSTITUTION_${idx}]`,
			project: `[PROJECT_${idx}]`,
			self_citation: `[CITATION_${idx}]`
		} satisfies Record<SeedCategory, string>)[r.category];

		const variants = r.category === 'person_name' ? nameVariants(cleaned) : [cleaned];

		seeds.push({
			category: r.category,
			role: r.role,
			value: cleaned,
			variants,
			replacement,
			source: r.source
		});
	}

	return seeds;
}
