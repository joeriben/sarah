// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:WERK_GUTACHT — Werk-aggregierendes, indikator-getriebenes Gutacht.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   Drei Sub-Stufen plus dialogischer Block:
//   a Werk-im-Lichte-der-Fragestellung — längerer Absatz, immer aktiv
//   b Hotspot-Würdigung nach funktionstyp-strukturiertem Raster der
//     Bewertungsachsen, strukturierend nicht erschöpfend, indikator-
//     getrieben (gelb/rot)
//   c Fazit aus a+b — gated durch Upload eines `review_draft`
//   d/e/f dialogischer Block, zwingend nach c (Blind-Position, Differenz,
//         Reflexive Position) — gated.
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   SARAH automatisiert das Beurteilen NICHT. Sprache: "analysiert",
//   "Indikator", "Critical-Friend-Hinweis" — niemals "bewertet/beurteilt".
//   Indikatoren grün/gelb/rot codieren Wertung (Problem/Ambivalenz/OK),
//   Mother-Setzung b: nur gelb/rot (strukturierend, nicht erschöpfend);
//   Achsen ohne Befund tragen `null` als Indikator.
//
// User-Setzung 2026-05-04:
//   - WERK_GUTACHT-c wird heute mit DEAKTIVIERTEM GATING implementiert
//     (Testung der Mechanik). content.gatingDisabled=true markiert
//     das transparent. Der Reviewer-Schutz greift wieder, sobald die
//     review_draft-Upload-UI mit Roadmap-Stufe 4 kommt.
//   - WERK_GUTACHT-d/e/f bleiben deferred (review_draft-Pflicht +
//     Prompt-Isolation gegen Gutachten-Leak).
//   - Inputs Option B: function_constructs + memo_content optional
//     (wenn H1/H2-Vorlauf existiert).
//
// Persistenz: function_constructs mit
//   outline_function_type='WERK_GUTACHT', construct_kind='WERK_GUTACHT'.
//   Ein Konstrukt mit content = { aText, bAxes, cText, gatingDisabled, ... }.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';
import { loadEffectiveOutline } from '../../documents/outline.js';
import { PreconditionFailedError } from './precondition.js';
import {
	loadAllConstructs,
	loadCollapseMemos,
	buildOutlineSummary,
	buildConstructsBlock,
	buildMemosBlock,
} from './werk-shared.js';

// ── Cross-Reads für a/c (FRAGESTELLUNG, WERK_BESCHREIBUNG) ────────

async function loadFragestellungText(
	caseId: string,
	documentId: string
): Promise<string | null> {
	const row = await queryOne<{ content: { text?: string } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	return row?.content?.text ?? null;
}

async function loadWerkBeschreibungText(
	caseId: string,
	documentId: string
): Promise<string | null> {
	const row = await queryOne<{ content: { werkBeschreibungText?: string } }>(
		`SELECT content FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'WERK_DESKRIPTION'
		   AND construct_kind = 'WERK_BESCHREIBUNG'
		 ORDER BY created_at DESC LIMIT 1`,
		[caseId, documentId]
	);
	return row?.content?.werkBeschreibungText ?? null;
}

// ── Achsen-Vokabular ──────────────────────────────────────────────
//
// Aus project_three_heuristics_architecture.md (Assessment-Achse):
//   FRAGESTELLUNG → Qualität
//   GRUNDLAGENTHEORIE → Fundiertheit
//   FORSCHUNGSDESIGN → Angemessenheit
//   DURCHFUEHRUNG → Qualität
//   SYNTHESE → Systematisierungsleistung
//   SCHLUSSREFLEXION → Legitimiertheit der Geltungsansprüche

const AXIS_NAMES = [
	'FRAGESTELLUNG-Qualität',
	'GRUNDLAGENTHEORIE-Fundiertheit',
	'FORSCHUNGSDESIGN-Angemessenheit',
	'DURCHFUEHRUNG-Qualität',
	'SYNTHESE-Systematisierungsleistung',
	'SCHLUSSREFLEXION-Legitimiertheit',
] as const;
type AxisName = (typeof AXIS_NAMES)[number];

// ── LLM-Call Stage a ──────────────────────────────────────────────

const StageALLMSchema = z.object({
	aText: z.string().min(1),
});
type StageAResult = z.infer<typeof StageALLMSchema>;

interface ExtractStageAInput {
	werkBeschreibungText: string;
	fragestellungText: string;
	constructsBlock: string;
	outlineSummary: string;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractStageA(input: ExtractStageAInput): Promise<{
	result: StageAResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das ein wissenschaftliches Werk im Lichte seiner FRAGESTELLUNG analysiert. Du arbeitest auf der Werk-Beschreibung (deskriptive Aggregation aller Funktionstyp-Konstrukte), der Outline und der ursprünglichen FRAGESTELLUNG. Output ist eine Critical-Friend-Analyse, KEIN Urteil.',
		'',
		'Aufgabe (Stage a — Werk-im-Lichte-der-Fragestellung):',
		'  Ein längerer Absatz (6–12 Sätze), der das Werk in Bezug auf die FRAGESTELLUNG analysiert: greift die Arbeit auf, was die Fragestellung verlangt? Wo fokussiert sie, wo verschiebt sich der Fokus, wo bleibt die Antwort implizit? Indikatoren-Hinweise (gelb=Ambivalenz, rot=Problem) sind ERLAUBT als deskriptive Beobachtung — nicht als kategorisches Urteil.',
		'',
		'Stilregeln (PFLICHT):',
		'  - Sprache: "die Arbeit fokussiert …", "der Bezug zur Fragestellung verschiebt sich …", "implizit bleibt …".',
		'  - KEIN "bewertet", "beurteilt", "schwach", "stark", "präzise", "lückenhaft" — auch nicht implizit.',
		'  - Critical-Friend-Hinweise wie "die Fragestellung wird im Sample nur teilweise eingelöst" oder "die DURCHFÜHRUNG fokussiert auf X, während die FRAGESTELLUNG zusätzlich Y verlangt" sind ERLAUBT als deskriptive Beobachtung mit Indikator-Tönung.',
		'  - Wenn Funktionstypen fehlen (z.B. keine SCHLUSSREFLEXION), das deskriptiv benennen, nicht als Mangel werten.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "aText": "<6–12 Sätze Werk-im-Lichte-der-Fragestellung>"',
		'}',
	].join('\n');

	const userMessage = [
		'FRAGESTELLUNG der Arbeit:',
		input.fragestellungText,
		'',
		'WERK_BESCHREIBUNG (deskriptiv):',
		input.werkBeschreibungText,
		'',
		'Outline-Struktur:',
		input.outlineSummary,
		'',
		'Persistierte Funktionstyp-Konstrukte:',
		input.constructsBlock || '(keine)',
	].join('\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: input.maxTokens,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed: ExtractResult<StageAResult> = extractAndValidateJSON(
		response.text,
		StageALLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`WERK_GUTACHT-a: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
				`Raw: ${response.text.slice(0, 500)}`
		);
	}

	return {
		result: parsed.value,
		model: response.model,
		provider: response.provider,
		timingMs,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── LLM-Call Stage b ──────────────────────────────────────────────

const StageBAxisSchema = z.object({
	axisName: z.enum(AXIS_NAMES),
	indicator: z.enum(['yellow', 'red']).nullable(),
	rationale: z.string().min(1),
});
const StageBLLMSchema = z.object({
	axes: z.array(StageBAxisSchema).length(AXIS_NAMES.length),
});
type StageBAxis = z.infer<typeof StageBAxisSchema>;
type StageBResult = z.infer<typeof StageBLLMSchema>;

interface ExtractStageBInput {
	werkBeschreibungText: string;
	fragestellungText: string;
	constructsBlock: string;
	constructCountsByType: Record<string, number>;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractStageB(input: ExtractStageBInput): Promise<{
	result: StageBResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das ein wissenschaftliches Werk auf sechs funktionstyp-gebundene Achsen prüft. Pro Achse vergibst du einen Indikator (gelb=Ambivalenz/Hotspot, rot=Problem) ODER `null` wenn die Achse strukturell unauffällig ist oder das Werk den Funktionstyp nicht enthält. Strukturierend, NICHT erschöpfend — nicht jede Achse braucht einen Indikator. Grün gibt es nicht (das wäre ein Pauschal-Bestätigung, die der Critical-Friend-Identität widerspricht).',
		'',
		'Die sechs Achsen (Reihenfolge fix einzuhalten):',
		'  1. FRAGESTELLUNG-Qualität',
		'  2. GRUNDLAGENTHEORIE-Fundiertheit',
		'  3. FORSCHUNGSDESIGN-Angemessenheit',
		'  4. DURCHFUEHRUNG-Qualität',
		'  5. SYNTHESE-Systematisierungsleistung',
		'  6. SCHLUSSREFLEXION-Legitimiertheit',
		'',
		'Aufgabe pro Achse:',
		'  - indicator: "yellow" | "red" | null',
		'  - rationale: 1–3 Sätze deskriptiv. Bei `null`: kurzer Hinweis, warum kein Indikator (z.B. "keine SCHLUSSREFLEXION-Container im Werk; nichts zu prüfen", oder "FORSCHUNGSDESIGN-Konstrukte zeigen keine Auffälligkeit, die einen Indikator rechtfertigt"). Bei "yellow"/"red": präziser, deskriptiv-Critical-Friend-Hinweis ("Sample-Größe in BASIS reflektiert keine Generalisierungs-Grenze; im Verhältnis zur FRAGESTELLUNG nach Reichweite ein Hotspot").',
		'',
		'Stilregeln (PFLICHT):',
		'  - Sprache: "auffällig", "Hotspot", "Indikator", "Critical-Friend-Hinweis".',
		'  - KEIN "bewertet/beurteilt"; KEIN "schwach/stark/lückenhaft" als Pauschal-Urteil. Jede Aussage deskriptiv-konkret an einem Material-Bezug.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "axes": [',
		'    {"axisName": "FRAGESTELLUNG-Qualität",          "indicator": "yellow"|"red"|null, "rationale": "..."},',
		'    {"axisName": "GRUNDLAGENTHEORIE-Fundiertheit",  "indicator": "yellow"|"red"|null, "rationale": "..."},',
		'    {"axisName": "FORSCHUNGSDESIGN-Angemessenheit", "indicator": "yellow"|"red"|null, "rationale": "..."},',
		'    {"axisName": "DURCHFUEHRUNG-Qualität",          "indicator": "yellow"|"red"|null, "rationale": "..."},',
		'    {"axisName": "SYNTHESE-Systematisierungsleistung","indicator":"yellow"|"red"|null,"rationale":"..."},',
		'    {"axisName": "SCHLUSSREFLEXION-Legitimiertheit","indicator": "yellow"|"red"|null, "rationale": "..."}',
		'  ]',
		'}',
	].join('\n');

	const countsLine = Object.entries(input.constructCountsByType)
		.map(([k, v]) => `${k}=${v}`)
		.join(', ');

	const userMessage = [
		'FRAGESTELLUNG der Arbeit:',
		input.fragestellungText,
		'',
		'WERK_BESCHREIBUNG (deskriptiv):',
		input.werkBeschreibungText,
		'',
		`Konstrukt-Counts pro Funktionstyp (zur Orientierung über strukturelle Vollständigkeit): ${countsLine}`,
		'',
		'Persistierte Funktionstyp-Konstrukte:',
		input.constructsBlock || '(keine)',
	].join('\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: input.maxTokens,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed: ExtractResult<StageBResult> = extractAndValidateJSON(
		response.text,
		StageBLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`WERK_GUTACHT-b: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
				`Raw: ${response.text.slice(0, 500)}`
		);
	}

	// Achsen-Reihenfolge prüfen — LLM könnte sie umsortieren
	const got = parsed.value.axes.map((a) => a.axisName);
	for (let i = 0; i < AXIS_NAMES.length; i++) {
		if (got[i] !== AXIS_NAMES[i]) {
			throw new Error(
				`WERK_GUTACHT-b: Achsen-Reihenfolge falsch — erwartet ${AXIS_NAMES[i]}, bekommen ${got[i]}.`
			);
		}
	}

	return {
		result: parsed.value,
		model: response.model,
		provider: response.provider,
		timingMs,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── LLM-Call Stage c ──────────────────────────────────────────────
//
// Setzung 2026-05-04 (User): Gating heute deaktiviert. Im Vollausbau ist
// c gated durch case.review_draft_document_id (Mother-Critical-Friend-
// Setzung — kein bewertendes Fazit ohne eigenes User-Urteil davor).
// Heute Test-Modus: c läuft auch ohne review_draft, content.gatingDisabled
// markiert das transparent. Stilistisch bleibt c aggregierend-deskriptiv,
// kein Verdikt — c "synthetisiert" a + b zu einem Gesamtbild.

const StageCLLMSchema = z.object({
	cText: z.string().min(1),
});
type StageCResult = z.infer<typeof StageCLLMSchema>;

interface ExtractStageCInput {
	aText: string;
	bAxes: StageBAxis[];
	werkBeschreibungText: string;
	fragestellungText: string;
	gatingDisabled: boolean;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractStageC(input: ExtractStageCInput): Promise<{
	result: StageCResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const gatingNote = input.gatingDisabled
		? '\n  HINWEIS (Test-Modus): Diese c-Stage läuft ohne hochgeladenes Reviewer-Gutachten (`review_draft`). Im Vollausbau wäre c gated durch das eigene Urteil des Users, der dialogische Block (d/e/f) folgt. Heute ist c-Output ein deskriptiv-aggregierendes Gesamtbild aus a + b — KEIN Verdikt, KEIN Urteil. Im Output-Text DARF NICHT der Eindruck erweckt werden, dass dies ein abschließendes Gutachten sei.'
		: '';

	const system = [
		'Du bist ein analytisches Werkzeug, das aus Stage a (Werk-im-Lichte-der-Fragestellung) und Stage b (Hotspot-Würdigung pro funktionstyp-gebundener Achse) ein zusammenhängendes Gesamtbild des Werks aggregiert.' +
			gatingNote,
		'',
		'Aufgabe (Stage c — aggregiertes Gesamtbild):',
		'  Ein Absatz (5–10 Sätze), der die Befunde von a und b zu einem deskriptiv-aggregierenden Gesamtbild zusammenführt. Keine neuen Urteile, kein Verdikt — du verbindest a und b. Wo Hotspot-Indikatoren (gelb/rot) aus b auftauchen, hebe sie als zentrale Beobachtungen hervor; wo Achsen unauffällig sind, das deskriptiv benennen.',
		'',
		'Stilregeln (PFLICHT):',
		'  - Sprache: "im Zusammenhang …", "die Befunde aus a und b lassen erkennen …", "zentrale Beobachtungen sind …".',
		'  - KEIN "die Arbeit ist gut/schlecht/akzeptabel/mangelhaft". KEIN bewertendes Verdikt. KEIN "Empfehlung" als Reviewer-Aussage.',
		'  - Critical-Friend-Hinweise (deskriptive Beobachtung mit Indikator-Tönung) sind erlaubt.',
		'  - Wenn Test-Modus: Output-Text darf den Test-Modus erwähnen, MUSS aber nicht — gatingDisabled wird ohnehin im content gespeichert.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "cText": "<5–10 Sätze aggregierendes Gesamtbild>"',
		'}',
	].join('\n');

	const axesBlock = input.bAxes
		.map(
			(a) =>
				`- ${a.axisName}: ${a.indicator ?? 'kein Indikator'} — ${a.rationale}`
		)
		.join('\n');

	const userMessage = [
		'FRAGESTELLUNG der Arbeit:',
		input.fragestellungText,
		'',
		'WERK_BESCHREIBUNG (deskriptiv):',
		input.werkBeschreibungText,
		'',
		'Stage a — Werk-im-Lichte-der-Fragestellung:',
		input.aText,
		'',
		'Stage b — Hotspot-Würdigung pro Achse:',
		axesBlock,
	].join('\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: input.maxTokens,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed: ExtractResult<StageCResult> = extractAndValidateJSON(
		response.text,
		StageCLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`WERK_GUTACHT-c: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
				`Raw: ${response.text.slice(0, 500)}`
		);
	}

	return {
		result: parsed.value,
		model: response.model,
		provider: response.provider,
		timingMs,
		tokens: { input: response.inputTokens, output: response.outputTokens },
	};
}

// ── Persistenz ────────────────────────────────────────────────────

interface WerkGutachtContent {
	aText: string;
	bAxes: StageBAxis[];
	cText: string;
	gatingDisabled: boolean;
	gatingNote: string;
	hadMemos: boolean;
	memoCount: number;
	headingCount: number;
	constructCountsByType: Record<string, number>;
	llmModel: string;
	llmTimingMs: { stageA: number; stageB: number; stageC: number };
}

async function clearExistingWerkGutacht(
	caseId: string,
	documentId: string
): Promise<number> {
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'WERK_GUTACHT'
		   AND construct_kind = 'WERK_GUTACHT'`,
		[caseId, documentId]
	);
	return result.rowCount ?? 0;
}

async function persistWerkGutacht(
	caseId: string,
	documentId: string,
	anchorIds: string[],
	content: WerkGutachtContent
): Promise<string> {
	if (anchorIds.length === 0) {
		throw new Error('WERK_GUTACHT: keine Top-Level-Heading-IDs als Anker.');
	}
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
		 VALUES ($1, $2, 'WERK_GUTACHT', 'WERK_GUTACHT', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			anchorIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist WERK_GUTACHT');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

const DEFAULT_WERK_GUTACHT_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

const DEFAULT_MAX_TOKENS_A = 1500;
const DEFAULT_MAX_TOKENS_B = 2500;
const DEFAULT_MAX_TOKENS_C = 1500;

const GATING_NOTE_TEST_MODE =
	'WERK_GUTACHT-c läuft heute mit deaktiviertem Gating für Testung der Mechanik. Im Vollausbau verlangt c den Upload eines `case.review_draft_document_id` (eigenes Reviewer-Urteil) und triggert anschließend den dialogischen Block d/e/f mit Prompt-Isolation gegen Gutachten-Leak.';

export interface WerkGutachtPassOptions {
	persistConstructs?: boolean;
	maxTokensA?: number;
	maxTokensB?: number;
	maxTokensC?: number;
	modelOverride?: { provider: Provider; model: string };
	// Heute keine Wirkung — Gating ist hartkodiert deaktiviert. Sobald
	// review_draft-Upload-UI kommt, wird hier `requireReviewDraft: boolean`
	// dazugestellt; default true, mit Override-Möglichkeit für Devs.
}

export interface WerkGutachtPassResult {
	caseId: string;
	documentId: string;
	aText: string;
	bAxes: StageBAxis[];
	cText: string;
	gatingDisabled: boolean;
	constructId: string | null;
	deletedPriorCount: number;
	hadMemos: boolean;
	memoCount: number;
	headingCount: number;
	constructCountsByType: Record<string, number>;
	llmCalls: number;
	llmTimingMs: { stageA: number; stageB: number; stageC: number; total: number };
	tokens: { input: number; output: number };
	provider: string;
	model: string;
	diagnostics: { warnings: string[] };
}

export async function runWerkGutachtPass(
	caseId: string,
	options: WerkGutachtPassOptions = {}
): Promise<WerkGutachtPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokensA = options.maxTokensA ?? DEFAULT_MAX_TOKENS_A;
	const maxTokensB = options.maxTokensB ?? DEFAULT_MAX_TOKENS_B;
	const maxTokensC = options.maxTokensC ?? DEFAULT_MAX_TOKENS_C;
	const modelOverride = options.modelOverride ?? DEFAULT_WERK_GUTACHT_MODEL;
	const warnings: string[] = [];

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const outline = await loadEffectiveOutline(documentId);
	if (!outline) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_GUTACHT',
			missing: 'Outline',
			diagnostic: 'Werk hat keine ladbare Outline.',
		});
	}
	const { anchorIds, outlineSummary, headingCount } = buildOutlineSummary(
		outline.headings
	);
	if (anchorIds.length === 0) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_GUTACHT',
			missing: 'Top-Level-Heading',
			diagnostic:
				'Werk hat keine nicht-excluded Top-Level-Überschriften. WERK_GUTACHT braucht mind. 1 Heading als Anker.',
		});
	}

	const werkBeschreibungText = await loadWerkBeschreibungText(caseId, documentId);
	if (!werkBeschreibungText) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_GUTACHT',
			missing: 'WERK_BESCHREIBUNG',
			diagnostic:
				'WERK_GUTACHT braucht WERK_BESCHREIBUNG aus h3_werk_deskription. Reviewer-Aktion: WERK_DESKRIPTION-Phase laufen lassen, dann WERK_GUTACHT erneut triggern.',
		});
	}

	const fragestellungText = await loadFragestellungText(caseId, documentId);
	if (!fragestellungText) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_GUTACHT',
			missing: 'FRAGESTELLUNG',
			diagnostic:
				'WERK_GUTACHT braucht FRAGESTELLUNG aus h3_exposition. Reviewer-Aktion: EXPOSITION-Phase laufen lassen.',
		});
	}

	const constructs = await loadAllConstructs(caseId, documentId);
	const { text: constructsBlock, countsByType } = buildConstructsBlock(constructs);

	const memos = await loadCollapseMemos(documentId);
	const hadMemos = memos.length > 0;
	if (hadMemos) {
		warnings.push(
			`H1/H2-Memos vorhanden (${memos.length}); WERK_GUTACHT verwendet WERK_BESCHREIBUNG, in die memos bereits eingeflossen sind.`
		);
	}

	// Stage a
	const aRes = await extractStageA({
		werkBeschreibungText,
		fragestellungText,
		constructsBlock,
		outlineSummary,
		documentId,
		maxTokens: maxTokensA,
		modelOverride,
	});

	// Stage b
	const bRes = await extractStageB({
		werkBeschreibungText,
		fragestellungText,
		constructsBlock,
		constructCountsByType: countsByType,
		documentId,
		maxTokens: maxTokensB,
		modelOverride,
	});

	// Stage c — heute mit deaktiviertem Gating (User-Setzung 2026-05-04)
	const gatingDisabled = true;
	if (gatingDisabled) {
		warnings.push(`WERK_GUTACHT-c-Gating deaktiviert (Test-Modus). ${GATING_NOTE_TEST_MODE}`);
	}
	const cRes = await extractStageC({
		aText: aRes.result.aText,
		bAxes: bRes.result.axes,
		werkBeschreibungText,
		fragestellungText,
		gatingDisabled,
		documentId,
		maxTokens: maxTokensC,
		modelOverride,
	});

	const totalInput = aRes.tokens.input + bRes.tokens.input + cRes.tokens.input;
	const totalOutput = aRes.tokens.output + bRes.tokens.output + cRes.tokens.output;
	const totalTimingMs = aRes.timingMs + bRes.timingMs + cRes.timingMs;

	const content: WerkGutachtContent = {
		aText: aRes.result.aText,
		bAxes: bRes.result.axes,
		cText: cRes.result.cText,
		gatingDisabled,
		gatingNote: GATING_NOTE_TEST_MODE,
		hadMemos,
		memoCount: memos.length,
		headingCount,
		constructCountsByType: countsByType,
		llmModel: aRes.model,
		llmTimingMs: {
			stageA: aRes.timingMs,
			stageB: bRes.timingMs,
			stageC: cRes.timingMs,
		},
	};

	let constructId: string | null = null;
	let deletedPriorCount = 0;
	if (persistConstructs) {
		deletedPriorCount = await clearExistingWerkGutacht(caseId, documentId);
		constructId = await persistWerkGutacht(caseId, documentId, anchorIds, content);
	}

	return {
		caseId,
		documentId,
		aText: content.aText,
		bAxes: content.bAxes,
		cText: content.cText,
		gatingDisabled,
		constructId,
		deletedPriorCount,
		hadMemos,
		memoCount: memos.length,
		headingCount,
		constructCountsByType: countsByType,
		llmCalls: 3,
		llmTimingMs: {
			stageA: aRes.timingMs,
			stageB: bRes.timingMs,
			stageC: cRes.timingMs,
			total: totalTimingMs,
		},
		tokens: { input: totalInput, output: totalOutput },
		provider: aRes.provider,
		model: aRes.model,
		diagnostics: { warnings },
	};
}
