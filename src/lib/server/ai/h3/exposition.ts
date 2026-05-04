// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:EXPOSITION — extrahiert FRAGESTELLUNG (rekonstruiert) und MOTIVATION
// (kurz zusammengefasst) aus dem Einleitungs-Bereich eines Werkes.
//
// Drei Schritte:
//   1. Parser (deterministisch, regex-basiert): identifiziert im EXPOSITION-
//      Container rückwärts den Fragestellungs-Block (¶ mit Frage-Markern,
//      gecluster) und die Motivations-¶ (alle ¶ vor dem Block).
//   2. LLM rekonstruiert die Forschungsfragestellung aus den
//      Fragestellungs-¶ als kompakte Frage (trennt Frage von
//      Methodenrahmen, der oft im selben Quote-Block steht).
//   3. LLM fasst die Motivations-¶ in 1–3 Sätzen zusammen.
//
// Fallback: wenn der Parser im Container nichts findet, geht ein einziger
// LLM-Call über den ganzen Container und macht Identifikation +
// Rekonstruktion + Motivations-Zusammenfassung in einem Schwung.
//
// Persistenz: function_constructs mit content = { text: <…> }. Keine
// Klassifikator-Telemetrie im content (siehe Memory
// feedback_constructs_are_extracts_not_telemetry.md). Wenn eine Stufe
// nichts findet, wird kein Konstrukt persistiert (kein "thema_verfehlt"-
// Marker — die Abwesenheit ist der Befund, den eine spätere WERK_GUTACHT-
// Stufe konsumiert).
//
// Eintrittspunkte (Memory feedback_no_phase_layer_orchestrator.md):
//   runExpositionForComplex(caseId, documentId, complex)
//     — primärer komplex-skopierter Eintritt für den Walk-Dispatcher.
//   runExpositionPass(caseId)
//     — Wrapper für Test-Skripte: lädt den Walk, sucht den ersten
//       EXPOSITION-Komplex und delegiert. PreconditionFailedError, wenn
//       der Walk keinen EXPOSITION-Komplex enthält.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, getModel, getProvider } from '../client.js';
import { extractAndValidateJSON } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import { loadH3ComplexWalk, type H3Complex } from '../../pipeline/h3-complex-walk.js';

// ── Komplex-Auflösung ─────────────────────────────────────────────

interface ExpositionParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	containerHeadingText: string;
	indexInContainer: number;
}

async function loadExpositionParagraphsForComplex(
	documentId: string,
	complex: H3Complex
): Promise<ExpositionParagraph[]> {
	if (complex.paragraphIds.length === 0) return [];
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
		 WHERE p.id = ANY($1::uuid[])
		   AND p.document_id = $2
		 ORDER BY p.char_start`,
		[complex.paragraphIds, documentId]
	)).rows;

	return rows.map((r, i) => ({
		paragraphId: r.paragraph_id,
		charStart: r.char_start,
		charEnd: r.char_end,
		text: r.text.trim(),
		containerHeadingText: complex.headingText,
		indexInContainer: i,
	}));
}

// ── Stufe 1: Parser (deterministisch, regex) ───────────────────────

// Marker für Fragestellungs-¶. Pragmatischer Set; kann iterativ erweitert
// werden. False positives (z.B. rhetorische Methodenfragen) werden in der
// LLM-Rekonstruktions-Stufe abgefangen — dort entscheidet das LLM, ob
// in den Kandidaten-¶ wirklich die Forschungsfrage steht.
const FRAGESTELLUNG_MARKERS: RegExp[] = [
	/\?/,
	/\b(forschungs|untersuchungs|leit|haupt)?frage(stellung)?\b/i,
	/\blautet\s*[:„"]/i,
	/\b(diese|vorliegende)\s+(arbeit|studie|untersuchung|beitrag|aufsatz)\s+(untersucht|fragt|prüft|zeigt|analysiert|geht|widmet|setzt|ist)/i,
	/\b(im|zu(m)?)\s+(mittelpunkt|zentrum)\s+(steht|stehen)\b/i,
	/\b(soll|sollen|wird|werden)\s+\S+(\s+\S+){0,8}\s+(untersucht|geprüft|gezeigt|gefragt|analysiert|beantwortet)/i,
	/\b(erkenntnisinteresse|forschungsinteresse|untersuchungsgegenstand)\b/i,
];

function paragraphHasFragestellungMarker(text: string): boolean {
	return FRAGESTELLUNG_MARKERS.some((re) => re.test(text));
}

interface ParserResult {
	fragestellungParagraphs: ExpositionParagraph[];
	motivationParagraphs: ExpositionParagraph[];
}

/**
 * Identifiziert rückwärts den ersten zusammenhängenden Cluster von
 * ¶ mit Frage-Markern. Alles davor im Container = Motivation.
 * Returnt null, wenn kein Marker-¶ im Container gefunden wird.
 */
function parserIdentifyParagraphs(paragraphs: ExpositionParagraph[]): ParserResult | null {
	let blockStart = -1;
	let blockEnd = -1;
	for (let i = paragraphs.length - 1; i >= 0; i--) {
		const hit = paragraphHasFragestellungMarker(paragraphs[i].text);
		if (hit) {
			if (blockEnd === -1) blockEnd = i;
			blockStart = i;
		} else if (blockEnd !== -1) {
			// Lücke nach Cluster-Anfang → Cluster zu Ende.
			break;
		}
	}
	if (blockStart === -1) return null;
	return {
		fragestellungParagraphs: paragraphs.slice(blockStart, blockEnd + 1),
		motivationParagraphs: paragraphs.slice(0, blockStart),
	};
}

// ── Stufe 2: LLM-Rekonstruktion der Fragestellung ──────────────────

const RekonstruktionSchema = z.object({
	found: z.boolean(),
	fragestellung: z.string().nullable(),
});
type RekonstruktionResult = z.infer<typeof RekonstruktionSchema>;

async function rekonstruiereFragestellung(
	candidateParagraphs: ExpositionParagraph[],
	containerLabel: string,
	documentId: string
): Promise<{ result: RekonstruktionResult; tokens: { input: number; output: number } }> {
	const system = [
		'Du bist ein analytisches Werkzeug, das aus dem Einleitungs-Material einer wissenschaftlichen Arbeit die TATSÄCHLICHE FRAGESTELLUNG rekonstruiert.',
		'',
		'Eine wissenschaftliche Fragestellung ist NICHT identisch mit einer grammatischen Frage. Sie führt zwei Komponenten zusammen:',
		'  (1) das PROBLEMFELD — der Untersuchungsgegenstand mit seiner offenen, klärungsbedürftigen Frage,',
		'  (2) die PERSPEKTIVE — die konzeptuelle/theoretische Folie (Bezugstheorie, Begriffsrahmen), aus der heraus das Problemfeld bearbeitet wird.',
		'Beides zusammen ergibt die Fragestellung. Sie umfasst typisch 2–4 Sätze und kann auch als Aussage formuliert sein.',
		'',
		'KRITISCHER PUNKT — selbstdeklarierte vs. tatsächliche Fragestellung:',
		'Die im Text explizit formulierte "Forschungsfrage" (typisch eingeleitet mit "Die Forschungsfrage lautet:" o.ä.) ist häufig oberflächlich, naiv oder empirisch nicht einlösbar. Klassischer Fall sind unspezifische Wirkungsfragen wie "Inwiefern fördert X das Y" — solche Selbstdeklarationen sind nicht zwingend die echte Fragestellung; sie sind das, was die Autorin GLAUBT zu tun. Reproduziere sie NICHT naiv.',
		'',
		'Die TATSÄCHLICHE Fragestellung ergibt sich aus der analytischen Konstellation, die die Einleitung aufmacht:',
		'  - Welche theoretische Folie wird substanziell und zentral aufgerufen?',
		'  - Welches Material wird mit dieser Folie beleuchtet?',
		'  - Welche Stoßrichtung hat die Arbeit de facto (gemessen daran, was substanziell ausgeführt wird)?',
		'',
		'Wenn eine theoretische Position substanziell entfaltet und an einem Material erprobt wird, ist die echte Fragestellung oft die Tragfähigkeit / Anwendbarkeit / Notwendigkeit dieser Position für dieses Material — NICHT die selbstdeklarierte Wirkungsfrage über das Material selbst.',
		'',
		'Was NICHT zur Fragestellung gehört (und nicht in deine Rekonstruktion gehört):',
		'  - METHODE (z.B. "Vergleich", "Diskursanalyse", "Interview", "im theoriegeleiteten Vergleich") — das ist FORSCHUNGSDESIGN, separates Konstrukt.',
		'  - MOTIVATION (z.B. "Forschungslücke", "gesellschaftliche Relevanz", "Anlass") — das ist separates Konstrukt MOTIVATION.',
		'',
		'Aufgabe: aus den vorgegebenen Absätzen die TATSÄCHLICHE Fragestellung kritisch rekonstruieren — Problemfeld und Perspektive zusammenführen, Selbstdeklarations-Slop, Methode und Motivation explizit weglassen.',
		'',
		'Wenn in den vorgegebenen Absätzen weder Problemfeld noch Perspektive substanziell erkennbar sind, antworte mit found=false.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "found": true | false,',
		'  "fragestellung": "<rekonstruierte tatsächliche Fragestellung, 2–4 Sätze, Problemfeld + Perspektive>" | null',
		'}',
	].join('\n');

	const userMessage = [
		`Container (Heading): ${containerLabel}`,
		'',
		'Kandidaten-Absätze:',
		...candidateParagraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 1200,
		responseFormat: 'json',
		documentIds: [documentId],
	});

	const parsed = extractAndValidateJSON(response.text, RekonstruktionSchema);
	if (!parsed.ok) {
		throw new Error(
			`REKONSTRUKTION-Tool: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	if (parsed.value.found && !parsed.value.fragestellung) {
		throw new Error(`REKONSTRUKTION-Tool: found=true, aber fragestellung=null.`);
	}
	return {
		result: parsed.value,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Stufe 2b: LLM-Beurteilung der Fragestellung ────────────────────
//
// Zweiter, vom Rekonstruktions-Call UNABHÄNGIGER Lese-Pass auf demselben
// Material (`fragestellungParagraphs` aus dem Parser oder Fallback). Sieht
// die rekonstruierte Fragestellung NICHT — operiert direkt auf dem
// Quelltext-Material.

const BeurteilungSchema = z.object({
	beurteilung: z.string().min(1),
});
type BeurteilungResult = z.infer<typeof BeurteilungSchema>;

async function beurteileFragestellung(
	candidateParagraphs: ExpositionParagraph[],
	containerLabel: string,
	documentId: string
): Promise<{ result: BeurteilungResult; tokens: { input: number; output: number } }> {
	const system = [
		'Du bekommst die Absätze einer Werk-Einleitung, in denen die Forschungsfragestellung der Arbeit formuliert ist. Beurteile diese Fragestellung in einem einzigen Satz, auf Basis einer selbst-gerankten Auswahl dieser fünf Kriterien:',
		'  - sachliche Konsistenz',
		'  - logische Konsistenz',
		'  - sprachliche Präzision',
		'  - Vermögen, die Arbeit zu motivieren / Klärungsbeitrag zu erlauben (eine bloße Themenangabe wie „Leben und Werk von Maria Montessori" fällt hier durch; „Werk von Montessori versus Leben" ist im Ansatz Fragestellung, weil ein Verhältnis gesetzt wird)',
		'  - Zusammenführen heterogener Elemente',
		'',
		'Du wählst und rankst, welche dieser Kriterien an dieser Fragestellung am meisten ins Gewicht fallen — der beurteilende Satz stützt sich auf diese Auswahl, nicht zwingend auf alle fünf.',
		'',
		'Antwort als JSON:',
		'{',
		'  "beurteilung": "<ein Satz>"',
		'}',
	].join('\n');

	const userMessage = [
		`Container (Heading): ${containerLabel}`,
		'',
		'Fragestellungs-Absätze:',
		...candidateParagraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 600,
		responseFormat: 'json',
		documentIds: [documentId],
	});

	const parsed = extractAndValidateJSON(response.text, BeurteilungSchema);
	if (!parsed.ok) {
		throw new Error(
			`BEURTEILUNG-Tool: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	return {
		result: parsed.value,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Stufe 3: LLM-Zusammenfassung der Motivation ────────────────────

const MotivationSchema = z.object({
	zusammenfassung: z.string().min(1),
});
type MotivationResult = z.infer<typeof MotivationSchema>;

async function fasseMotivationZusammen(
	motivationParagraphs: ExpositionParagraph[],
	containerLabel: string,
	documentId: string
): Promise<{ result: MotivationResult; tokens: { input: number; output: number } }> {
	const system = [
		'Du bist ein analytisches Werkzeug, das aus dem Einleitungs-Material einer wissenschaftlichen Arbeit die MOTIVATION der Untersuchung knapp zusammenfasst.',
		'',
		'Aufgabe: aus den vorgegebenen Absätzen, die der Forschungsfrage vorausgehen, die Motivation der Arbeit in 1–3 Sätzen prägnant zusammenfassen — was treibt die Untersuchung an, welche Lücke / welches Problem / welcher gesellschaftliche Bezug wird genannt.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "zusammenfassung": "<1–3 Sätze>"',
		'}',
	].join('\n');

	const userMessage = [
		`Container (Heading): ${containerLabel}`,
		'',
		'Motivations-Absätze:',
		...motivationParagraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 500,
		responseFormat: 'json',
		documentIds: [documentId],
	});

	const parsed = extractAndValidateJSON(response.text, MotivationSchema);
	if (!parsed.ok) {
		throw new Error(
			`MOTIVATION-Tool: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	return {
		result: parsed.value,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Fallback: LLM identifiziert + rekonstruiert + zusammenfasst ────

const FallbackSchema = z.object({
	found: z.boolean(),
	fragestellung: z.string().nullable(),
	fragestellung_paragraph_indices: z.array(z.number().int().min(0)).nullable(),
	motivation: z.string().nullable(),
	motivation_paragraph_indices: z.array(z.number().int().min(0)).nullable(),
});
type FallbackResult = z.infer<typeof FallbackSchema>;

async function llmFallbackVollerContainer(
	paragraphs: ExpositionParagraph[],
	containerLabel: string,
	documentId: string
): Promise<{ result: FallbackResult; tokens: { input: number; output: number } }> {
	const system = [
		'Du bist ein analytisches Werkzeug. Eine deterministische Vorprüfung hat im Einleitungs-Container kein Frage-Marker-Muster gefunden; jetzt sollst du den ganzen Container prüfen.',
		'',
		'Aufgaben:',
		'  1. Identifiziere, in welchen Absätzen die FORSCHUNGSFRAGESTELLUNG steckt (Indizes der nummerierten Liste).',
		'  2. Rekonstruiere die Frage als kompakte, lesbare Frage (Frage trennen von Methodenrahmen).',
		'  3. Identifiziere die MOTIVATIONS-Absätze (Begründungen, was die Frage motiviert) — typischerweise davor.',
		'  4. Fasse die Motivation in 1–3 Sätzen zusammen.',
		'',
		'Wenn keine Forschungsfrage identifizierbar ist, antworte mit found=false und alle anderen Felder null.',
		'',
		'JSON-Schema:',
		'{',
		'  "found": true | false,',
		'  "fragestellung": "<rekonstruierte Frage>" | null,',
		'  "fragestellung_paragraph_indices": [<int>, ...] | null,',
		'  "motivation": "<1–3 Sätze>" | null,',
		'  "motivation_paragraph_indices": [<int>, ...] | null',
		'}',
	].join('\n');

	const userMessage = [
		`Container (Heading): ${containerLabel}`,
		'',
		'Nummerierte Absatzliste:',
		...paragraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 1500,
		responseFormat: 'json',
		documentIds: [documentId],
	});

	const parsed = extractAndValidateJSON(response.text, FallbackSchema);
	if (!parsed.ok) {
		throw new Error(
			`FALLBACK-Tool: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
			`Raw: ${response.text.slice(0, 500)}`
		);
	}
	const r = parsed.value;
	if (r.found) {
		if (!r.fragestellung || !r.fragestellung_paragraph_indices) {
			throw new Error(`FALLBACK-Tool: found=true ohne fragestellung+indices.`);
		}
		for (const idx of r.fragestellung_paragraph_indices) {
			if (idx >= paragraphs.length) {
				throw new Error(`FALLBACK-Tool: fragestellung_paragraph_indices enthält ${idx} außerhalb des Containers (${paragraphs.length}).`);
			}
		}
		if (r.motivation_paragraph_indices) {
			for (const idx of r.motivation_paragraph_indices) {
				if (idx >= paragraphs.length) {
					throw new Error(`FALLBACK-Tool: motivation_paragraph_indices enthält ${idx} außerhalb des Containers.`);
				}
			}
		}
	}
	return {
		result: r,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Persistenz ────────────────────────────────────────────────────

async function clearExistingExpositionForComplex(
	caseId: string,
	documentId: string,
	complexParagraphIds: string[]
): Promise<number> {
	// Idempotenz, komplex-skopiert: alte EXPOSITION-Konstrukte
	// (FRAGESTELLUNG, MOTIVATION) werden nur gelöscht, wenn ihre Anker-
	// Absätze vollständig im aktuellen Komplex liegen. Das schützt
	// Konstrukte aus parallelen EXPOSITION-Komplexen (selten, aber denkbar)
	// vor versehentlichem Wegräumen. FRAGESTELLUNG_BEURTEILUNG wird
	// absichtlich NICHT gelöscht — das ist ein eigener Beurteilungs-Lauf
	// (runBeurteilungForComplex), läuft separat und steht nicht im
	// Auftrags-Verhältnis zum Rekonstruktions-Pass.
	if (complexParagraphIds.length === 0) return 0;
	const r = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind IN ('FRAGESTELLUNG', 'MOTIVATION')
		   AND anchor_element_ids <@ $3::uuid[]`,
		[caseId, documentId, complexParagraphIds]
	);
	return r.rowCount ?? 0;
}

async function persistConstruct(
	caseId: string,
	documentId: string,
	constructKind: 'FRAGESTELLUNG' | 'MOTIVATION' | 'FRAGESTELLUNG_BEURTEILUNG',
	anchorElementIds: string[],
	content: { text: string } | { beurteilung: string }
): Promise<string> {
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: content,
	};
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'EXPOSITION', $3, $4, $5, $6)
		 RETURNING id`,
		[
			caseId,
			documentId,
			constructKind,
			anchorElementIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error(`Failed to persist ${constructKind} construct`);
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface ExpositionPassResult {
	caseId: string;
	documentId: string;
	containerParagraphCount: number;
	parserHit: boolean;                          // true = Stufe-1-Parser hat Treffer geliefert
	usedFallback: boolean;                       // true = LLM-Fallback eingesprungen
	fragestellungConstructId: string | null;
	fragestellungText: string | null;
	fragestellungAnchorParagraphIds: string[];
	motivationConstructId: string | null;
	motivationText: string | null;
	motivationAnchorParagraphIds: string[];
	tokens: { input: number; output: number };
	llmCalls: number;
	model: string;
	provider: string;
}

// ── Public API: isolierter Beurteilungs-Lauf ───────────────────────
//
// Eigener Eintrittspunkt, der NUR den Beurteilungs-Schritt ausführt.
// Lässt FRAGESTELLUNG / MOTIVATION unangetastet — schützt validierte
// Stände eines getrennten Rekonstruktions-Laufs. (Der Haupt-Pass
// runExpositionPass schreibt sie selbst idempotent, siehe
// clearExistingExposition.) Verwendet dieselbe Parser/Fallback-Logik
// wie der Haupt-Pass, um an dasselbe Material zu kommen wie der
// Rekonstruktions-Call.

export interface BeurteilungPassResult {
	caseId: string;
	documentId: string;
	containerParagraphCount: number;
	parserHit: boolean;
	usedFallback: boolean;
	beurteilungConstructId: string | null;
	beurteilungText: string | null;
	beurteilungAnchorParagraphIds: string[];
	tokens: { input: number; output: number };
	llmCalls: number;
	model: string;
	provider: string;
}

export async function runBeurteilungForComplex(
	caseId: string,
	documentId: string,
	complex: H3Complex
): Promise<BeurteilungPassResult> {
	if (complex.functionType !== 'EXPOSITION') {
		throw new Error(
			`runBeurteilungForComplex: Komplex hat functionType=${complex.functionType}, erwartet EXPOSITION`
		);
	}

	const paragraphs = await loadExpositionParagraphsForComplex(documentId, complex);
	const containerLabel = complex.headingText;

	let totalInput = 0;
	let totalOutput = 0;
	let llmCalls = 0;

	let fragestellungParagraphs: ExpositionParagraph[] = [];

	const parsed = parserIdentifyParagraphs(paragraphs);
	const parserHit = parsed !== null;
	let usedFallback = false;

	if (parsed) {
		fragestellungParagraphs = parsed.fragestellungParagraphs;
	} else {
		// Fallback: LLM identifiziert die Fragestellungs-¶ über den ganzen Komplex.
		usedFallback = true;
		const fb = await llmFallbackVollerContainer(paragraphs, containerLabel, documentId);
		llmCalls += 1;
		totalInput += fb.tokens.input;
		totalOutput += fb.tokens.output;

		if (fb.result.found && fb.result.fragestellung_paragraph_indices) {
			fragestellungParagraphs =
				fb.result.fragestellung_paragraph_indices.map((i) => paragraphs[i]);
		}
	}

	if (fragestellungParagraphs.length === 0) {
		// Keine Fragestellungs-¶ identifizierbar → kein Konstrukt anlegen
		// (Abwesenheit ist Befund — Memory feedback_constructs_are_extracts_not_telemetry.md).
		return {
			caseId,
			documentId,
			containerParagraphCount: paragraphs.length,
			parserHit,
			usedFallback,
			beurteilungConstructId: null,
			beurteilungText: null,
			beurteilungAnchorParagraphIds: [],
			tokens: { input: totalInput, output: totalOutput },
			llmCalls,
			model: getModel(),
			provider: getProvider(),
		};
	}

	const beur = await beurteileFragestellung(
		fragestellungParagraphs,
		containerLabel,
		documentId
	);
	llmCalls += 1;
	totalInput += beur.tokens.input;
	totalOutput += beur.tokens.output;

	const beurteilungConstructId = await persistConstruct(
		caseId,
		documentId,
		'FRAGESTELLUNG_BEURTEILUNG',
		fragestellungParagraphs.map((p) => p.paragraphId),
		{ beurteilung: beur.result.beurteilung }
	);

	return {
		caseId,
		documentId,
		containerParagraphCount: paragraphs.length,
		parserHit,
		usedFallback,
		beurteilungConstructId,
		beurteilungText: beur.result.beurteilung,
		beurteilungAnchorParagraphIds: fragestellungParagraphs.map((p) => p.paragraphId),
		tokens: { input: totalInput, output: totalOutput },
		llmCalls,
		model: getModel(),
		provider: getProvider(),
	};
}

/**
 * Wrapper für Test-Skripte / direkte Case-Aufrufe ohne Walk-Kontext.
 * Lädt den Walk, sucht den ersten EXPOSITION-Komplex und delegiert.
 */
export async function runBeurteilungOnly(caseId: string): Promise<BeurteilungPassResult> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const walk = await loadH3ComplexWalk(documentId);
	const complex = walk.find((c) => c.functionType === 'EXPOSITION');
	if (!complex) {
		throw new PreconditionFailedError({
			heuristic: 'EXPOSITION',
			missing: 'EXPOSITION-Komplex',
			diagnostic:
				`Walk für Werk ${documentId} enthält keinen EXPOSITION-Komplex — ` +
				`erst FUNKTIONSTYP_ZUWEISEN-Vor-Heuristik laufen oder Outline-UI manuell setzen.`,
		});
	}
	return runBeurteilungForComplex(caseId, documentId, complex);
}

export async function runExpositionForComplex(
	caseId: string,
	documentId: string,
	complex: H3Complex
): Promise<ExpositionPassResult> {
	if (complex.functionType !== 'EXPOSITION') {
		throw new Error(
			`runExpositionForComplex: Komplex hat functionType=${complex.functionType}, erwartet EXPOSITION`
		);
	}

	const paragraphs = await loadExpositionParagraphsForComplex(documentId, complex);
	const containerLabel = complex.headingText;

	let totalInput = 0;
	let totalOutput = 0;
	let llmCalls = 0;

	let fragestellungParagraphs: ExpositionParagraph[] = [];
	let motivationParagraphs: ExpositionParagraph[] = [];
	let fragestellungText: string | null = null;
	let motivationText: string | null = null;

	const parsed = parserIdentifyParagraphs(paragraphs);
	const parserHit = parsed !== null;
	let usedFallback = false;

	if (parsed) {
		fragestellungParagraphs = parsed.fragestellungParagraphs;
		motivationParagraphs = parsed.motivationParagraphs;

		const recon = await rekonstruiereFragestellung(
			fragestellungParagraphs,
			containerLabel,
			documentId
		);
		llmCalls += 1;
		totalInput += recon.tokens.input;
		totalOutput += recon.tokens.output;

		if (recon.result.found) {
			fragestellungText = recon.result.fragestellung;

			if (motivationParagraphs.length > 0) {
				const motiv = await fasseMotivationZusammen(
					motivationParagraphs,
					containerLabel,
					documentId
				);
				llmCalls += 1;
				totalInput += motiv.tokens.input;
				totalOutput += motiv.tokens.output;
				motivationText = motiv.result.zusammenfassung;
			}
		}
	}

	// Fallback: Parser fand nichts ODER Parser-Treffer wurde vom LLM verworfen.
	if (!fragestellungText) {
		usedFallback = true;
		const fb = await llmFallbackVollerContainer(paragraphs, containerLabel, documentId);
		llmCalls += 1;
		totalInput += fb.tokens.input;
		totalOutput += fb.tokens.output;

		if (fb.result.found) {
			fragestellungParagraphs =
				fb.result.fragestellung_paragraph_indices!.map((i) => paragraphs[i]);
			fragestellungText = fb.result.fragestellung;
			if (fb.result.motivation_paragraph_indices && fb.result.motivation) {
				motivationParagraphs = fb.result.motivation_paragraph_indices.map((i) => paragraphs[i]);
				motivationText = fb.result.motivation;
			} else {
				motivationParagraphs = [];
				motivationText = null;
			}
		}
	}

	// Idempotenz-Schicht: vor dem Persist alte FRAGESTELLUNG/MOTIVATION für
	// genau diesen Komplex wegräumen. Re-Run produziert deterministisch
	// denselben End-Stand. Andere EXPOSITION-Komplexe (sofern vorhanden)
	// bleiben unangetastet.
	await clearExistingExpositionForComplex(caseId, documentId, complex.paragraphIds);

	let fragestellungConstructId: string | null = null;
	let motivationConstructId: string | null = null;

	if (fragestellungText && fragestellungParagraphs.length > 0) {
		fragestellungConstructId = await persistConstruct(
			caseId,
			documentId,
			'FRAGESTELLUNG',
			fragestellungParagraphs.map((p) => p.paragraphId),
			{ text: fragestellungText }
		);
	}

	if (motivationText && motivationParagraphs.length > 0) {
		motivationConstructId = await persistConstruct(
			caseId,
			documentId,
			'MOTIVATION',
			motivationParagraphs.map((p) => p.paragraphId),
			{ text: motivationText }
		);
	}

	return {
		caseId,
		documentId,
		containerParagraphCount: paragraphs.length,
		parserHit,
		usedFallback,
		fragestellungConstructId,
		fragestellungText,
		fragestellungAnchorParagraphIds: fragestellungParagraphs.map((p) => p.paragraphId),
		motivationConstructId,
		motivationText,
		motivationAnchorParagraphIds: motivationParagraphs.map((p) => p.paragraphId),
		tokens: { input: totalInput, output: totalOutput },
		llmCalls,
		model: getModel(),
		provider: getProvider(),
	};
}

/**
 * Wrapper für Test-Skripte / direkte Case-Aufrufe ohne Walk-Kontext.
 * Lädt den Walk, sucht den ersten EXPOSITION-Komplex und delegiert.
 */
export async function runExpositionPass(caseId: string): Promise<ExpositionPassResult> {
	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const walk = await loadH3ComplexWalk(documentId);
	const complex = walk.find((c) => c.functionType === 'EXPOSITION');
	if (!complex) {
		throw new PreconditionFailedError({
			heuristic: 'EXPOSITION',
			missing: 'EXPOSITION-Komplex',
			diagnostic:
				`Walk für Werk ${documentId} enthält keinen EXPOSITION-Komplex — ` +
				`erst FUNKTIONSTYP_ZUWEISEN-Vor-Heuristik laufen oder Outline-UI manuell setzen.`,
		});
	}
	return runExpositionForComplex(caseId, documentId, complex);
}
