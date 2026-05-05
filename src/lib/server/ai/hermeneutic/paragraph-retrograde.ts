// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-paragraph retrograde pass — H2-Aggregations-Linie (synthetisch,
// retrograder Verfeinerungs-Durchlauf).
//
// FFN-Backprop-style Stufe 3 (nach chapter-collapse-retrograde +
// section-collapse-retrograde): liest die forward-interpretierende Memo
// eines Absatzes erneut, jetzt mit dem retrograde-Subkapitel-Memo als
// Kontext (das Retrograde-Hauptkapitel-Memo + Werk-Synthese bereits
// absorbiert hat). Das Forward-Memo bleibt unverändert; das Retrograde-
// Memo wird parallel persistiert.
//
// Input:
//   - Forward-interpretierend-Memo: `[interpretierend]` zu paragraphId
//   - Retrograde-Subchapter-Memo: `[kontextualisierend/subchapter/synthetic-retrograde]`
//     zum Heading des umfassenden Subkapitels
//
// Output-Schema: { interpretierend: string } — wie Forward, aber retrograd
// neu gelesen. Kein FORMULIEREND-Feld in Retrograde (das ist Forward-only;
// inhaltliche Verdichtung ist eine Forward-Aufgabe und ändert sich durch
// Werk-Wissen nicht).
//
// Storage: Inscription-Tag `[interpretierend-retrograde]`,
// memo_type='interpretierend' (gleicher Typ wie Forward, damit nachgelagerte
// Konsumenten ggf. den jeweiligen Retrograde-Stand abrufen können — Trennung
// erfolgt rein über das inscription-Tag).
//
// Idempotent: skipt, wenn ein retrograde-interpretierend-Memo für diesen
// Absatz existiert. Re-run: DELETE über naming-id.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { type Provider } from '../client.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import {
	runProseCallWithRepair,
	describeProseFormat,
	type SectionSpec,
} from '../prose-extract.js';

// ── Output schema + spec ──────────────────────────────────────────

const ParagraphRetrogradeResultSchema = z.object({
	interpretierend: z.string().min(1),
});

export type ParagraphRetrogradeResult = z.infer<typeof ParagraphRetrogradeResultSchema>;

const PARAGRAPH_RETROGRADE_SPEC: SectionSpec = {
	singletons: { INTERPRETIEREND: 'multiline' },
	lists: {},
};

// ── Context ────────────────────────────────────────────────────────

interface RetrogradeContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: { name: string; work_type: string; criteria: string; persona: string };

	paragraphId: string;
	paragraphText: string;
	subchapterHeadingId: string;
	subchapterLabel: string;
	positionInSubchapter: number;
	subchapterTotalParagraphs: number;

	forwardInterpretierend: string;
	retrogradeSubchapterMemo: {
		synthese: string;
		auffaelligkeiten: { scope: string; observation: string }[];
	};
}

// ── Loader ────────────────────────────────────────────────────────

async function loadRetrogradeContext(
	caseId: string,
	paragraphId: string
): Promise<RetrogradeContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.criteria) throw new Error(`Case ${caseId} has no assessment_brief attached`);

	const docRow = await queryOne<{ inscription: string; full_text: string }>(
		`SELECT n.inscription, dc.full_text
		 FROM namings n JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found: ${caseRow.central_document_id}`);

	const para = await queryOne<{
		char_start: number;
		char_end: number;
		section_kind: string | null;
	}>(
		`SELECT char_start, char_end, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'paragraph'`,
		[paragraphId, caseRow.central_document_id]
	);
	if (!para) throw new Error(`Paragraph not found in document: ${paragraphId}`);
	if (para.section_kind !== 'main') {
		throw new Error(`Paragraph ${paragraphId} is in section_kind=${para.section_kind}, not 'main'`);
	}

	const heading = await queryOne<{ id: string; char_start: number; char_end: number }>(
		`SELECT id, char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start <= $2
		 ORDER BY char_start DESC LIMIT 1`,
		[caseRow.central_document_id, para.char_start]
	);
	if (!heading) {
		throw new Error(
			`No subchapter heading found before paragraph ${paragraphId} ` +
				`(retrograde requires an enclosing subchapter)`
		);
	}

	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start ASC LIMIT 1`,
		[caseRow.central_document_id, para.char_start]
	);
	const subchapterEnd = nextHeading?.char_start ?? docRow.full_text.length;

	const subPars = (
		await query<{ id: string; char_start: number }>(
			`SELECT id, char_start FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			   AND char_start >= $2 AND char_start < $3
			 ORDER BY char_start`,
			[caseRow.central_document_id, heading.char_start, subchapterEnd]
		)
	).rows;
	const idx = subPars.findIndex((p) => p.id === paragraphId);
	if (idx === -1) throw new Error(`Paragraph ${paragraphId} not found in its subchapter`);

	// Forward-interpretierend laden (Pflicht-Vorbedingung).
	const fwdRow = await queryOne<{ content: string }>(
		`SELECT mc.content
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'paragraph'
		   AND mc.memo_type = 'interpretierend'
		   AND n.inscription LIKE '[interpretierend]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[paragraphId]
	);
	if (!fwdRow) {
		throw new Error(
			`Cannot run runParagraphRetrograde for ${paragraphId}: ` +
				`no forward interpretierend memo exists. Run paragraph_synthetic first.`
		);
	}

	// Retrograde-Subchapter-Memo laden (Pflicht-Vorbedingung).
	const retroSubRow = await queryOne<{
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic-retrograde]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[heading.id]
	);
	if (!retroSubRow) {
		throw new Error(
			`Cannot run runParagraphRetrograde for ${paragraphId}: ` +
				`no retrograde subchapter memo exists for enclosing heading ${heading.id}. ` +
				`Run section_collapse_retrograde first.`
		);
	}

	return {
		caseId,
		projectId: caseRow.project_id,
		centralDocumentId: caseRow.central_document_id,
		documentTitle: docRow.inscription,
		brief: {
			name: caseRow.brief_name,
			work_type: caseRow.work_type,
			criteria: caseRow.criteria,
			persona: caseRow.persona,
		},
		paragraphId,
		paragraphText: docRow.full_text.substring(para.char_start, para.char_end),
		subchapterHeadingId: heading.id,
		subchapterLabel: docRow.full_text.substring(heading.char_start, heading.char_end).trim(),
		positionInSubchapter: idx + 1,
		subchapterTotalParagraphs: subPars.length,
		forwardInterpretierend: fwdRow.content,
		retrogradeSubchapterMemo: {
			synthese: retroSubRow.content,
			auffaelligkeiten: retroSubRow.properties?.auffaelligkeiten ?? [],
		},
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: RetrogradeContext): string {
	const retroSubAuff =
		ctx.retrogradeSubchapterMemo.auffaelligkeiten.length === 0
			? ''
			: '\n\nAuffälligkeiten des retrograden Subkapitel-Memos:\n' +
				ctx.retrogradeSubchapterMemo.auffaelligkeiten
					.map((a) => `  [${a.scope}] ${a.observation}`)
					.join('\n');

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — ABSATZ-RETROGRADE-PASS]
Du hast in einem früheren Pass bereits eine interpretierende Memo zu diesem Absatz verfasst (Forward-Memo, siehe User-Message). Inzwischen liegt das **retrograde** Subkapitel-Memo vor — es hat das retrograde Hauptkapitel-Memo und damit die Werk-Synthese W absorbiert und reformuliert die Lesart des umfassenden Subkapitels unter der Werk-Perspektive.

Mit diesem nachgereichten Wissen liest du den Absatz **erneut** und legst eine **revidierte** interpretierende Memo vor.

Aufgabe: das Forward-Memo nicht wiederholen, sondern *re-akzentuieren*.
- **Bestätigen**, wenn die Forward-Lesart unter dem Subkapitel-Retro-Licht trägt — kurz so benennen.
- **Verschieben**, wenn das Werk-/Subkap-Wissen die Funktions-Diagnose des Absatzes verändert (z.B. ein im Forward als "Nebenklärung" gelesener Absatz erweist sich rückblickend als pivot, oder umgekehrt).
- **Korrigieren**, wenn die Forward-Lesart dem Absatz im Werk-Kontext substantiell unrecht tut.

Schreibe NICHT noch einmal die Forward-Lesart aus, wenn nichts zu revidieren ist — knappe Bestätigung ("die Forward-Lesart trägt unter Werk-Licht ohne Akzent-Verschiebung") genügt dann. Nur eine Sektion (INTERPRETIEREND), 2–4 Sätze, retrograd-revidierend.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}

[UMFASSENDES SUBKAPITEL — RETROGRADE-MEMO (W- und Hauptkapitel-absorbiert)]
Subkapitel: "${ctx.subchapterLabel}"
Position dieses Absatzes im Subkapitel: ${ctx.positionInSubchapter} von ${ctx.subchapterTotalParagraphs}.

${ctx.retrogradeSubchapterMemo.synthese}${retroSubAuff}

[OUTPUT-FORMAT]
${describeProseFormat(PARAGRAPH_RETROGRADE_SPEC)}

Inhalt der INTERPRETIEREND-Sektion: 2–4 Sätze, retrograd-revidierend gegenüber der Forward-Lesart. Klare Diagnose: bestätigt / verschoben / korrigiert.`;
}

function buildUserMessage(ctx: RetrogradeContext): string {
	return `Absatz ${ctx.positionInSubchapter} von ${ctx.subchapterTotalParagraphs} im Subkapitel "${ctx.subchapterLabel}".

[ABSATZ-TEXT]
"${ctx.paragraphText}"

[FORWARD-INTERPRETIEREND-MEMO (zu revidieren)]
${ctx.forwardInterpretierend}

[AUFGABE]
Lege jetzt das **retrograde** interpretierende Memo vor — im Licht des retrograden Subkapitel-Memos (siehe System-Prompt). Bestätige / verschiebe / korrigiere; wiederhole das Forward-Memo nicht.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeParagraphRetrogradeMemo(
	ctx: RetrogradeContext,
	result: ParagraphRetrogradeResult,
	userId: string
): Promise<{ memoId: string }> {
	return transaction(async (client) => {
		let perspective = (
			await client.query(
				`SELECT n.id FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
				 WHERE n.project_id = $1 AND a.mode = 'perspective'
				   AND a.properties->>'role' = 'memo-system'
				   AND n.deleted_at IS NULL
				 LIMIT 1`,
				[ctx.projectId]
			)
		).rows[0];
		if (!perspective) {
			const r = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, 'Memo System', $2) RETURNING id`,
				[ctx.projectId, userId]
			);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $1, 'perspective', '{"role": "memo-system"}')`,
				[r.rows[0].id]
			);
			perspective = r.rows[0];
		}

		const label = `[interpretierend-retrograde] ${ctx.subchapterLabel} §${ctx.positionInSubchapter}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', '{"source": "synthetic_retrograde"}')`,
			[memoId, perspective.id]
		);
		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'interpretierend', $3, 'paragraph')`,
			[memoId, result.interpretierend, ctx.paragraphId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ParagraphRetrogradeRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: ParagraphRetrogradeResult | null;
	stored: { memoId: string } | null;
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	} | null;
	model: string | null;
	provider: string | null;
}

export async function runParagraphRetrograde(
	caseId: string,
	paragraphId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ParagraphRetrogradeRun> {
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[interpretierend-retrograde]%'
		   AND mc.scope_element_id = $1
		   AND mc.scope_level = 'paragraph'
		   AND mc.memo_type = 'interpretierend'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[paragraphId]
	);
	if (existingMemo) {
		return {
			skipped: true,
			existingMemoId: existingMemo.id,
			result: null,
			stored: null,
			tokens: null,
			model: null,
			provider: null,
		};
	}

	const ctx = await loadRetrogradeContext(caseId, paragraphId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: PARAGRAPH_RETROGRADE_SPEC,
			schema: ParagraphRetrogradeResultSchema,
			label: 'paragraph-retrograde',
			maxTokens: opts.maxTokens ?? 2000,
			modelOverride: opts.modelOverride,
			caseId,
			paragraphId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/paragraph-retrograde-failure-${paragraphId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`paragraph_id: ${paragraphId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeParagraphRetrogradeMemo(ctx, parsed, userId);

	return {
		skipped: false,
		existingMemoId: null,
		result: parsed,
		stored,
		tokens: {
			input: repairResult.tokens.input,
			output: repairResult.tokens.output,
			cacheCreation: repairResult.tokens.cacheCreation,
			cacheRead: repairResult.tokens.cacheRead,
			total: repairResult.tokens.total,
		},
		model: repairResult.model,
		provider: repairResult.provider,
	};
}
