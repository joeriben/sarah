// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:GRUNDLAGENTHEORIE — Schritt 3 reproduktiv (H2-Würdigung + ECKPUNKT_CHECK).
//
// Spec: docs/h3_grundlagentheorie_status.md, Sektion "Schritt 3 reproduktiv".
// Mother-Setzung: project_three_heuristics_architecture.md (H3:GRUNDLAGENTHEORIE).
//
// Mechanik:
//   1. Pro GRUNDLAGENTHEORIE-Container: BLOCK_ROUTING-Konstrukt aus Schritt 2
//      laden (Pflicht — wenn fehlend, Fehler).
//   2. Auf Blöcke mit classification='wiedergabe' filtern.
//   3. Pro reproduktiv-Block ZWEI LLM-Calls:
//        (a) BLOCK_WUERDIGUNG (H2): synthetisch-hermeneutische Zusammenfassung
//            "Was wird in diesem Block gesagt?" — 2–4 Sätze deskriptiv.
//        (b) ECKPUNKT_CHECK (GTH-spezifisch, drei Achsen):
//              kernbegriff   — Schlüsselbegriff des referierten Theoretikers
//                              originalgetreu vs. verkürzt/verzerrt
//              kontamination — Drittkonzepte ohne Markierung eingeschoben
//              provenienz    — beleg-bedürftige Behauptungen ohne Beleg
//            Pro Achse Reviewer-Signal green|yellow|red + Rationale.
//
// Critical-Friend-Identität: Die Tools beschreiben Wiedergabe-Modus und
// Indikatoren — sie BEURTEILEN das Werk nicht. Sprache deskriptiv im Prompt
// und im Output ("im Block taucht X auf, das nicht von Y stammt", nicht
// "der Autor versteht das falsch"). Reviewer-Signale rot/gelb/grün codieren
// Wertung (Problem/Ambivalenz/OK), nicht Klassifikator-Typ.
//
// Persistenz: function_constructs mit construct_kind in
// {'BLOCK_WUERDIGUNG', 'ECKPUNKT_BEFUND'} — pro Container je ein Konstrukt
// mit Array über alle reproduktiv-Blöcke. Keine Idempotenz (analog Schritt 1+2).

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, getModel, getProvider, type Provider } from '../client.js';
import { extractAndValidateJSON } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import {
	loadGrundlagentheorieParagraphsForComplex,
	type GrundlagentheorieContainer,
	type GrundlagentheorieParagraph,
} from './grundlagentheorie.js';
import { loadH3ComplexWalk, type H3Complex } from '../../pipeline/h3-complex-walk.js';

// ── Routing-Konstrukt einlesen ────────────────────────────────────

interface RoutedBlockFromDb {
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	type: 'author_cluster' | 'citation_gap';
	dominantAuthor?: string;
	classification: 'wiedergabe' | 'diskussion';
	rationale: string;
	confidence?: 'high' | 'medium' | 'low';
}

interface BlockRoutingContentFromDb {
	blocks: RoutedBlockFromDb[];
	thresholds: { minClusterLen: number; minCitationGapLen: number };
}

async function loadBlockRoutingForContainer(
	caseId: string,
	documentId: string,
	headingId: string
): Promise<BlockRoutingContentFromDb | null> {
	// BLOCK_ROUTING-Konstrukt eines Containers identifizieren wir über
	// anchor_element_ids — ein Routing-Konstrukt verankert genau die ¶ des
	// Containers. Wenn mehrere Re-Runs persistiert sind (keine Idempotenz),
	// nimmt loadBlockRoutingForContainer den jüngsten via created_at DESC.
	const row = await queryOne<{ content: BlockRoutingContentFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'BLOCK_ROUTING'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, headingId]
	);
	if (!row) {
		// Heading-ID ist nicht zwingend in anchor_element_ids (Routing speichert
		// ¶-IDs, nicht Heading-IDs). Fallback: über erstes ¶ matchen.
		return null;
	}
	return row.content;
}

async function loadBlockRoutingByFirstParagraph(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<BlockRoutingContentFromDb | null> {
	const row = await queryOne<{ content: BlockRoutingContentFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'BLOCK_ROUTING'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, firstParagraphId]
	);
	return row?.content ?? null;
}

// ── BLOCK_WUERDIGUNG (H2 synthetisch-hermeneutisch) ───────────────

const BlockWuerdigungSchema = z.object({
	summary: z.string().min(1),
});
type BlockWuerdigungResult = z.infer<typeof BlockWuerdigungSchema>;

interface BlockWuerdigungInput {
	block: RoutedBlockFromDb;
	paragraphs: GrundlagentheorieParagraph[];
	containerLabel: string;
	documentId: string;
	modelOverride?: { provider: Provider; model: string };
}

async function blockWuerdigung(input: BlockWuerdigungInput): Promise<{
	result: BlockWuerdigungResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	// H2-Stil: synthetisch-hermeneutisch, keine ¶-weise Argumentanalyse.
	// Der Block ist als Wiedergabe-Modus klassifiziert — die Aufgabe ist
	// zu beschreiben, was inhaltlich entfaltet wird (nicht zu prüfen, wie
	// gut die Wiedergabe ist; das macht ECKPUNKT_CHECK separat).
	const system = [
		'Du bist ein analytisches Werkzeug, das einen zusammenhängenden Textblock aus einem Theoriekapitel einer wissenschaftlichen Arbeit synthetisch-hermeneutisch würdigt.',
		'',
		'Aufgabe: Fasse zusammen, WAS dieser Textblock inhaltlich entfaltet — welche Begriffe, welche Theoriestücke, welche Linie wird vom Text durch den Block gezogen.',
		'',
		'Stil: 2–4 Sätze in DESKRIPTIVER Sprache. Du beurteilst nicht, ob die Wiedergabe gut oder schlecht ist; du benennst, was der Block sagt. Keine Wert-Urteile, keine Qualitätsaussagen über Tiefe oder Verkürzung. Eigene Worte, keine wörtlichen Zitate.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "summary": "<2–4 Sätze, deskriptiv>"',
		'}',
	].join('\n');

	const blockText = input.paragraphs
		.map((p, i) => `[¶${input.block.paragraphIndexRange[0] + i}] ${p.text}`)
		.join('\n\n');

	const metaLines: string[] = [];
	metaLines.push(`Container: ${input.containerLabel}`);
	metaLines.push(
		`¶-Bereich: ${input.block.paragraphIndexRange[0]}–${input.block.paragraphIndexRange[1]} (${input.paragraphs.length} ¶)`
	);
	metaLines.push(`Block-Typ: ${input.block.type}`);
	if (input.block.dominantAuthor) {
		metaLines.push(`Dominanter Autor (deterministisch erkannt): ${input.block.dominantAuthor}`);
	}

	const userMessage = [metaLines.join('\n'), '', 'Block-Text:', blockText].join('\n\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 500,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed = extractAndValidateJSON(response.text, BlockWuerdigungSchema);
	if (!parsed.ok) {
		throw new Error(
			`BLOCK_WUERDIGUNG: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

// ── ECKPUNKT_CHECK (drei Achsen) ──────────────────────────────────

const Signal = z.enum(['green', 'yellow', 'red']);
const AxisSchema = z.object({
	signal: Signal,
	rationale: z.string().min(1),
	paragraphIds: z.array(z.string()).optional(),
});
const EckpunktCheckSchema = z.object({
	axes: z.object({
		kernbegriff: AxisSchema,
		kontamination: AxisSchema,
		provenienz: AxisSchema,
	}),
});
type EckpunktCheckResult = z.infer<typeof EckpunktCheckSchema>;
type AxisResult = z.infer<typeof AxisSchema>;

interface EckpunktCheckInput {
	block: RoutedBlockFromDb;
	paragraphs: GrundlagentheorieParagraph[];
	containerLabel: string;
	documentId: string;
	modelOverride?: { provider: Provider; model: string };
}

async function eckpunktCheck(input: EckpunktCheckInput): Promise<{
	result: EckpunktCheckResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das die Wiedergabe-Qualität eines reproduktiven Textblocks aus einem Theoriekapitel auf drei Achsen analysiert.',
		'',
		'Drei Achsen:',
		'',
		'  (a) kernbegriff — Wird der Schlüsselbegriff des im Block referierten Theoretikers im Sinne des Originals dargestellt, oder verkürzt/verzerrt? Indikatoren für Verkürzung: zentrale Verschränkungen werden weggelassen, eine Dimension einer mehrdimensionalen Konzeption wird isoliert dargestellt, der Begriff verliert seine technische Bedeutung. Falls im Block kein eindeutig identifizierbarer Eckpunkt-Theoretiker erkennbar ist (z.B. citation-freier Block ohne klar dominanten Autor): Signal "yellow" mit Rationale "kein eindeutiger Eckpunkt im Block identifizierbar".',
		'',
		'  (b) kontamination — Werden Drittkonzepte ohne Markierung eingeschoben? Ein Block, der Theoretiker A wiedergibt und plötzlich ein Konzept aus Theoretiker B oder einem anderen Theorie-Kontext verwendet, ohne den Übergang als solchen zu kennzeichnen, ist ein Kontaminations-Indikator. Sauber markierte Querbezüge (»vergleichbar mit X«, »anders als bei Y«) sind keine Kontamination.',
		'',
		'  (c) provenienz — Stehen Behauptungen im Block, die einer Quelle bedürfen, ohne Beleg da? Allgemeine Aussagen über einen Theoretiker oder über empirische Sachverhalte, die nicht zum Allgemeingut zählen, brauchen einen Beleg. Fehlende Belege bei beleg-bedürftigen Behauptungen sind ein Provenienz-Indikator.',
		'',
		'Reviewer-Signale pro Achse:',
		'  - "green"  = unauffällig, keine erkennbaren Probleme auf dieser Achse',
		'  - "yellow" = ambivalent, Hinweis worth noting, nicht eindeutig problematisch',
		'  - "red"    = klares Problem auf dieser Achse',
		'',
		'Sprache: DESKRIPTIV. Beschreibe, was du im Block beobachtest — z.B. "im Block taucht das Konzept X auf, das nicht zur referierten Theorie Y gehört" — NICHT "der Block ist schlecht" oder "der Autor versteht das falsch". Du benennst Indikatoren, du sprichst kein Urteil.',
		'',
		'Pro Achse: Signal, kurze deskriptive Rationale (1–2 Sätze, was hast du beobachtet), optional ¶-Anker (welche der vorgelegten ¶ sind betroffen).',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "axes": {',
		'    "kernbegriff":   { "signal": "green"|"yellow"|"red", "rationale": "<1–2 Sätze>", "paragraphIds": ["<id>", …] },',
		'    "kontamination": { "signal": "green"|"yellow"|"red", "rationale": "<1–2 Sätze>", "paragraphIds": ["<id>", …] },',
		'    "provenienz":    { "signal": "green"|"yellow"|"red", "rationale": "<1–2 Sätze>", "paragraphIds": ["<id>", …] }',
		'  }',
		'}',
		'',
		'paragraphIds ist optional und nur zu setzen, wenn konkrete ¶ als Anker für die Beobachtung benannt werden können. Verwende exakt die im Block-Text angegebenen ¶-IDs.',
	].join('\n');

	const blockText = input.paragraphs
		.map((p) => `[¶-id=${p.paragraphId} | ¶${p.indexInContainer}] ${p.text}`)
		.join('\n\n');

	const metaLines: string[] = [];
	metaLines.push(`Container: ${input.containerLabel}`);
	metaLines.push(
		`¶-Bereich: ${input.block.paragraphIndexRange[0]}–${input.block.paragraphIndexRange[1]} (${input.paragraphs.length} ¶)`
	);
	metaLines.push(`Block-Typ: ${input.block.type}`);
	if (input.block.dominantAuthor) {
		metaLines.push(`Dominanter Autor (deterministisch erkannt): ${input.block.dominantAuthor}`);
	} else {
		metaLines.push(`Dominanter Autor: (keiner deterministisch erkannt — kein eindeutiger Eckpunkt)`);
	}

	const userMessage = [metaLines.join('\n'), '', 'Block-Text (mit ¶-IDs):', blockText].join('\n\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 1500,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed = extractAndValidateJSON(response.text, EckpunktCheckSchema);
	if (!parsed.ok) {
		throw new Error(
			`ECKPUNKT_CHECK: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

// ── Persistenz ─────────────────────────────────────────────────────

interface BlockWuerdigungPersisted {
	blockIndex: number;
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	summary: string;
	llmModel: string;
	llmTimingMs: number;
}

interface BlockWuerdigungContent {
	blocks: BlockWuerdigungPersisted[];
}

interface EckpunktBefundPersisted {
	blockIndex: number;
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	axes: EckpunktCheckResult['axes'];
	llmModel: string;
	llmTimingMs: number;
}

interface EckpunktBefundContent {
	blocks: EckpunktBefundPersisted[];
}

async function persistConstruct(
	caseId: string,
	documentId: string,
	container: GrundlagentheorieContainer,
	constructKind: 'BLOCK_WUERDIGUNG' | 'ECKPUNKT_BEFUND',
	content: BlockWuerdigungContent | EckpunktBefundContent
): Promise<string> {
	const stackEntry = {
		kind: 'origin' as const,
		at: new Date().toISOString(),
		by_user_id: null,
		source_run_id: null,
		content_snapshot: content,
	};
	const anchorIds = container.paragraphs.map((p) => p.paragraphId);
	if (anchorIds.length === 0) {
		throw new Error(
			`${constructKind}: Container "${container.headingText}" hat keine Paragraphen.`
		);
	}
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'GRUNDLAGENTHEORIE', $3, $4, $5, $6)
		 RETURNING id`,
		[
			caseId,
			documentId,
			constructKind,
			anchorIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error(`Failed to persist ${constructKind} for ${container.headingText}`);
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface ReproductivePassOptions {
	persistConstructs?: boolean;
	modelOverride?: { provider: Provider; model: string };
}

export interface ContainerReproductiveResult {
	headingId: string;
	headingText: string;
	paragraphCount: number;
	reproductiveBlockCount: number;
	blocks: Array<{
		blockIndex: number;
		type: 'author_cluster' | 'citation_gap';
		paragraphIds: string[];
		paragraphIndexRange: [number, number];
		dominantAuthor?: string;
		summary: string;
		summaryLlmModel: string;
		summaryTimingMs: number;
		summaryTokens: { input: number; output: number };
		axes: EckpunktCheckResult['axes'];
		eckpunktLlmModel: string;
		eckpunktTimingMs: number;
		eckpunktTokens: { input: number; output: number };
	}>;
	blockWuerdigungConstructId: string | null;
	eckpunktBefundConstructId: string | null;
}

export interface ReproductivePassResult {
	caseId: string;
	documentId: string;
	model: string;
	provider: string;
	totalLlmCalls: number;
	totalTimingMs: number;
	totalTokens: { input: number; output: number };
	containers: ContainerReproductiveResult[];
}

// Default-Modell: Sonnet 4.6 via OpenRouter — selber Default wie der
// Routing-Pass (grundlagentheorie_routing.ts). Begründung: Block-Würdigung
// (H2 synthetisch) und 3-Achsen-Klassifikation sind im selben Komplexitäts-
// Bereich wie das Routing; ein im Repo etabliertes Modell ohne Premium-
// Aufschlag. Tunable via options.modelOverride.
const DEFAULT_REPRODUCTIVE_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

/**
 * Anchor-skopierter DELETE für BLOCK_WUERDIGUNG + ECKPUNKT_BEFUND eines
 * Komplexes — Idempotenz pro Walk-Knoten.
 */
async function clearExistingReproductiveBefundForComplex(
	caseId: string,
	documentId: string,
	complexParagraphIds: string[]
): Promise<number> {
	if (complexParagraphIds.length === 0) return 0;
	const r = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind IN ('BLOCK_WUERDIGUNG', 'ECKPUNKT_BEFUND')
		   AND anchor_element_ids <@ $3::uuid[]`,
		[caseId, documentId, complexParagraphIds]
	);
	return r.rowCount ?? 0;
}

export interface ReproductiveComplexPassResult {
	caseId: string;
	documentId: string;
	model: string;
	provider: string;
	totalLlmCalls: number;
	totalTimingMs: number;
	totalTokens: { input: number; output: number };
	container: ContainerReproductiveResult;
}

/**
 * Komplex-skopierter Eintritt für H3:GRUNDLAGENTHEORIE Schritt 3b (reproduktiv).
 *
 * Voraussetzungen pro Komplex: BLOCK_ROUTING (Step 2) muss bereits persistiert
 * sein — die ¶ des Komplexes sind die Anchor-Match-Basis.
 */
export async function runReproductiveBlockForComplex(
	caseId: string,
	documentId: string,
	complex: H3Complex,
	options: ReproductivePassOptions = {}
): Promise<ReproductiveComplexPassResult> {
	if (complex.functionType !== 'GRUNDLAGENTHEORIE') {
		throw new Error(
			`runReproductiveBlockForComplex erwartet functionType='GRUNDLAGENTHEORIE', erhielt '${complex.functionType}' (heading=${complex.headingId})`
		);
	}
	const persistConstructs = options.persistConstructs !== false;
	const modelOverride = options.modelOverride ?? DEFAULT_REPRODUCTIVE_MODEL;

	const container = await loadGrundlagentheorieParagraphsForComplex(documentId, complex);
	if (container.paragraphs.length === 0) {
		throw new Error(
			`GRUNDLAGENTHEORIE-Komplex ${complex.headingId} hat keine Paragraphen — Walk-Builder sollte das verhindern.`
		);
	}

	let routing = await loadBlockRoutingByFirstParagraph(
		caseId,
		documentId,
		container.paragraphs[0].paragraphId
	);
	if (!routing) {
		// Fallback: Heading-ID-Match (für etwaige Persistenz-Varianten)
		routing = await loadBlockRoutingForContainer(caseId, documentId, container.headingId);
	}
	if (!routing) {
		throw new Error(
			`Komplex "${container.headingText}" hat kein BLOCK_ROUTING-Konstrukt — ` +
				`Routing-Pass (Step 2) muss zuerst laufen ` +
				`(scripts/test-h3-routing.ts <caseId> --persist).`
		);
	}

	if (persistConstructs) {
		await clearExistingReproductiveBefundForComplex(caseId, documentId, complex.paragraphIds);
	}

	const reproductiveBlocks = routing.blocks.filter((b) => b.classification === 'wiedergabe');

	const paragraphById = new Map(container.paragraphs.map((p) => [p.paragraphId, p]));
	const containerResultBlocks: ContainerReproductiveResult['blocks'] = [];
	let totalLlmCalls = 0;
	let totalTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastModel = '';
	let lastProvider = '';

	for (let i = 0; i < reproductiveBlocks.length; i++) {
		const block = reproductiveBlocks[i];
		const blockParagraphs = block.paragraphIds.map((id) => {
			const p = paragraphById.get(id);
			if (!p) {
				throw new Error(
					`Block-¶ ${id} aus Routing-Konstrukt nicht in Komplex "${container.headingText}" gefunden.`
				);
			}
			return p;
		});

		// Call 1 — H2 BLOCK_WUERDIGUNG
		const wuerdigung = await blockWuerdigung({
			block,
			paragraphs: blockParagraphs,
			containerLabel: container.headingText,
			documentId,
			modelOverride,
		});
		totalLlmCalls += 1;
		totalTimingMs += wuerdigung.timingMs;
		totalInputTokens += wuerdigung.tokens.input;
		totalOutputTokens += wuerdigung.tokens.output;
		lastModel = wuerdigung.model;
		lastProvider = wuerdigung.provider;

		// Call 2 — ECKPUNKT_CHECK
		const eckpunkt = await eckpunktCheck({
			block,
			paragraphs: blockParagraphs,
			containerLabel: container.headingText,
			documentId,
			modelOverride,
		});
		totalLlmCalls += 1;
		totalTimingMs += eckpunkt.timingMs;
		totalInputTokens += eckpunkt.tokens.input;
		totalOutputTokens += eckpunkt.tokens.output;
		lastModel = eckpunkt.model;
		lastProvider = eckpunkt.provider;

		containerResultBlocks.push({
			blockIndex: i,
			type: block.type,
			paragraphIds: block.paragraphIds,
			paragraphIndexRange: block.paragraphIndexRange,
			dominantAuthor: block.dominantAuthor,
			summary: wuerdigung.result.summary,
			summaryLlmModel: wuerdigung.model,
			summaryTimingMs: wuerdigung.timingMs,
			summaryTokens: wuerdigung.tokens,
			axes: eckpunkt.result.axes,
			eckpunktLlmModel: eckpunkt.model,
			eckpunktTimingMs: eckpunkt.timingMs,
			eckpunktTokens: eckpunkt.tokens,
		});
	}

	let wuerdigungConstructId: string | null = null;
	let eckpunktConstructId: string | null = null;
	if (persistConstructs && containerResultBlocks.length > 0) {
		const wuerdigungContent: BlockWuerdigungContent = {
			blocks: containerResultBlocks.map((b) => ({
				blockIndex: b.blockIndex,
				paragraphIds: b.paragraphIds,
				paragraphIndexRange: b.paragraphIndexRange,
				summary: b.summary,
				llmModel: b.summaryLlmModel,
				llmTimingMs: b.summaryTimingMs,
			})),
		};
		const eckpunktContent: EckpunktBefundContent = {
			blocks: containerResultBlocks.map((b) => ({
				blockIndex: b.blockIndex,
				paragraphIds: b.paragraphIds,
				paragraphIndexRange: b.paragraphIndexRange,
				axes: b.axes,
				llmModel: b.eckpunktLlmModel,
				llmTimingMs: b.eckpunktTimingMs,
			})),
		};
		wuerdigungConstructId = await persistConstruct(
			caseId,
			documentId,
			container,
			'BLOCK_WUERDIGUNG',
			wuerdigungContent
		);
		eckpunktConstructId = await persistConstruct(
			caseId,
			documentId,
			container,
			'ECKPUNKT_BEFUND',
			eckpunktContent
		);
	}

	return {
		caseId,
		documentId,
		model: lastModel || modelOverride?.model || getModel(),
		provider: lastProvider || modelOverride?.provider || getProvider(),
		totalLlmCalls,
		totalTimingMs,
		totalTokens: { input: totalInputTokens, output: totalOutputTokens },
		container: {
			headingId: container.headingId,
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
			reproductiveBlockCount: reproductiveBlocks.length,
			blocks: containerResultBlocks,
			blockWuerdigungConstructId: wuerdigungConstructId,
			eckpunktBefundConstructId: eckpunktConstructId,
		},
	};
}

/**
 * Werk-skopierter Wrapper über den Walk: dispatched
 * runReproductiveBlockForComplex pro GRUNDLAGENTHEORIE-Komplex.
 */
export async function runReproductiveBlockPass(
	caseId: string,
	options: ReproductivePassOptions = {}
): Promise<ReproductivePassResult> {
	const modelOverride = options.modelOverride ?? DEFAULT_REPRODUCTIVE_MODEL;

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
	const gthComplexes = walk.filter((c) => c.functionType === 'GRUNDLAGENTHEORIE');
	if (gthComplexes.length === 0) {
		throw new PreconditionFailedError({
			heuristic: 'GRUNDLAGENTHEORIE',
			missing: 'GRUNDLAGENTHEORIE-Komplex',
			diagnostic:
				`Werk ${documentId} hat keinen GRUNDLAGENTHEORIE-Komplex im H3-Walk — ` +
				`erst FUNKTIONSTYP_ZUWEISEN-Vor-Heuristik laufen oder Outline-UI manuell setzen.`,
		});
	}

	const out: ContainerReproductiveResult[] = [];
	let totalLlmCalls = 0;
	let totalTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastModel = '';
	let lastProvider = '';

	for (const complex of gthComplexes) {
		const result = await runReproductiveBlockForComplex(caseId, documentId, complex, options);
		out.push(result.container);
		totalLlmCalls += result.totalLlmCalls;
		totalTimingMs += result.totalTimingMs;
		totalInputTokens += result.totalTokens.input;
		totalOutputTokens += result.totalTokens.output;
		if (result.model) lastModel = result.model;
		if (result.provider) lastProvider = result.provider;
	}

	return {
		caseId,
		documentId,
		model: lastModel || modelOverride?.model || getModel(),
		provider: lastProvider || modelOverride?.provider || getProvider(),
		totalLlmCalls,
		totalTimingMs,
		totalTokens: { input: totalInputTokens, output: totalOutputTokens },
		containers: out,
	};
}
