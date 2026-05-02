// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Seed-Extraktor für die deterministische Anonymisierung (UC1).
//
// Architektur-Setzung 2026-05-02 (User):
//   "Es gibt Technologien um Namen zu erkennen ohne externes LLM, so ein
//    algorithmisches Ding oder mini-LLM"
//
// → Personen-/Organisations-/Location-Erkennung läuft über **spaCy** lokal
//   (de_core_news_lg, ~545 MB, kein API-Call). Siehe ner.ts.
//
// Was bleibt im regex-Pfad:
//   – Email-Extraktion (mit Digit-Prefix-Stripping für Matrikel-Email-
//     Konkatenationen aus DOCX-Run-Boundaries)
//   – Matrikel-/Student-ID-Extraktion (label-getriggert)
//   – Telefonnummer-Extraktion (label-getriggert oder format-erkannt)
//
// Der frühere Regex-Walk für Personennamen (extractLeadingName,
// inlineTitledNames, personNameCandidates) ist entfallen — er war
// kämpfend gegen jede DOCX-Layout-Variante und produzierte kaputte
// Seeds wie "Prof. Dr. Benjamin J örissen Datum Einreichung".

import { runNer, type NerEntity } from './ner.js';

export type SeedCategory =
	| 'person_name'
	| 'email'
	| 'matrikel'
	| 'student_id'
	| 'institution'
	| 'project'
	| 'self_citation'
	| 'phone';

export type SeedRole = 'author' | 'supervisor' | 'examiner' | 'subject' | 'other' | null;

export type SeedSource =
	| 'ner_spacy'
	| 'regex_email'
	| 'regex_matrikel'
	| 'regex_student_id'
	| 'regex_phone'
	| 'frontmatter_label'
	| 'llm_assisted';

export interface ReplacementSeed {
	category: SeedCategory;
	role: SeedRole;
	value: string;
	variants: string[];
	replacement: string;
	source: SeedSource;
}

// ── Frontmatter-Window ───────────────────────────────────────────────

// Stoppt das Frontmatter-Fenster, sobald die erste Kapitel-Überschrift
// kommt. Mehrsprachig.
const FRONTMATTER_STOP_RE =
	/^\s*(?:\d+(?:\.\d+)*\s+)?(?:einleitung|einf(?:ue|ü)hrung|introduction|introduzione|introducci[oó]n|introdu[cç][aã]o|inleiding|wst[eę]p|[uú]vod|inledning|indledning|innledning|johdanto|εισαγωγή|giri[şs]|введение|序論|序章|引言|前言|序|chapter\s+1|chapitre\s+1|kapitel\s+1|cap[ií]tulo\s+1|capitolo\s+1|hoofdstuk\s+1|rozdzia[lł]\s+1|kapitola\s+1|kapitel\s+ett|αʹ\s*κεφάλαιο|глава\s+1|第一章|الفصل\s+الأول|المقدمة|مقدمة)\b/im;

export function extractFrontmatter(text: string, maxChars = 10000): string {
	const window = text.slice(0, maxChars);
	const m = FRONTMATTER_STOP_RE.exec(window);
	if (m && m.index > 200) return window.slice(0, m.index);
	return window;
}

// ── Regex-Extraktoren (Email/Matrikel/Phone) ─────────────────────────

// Email-Extraktion mit Digit-Prefix-Stripping. Hintergrund: in DOCX-
// Frontpages werden Felder wie "Matrikelnummer: 21925501 mail@...com"
// vom Parser oft an Run-Boundaries konkateniert zu "21925501mail@...com".
// Eine naive Regex würde dann "21925501mail@..." als Local-Part fangen
// und die Matrikel-Substitution überlappt nicht mehr → kaputte Seeds.
//
// Strategie: erst breit matchen (alles vor dem @ einsammeln), dann
// `^\d+(?=[A-Za-z])` als Präfix wegtrimmen.
function extractEmails(text: string): string[] {
	const out = new Set<string>();
	const re = /(?<![@.])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
	for (const m of text.matchAll(re)) {
		const full = m[0];
		const at = full.indexOf('@');
		let local = full.slice(0, at);
		const domain = full.slice(at);
		const stripped = local.replace(/^\d+(?=[A-Za-z])/, '');
		if (stripped.length >= 1) out.add(stripped + domain);
	}
	return [...out];
}

// Matrikel-/Student-ID-Patterns — explizit gelabelt.
const STUDENT_ID_RE =
	/\b(?:matrikel(?:nummer|nr\.?)?|student(?:en)?(?:nummer|id|number)|registration\s*number|n[uú]mero\s*de\s*matr[íi]cula|n[ºo°]?\s*matr[ií]cul[oa]|registrazione)\s*[:#-]?\s*([A-Z]?\d[\d\s./-]{3,}\d)/gi;

function extractMatrikel(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(STUDENT_ID_RE)) {
		const cleaned = m[1].replace(/[\s./-]+/g, '').trim();
		if (cleaned.length >= 4) out.add(cleaned);
	}
	return [...out];
}

// Telefonnummer-Extraktion — STRIKT: nur mit explizitem Tel-Label
// ODER mit "+"-Country-Code-Präfix. Sonst greift es auf jede 7+-stellige
// Number-Sequence (Matrikel, Datum, ISBN), und wir bekommen False-
// Positives wie "12345678" oder "26.08.2025".
const PHONE_LABELED_RE =
	/\b(?:tel(?:\.|efon)?|mobil(?:funk)?|handy|phone|fax|t\.|tel\s*nr\.?)\s*[:.]?\s*([+]?[\d\s./()-]{7,20}\d)/gi;
const PHONE_INTL_RE =
	/(?<![\d])\+\d{1,3}[\s./()-]*(?:\d[\s./()-]*){6,15}\d/g;

// Datum-Patterns, die wir NICHT als Phone akzeptieren wollen.
const DATE_LIKE_RE =
	/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$|^\d{2}\.\d{2}\.\d{4}$/;

function extractPhones(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(PHONE_LABELED_RE)) {
		const cleaned = m[1].trim().replace(/[ \t]+$/, '');
		const digits = cleaned.replace(/\D/g, '');
		if (digits.length < 7 || digits.length > 16) continue;
		if (DATE_LIKE_RE.test(cleaned)) continue;
		out.add(cleaned);
	}
	for (const m of text.matchAll(PHONE_INTL_RE)) {
		const cleaned = m[0].trim();
		const digits = cleaned.replace(/\D/g, '');
		if (digits.length < 7 || digits.length > 16) continue;
		out.add(cleaned);
	}
	return [...out];
}

// ── Rolle-Inferenz aus NER-Kontext ───────────────────────────────────

// Label-Patterns, deren räumliche Position einer NER-Person die Rolle
// (author/supervisor) zuweist. Die Person SELBST wird vom NER erkannt;
// das Label markiert nur den Kontext.
const ROLE_LABELS: { pattern: RegExp; role: SeedRole }[] = [
	{
		pattern: /\b(?:vorgelegt|eingereicht|verfasst|abgegeben|presented|submitted|prepared|written|presentado|presentata|apresentado|przedstawion[aey]|ingeleverd|inskickad|indleveret|innlevert|esitetty)\s+(?:von|by|par|de|por|da|door|przez|av|af|tarafından|представлена)\b/i,
		role: 'author'
	},
	{
		pattern: /\b(?:autor(?:in)?|author|verfasser(?:in)?|bearbeiter(?:in)?|kandidat(?:in)?|name|verfasst\s+von)\b/i,
		role: 'author'
	},
	{
		pattern: /\b(?:betreuer(?:in)?|erstgutachter(?:in)?|zweitgutachter(?:in)?|drittgutachter(?:in)?|pr(?:ue|ü)fer(?:in)?|gutachter(?:in)?|mentorat|mentor(?:in)?|doktorvater|doktormutter|promotionskommission|pr(?:ue|ü)fungskommission|promotionsausschuss|supervisor|advisor|examiner|director\s+of\s+studies|directeur(?:\s+de\s+th[èe]se)?|relatore|orientador(?:a)?|begeleider|promotor|opiekun|veiledere?|handledare|ohjaaja|jury)\b/i,
		role: 'supervisor'
	}
];

function findLabelPositions(text: string): { pos: number; role: SeedRole }[] {
	const positions: { pos: number; role: SeedRole }[] = [];
	for (const lbl of ROLE_LABELS) {
		const re = new RegExp(lbl.pattern.source, 'gi');
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			positions.push({ pos: m.index, role: lbl.role });
		}
	}
	positions.sort((a, b) => a.pos - b.pos);
	return positions;
}

// Splittet PER-Spans, die zwei zusammengezogene Namen enthalten. Trenner:
// inline `Prof. Dr.`, `Dr.`, `Prof.`-Sequenzen oder `(Vorsitz)`-artige
// Klammerausdrücke.
function splitConcatenatedPersons(entities: NerEntity[], text: string): NerEntity[] {
	const out: NerEntity[] = [];
	const splitRe = /\s+(?:\(|Prof\.|Dr\.|Mr\.|Mrs\.|Hon\.|PhD\.?|MD\.?)/g;
	for (const ent of entities) {
		// Suche INNERHALB der Span nach Splitter-Positionen.
		const span = text.slice(ent.start, ent.end);
		const splits: number[] = [];
		let m: RegExpExecArray | null;
		const re = new RegExp(splitRe.source, 'g');
		while ((m = re.exec(span)) !== null) {
			if (m.index > 0) splits.push(m.index);
		}
		if (splits.length === 0) {
			out.push(ent);
			continue;
		}
		// Splitte die Span an den gefundenen Positionen.
		let cursor = 0;
		for (const splitPos of [...splits, span.length]) {
			const subRaw = span.slice(cursor, splitPos).trim();
			// Title-Präfix aus dem Sub-Namen entfernen — sonst kommt
			// z.B. "Dr. Claudia Jahnel" als value heraus statt "Claudia
			// Jahnel". Failsafe-variants hätten den nackten Namen zwar
			// auch, aber der Display-value bleibt sauberer.
			const sub = subRaw.replace(/^(?:Prof|Dr|h\.c|phil|theol|med|iur|nat|Mr|Mrs|Hon|Sir)\.?(?:\s+(?:Prof|Dr|h\.c|phil|theol|med|iur|nat)\.?)*\s+/gi, '').trim();
			const tokens = sub.match(/\p{Lu}[\p{L}\p{M}'’-]+/gu) ?? [];
			if (tokens.length >= 2) {
				const subStart = ent.start + cursor + (subRaw.length - sub.length);
				out.push({
					text: sub,
					label: 'PER',
					start: subStart,
					end: subStart + sub.length
				});
			}
			cursor = splitPos;
		}
	}
	return out;
}

function roleForPosition(pos: number, labels: { pos: number; role: SeedRole }[]): SeedRole {
	let role: SeedRole = 'other';
	let bestDistance = Infinity;
	for (const lp of labels) {
		if (lp.pos > pos) break;
		const d = pos - lp.pos;
		// Label muss nicht zu weit weg sein (max ~150 Zeichen Abstand —
		// sonst wirkt der Kontext nicht mehr). Wenn weiter weg, Label gilt
		// nicht mehr; Person bekommt 'other'.
		if (d <= 150 && d < bestDistance) {
			bestDistance = d;
			role = lp.role;
		}
	}
	if (bestDistance === Infinity) {
		// Kein Label gefunden — bei der ERSTEN Person in der Frontpage gilt
		// implizit "author" (häufiges Cover-Pattern: "Titel: ... Name ...
		// Matrikelnummer ..."), bei späteren 'other'.
		return null;
	}
	return role;
}

// ── Variants (für Failsafe-Tripwire) ─────────────────────────────────

// Akademische Titel, die wir bei der Variant-Generation strippen, damit
// "Prof. Dr. Benjamin Jörissen" auch als "Jörissen", "B. Jörissen" etc.
// im Failsafe-Scan greift.
const TITLE_PREFIX_RE =
	/\b(?:prof(?:essor)?|dr|ph\.?\s*d|m\.?\s*a|b\.?\s*a|m\.?\s*sc|b\.?\s*sc|hon|priv[.-]?doz|sir|mr|mrs|ms|mme|sra|sr|dipl[.-]?ing|mag|doc|kand|ass|phil|theol|med|iur|nat|h\.\s*c|h\.c)\.?(?=\b)/gi;

const NAME_TOKEN_RE = /\p{Lu}[\p{L}\p{M}.'’-]{1,}|\p{Lu}\./gu;

function collapseSpaces(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function stripTitles(s: string): string {
	return collapseSpaces(s.replace(TITLE_PREFIX_RE, '')).replace(/^[ ,;:.-]+|[ ,;:.-]+$/g, '');
}

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
			lastName // Nachname allein — riskant für False-Positives, aber wichtig im Volltext
		];
		for (const c of candidates) {
			if (!variants.includes(c)) variants.push(c);
		}
	}
	return variants.sort((a, b) => b.length - a.length);
}

// ── Public API: buildSeeds ───────────────────────────────────────────

function normalizeKey(value: string, category: SeedCategory): string {
	if (category === 'person_name') {
		return stripTitles(value).toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
	}
	return value.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Baut die Seed-Liste für ein Dokument:
 *   1. Personen-Erkennung via spaCy NER auf dem Frontmatter-Window.
 *   2. Email/Matrikel/Phone via Regex (über das gesamte Dokument).
 *   3. Rolle-Zuordnung (author/supervisor/...) aus räumlicher Nähe zu
 *      Label-Wörtern wie "Vorgelegt von" / "Betreuer:".
 *
 * Idempotent: zweiter Aufruf auf demselben (zwischenzeitlich anonymi-
 * sierten) Text liefert leere Seeds, weil Klartext bereits durch
 * `[NAME_001]` etc. ersetzt ist.
 */
export async function buildSeeds(text: string): Promise<ReplacementSeed[]> {
	const frontmatter = extractFrontmatter(text);
	const labelPositions = findLabelPositions(frontmatter);

	// 1. Personen via NER auf Frontmatter
	const ner = await runNer(frontmatter, 'auto');
	let personEntities: NerEntity[] = ner.entities.filter((e) => e.label === 'PER');

	// Post-Processing: spaCy fasst bei DOCX-konkatenierten Frontpages
	// gelegentlich zwei aufeinanderfolgende Namen zu einem PER-Span
	// zusammen, wenn dazwischen kein Trenner ausser Whitespace + Title
	// steht ("Julia Franz Prof. Dr. Claudia Jahnel"). Wir splitten an
	// inline-Title-Sequenzen nachträglich.
	personEntities = splitConcatenatedPersons(personEntities, frontmatter);

	const seeds: ReplacementSeed[] = [];
	const seenKeys = new Set<string>();
	const counters: Record<SeedCategory, number> = {
		person_name: 0,
		email: 0,
		matrikel: 0,
		student_id: 0,
		institution: 0,
		project: 0,
		self_citation: 0,
		phone: 0
	};

	function addSeed(seed: Omit<ReplacementSeed, 'replacement'>): void {
		const key = `${seed.category}:${normalizeKey(seed.value, seed.category)}`;
		if (seenKeys.has(key)) return;
		seenKeys.add(key);
		counters[seed.category]++;
		const idx = String(counters[seed.category]).padStart(3, '0');
		const replacement = ({
			person_name: `[NAME_${idx}]`,
			email: `[EMAIL_${idx}]`,
			matrikel: `[MATRIKEL_${idx}]`,
			student_id: `[STUDENT_ID_${idx}]`,
			institution: `[INSTITUTION_${idx}]`,
			project: `[PROJECT_${idx}]`,
			self_citation: `[CITATION_${idx}]`,
			phone: `[PHONE_${idx}]`
		} satisfies Record<SeedCategory, string>)[seed.category];
		seeds.push({ ...seed, replacement });
	}

	// Erste Person ohne Label-Kontext bekommt 'author' implizit.
	let firstPersonSeen = false;
	for (const ent of personEntities) {
		const value = ent.text.trim();
		if (value.length < 3) continue;
		// Tokens-Check: mindestens 2 Wörter (Vor- + Nachname) — sonst False-
		// Positive auf einzelne Cap-Wörter, die spaCy hier und da wirft.
		const tokens = value.match(NAME_TOKEN_RE) ?? [];
		if (tokens.length < 2) continue;
		let role = roleForPosition(ent.start, labelPositions);
		if (role === null) {
			role = firstPersonSeen ? 'other' : 'author';
		}
		firstPersonSeen = true;
		addSeed({
			category: 'person_name',
			role,
			value,
			variants: nameVariants(value),
			source: 'ner_spacy'
		});
	}

	// 2. Emails (Volltext, nicht nur Frontmatter — Mailadressen können
	//    auch im Anhang stehen, sind aber DSGVO-relevant überall)
	for (const email of extractEmails(text)) {
		addSeed({
			category: 'email',
			role: null,
			value: email,
			variants: [email],
			source: 'regex_email'
		});
	}

	// 3. Matrikel/Student-IDs (label-getriggert → Volltext OK)
	for (const m of extractMatrikel(text)) {
		addSeed({
			category: 'matrikel',
			role: null,
			value: m,
			variants: [m],
			source: 'regex_matrikel'
		});
	}

	// 4. Telefonnummern (nur Frontmatter — im Haupttext könnten Tel-Nummern
	//    inhaltlich relevant sein und sollten nicht plattgemacht werden)
	for (const phone of extractPhones(frontmatter)) {
		addSeed({
			category: 'phone',
			role: null,
			value: phone,
			variants: [phone],
			source: 'regex_phone'
		});
	}

	return seeds;
}

/**
 * Liefert den vermuteten Werktitel für die Filename-Generierung. Greift
 * auf NER-MISC-Entities zurück (spaCy klassifiziert lange Werktitel im
 * de_core_news_lg häufig als MISC) und auf "Titel:"-Label.
 */
export async function extractTitleHint(text: string): Promise<string | undefined> {
	const frontmatter = extractFrontmatter(text);

	// "Titel:"-Label hat die höchste Vertrauenswürdigkeit.
	const titleLabelMatch = /\b(?:titel|title|titre|t[íi]tulo|titolo|onderwerp|otsikko|tittel|nadpis|başlık|название|θέμα|عنوان|主題|题目|제목)\s*[:.]?\s*/i.exec(frontmatter);
	if (titleLabelMatch) {
		const tail = frontmatter.slice(titleLabelMatch.index + titleLabelMatch[0].length);
		// Bis zum ersten Satzende (`. ` mit folgender Cap) oder \n.
		const m = tail.match(/^([^.\n]+(?:\.[^.\n]*)*?)(?:[.!?](?=\s+\p{Lu}|\s*$|\s*\n)|\n)/u);
		const title = collapseSpaces((m ? m[1] : tail.slice(0, 200)).trim());
		if (title.length >= 8) return title;
	}

	// Fallback: NER-MISC (oft Werktitel)
	const ner = await runNer(frontmatter, 'auto');
	const miscs = ner.entities.filter((e) => e.label === 'MISC');
	for (const m of miscs) {
		if (m.text.length >= 12 && m.text.length <= 200) return m.text.trim();
	}

	return undefined;
}
