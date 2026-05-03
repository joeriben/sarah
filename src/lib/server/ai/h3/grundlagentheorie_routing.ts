// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:GRUNDLAGENTHEORIE — Schritt 2 (Routing).
//
// Spec: docs/h3_grundlagentheorie_status.md, Sektion "Schritt 2 — Routing".
// Mother-Setzung: project_three_heuristics_architecture.md (H3:GRUNDLAGENTHEORIE).
//
// Mechanik:
//   1. Pro GRUNDLAGENTHEORIE-Container: Verweisprofil aufbauen (deterministisch,
//      aus grundlagentheorie.ts wiederverwendet — read-only, ohne Persistenz).
//   2. Verdachts-Blöcke identifizieren (deterministisch, kein LLM):
//      - author_cluster: ≥ minClusterLen ¶ mit gleichem dominantAuthor
//      - citation_gap:   ≥ minCitationGapLen ¶ mit citationCount=0
//      Bei Overlap gewinnt author_cluster (spezifischer).
//   3. Pro Verdachts-Block ein billiger Block-LLM-Call WIEDERGABE_PRÜFEN.
//      Output: Klassifikation wiedergabe|diskussion + deskriptive Begründung.
//
// Critical-Friend-Identität: das Tool klassifiziert Mode (reproduktiv vs.
// diskursiv), es bewertet/beurteilt nicht. Sprachregel im Prompt eingehalten.
//
// Persistenz: function_constructs mit construct_kind='BLOCK_ROUTING'. Pro
// Container ein Konstrukt mit blocks[] + thresholds. Keine Idempotenz (analog
// VERWEIS_PROFIL — Re-Run dupliziert in der experimentellen Phase).

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, getModel, getProvider, type Provider } from '../client.js';
import { extractAndValidateJSON } from '../json-extract.js';
import {
	loadGrundlagentheorieContainers,
	extractInlineCitations,
	type GrundlagentheorieContainer,
	type GrundlagentheorieParagraph,
} from './grundlagentheorie.js';

// ── Verdachts-Block-Identifikation (deterministisch) ───────────────

export type SuspicionBlockType = 'author_cluster' | 'citation_gap';

export interface SuspicionBlock {
	type: SuspicionBlockType;
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	dominantAuthor?: string;
	authorMentions?: Array<{ author: string; mentions: number }>;
}

interface ParagraphSignature {
	paragraphId: string;
	indexInContainer: number;
	citationCount: number;
	dominantAuthor: string | null;
	authorCounts: Map<string, number>;
}

function buildParagraphSignatures(
	container: GrundlagentheorieContainer
): ParagraphSignature[] {
	return container.paragraphs.map((p) => {
		const citations = extractInlineCitations(p);
		const authorCounts = new Map<string, number>();
		for (const c of citations) {
			for (const a of c.authorsCanonical) {
				authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
			}
		}
		let dominant: string | null = null;
		let dominantCount = 0;
		for (const [a, n] of authorCounts) {
			if (n > dominantCount) {
				dominant = a;
				dominantCount = n;
			}
		}
		return {
			paragraphId: p.paragraphId,
			indexInContainer: p.indexInContainer,
			citationCount: citations.length,
			dominantAuthor: dominant,
			authorCounts,
		};
	});
}

export function identifySuspicionBlocks(
	container: GrundlagentheorieContainer,
	thresholds: { minClusterLen: number; minCitationGapLen: number }
): SuspicionBlock[] {
	const sigs = buildParagraphSignatures(container);
	if (sigs.length === 0) return [];

	// Pass 1: author_cluster (höhere Priorität)
	const authorBlocks: SuspicionBlock[] = [];
	let runStart = -1;
	let runAuthor: string | null = null;
	const flushAuthorRun = (endExclusive: number) => {
		if (runStart < 0 || runAuthor === null) return;
		const len = endExclusive - runStart;
		if (len >= thresholds.minClusterLen) {
			const slice = sigs.slice(runStart, endExclusive);
			const mentionMap = new Map<string, number>();
			for (const s of slice) {
				for (const [a, n] of s.authorCounts) {
					mentionMap.set(a, (mentionMap.get(a) ?? 0) + n);
				}
			}
			const mentions = Array.from(mentionMap.entries())
				.map(([author, m]) => ({ author, mentions: m }))
				.sort((a, b) => b.mentions - a.mentions);
			authorBlocks.push({
				type: 'author_cluster',
				paragraphIds: slice.map((s) => s.paragraphId),
				paragraphIndexRange: [slice[0].indexInContainer, slice[slice.length - 1].indexInContainer],
				dominantAuthor: runAuthor,
				authorMentions: mentions,
			});
		}
	};
	for (let i = 0; i < sigs.length; i++) {
		const s = sigs[i];
		if (s.dominantAuthor && s.dominantAuthor === runAuthor) {
			// Lauf läuft weiter
			continue;
		}
		// Lauf endet
		flushAuthorRun(i);
		runAuthor = s.dominantAuthor;
		runStart = s.dominantAuthor ? i : -1;
	}
	flushAuthorRun(sigs.length);

	// Pass 2: citation_gap, exclusive zu author_cluster-¶
	const usedIndices = new Set<number>();
	for (const b of authorBlocks) {
		for (let i = b.paragraphIndexRange[0]; i <= b.paragraphIndexRange[1]; i++) {
			usedIndices.add(i);
		}
	}
	const gapBlocks: SuspicionBlock[] = [];
	let gapStart = -1;
	const flushGap = (endExclusive: number) => {
		if (gapStart < 0) return;
		const len = endExclusive - gapStart;
		if (len >= thresholds.minCitationGapLen) {
			const slice = sigs.slice(gapStart, endExclusive);
			gapBlocks.push({
				type: 'citation_gap',
				paragraphIds: slice.map((s) => s.paragraphId),
				paragraphIndexRange: [slice[0].indexInContainer, slice[slice.length - 1].indexInContainer],
			});
		}
	};
	for (let i = 0; i < sigs.length; i++) {
		const s = sigs[i];
		if (usedIndices.has(i)) {
			flushGap(i);
			gapStart = -1;
			continue;
		}
		if (s.citationCount === 0) {
			if (gapStart < 0) gapStart = i;
		} else {
			flushGap(i);
			gapStart = -1;
		}
	}
	flushGap(sigs.length);

	// Sortiert nach Start-Index
	return [...authorBlocks, ...gapBlocks].sort(
		(a, b) => a.paragraphIndexRange[0] - b.paragraphIndexRange[0]
	);
}

// ── WIEDERGABE_PRÜFEN per Block-LLM ────────────────────────────────

const RoutingResultSchema = z.object({
	classification: z.enum(['wiedergabe', 'diskussion']),
	rationale: z.string().min(1),
	confidence: z.enum(['high', 'medium', 'low']).optional(),
});
type RoutingResult = z.infer<typeof RoutingResultSchema>;

interface WiedergabePruefenInput {
	block: SuspicionBlock;
	paragraphs: GrundlagentheorieParagraph[];
	containerLabel: string;
	documentId: string;
	modelOverride?: { provider: Provider; model: string };
}

async function wiedergabePruefen(
	input: WiedergabePruefenInput
): Promise<{
	result: RoutingResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das einen zusammenhängenden Textblock aus einem Theoriekapitel einer wissenschaftlichen Arbeit auf seinen Modus klassifiziert.',
		'',
		'Modus-Unterscheidung:',
		'  - "wiedergabe": der Block referiert/paraphrasiert vorhandenes Wissen einer (oder weniger) Quelle(n), ohne dass eine eigene argumentative Linie entwickelt wird. Typische Indikatoren: konsekutive Bezugnahme auf denselben Autor, lehrbuchartige Darstellung, fehlende eigenständige Verknüpfung oder Problematisierung.',
		'  - "diskussion": der Block entwickelt eine eigene argumentative Linie, verknüpft Positionen, problematisiert, vergleicht, ordnet ein. Citations stehen im Dienst eines eigenen Gedankengangs, nicht als bloße Referat-Stützen.',
		'',
		'Klassifiziere den vorgelegten Block. Begründe deine Klassifikation in 1–3 Sätzen DESKRIPTIV — beschreibe, was im Text passiert (welche Bewegung der Text macht), nicht ob das gut oder schlecht ist. Du beurteilst den Block nicht; du benennst seinen Modus.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "classification": "wiedergabe" | "diskussion",',
		'  "rationale": "<1–3 Sätze, deskriptiv>",',
		'  "confidence": "high" | "medium" | "low"  // optional',
		'}',
	].join('\n');

	const blockText = input.paragraphs
		.map((p, i) => `[¶${input.block.paragraphIndexRange[0] + i}] ${p.text}`)
		.join('\n\n');

	const metaLines: string[] = [];
	metaLines.push(`Container: ${input.containerLabel}`);
	metaLines.push(`Block-Typ: ${input.block.type}`);
	metaLines.push(
		`¶-Bereich: ${input.block.paragraphIndexRange[0]}–${input.block.paragraphIndexRange[1]} (${input.paragraphs.length} ¶)`
	);
	if (input.block.dominantAuthor) {
		metaLines.push(`Dominanter Autor (deterministisch erkannt): ${input.block.dominantAuthor}`);
	}
	if (input.block.authorMentions && input.block.authorMentions.length > 0) {
		const top = input.block.authorMentions
			.slice(0, 5)
			.map((m) => `${m.author}=${m.mentions}`)
			.join(', ');
		metaLines.push(`Author-Mentions im Block (Top-5): ${top}`);
	}

	const userMessage = [metaLines.join('\n'), '', 'Block-Text:', blockText].join('\n\n');

	const t0 = Date.now();
	const response = await chat({
		system,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens: 400,
		responseFormat: 'json',
		documentIds: [input.documentId],
		modelOverride: input.modelOverride,
	});
	const timingMs = Date.now() - t0;

	const parsed = extractAndValidateJSON(response.text, RoutingResultSchema);
	if (!parsed.ok) {
		throw new Error(
			`WIEDERGABE_PRÜFEN: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

interface RoutedBlockPersisted {
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	type: SuspicionBlockType;
	dominantAuthor?: string;
	classification: 'wiedergabe' | 'diskussion';
	rationale: string;
	confidence?: 'high' | 'medium' | 'low';
	llmModel: string;
	llmTimingMs: number;
}

interface BlockRoutingContent {
	blocks: RoutedBlockPersisted[];
	thresholds: {
		minClusterLen: number;
		minCitationGapLen: number;
	};
}

async function persistBlockRouting(
	caseId: string,
	documentId: string,
	container: GrundlagentheorieContainer,
	content: BlockRoutingContent
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
			`BLOCK_ROUTING: Container "${container.headingText}" hat keine Paragraphen.`
		);
	}
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'GRUNDLAGENTHEORIE', 'BLOCK_ROUTING', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			anchorIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error(`Failed to persist BLOCK_ROUTING for ${container.headingText}`);
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface RoutingPassOptions {
	persistConstructs?: boolean;
	minClusterLen?: number;
	minCitationGapLen?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface ContainerRoutingResult {
	headingId: string;
	headingText: string;
	paragraphCount: number;
	blocks: Array<{
		type: SuspicionBlockType;
		paragraphIds: string[];
		paragraphIndexRange: [number, number];
		dominantAuthor?: string;
		classification: 'wiedergabe' | 'diskussion';
		rationale: string;
		confidence?: 'high' | 'medium' | 'low';
		llmModel: string;
		llmTimingMs: number;
		tokens: { input: number; output: number };
	}>;
	blockRoutingConstructId: string | null;
}

export interface RoutingPassResult {
	caseId: string;
	documentId: string;
	thresholds: { minClusterLen: number; minCitationGapLen: number };
	model: string;
	provider: string;
	totalLlmCalls: number;
	totalTimingMs: number;
	totalTokens: { input: number; output: number };
	containers: ContainerRoutingResult[];
}

const DEFAULT_MIN_CLUSTER_LEN = 4;
const DEFAULT_MIN_CITATION_GAP_LEN = 5;

// Default-Modell für das Routing: Sonnet 4.6 via OpenRouter. Begründung:
// Block-Klassifikation braucht kein nuanciertes Reasoning; Sonnet ist im
// Repo etabliert (vgl. compare-models-section-collapse.ts) und deutlich
// günstiger als der derzeit per ai-settings.json aktive Opus-Default.
// Tunable via options.modelOverride.
const DEFAULT_ROUTING_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

export async function runRoutingPass(
	caseId: string,
	options: RoutingPassOptions = {}
): Promise<RoutingPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const minClusterLen = options.minClusterLen ?? DEFAULT_MIN_CLUSTER_LEN;
	const minCitationGapLen = options.minCitationGapLen ?? DEFAULT_MIN_CITATION_GAP_LEN;
	const modelOverride = options.modelOverride ?? DEFAULT_ROUTING_MODEL;

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

	const thresholds = { minClusterLen, minCitationGapLen };
	const out: ContainerRoutingResult[] = [];
	let totalLlmCalls = 0;
	let totalTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastModel = '';
	let lastProvider = '';

	for (const container of containers) {
		const suspicionBlocks = identifySuspicionBlocks(container, thresholds);
		const paragraphById = new Map(container.paragraphs.map((p) => [p.paragraphId, p]));

		const containerResultBlocks: ContainerRoutingResult['blocks'] = [];
		for (const block of suspicionBlocks) {
			const blockParagraphs = block.paragraphIds.map((id) => {
				const p = paragraphById.get(id);
				if (!p) throw new Error(`Block-¶ ${id} not found in container`);
				return p;
			});
			const llm = await wiedergabePruefen({
				block,
				paragraphs: blockParagraphs,
				containerLabel: container.headingText,
				documentId,
				modelOverride,
			});
			totalLlmCalls += 1;
			totalTimingMs += llm.timingMs;
			totalInputTokens += llm.tokens.input;
			totalOutputTokens += llm.tokens.output;
			lastModel = llm.model;
			lastProvider = llm.provider;
			containerResultBlocks.push({
				type: block.type,
				paragraphIds: block.paragraphIds,
				paragraphIndexRange: block.paragraphIndexRange,
				dominantAuthor: block.dominantAuthor,
				classification: llm.result.classification,
				rationale: llm.result.rationale,
				confidence: llm.result.confidence,
				llmModel: llm.model,
				llmTimingMs: llm.timingMs,
				tokens: llm.tokens,
			});
		}

		let constructId: string | null = null;
		if (persistConstructs && containerResultBlocks.length > 0) {
			const persistedBlocks: RoutedBlockPersisted[] = containerResultBlocks.map((b) => ({
				paragraphIds: b.paragraphIds,
				paragraphIndexRange: b.paragraphIndexRange,
				type: b.type,
				dominantAuthor: b.dominantAuthor,
				classification: b.classification,
				rationale: b.rationale,
				confidence: b.confidence,
				llmModel: b.llmModel,
				llmTimingMs: b.llmTimingMs,
			}));
			constructId = await persistBlockRouting(caseId, documentId, container, {
				blocks: persistedBlocks,
				thresholds,
			});
		}

		out.push({
			headingId: container.headingId,
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
			blocks: containerResultBlocks,
			blockRoutingConstructId: constructId,
		});
	}

	return {
		caseId,
		documentId,
		thresholds,
		model: lastModel || modelOverride?.model || getModel(),
		provider: lastProvider || modelOverride?.provider || getProvider(),
		totalLlmCalls,
		totalTimingMs,
		totalTokens: { input: totalInputTokens, output: totalOutputTokens },
		containers: out,
	};
}
