// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3:WERK_DESKRIPTION — Werk-aggregierte, deskriptive Inhaltszusammenfassung.
//
// Mother-Setzung (project_three_heuristics_architecture.md):
//   "Werk-Ebene, immer aktiv nach allen Kapitel-Heuristiken — Konstrukt:
//    WERK_BESCHREIBUNG (neutrale, zusammenhängende Inhaltszusammenfassung).
//    Aggregation aus persistierten Konstrukten + Outline. Kein neuer Wert,
//    keine Bewertung."
//
// Critical-Friend-Identität (project_critical_friend_identity.md):
//   Diese Heuristik ist DESKRIPTIV. Sie beschreibt, was das Werk tut —
//   sie beurteilt es nicht. Sprache: "die Arbeit untersucht …", "das
//   Kapitel referiert …", niemals "stark", "lückenhaft", "schwach".
//
// User-Setzung 2026-05-04 (Inputs Option B):
//   - Input: alle function_constructs des Werks aller H3-Phasen
//   - Optional integriert: memo_content (scope_level=chapter|subchapter)
//     wenn ein H1- oder H2-Run zuvor existiert.
//
// Persistenz: function_constructs mit
//   outline_function_type='WERK_DESKRIPTION', construct_kind='WERK_BESCHREIBUNG'.
//   anchor_element_ids = nicht-excluded Top-Level-Heading-IDs.
//
// Migration 050 erweitert die outline_function_type-CHECK-Liste um
// WERK_DESKRIPTION + WERK_GUTACHT.

import { z } from 'zod';
import { query, queryOne } from '../../db/index.js';
import { chat, type Provider } from '../client.js';
import { resolveTier } from '../model-tiers.js';
import { extractAndValidateJSON, type ExtractResult } from '../json-extract.js';
import { loadEffectiveOutline } from '../../documents/outline.js';
import { PreconditionFailedError } from './precondition.js';
import {
	loadAllConstructs,
	loadCollapseMemos,
	buildOutlineSummary,
	buildConstructsBlock,
	buildMemosBlock,
	loadH3CaseContext,
	formatWerktypLine,
	formatKriterienBlock,
	type H3BriefContext,
} from './werk-shared.js';

// ── LLM-Call ──────────────────────────────────────────────────────

const WerkBeschreibungLLMSchema = z.object({
	werkBeschreibungText: z.string().min(1),
});
type WerkBeschreibungLLMResult = z.infer<typeof WerkBeschreibungLLMSchema>;

interface ExtractWerkBeschreibungInput {
	outlineSummary: string;
	constructsBlock: string;
	memosBlock: string | null;
	headingCount: number;
	brief: H3BriefContext;
	documentId: string;
	maxTokens: number;
	modelOverride?: { provider: Provider; model: string };
}

async function extractWerkBeschreibung(input: ExtractWerkBeschreibungInput): Promise<{
	result: WerkBeschreibungLLMResult;
	model: string;
	provider: string;
	timingMs: number;
	tokens: { input: number; output: number };
}> {
	const kriterien = formatKriterienBlock(input.brief);
	const system = [
		'Du bist ein analytisches Werkzeug, das aus den persistierten Funktionstyp-Konstrukten eines Werks (FRAGESTELLUNG, FORSCHUNGSGEGENSTAND, METHODEN, BEFUNDEN, GESAMTERGEBNIS, GELTUNGSANSPRUCH usw.) eine zusammenhängende Werk-Beschreibung erzeugst — gemeinsam mit der Outline-Struktur und ggf. hermeneutischen Memo-Synthesen aus einem H1-/H2-Vorlauf.',
		'',
		formatWerktypLine(input.brief),
		...(kriterien ? ['', kriterien] : []),
		'',
		'Aufgabe:',
		'  Eine kohärente, deskriptive Inhaltszusammenfassung des Werks. 8–18 Sätze. Folge dem strukturellen Aufbau (was der erste Teil leistet, was der zweite leistet, …), benenne den Forschungsgegenstand, die Methodik, die zentralen Befunde, das Gesamtergebnis und die Reflexion. Keine Wertung.',
		'',
		'Stilregeln (PFLICHT):',
		'  - DESKRIPTIV: "die Arbeit untersucht …", "das Kapitel rekonstruiert …", "der Befund lautet …".',
		'  - KEINE Wertung: niemals "stark", "lückenhaft", "überzeugend", "dünn", "schwach", "präzise", "unklar". Auch nicht implizit ("die Arbeit zeigt eindrucksvoll …").',
		'  - KEIN Urteil über Reichweite, Methodenwahl, Thesen-Stärke. Du beschreibst, was DA ist; du sagst nicht, was es WERT ist.',
		'  - Wenn ein Funktionstyp im Werk fehlt (z.B. keine SCHLUSSREFLEXION-Container), benenne das deskriptiv ("das Werk enthält keine eigenständige Reflexion über Reichweite und Grenzen"), nicht als Mangel.',
		'',
		'Antworte ausschließlich als JSON nach diesem Schema:',
		'{',
		'  "werkBeschreibungText": "<8–18 Sätze deskriptive Werk-Beschreibung>"',
		'}',
	].join('\n');

	const userBlocks: string[] = [
		`Outline-Struktur (${input.headingCount} Überschriften, mit Funktionstyp-Markern wenn vergeben):`,
		input.outlineSummary,
		'',
		`Persistierte Funktionstyp-Konstrukte:`,
		input.constructsBlock || '(keine Konstrukte vorhanden)',
	];

	if (input.memosBlock) {
		userBlocks.push('');
		userBlocks.push(
			'Hermeneutische Memo-Synthesen (aus früherem H1- oder H2-Run, optional, zur Vertiefung):'
		);
		userBlocks.push(input.memosBlock);
	}

	const userMessage = userBlocks.join('\n');

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

	const parsed: ExtractResult<WerkBeschreibungLLMResult> = extractAndValidateJSON(
		response.text,
		WerkBeschreibungLLMSchema
	);
	if (!parsed.ok) {
		const stage = 'stage' in parsed ? parsed.stage : 'unknown';
		const error = 'error' in parsed ? parsed.error : 'unknown';
		throw new Error(
			`WERK_BESCHREIBUNG: Antwort nicht parsbar (stage=${stage}): ${error}\n` +
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

interface WerkBeschreibungContent {
	werkBeschreibungText: string;
	constructCountsByType: Record<string, number>;
	hadMemos: boolean;
	memoCount: number;
	headingCount: number;
	llmModel: string;
	llmTimingMs: number;
}

async function clearExistingWerkDeskription(
	caseId: string,
	documentId: string
): Promise<number> {
	const result = await query(
		`DELETE FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		   AND outline_function_type = 'WERK_DESKRIPTION'
		   AND construct_kind = 'WERK_BESCHREIBUNG'`,
		[caseId, documentId]
	);
	return result.rowCount ?? 0;
}

async function persistWerkBeschreibung(
	caseId: string,
	documentId: string,
	anchorIds: string[],
	content: WerkBeschreibungContent
): Promise<string> {
	if (anchorIds.length === 0) {
		throw new Error('WERK_DESKRIPTION: keine Top-Level-Heading-IDs als Anker.');
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
		 VALUES ($1, $2, 'WERK_DESKRIPTION', 'WERK_BESCHREIBUNG', $3, $4, $5)
		 RETURNING id`,
		[
			caseId,
			documentId,
			anchorIds,
			JSON.stringify(content),
			JSON.stringify([stackEntry]),
		]
	);
	if (!row) throw new Error('Failed to persist WERK_BESCHREIBUNG');
	return row.id;
}

// ── Public API ────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 2500;

export interface WerkDeskriptionPassOptions {
	persistConstructs?: boolean;
	maxTokens?: number;
	modelOverride?: { provider: Provider; model: string };
}

export interface WerkDeskriptionPassResult {
	caseId: string;
	documentId: string;
	werkBeschreibungText: string | null;
	constructId: string | null;
	deletedPriorCount: number;
	constructCountsByType: Record<string, number>;
	hadMemos: boolean;
	memoCount: number;
	headingCount: number;
	llmCalls: number;
	llmTimingMs: number;
	tokens: { input: number; output: number };
	provider: string;
	model: string;
	diagnostics: { warnings: string[] };
}

export async function runWerkDeskriptionPass(
	caseId: string,
	options: WerkDeskriptionPassOptions = {}
): Promise<WerkDeskriptionPassResult> {
	const persistConstructs = options.persistConstructs !== false;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	const modelOverride = options.modelOverride ?? resolveTier('h3.tier3');
	const warnings: string[] = [];

	const { centralDocumentId: documentId, brief } = await loadH3CaseContext(caseId);

	const outline = await loadEffectiveOutline(documentId);
	if (!outline) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_DESKRIPTION',
			missing: 'Outline',
			diagnostic:
				'Werk hat keine ladbare Outline (loadEffectiveOutline lieferte null). Outline überprüfen oder Dokument re-parsen.',
		});
	}
	const { anchorIds, outlineSummary, headingCount } = buildOutlineSummary(
		outline.headings
	);
	if (anchorIds.length === 0) {
		throw new PreconditionFailedError({
			heuristic: 'WERK_DESKRIPTION',
			missing: 'Top-Level-Heading',
			diagnostic:
				'Werk hat keine nicht-excluded Top-Level-Überschriften (effectiveLevel=1). WERK_BESCHREIBUNG kann ohne Werk-Strukturpunkte nicht persistiert werden (anchor_element_ids verlangt mind. 1 Element).',
		});
	}

	const constructs = await loadAllConstructs(caseId, documentId);
	if (constructs.length === 0) {
		warnings.push(
			'Keine H3-Funktionstyp-Konstrukte im Werk vorhanden — die Werk-Beschreibung wird nur auf Outline-Struktur basieren.'
		);
	}
	const { text: constructsBlock, countsByType } = buildConstructsBlock(constructs);

	const memos = await loadCollapseMemos(documentId);
	const hadMemos = memos.length > 0;
	const memosBlock = buildMemosBlock(memos);
	if (hadMemos) {
		warnings.push(
			`H1/H2-Memos integriert: ${memos.length} (chapter+subchapter). Reviewer hatte vorab einen H1/H2-Run.`
		);
	}

	const llmRes = await extractWerkBeschreibung({
		outlineSummary,
		constructsBlock,
		memosBlock,
		headingCount,
		brief,
		documentId,
		maxTokens,
		modelOverride,
	});

	const content: WerkBeschreibungContent = {
		werkBeschreibungText: llmRes.result.werkBeschreibungText,
		constructCountsByType: countsByType,
		hadMemos,
		memoCount: memos.length,
		headingCount,
		llmModel: llmRes.model,
		llmTimingMs: llmRes.timingMs,
	};

	let constructId: string | null = null;
	let deletedPriorCount = 0;
	if (persistConstructs) {
		deletedPriorCount = await clearExistingWerkDeskription(caseId, documentId);
		constructId = await persistWerkBeschreibung(caseId, documentId, anchorIds, content);
	}

	return {
		caseId,
		documentId,
		werkBeschreibungText: content.werkBeschreibungText,
		constructId,
		deletedPriorCount,
		constructCountsByType: countsByType,
		hadMemos,
		memoCount: memos.length,
		headingCount,
		llmCalls: 1,
		llmTimingMs: llmRes.timingMs,
		tokens: llmRes.tokens,
		provider: llmRes.provider,
		model: llmRes.model,
		diagnostics: { warnings },
	};
}
