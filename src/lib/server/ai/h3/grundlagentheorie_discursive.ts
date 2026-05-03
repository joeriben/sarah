// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:GRUNDLAGENTHEORIE — Schritt 3 diskursiv (DISKURSIV_BEZUG_PRÜFEN).
//
// Spec: docs/h3_grundlagentheorie_status.md, Sektion "Schritt 3 diskursiv".
// Mother-Setzung: project_three_heuristics_architecture.md (H3:GRUNDLAGENTHEORIE).
//
// Mechanik:
//   1. Pro GRUNDLAGENTHEORIE-Container: BLOCK_ROUTING-Konstrukt aus Schritt 2
//      laden (Pflicht — wenn fehlend, Fehler).
//   2. FRAGESTELLUNG-Konstrukt aus EXPOSITION-Pass laden (Pflicht — wenn
//      fehlend, Fehler; EXPOSITION-Pass muss zuerst gelaufen sein).
//   3. Diskursive Blöcke pro Container identifizieren (deterministisch):
//        - source='routing_diskussion': Verdachts-Blöcke aus BLOCK_ROUTING,
//          die das Routing als 'diskussion' klassifiziert hat (also keine
//          Wiedergabe — eigene argumentative Linie trotz Verdachts-Pattern).
//        - source='standard_stretch':   kontinuierliche Sequenzen von ¶, die
//          in KEINEM Verdachts-Block liegen (= Routing hat sie gar nicht
//          angesehen, weil unauffällig). Min-Länge tunable; Default 1
//          (jeder einzelne ¶ wird ein "Block").
//      Beide Sorten in einer Liste, nach paragraphIndexRange[0] sortiert.
//   4. Pro diskursivem Block ein LLM-Call DISKURSIV_BEZUG_PRÜFEN gegen die
//      FRAGESTELLUNG: explizit | implizit | bezugslos + Reviewer-Signal
//      green/yellow/red + 1–2-Satz-Rationale + optional ¶-Anker.
//
// Critical-Friend-Identität: Das Tool benennt den Bezugs-Modus deskriptiv
// (Indikator), es bewertet die Arbeit nicht. Sprache "der Block thematisiert
// X, das in der Fragestellung als zentraler Bezugspunkt benannt wurde" —
// NICHT "der Block ist gut/schlecht zur Frage bezogen". Reviewer-Signale
// rot/gelb/grün codieren Wertung (Problem/Ambivalenz/OK), nicht
// Klassifikator-Typ (vgl. feedback_color_only_for_reviewer_signals.md).
//
// Persistenz: function_constructs mit construct_kind='DISKURSIV_BEZUG_BEFUND'
// — pro Container ein Konstrukt mit Array über alle diskursiven Blöcke.
// Keine Idempotenz (analog Schritt 1+2+3-reproduktiv).

import { z } from 'zod';
import { queryOne } from '../../db/index.js';
import { chat, getModel, getProvider, type Provider } from '../client.js';
import { extractAndValidateJSON } from '../json-extract.js';
import {
	loadGrundlagentheorieContainers,
	type GrundlagentheorieContainer,
	type GrundlagentheorieParagraph,
} from './grundlagentheorie.js';

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

// ── FRAGESTELLUNG-Konstrukt einlesen (Cross-Typ-Bezug aus EXPOSITION) ──

interface FragestellungContent {
	text: string;
}

async function loadFragestellung(
	caseId: string,
	documentId: string
): Promise<string> {
	const row = await queryOne<{ content: FragestellungContent }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'EXPOSITION'
		   AND construct_kind = 'FRAGESTELLUNG'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) {
		throw new Error(
			`FRAGESTELLUNG fehlt — EXPOSITION-Pass mit FRAGESTELLUNG muss zuerst laufen ` +
				`(siehe runExpositionPass / scripts/test-h3-exposition.ts <caseId> --persist).`
		);
	}
	if (!row.content?.text || typeof row.content.text !== 'string') {
		throw new Error(
			`FRAGESTELLUNG-Konstrukt hat unerwartetes Schema: content.text fehlt oder ist kein String.`
		);
	}
	return row.content.text;
}

// ── Diskursive Block-Identifikation (deterministisch) ──────────────

export type DiscursiveBlockSource = 'routing_diskussion' | 'standard_stretch';

export interface DiscursiveBlock {
	source: DiscursiveBlockSource;
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	// Bei routing_diskussion übernommen aus dem Routing-Block
	routingType?: 'author_cluster' | 'citation_gap';
	dominantAuthor?: string;
	routingRationale?: string;
}

/**
 * Identifiziert die diskursiven Blöcke eines Containers:
 *
 *   (1) routing_diskussion: Verdachts-Blöcke aus BLOCK_ROUTING mit
 *       classification='diskussion' — wurden vom Routing geprüft und
 *       als eigene argumentative Linie befunden, trotz Verdachts-Pattern.
 *
 *   (2) standard_stretch: kontinuierliche ¶-Sequenzen, die in KEINEM
 *       Verdachts-Block des Routings liegen (weder wiedergabe- noch
 *       diskussion-klassifiziert) — vom Routing als unauffällig
 *       übergangen.
 *
 * Beide gehen in eine Liste, sortiert nach paragraphIndexRange[0].
 *
 * @param minStandardStretchLen Mindestlänge in ¶ für Standard-Strecken-
 *        Blöcke. Default 1 (jeder einzelne ¶ zwischen Verdachts-Blöcken
 *        wird ein eigener Block). Bei Bedarf hochsetzen, um Single-¶-
 *        Noise-Blöcke zu unterdrücken.
 */
export function identifyDiscursiveBlocks(
	container: GrundlagentheorieContainer,
	routing: BlockRoutingContentFromDb,
	minStandardStretchLen: number
): DiscursiveBlock[] {
	if (container.paragraphs.length === 0) return [];

	// ── (1) routing_diskussion ──────────────────────────────────────
	const routingDiscussionBlocks: DiscursiveBlock[] = routing.blocks
		.filter((b) => b.classification === 'diskussion')
		.map((b) => ({
			source: 'routing_diskussion' as const,
			paragraphIds: b.paragraphIds,
			paragraphIndexRange: b.paragraphIndexRange,
			routingType: b.type,
			dominantAuthor: b.dominantAuthor,
			routingRationale: b.rationale,
		}));

	// ── (2) standard_stretch ────────────────────────────────────────
	// Alle ¶-Indizes, die in IRGENDEINEM Routing-Block liegen (egal ob
	// wiedergabe oder diskussion), sind aus Standard-Strecken
	// ausgeschlossen.
	const usedIndices = new Set<number>();
	for (const b of routing.blocks) {
		for (let i = b.paragraphIndexRange[0]; i <= b.paragraphIndexRange[1]; i++) {
			usedIndices.add(i);
		}
	}

	const standardStretchBlocks: DiscursiveBlock[] = [];
	let runStart = -1;
	const flushRun = (endExclusive: number) => {
		if (runStart < 0) return;
		const len = endExclusive - runStart;
		if (len >= minStandardStretchLen) {
			const slice = container.paragraphs.slice(runStart, endExclusive);
			standardStretchBlocks.push({
				source: 'standard_stretch',
				paragraphIds: slice.map((p) => p.paragraphId),
				paragraphIndexRange: [
					slice[0].indexInContainer,
					slice[slice.length - 1].indexInContainer,
				],
			});
		}
	};

	for (let i = 0; i < container.paragraphs.length; i++) {
		if (usedIndices.has(i)) {
			flushRun(i);
			runStart = -1;
			continue;
		}
		if (runStart < 0) runStart = i;
	}
	flushRun(container.paragraphs.length);

	// ── Merge + Sort ────────────────────────────────────────────────
	return [...routingDiscussionBlocks, ...standardStretchBlocks].sort(
		(a, b) => a.paragraphIndexRange[0] - b.paragraphIndexRange[0]
	);
}

// ── DISKURSIV_BEZUG_PRÜFEN per Block-LLM ──────────────────────────

const DiskursivBezugSchema = z.object({
	bezug: z.enum(['explizit', 'implizit', 'bezugslos']),
	signal: z.enum(['green', 'yellow', 'red']),
	rationale: z.string().min(1),
	paragraphIds: z.array(z.string()).optional(),
});
type DiskursivBezugResult = z.infer<typeof DiskursivBezugSchema>;

interface DiskursivBezugInput {
	block: DiscursiveBlock;
	paragraphs: GrundlagentheorieParagraph[];
	containerLabel: string;
	fragestellung: string;
	documentId: string;
	modelOverride?: { provider: Provider; model: string };
	maxTokens: number;
}

async function diskursivBezugPruefen(input: DiskursivBezugInput): Promise<{
	result: DiskursivBezugResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	// Critical-Friend: das Tool benennt den Modus des Bezugs (explizit /
	// implizit / bezugslos) als Indikator. Es spricht KEIN Urteil über
	// die Arbeit. Reviewer-Signal aggregiert Modus zur Reviewer-Sicht
	// (rot/gelb/grün = Wertung Problem/Ambivalenz/OK).
	const system = [
		'Du bist ein analytisches Werkzeug, das einen zusammenhängenden Textblock aus einem Theoriekapitel auf seinen Bezug zur Forschungsfragestellung der Arbeit klassifiziert.',
		'',
		'Bezugs-Modi:',
		'  - "explizit"   = der Block nennt die Fragestellung beim Namen oder paraphrasiert sie deutlich; es wird sichtbar gemacht, dass das Material auf die Fragestellung bezogen wird.',
		'  - "implizit"   = Stichworte, Begriffe oder Konzepte aus der Fragestellung tauchen in der Argumentation des Blocks auf, ohne dass der Bezug zur Fragestellung explizit benannt wird.',
		'  - "bezugslos"  = der Block läuft ohne erkennbaren Bezug zur Fragestellung — fachlich kann das in Ordnung sein (z.B. allgemeine Theorie-Darstellung), die Fragestellung erscheint im Block aber weder explizit noch durch geteilte Begriffe/Konzepte.',
		'',
		'Reviewer-Signal (Wertung des Befundes für die Reviewerin):',
		'  - "green"  = klarer Bezug — explizit, oder implizit mit deutlich erkennbar geteilten Begriffen/Konzepten',
		'  - "yellow" = teilweise / lose Verbindung — Bezug ist erkennbar, aber unspezifisch oder nur an Randbegriffen',
		'  - "red"    = bezugslos — der Block trägt zur Fragestellung nichts erkennbar bei',
		'',
		'Sprache: DESKRIPTIV. Beschreibe, WAS du im Block beobachtest und WIE er sich zur Fragestellung verhält — z.B. "der Block thematisiert X, das in der Fragestellung als zentraler Bezugspunkt benannt wurde" oder "der Block entfaltet Y; die Fragestellung erscheint im Block weder explizit noch durch geteilte Konzepte". NICHT "der Block ist gut/schlecht zur Frage bezogen", NICHT "der Autor versäumt es", NICHT Werturteile über die Arbeit. Du benennst einen Indikator, du sprichst kein Urteil über das Werk.',
		'',
		'Pro Block: bezug-Modus, Reviewer-Signal, kurze deskriptive Rationale (1–2 Sätze, was hast du beobachtet), optional ¶-Anker (welche der vorgelegten ¶ machen den Bezug oder seine Abwesenheit besonders deutlich).',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "bezug":        "explizit" | "implizit" | "bezugslos",',
		'  "signal":       "green" | "yellow" | "red",',
		'  "rationale":    "<1–2 Sätze, deskriptiv>",',
		'  "paragraphIds": ["<id>", …]   // optional, exakt die im Block-Text angegebenen ¶-IDs',
		'}',
	].join('\n');

	const blockText = input.paragraphs
		.map((p) => `[¶-id=${p.paragraphId} | ¶${p.indexInContainer}] ${p.text}`)
		.join('\n\n');

	const metaLines: string[] = [];
	metaLines.push(`Container: ${input.containerLabel}`);
	metaLines.push(`Block-Quelle: ${input.block.source}`);
	metaLines.push(
		`¶-Bereich: ${input.block.paragraphIndexRange[0]}–${input.block.paragraphIndexRange[1]} (${input.paragraphs.length} ¶)`
	);
	if (input.block.routingType) {
		metaLines.push(`Routing-Typ (vom Schritt-2-Routing): ${input.block.routingType}`);
	}
	if (input.block.dominantAuthor) {
		metaLines.push(`Dominanter Autor (deterministisch erkannt): ${input.block.dominantAuthor}`);
	}

	const userMessage = [
		metaLines.join('\n'),
		'',
		'Forschungsfragestellung der Arbeit (rekonstruiert aus EXPOSITION):',
		input.fragestellung,
		'',
		'Block-Text (mit ¶-IDs):',
		blockText,
	].join('\n\n');

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

	const parsed = extractAndValidateJSON(response.text, DiskursivBezugSchema);
	if (!parsed.ok) {
		throw new Error(
			`DISKURSIV_BEZUG_PRÜFEN: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

interface DiskursivBezugBlockPersisted {
	blockIndex: number;
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	source: DiscursiveBlockSource;
	bezug: 'explizit' | 'implizit' | 'bezugslos';
	signal: 'green' | 'yellow' | 'red';
	rationale: string;
	anchorParagraphIds?: string[];
	llmModel: string;
	llmTimingMs: number;
}

interface DiskursivBezugBefundContent {
	fragestellungSnippet: string;
	blocks: DiskursivBezugBlockPersisted[];
	thresholds: {
		minStandardStretchLen: number;
	};
}

async function persistDiskursivBezugBefund(
	caseId: string,
	documentId: string,
	container: GrundlagentheorieContainer,
	content: DiskursivBezugBefundContent
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
			`DISKURSIV_BEZUG_BEFUND: Container "${container.headingText}" hat keine Paragraphen.`
		);
	}
	const row = await queryOne<{ id: string }>(
		`INSERT INTO function_constructs
		   (case_id, document_id, outline_function_type, construct_kind,
		    anchor_element_ids, content, version_stack)
		 VALUES ($1, $2, 'GRUNDLAGENTHEORIE', 'DISKURSIV_BEZUG_BEFUND', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			anchorIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) {
		throw new Error(`Failed to persist DISKURSIV_BEZUG_BEFUND for ${container.headingText}`);
	}
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

export interface DiscursivePassOptions {
	persistConstructs?: boolean;
	/**
	 * Mindestlänge (in ¶) für Standard-Strecken-Blöcke (Sequenzen außerhalb
	 * der Routing-Verdachts-Blöcke). Default 1 — jeder einzelne ¶ zwischen
	 * Verdachts-Blöcken wird ein eigener "Block". Hochsetzen, um Single-¶-
	 * Lücken zu überspringen. Setq: Default 1 ist offensiv (auch winzige
	 * Lücken bekommen einen LLM-Call). User-Konsens steht aus.
	 */
	minStandardStretchLen?: number;
	modelOverride?: { provider: Provider; model: string };
	/**
	 * maxTokens für den DISKURSIV_BEZUG_PRÜFEN-Call. Default 800 — eine
	 * Klassifikation + 1–2-Satz-Rationale + optionale ¶-Anker bleiben
	 * darunter. Setq: nicht empirisch validiert; falls Antworten regelmäßig
	 * abgeschnitten werden, hochziehen. User-Konsens steht aus.
	 */
	maxTokens?: number;
}

export interface ContainerDiscursiveResult {
	headingId: string;
	headingText: string;
	paragraphCount: number;
	discursiveBlockCount: number;
	blocks: Array<{
		blockIndex: number;
		source: DiscursiveBlockSource;
		paragraphIds: string[];
		paragraphIndexRange: [number, number];
		routingType?: 'author_cluster' | 'citation_gap';
		dominantAuthor?: string;
		bezug: 'explizit' | 'implizit' | 'bezugslos';
		signal: 'green' | 'yellow' | 'red';
		rationale: string;
		anchorParagraphIds?: string[];
		llmModel: string;
		llmTimingMs: number;
		tokens: { input: number; output: number };
	}>;
	diskursivBezugBefundConstructId: string | null;
}

export interface DiscursivePassResult {
	caseId: string;
	documentId: string;
	fragestellung: string;
	thresholds: { minStandardStretchLen: number };
	maxTokens: number;
	model: string;
	provider: string;
	totalLlmCalls: number;
	totalTimingMs: number;
	totalTokens: { input: number; output: number };
	containers: ContainerDiscursiveResult[];
}

// Setq-Defaults — siehe DiscursivePassOptions JSDoc oben.
const DEFAULT_MIN_STANDARD_STRETCH_LEN = 1;
const DEFAULT_MAX_TOKENS = 800;

// Default-Modell: Sonnet 4.6 via OpenRouter — analog Routing + Reproductive.
// DISKURSIV ist 1 Klassifikation + Rationale je Block, im selben
// Komplexitäts-Bereich. Tunable via options.modelOverride.
const DEFAULT_DISCURSIVE_MODEL: { provider: Provider; model: string } = {
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4.6',
};

export async function runDiskursivBezugPass(
	caseId: string,
	options: DiscursivePassOptions = {}
): Promise<DiscursivePassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const minStandardStretchLen =
		options.minStandardStretchLen ?? DEFAULT_MIN_STANDARD_STRETCH_LEN;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? DEFAULT_DISCURSIVE_MODEL;

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

	// FRAGESTELLUNG einmal laden — gilt für alle Container des Werks.
	const fragestellung = await loadFragestellung(caseId, documentId);
	const fragestellungSnippet = fragestellung.slice(0, 200);

	const out: ContainerDiscursiveResult[] = [];
	let totalLlmCalls = 0;
	let totalTimingMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastModel = '';
	let lastProvider = '';

	for (const container of containers) {
		// Routing-Konstrukt für diesen Container laden — Anchor-Match über
		// erstes ¶ (analog reproductive). Wenn keins existiert: harter
		// Fehler, Routing-Pass muss zuerst laufen.
		let routing: BlockRoutingContentFromDb | null = null;
		if (container.paragraphs.length > 0) {
			routing = await loadBlockRoutingByFirstParagraph(
				caseId,
				documentId,
				container.paragraphs[0].paragraphId
			);
		}
		if (!routing) {
			throw new Error(
				`Container "${container.headingText}" hat kein BLOCK_ROUTING-Konstrukt — ` +
					`Routing-Pass muss zuerst laufen ` +
					`(scripts/test-h3-routing.ts <caseId> --persist).`
			);
		}

		const discursiveBlocks = identifyDiscursiveBlocks(
			container,
			routing,
			minStandardStretchLen
		);

		const paragraphById = new Map(container.paragraphs.map((p) => [p.paragraphId, p]));
		const containerResultBlocks: ContainerDiscursiveResult['blocks'] = [];

		for (let i = 0; i < discursiveBlocks.length; i++) {
			const block = discursiveBlocks[i];
			const blockParagraphs = block.paragraphIds.map((id) => {
				const p = paragraphById.get(id);
				if (!p) {
					throw new Error(
						`Block-¶ ${id} aus diskursivem Block nicht in Container "${container.headingText}" gefunden.`
					);
				}
				return p;
			});

			const llm = await diskursivBezugPruefen({
				block,
				paragraphs: blockParagraphs,
				containerLabel: container.headingText,
				fragestellung,
				documentId,
				modelOverride,
				maxTokens,
			});
			totalLlmCalls += 1;
			totalTimingMs += llm.timingMs;
			totalInputTokens += llm.tokens.input;
			totalOutputTokens += llm.tokens.output;
			lastModel = llm.model;
			lastProvider = llm.provider;

			containerResultBlocks.push({
				blockIndex: i,
				source: block.source,
				paragraphIds: block.paragraphIds,
				paragraphIndexRange: block.paragraphIndexRange,
				routingType: block.routingType,
				dominantAuthor: block.dominantAuthor,
				bezug: llm.result.bezug,
				signal: llm.result.signal,
				rationale: llm.result.rationale,
				anchorParagraphIds: llm.result.paragraphIds,
				llmModel: llm.model,
				llmTimingMs: llm.timingMs,
				tokens: llm.tokens,
			});
		}

		let constructId: string | null = null;
		if (persistConstructs && containerResultBlocks.length > 0) {
			const persistedBlocks: DiskursivBezugBlockPersisted[] = containerResultBlocks.map(
				(b) => ({
					blockIndex: b.blockIndex,
					paragraphIds: b.paragraphIds,
					paragraphIndexRange: b.paragraphIndexRange,
					source: b.source,
					bezug: b.bezug,
					signal: b.signal,
					rationale: b.rationale,
					anchorParagraphIds: b.anchorParagraphIds,
					llmModel: b.llmModel,
					llmTimingMs: b.llmTimingMs,
				})
			);
			constructId = await persistDiskursivBezugBefund(caseId, documentId, container, {
				fragestellungSnippet,
				blocks: persistedBlocks,
				thresholds: { minStandardStretchLen },
			});
		}

		out.push({
			headingId: container.headingId,
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
			discursiveBlockCount: discursiveBlocks.length,
			blocks: containerResultBlocks,
			diskursivBezugBefundConstructId: constructId,
		});
	}

	return {
		caseId,
		documentId,
		fragestellung,
		thresholds: { minStandardStretchLen },
		maxTokens,
		model: lastModel || modelOverride?.model || getModel(),
		provider: lastProvider || modelOverride?.provider || getProvider(),
		totalLlmCalls,
		totalTimingMs,
		totalTokens: { input: totalInputTokens, output: totalOutputTokens },
		containers: out,
	};
}
