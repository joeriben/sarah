// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:GRUNDLAGENTHEORIE — Schritt 4: FORSCHUNGSGEGENSTAND_REKONSTRUIEREN.
//
// Spec: docs/h3_grundlagentheorie_status.md, Sektion "Schritt 4".
// Mother-Setzung: project_three_heuristics_architecture.md (Container-End-
// Aggregation). User-Setzung 2026-05-03: Werk-aggregiertes FORSCHUNGSGEGENSTAND-
// Konstrukt — H3:FORSCHUNGSDESIGN braucht den vollständigen Gegenstand, also
// muss er bevor FORSCHUNGSDESIGN startet aggregiert vorliegen.
//
// Mechanik:
//   1. Werk-Schritt: alle GRUNDLAGENTHEORIE-Container des Werks laden.
//   2. Pro Container die in Schritt 1–3 erzeugten Konstrukte einlesen
//      (VERWEIS_PROFIL Pflicht, BLOCK_ROUTING/BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/
//      DISKURSIV_BEZUG_BEFUND optional, je nach Lauf-Stand).
//   3. FRAGESTELLUNG aus EXPOSITION als Bezugsrahmen einlesen (Pflicht).
//   4. EIN LLM-Call pro Werk: kondensierte Werk-Übersicht + FRAGESTELLUNG,
//      Aufgabe ist die deskriptive Rekonstruktion des Forschungsgegenstands.
//      Der Forschungsgegenstand ist die Spezifizierung der FRAGESTELLUNG
//      durch die in den GTH-Containern erfolgte begriffliche Verortung.
//   5. Persistenz als FORSCHUNGSGEGENSTAND-Konstrukt mit anchor_element_ids =
//      alle ¶-IDs aller GTH-Container des Werks (Werk-Aggregat).
//
// Critical-Friend-Identität: das Tool BESCHREIBT den Forschungsgegenstand,
// es BEURTEILT die Theoriearbeit nicht. Es benennt, was die Theoriearbeit
// als Spezifizierung der FRAGESTELLUNG geleistet hat — nicht ob das gut
// oder schlecht ist.
//
// Persistenz: function_constructs mit construct_kind='FORSCHUNGSGEGENSTAND',
// outline_function_type='GRUNDLAGENTHEORIE'. Genau ein Konstrukt pro Werk
// (anchor_element_ids spannt alle GTH-Container). Keine Idempotenz (Re-Run
// dupliziert; FORSCHUNGSDESIGN-Pass liest jüngstes via ORDER BY created_at).

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { resolveTier } from '../model-tiers.js';
import { extractAndValidateJSON } from '../json-extract.js';
import { PreconditionFailedError } from './precondition.js';
import {
	loadGrundlagentheorieContainers,
	type GrundlagentheorieContainer,
} from './grundlagentheorie.js';
import { loadH3ComplexWalk } from '../../pipeline/h3-complex-walk.js';
import {
	loadH3CaseContext,
	formatWerktypLine,
	type H3BriefContext,
} from './werk-shared.js';

// ── Konstrukt-Loader (kondensiert) ─────────────────────────────────

interface VerweisProfileFromDb {
	citationCount: number;
	uniqueAuthorCount: number;
	byAuthor: Array<{ author: string; mentions: number; paragraphIds: string[] }>;
	density: {
		hhi: number;
		topAuthorShare: number;
		top3AuthorShare: number;
		maxConsecutiveParagraphsDominatedByAuthor: number;
		consecutiveDominanceAuthor?: string | null;
		paragraphsWithCitation: number;
		paragraphsWithoutCitation: number;
	};
}

async function loadVerweisProfileForContainer(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<VerweisProfileFromDb | null> {
	const row = await queryOne<{ content: VerweisProfileFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'VERWEIS_PROFIL'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, firstParagraphId]
	);
	return row?.content ?? null;
}

interface RoutedBlockFromDb {
	paragraphIds: string[];
	paragraphIndexRange: [number, number];
	type: 'author_cluster' | 'citation_gap';
	dominantAuthor?: string;
	classification: 'wiedergabe' | 'diskussion';
	rationale: string;
	confidence?: 'high' | 'medium' | 'low';
}

async function loadBlockRoutingForContainer(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<{ blocks: RoutedBlockFromDb[] } | null> {
	const row = await queryOne<{ content: { blocks: RoutedBlockFromDb[] } }>(
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

interface BlockWuerdigungFromDb {
	blocks: Array<{
		blockIndex: number;
		paragraphIndexRange: [number, number];
		summary: string;
	}>;
}

async function loadBlockWuerdigungForContainer(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<BlockWuerdigungFromDb | null> {
	const row = await queryOne<{ content: BlockWuerdigungFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'BLOCK_WUERDIGUNG'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, firstParagraphId]
	);
	return row?.content ?? null;
}

interface EckpunktBefundFromDb {
	blocks: Array<{
		blockIndex: number;
		paragraphIndexRange: [number, number];
		axes: {
			kernbegriff: { signal: string; rationale: string };
			kontamination: { signal: string; rationale: string };
			provenienz: { signal: string; rationale: string };
		};
	}>;
}

async function loadEckpunktBefundForContainer(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<EckpunktBefundFromDb | null> {
	const row = await queryOne<{ content: EckpunktBefundFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'ECKPUNKT_BEFUND'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, firstParagraphId]
	);
	return row?.content ?? null;
}

interface DiskursivBefundFromDb {
	blocks: Array<{
		source: 'routing_diskussion' | 'standard_stretch';
		paragraphIndexRange: [number, number];
		bezug: 'explizit' | 'implizit' | 'bezugslos';
		signal: string;
		rationale: string;
	}>;
}

async function loadDiskursivBefundForContainer(
	caseId: string,
	documentId: string,
	firstParagraphId: string
): Promise<DiskursivBefundFromDb | null> {
	const row = await queryOne<{ content: DiskursivBefundFromDb }>(
		`SELECT content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'DISKURSIV_BEZUG_BEFUND'
		   AND $3 = ANY(anchor_element_ids)
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId, firstParagraphId]
	);
	return row?.content ?? null;
}

async function loadFragestellung(caseId: string, documentId: string): Promise<string> {
	const row = await queryOne<{ content: { text?: string } }>(
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
	if (!row || !row.content?.text) {
		throw new PreconditionFailedError({
			heuristic: 'GRUNDLAGENTHEORIE',
			missing: 'FRAGESTELLUNG',
			diagnostic: `FRAGESTELLUNG fehlt — EXPOSITION-Pass muss zuerst laufen.`,
		});
	}
	return row.content.text;
}

// ── EXPOSITION-Fallback (Werke ohne dediziertes GTH-Kapitel) ──────
//
// Peer-Review-Artikel und kompakte Werke haben oft KEIN eigenes
// GRUNDLAGENTHEORIE-Kapitel — die theoretische Verortung ist in die
// EXPOSITION/Einleitung eingewoben. In diesem Fall darf FG nicht hart
// abbrechen; wir rekonstruieren ihn direkt aus den EXPOSITION-Absätzen.

interface ExpositionAggregate {
	paragraphIds: string[];
	headingTexts: string[];
	combinedText: string;
}

async function loadExpositionAggregate(
	documentId: string
): Promise<ExpositionAggregate> {
	const walk = await loadH3ComplexWalk(documentId);
	const expositionComplexes = walk.filter((c) => c.functionType === 'EXPOSITION');
	if (expositionComplexes.length === 0) {
		return { paragraphIds: [], headingTexts: [], combinedText: '' };
	}

	const allParagraphIds = expositionComplexes.flatMap((c) => c.paragraphIds);
	if (allParagraphIds.length === 0) {
		return {
			paragraphIds: [],
			headingTexts: expositionComplexes.map((c) => c.headingText),
			combinedText: '',
		};
	}

	const rows = (
		await query<{ id: string; text: string }>(
			`SELECT p.id,
			        SUBSTRING(dc.full_text FROM p.char_start + 1
			                              FOR p.char_end - p.char_start) AS text
			 FROM document_elements p
			 JOIN document_content dc ON dc.naming_id = p.document_id
			 WHERE p.id = ANY($1::uuid[])
			   AND p.document_id = $2
			 ORDER BY p.char_start`,
			[allParagraphIds, documentId]
		)
	).rows;

	const textByPid = new Map(rows.map((r) => [r.id, r.text.trim()]));
	const sections: string[] = [];
	const orderedPids: string[] = [];
	for (const c of expositionComplexes) {
		const lines: string[] = [];
		lines.push(`### ${c.headingText.trim() || '(EXPOSITION)'}`);
		for (const pid of c.paragraphIds) {
			const t = textByPid.get(pid);
			if (!t) continue;
			lines.push(t);
			orderedPids.push(pid);
		}
		sections.push(lines.join('\n'));
	}

	return {
		paragraphIds: orderedPids,
		headingTexts: expositionComplexes.map((c) => c.headingText),
		combinedText: sections.join('\n\n'),
	};
}

async function rekonstruiereForschungsgegenstandFromExposition(input: {
	fragestellung: string;
	exposition: ExpositionAggregate;
	brief: H3BriefContext;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}): Promise<{
	result: ForschungsgegenstandResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das den FORSCHUNGSGEGENSTAND einer wissenschaftlichen Arbeit aus ihrer EXPOSITION rekonstruiert.',
		'',
		formatWerktypLine(input.brief),
		'',
		'Diese Arbeit hat KEIN eigenständiges GRUNDLAGENTHEORIE-Kapitel — die theoretische Verortung ist in die EXPOSITION (Einleitung) eingewoben. Das ist typisch für Peer-Review-Artikel, kürzere Beiträge und kompakte Werke, in denen Theoriearbeit und Problemexposition zusammenfallen.',
		'',
		'Begriffe (für das Verständnis der Aufgabe):',
		'',
		'  FRAGESTELLUNG: die in der Einleitung formulierte Forschungsfrage. Sie hat zunächst Charakterisierungs-Status (cue → characterization).',
		'',
		'  FORSCHUNGSGEGENSTAND: die Spezifizierung der FRAGESTELLUNG durch die in der EXPOSITION erfolgte begriffliche Verortung — welche Begriffe werden eingeführt, in welcher Lesart, in welchen disziplinären Linien, in Abgrenzung wozu. Im Werk wird der Forschungsgegenstand oft nicht explizit als solcher benannt, sondern bleibt als Konstrukt implizit.',
		'',
		'Aufgabe: Schreibe eine deskriptive Rekonstruktion des FORSCHUNGSGEGENSTANDS in 3–5 Sätzen. Lies die EXPOSITION als Spezifizierung der FRAGESTELLUNG: welche begrifflichen Anker, welche Bezugsfelder, welche Begriffsverwendungen werden eingeführt? Benenne den Gegenstand so, wie er sich durch diese Verortung ergibt — wenn er im Werk explizit benannt wird, paraphrasiere; wenn er implizit bleibt, rekonstruiere ihn aus den begrifflichen Anschlüssen.',
		'',
		'Stil: DESKRIPTIV. Du beschreibst den Gegenstand, du beurteilst die Theoriearbeit nicht (kein "gut", "tiefgehend", "verkürzt"). Eigene Worte; keine wörtlichen Zitate; keine Kennzeichnung als "der Autor sagt" — sprich vom rekonstruierten Gegenstand selbst.',
		'',
		'Plus: nenne 3–7 KERNBEGRIFFE, die den Forschungsgegenstand konstituieren (Begriffsworte aus der EXPOSITION, ohne Erklärung).',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "text": "<3–5 Sätze, deskriptiv>",',
		'  "subjectKeywords": ["<begriff>", "<begriff>", …]',
		'}',
	].join('\n');

	const userMessage = [
		`FRAGESTELLUNG (aus EXPOSITION):`,
		input.fragestellung,
		'',
		`EXPOSITION (theoretische Verortung eingewoben, kein dediziertes GTH-Kapitel):`,
		'',
		input.exposition.combinedText,
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

	const parsed = extractAndValidateJSON(response.text, ForschungsgegenstandSchema);
	if (!parsed.ok) {
		throw new Error(
			`FORSCHUNGSGEGENSTAND (EXPOSITION-Fallback): Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

// ── Werk-Übersicht für den LLM-Prompt aufbauen ─────────────────────

interface ContainerOverview {
	headingText: string;
	paragraphCount: number;
	verweis: {
		citationCount: number;
		uniqueAuthorCount: number;
		hhi: number;
		topAuthorShare: number;
		top5Authors: Array<{ author: string; mentions: number }>;
		paragraphsWithoutCitation: number;
	};
	reproductiveBlocks: Array<{
		paragraphIndexRange: [number, number];
		dominantAuthor?: string;
		summary: string;
		eckpunkt: {
			kernbegriff: { signal: string; rationale: string };
			kontamination: { signal: string; rationale: string };
			provenienz: { signal: string; rationale: string };
		} | null;
	}>;
	discursiveBlocks: Array<{
		source: 'routing_diskussion' | 'standard_stretch';
		paragraphIndexRange: [number, number];
		bezug: 'explizit' | 'implizit' | 'bezugslos';
		signal: string;
		rationale: string;
	}>;
}

function buildOverviewPromptSection(overviews: ContainerOverview[]): string {
	const sections: string[] = [];
	for (let i = 0; i < overviews.length; i++) {
		const o = overviews[i];
		const lines: string[] = [];
		lines.push(`### Container ${i + 1}: ${o.headingText}`);
		lines.push(`¶-Anzahl: ${o.paragraphCount}`);
		lines.push(
			`Verweisprofil: ${o.verweis.citationCount} Citations, ${o.verweis.uniqueAuthorCount} unique Autoren, ` +
				`HHI=${o.verweis.hhi.toFixed(3)}, Top-1-Share=${o.verweis.topAuthorShare.toFixed(2)}, ` +
				`${o.verweis.paragraphsWithoutCitation} ¶ ohne Citation`
		);
		if (o.verweis.top5Authors.length > 0) {
			lines.push(
				`Top-Autoren: ${o.verweis.top5Authors
					.map((a) => `${a.author} (×${a.mentions})`)
					.join(', ')}`
			);
		}
		if (o.reproductiveBlocks.length > 0) {
			lines.push('');
			lines.push('Reproduktive Blöcke (Wiedergabe-Modus):');
			for (const b of o.reproductiveBlocks) {
				const range = `¶${b.paragraphIndexRange[0]}–${b.paragraphIndexRange[1]}`;
				const author = b.dominantAuthor ? ` (Autor: ${b.dominantAuthor})` : '';
				lines.push(`  - ${range}${author}: ${b.summary}`);
				if (b.eckpunkt) {
					const sigs = [
						`kernbegriff=${b.eckpunkt.kernbegriff.signal}`,
						`kontamination=${b.eckpunkt.kontamination.signal}`,
						`provenienz=${b.eckpunkt.provenienz.signal}`,
					].join(', ');
					lines.push(`    Eckpunkt-Befunde: ${sigs}`);
				}
			}
		}
		if (o.discursiveBlocks.length > 0) {
			lines.push('');
			lines.push('Diskursive Blöcke (Bezug zur FRAGESTELLUNG):');
			for (const b of o.discursiveBlocks) {
				const range = `¶${b.paragraphIndexRange[0]}–${b.paragraphIndexRange[1]}`;
				lines.push(
					`  - ${range} [${b.source}, bezug=${b.bezug}, signal=${b.signal}]: ${b.rationale}`
				);
			}
		}
		sections.push(lines.join('\n'));
	}
	return sections.join('\n\n');
}

// ── LLM-Call: Forschungsgegenstand rekonstruieren ─────────────────

const ForschungsgegenstandSchema = z.object({
	text: z.string().min(1),
	subjectKeywords: z.array(z.string().min(1)).min(1),
	salientContainerIndices: z.array(z.number().int()).optional(),
});
type ForschungsgegenstandResult = z.infer<typeof ForschungsgegenstandSchema>;

interface ForschungsgegenstandLlmInput {
	fragestellung: string;
	overviews: ContainerOverview[];
	brief: H3BriefContext;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function rekonstruiereForschungsgegenstand(input: ForschungsgegenstandLlmInput): Promise<{
	result: ForschungsgegenstandResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const system = [
		'Du bist ein analytisches Werkzeug, das den FORSCHUNGSGEGENSTAND einer wissenschaftlichen Arbeit aus ihrer Theoriearbeit (GRUNDLAGENTHEORIE) rekonstruiert.',
		'',
		formatWerktypLine(input.brief),
		'',
		'Begriffe (für das Verständnis der Aufgabe):',
		'',
		'  FRAGESTELLUNG: die in der Einleitung formulierte Forschungsfrage. Sie hat zunächst Charakterisierungs-Status (cue → characterization).',
		'',
		'  FORSCHUNGSGEGENSTAND: die Spezifizierung der FRAGESTELLUNG durch die in der Theoriearbeit erfolgte begriffliche Verortung. Erst durch die Theoriearbeit gewinnt die Fragestellung ihre konkreten Konturen — wessen Begriffe, in welcher Lesart, mit welchen Linien, in Abgrenzung wozu — und wird so zum greifbaren Forschungsgegenstand. Im Werk wird er oft NICHT explizit als solcher benannt, sondern bleibt als Konstrukt implizit.',
		'',
		'Aufgabe: Schreibe eine deskriptive Rekonstruktion des FORSCHUNGSGEGENSTANDS in 3–5 Sätzen. Greife dabei auf die in den GRUNDLAGENTHEORIE-Containern entfalteten Begriffe und diskursiven Linien zurück, lies sie als Spezifizierung der FRAGESTELLUNG. Benenne den Gegenstand so, wie er sich durch die Theoriearbeit ergibt — wenn er im Werk explizit benannt wird, paraphrasiere; wenn er implizit bleibt, rekonstruiere ihn aus den begrifflichen Anschlüssen.',
		'',
		'Stil: DESKRIPTIV. Du beschreibst den Gegenstand, du beurteilst die Theoriearbeit nicht (kein "gut", "tiefgehend", "verkürzt"). Eigene Worte; keine wörtlichen Zitate; keine Kennzeichnung als "der Autor sagt" — sprich vom rekonstruierten Gegenstand selbst.',
		'',
		'Plus: nenne 3–7 KERNBEGRIFFE, die den Forschungsgegenstand konstituieren (Begriffsworte aus den Containern, ohne Erklärung).',
		'',
		'Plus optional: salientContainerIndices = die Indizes der Container (1-basiert), die den Gegenstand am stärksten tragen. Lass leer, wenn alle gleichgewichtig.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "text": "<3–5 Sätze, deskriptiv>",',
		'  "subjectKeywords": ["<begriff>", "<begriff>", …],',
		'  "salientContainerIndices": [1, 2, …]',
		'}',
	].join('\n');

	const overviewBlock = buildOverviewPromptSection(input.overviews);

	const userMessage = [
		`FRAGESTELLUNG (aus EXPOSITION):`,
		input.fragestellung,
		'',
		`GRUNDLAGENTHEORIE-Übersicht (${input.overviews.length} Container):`,
		'',
		overviewBlock,
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

	const parsed = extractAndValidateJSON(response.text, ForschungsgegenstandSchema);
	if (!parsed.ok) {
		throw new Error(
			`FORSCHUNGSGEGENSTAND: Antwort nicht parsbar (stage=${parsed.stage}): ${parsed.error}\n` +
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

interface ForschungsgegenstandContent {
	text: string;
	subjectKeywords: string[];
	salientContainerIndices: number[];
	containerOverview: Array<{
		headingText: string;
		paragraphCount: number;
		topAuthors: string[];
	}>;
	llmModel: string;
	llmTimingMs: number;
}

async function persistForschungsgegenstand(
	caseId: string,
	documentId: string,
	allParagraphIds: string[],
	content: ForschungsgegenstandContent
): Promise<string> {
	if (allParagraphIds.length === 0) {
		throw new Error('FORSCHUNGSGEGENSTAND: keine Container-¶ als Anker.');
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
		 VALUES ($1, $2, 'GRUNDLAGENTHEORIE', 'FORSCHUNGSGEGENSTAND', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			allParagraphIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist FORSCHUNGSGEGENSTAND');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 1500;

export interface ForschungsgegenstandPassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface ForschungsgegenstandPassResult {
	caseId: string;
	documentId: string;
	containers: Array<{
		headingText: string;
		paragraphCount: number;
		hasVerweisProfil: boolean;
		hasReproductive: boolean;
		hasDiscursive: boolean;
	}>;
	fragestellungSnippet: string;
	forschungsgegenstand: {
		text: string;
		subjectKeywords: string[];
		salientContainerIndices: number[];
	} | null;
	constructId: string | null;
	llmCalls: number;
	llmTimingMs: number;
	tokens: { input: number; output: number };
	provider: string;
	model: string;
}

export async function runForschungsgegenstandPass(
	caseId: string,
	options: ForschungsgegenstandPassOptions = {}
): Promise<ForschungsgegenstandPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? resolveTier('h3.tier1');

	const { centralDocumentId: documentId, brief } = await loadH3CaseContext(caseId);

	const containers = await loadGrundlagentheorieContainers(documentId);
	const fragestellung = await loadFragestellung(caseId, documentId);
	const fragestellungSnippet = fragestellung.slice(0, 200);

	// Fallback für Werke ohne dediziertes GRUNDLAGENTHEORIE-Kapitel
	// (typisch Peer-Review-Artikel, kompakte Werke): theoretische Verortung
	// ist in die EXPOSITION eingewoben. Ein einziger LLM-Call rekonstruiert
	// den FORSCHUNGSGEGENSTAND aus EXPOSITION-Absätzen + FRAGESTELLUNG, ohne
	// die per-GTH-Komplex-Kette (Verweisprofil/Routing/Reproductive/Discursive),
	// die für eingewobene Theorie kein Material hätte. Anker des persistierten
	// FG-Konstrukts sind die EXPOSITION-Absätze, damit der downstream-Walk
	// (FORSCHUNGSDESIGN/SYNTHESE/SCHLUSSREFLEXION/WERK_*) das Konstrukt
	// regulär über construct_kind='FORSCHUNGSGEGENSTAND' findet.
	if (containers.length === 0) {
		const exposition = await loadExpositionAggregate(documentId);
		if (exposition.paragraphIds.length === 0) {
			throw new PreconditionFailedError({
				heuristic: 'GRUNDLAGENTHEORIE',
				missing: 'GRUNDLAGENTHEORIE-Container oder EXPOSITION-Material',
				diagnostic:
					`Werk ${documentId} hat weder GRUNDLAGENTHEORIE-Container noch ` +
					`EXPOSITION-Absätze — kein FORSCHUNGSGEGENSTAND rekonstruierbar.`,
			});
		}

		const llm = await rekonstruiereForschungsgegenstandFromExposition({
			fragestellung,
			exposition,
			brief,
			documentId,
			maxTokens,
			modelOverride,
		});

		let constructId: string | null = null;
		if (persistConstructs) {
			const content: ForschungsgegenstandContent = {
				text: llm.result.text,
				subjectKeywords: llm.result.subjectKeywords,
				salientContainerIndices: [],
				containerOverview: exposition.headingTexts.map((headingText) => ({
					headingText,
					paragraphCount: exposition.paragraphIds.length,
					topAuthors: [],
				})),
				llmModel: llm.model,
				llmTimingMs: llm.timingMs,
			};
			constructId = await persistForschungsgegenstand(
				caseId,
				documentId,
				exposition.paragraphIds,
				content
			);
		}

		return {
			caseId,
			documentId,
			containers: exposition.headingTexts.map((headingText) => ({
				headingText,
				paragraphCount: exposition.paragraphIds.length,
				hasVerweisProfil: false,
				hasReproductive: false,
				hasDiscursive: false,
			})),
			fragestellungSnippet,
			forschungsgegenstand: {
				text: llm.result.text,
				subjectKeywords: llm.result.subjectKeywords,
				salientContainerIndices: [],
			},
			constructId,
			llmCalls: 1,
			llmTimingMs: llm.timingMs,
			tokens: llm.tokens,
			provider: llm.provider,
			model: llm.model,
		};
	}

	// Pro Container alle Konstrukte einlesen und kondensieren.
	const overviews: ContainerOverview[] = [];
	const containersInfo: ForschungsgegenstandPassResult['containers'] = [];
	const allParagraphIds: string[] = [];

	for (const container of containers) {
		if (container.paragraphs.length === 0) continue;
		const firstPid = container.paragraphs[0].paragraphId;

		const verweis = await loadVerweisProfileForContainer(caseId, documentId, firstPid);
		if (!verweis) {
			throw new Error(
				`Container "${container.headingText}" hat kein VERWEIS_PROFIL — ` +
					`erst Schritt 1 laufen (scripts/test-h3-grundlagentheorie.ts <caseId>).`
			);
		}

		const routing = await loadBlockRoutingForContainer(caseId, documentId, firstPid);
		const wuerdigung = await loadBlockWuerdigungForContainer(caseId, documentId, firstPid);
		const eckpunkt = await loadEckpunktBefundForContainer(caseId, documentId, firstPid);
		const diskursiv = await loadDiskursivBefundForContainer(caseId, documentId, firstPid);

		// Reproduktive Blöcke aus Routing + Wuerdigung + Eckpunkt zusammenfügen.
		const reproductiveBlocks: ContainerOverview['reproductiveBlocks'] = [];
		if (routing) {
			const wiedergabeBlocks = routing.blocks.filter((b) => b.classification === 'wiedergabe');
			for (let i = 0; i < wiedergabeBlocks.length; i++) {
				const b = wiedergabeBlocks[i];
				const wuerdigungBlock = wuerdigung?.blocks.find(
					(wb) =>
						wb.paragraphIndexRange[0] === b.paragraphIndexRange[0] &&
						wb.paragraphIndexRange[1] === b.paragraphIndexRange[1]
				);
				const eckpunktBlock = eckpunkt?.blocks.find(
					(eb) =>
						eb.paragraphIndexRange[0] === b.paragraphIndexRange[0] &&
						eb.paragraphIndexRange[1] === b.paragraphIndexRange[1]
				);
				reproductiveBlocks.push({
					paragraphIndexRange: b.paragraphIndexRange,
					dominantAuthor: b.dominantAuthor,
					summary: wuerdigungBlock?.summary ?? '(keine BLOCK_WUERDIGUNG persistiert)',
					eckpunkt: eckpunktBlock?.axes ?? null,
				});
			}
		}

		const discursiveBlocks: ContainerOverview['discursiveBlocks'] = [];
		if (diskursiv) {
			for (const b of diskursiv.blocks) {
				discursiveBlocks.push({
					source: b.source,
					paragraphIndexRange: b.paragraphIndexRange,
					bezug: b.bezug,
					signal: b.signal,
					rationale: b.rationale,
				});
			}
		}

		overviews.push({
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
			verweis: {
				citationCount: verweis.citationCount,
				uniqueAuthorCount: verweis.uniqueAuthorCount,
				hhi: verweis.density.hhi,
				topAuthorShare: verweis.density.topAuthorShare,
				top5Authors: verweis.byAuthor
					.slice(0, 5)
					.map((a) => ({ author: a.author, mentions: a.mentions })),
				paragraphsWithoutCitation: verweis.density.paragraphsWithoutCitation,
			},
			reproductiveBlocks,
			discursiveBlocks,
		});

		containersInfo.push({
			headingText: container.headingText,
			paragraphCount: container.paragraphs.length,
			hasVerweisProfil: true,
			hasReproductive: reproductiveBlocks.length > 0,
			hasDiscursive: discursiveBlocks.length > 0,
		});

		for (const p of container.paragraphs) {
			allParagraphIds.push(p.paragraphId);
		}
	}

	if (overviews.length === 0) {
		throw new PreconditionFailedError({
			heuristic: 'GRUNDLAGENTHEORIE',
			missing: 'GRUNDLAGENTHEORIE-Container mit ¶',
			diagnostic: `Werk ${documentId} hat keine GTH-Container mit ¶ — kein FORSCHUNGSGEGENSTAND möglich.`,
		});
	}

	// 1 LLM-Call pro Werk.
	const llm = await rekonstruiereForschungsgegenstand({
		fragestellung,
		overviews,
		brief,
		documentId,
		maxTokens,
		modelOverride,
	});

	let constructId: string | null = null;
	if (persistConstructs) {
		const content: ForschungsgegenstandContent = {
			text: llm.result.text,
			subjectKeywords: llm.result.subjectKeywords,
			salientContainerIndices: llm.result.salientContainerIndices ?? [],
			containerOverview: overviews.map((o) => ({
				headingText: o.headingText,
				paragraphCount: o.paragraphCount,
				topAuthors: o.verweis.top5Authors.slice(0, 3).map((a) => a.author),
			})),
			llmModel: llm.model,
			llmTimingMs: llm.timingMs,
		};
		constructId = await persistForschungsgegenstand(
			caseId,
			documentId,
			allParagraphIds,
			content
		);
	}

	return {
		caseId,
		documentId,
		containers: containersInfo,
		fragestellungSnippet,
		forschungsgegenstand: {
			text: llm.result.text,
			subjectKeywords: llm.result.subjectKeywords,
			salientContainerIndices: llm.result.salientContainerIndices ?? [],
		},
		constructId,
		llmCalls: 1,
		llmTimingMs: llm.timingMs,
		tokens: llm.tokens,
		provider: llm.provider,
		model: llm.model,
	};
}
