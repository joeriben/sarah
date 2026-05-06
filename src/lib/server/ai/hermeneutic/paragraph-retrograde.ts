// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-paragraph retrograde pass — H2-Aggregations-Linie (synthetisch,
// retrograder Verfeinerungs-Durchlauf).
//
// FFN-Backprop-style Stufe 3 (nach chapter-collapse-retrograde +
// section-collapse-retrograde): liest die forward-interpretierende Memo
// eines Absatzes erneut, jetzt mit dem retrograden Memo der **umfassenden
// Aggregations-Einheit** als Kontext. Aggregations-Einheit ist:
//   - bei chosen_level=1 (Hauptkapitel = Synthese-Einheit, vgl.
//     chooseSubchapterLevel in heading-hierarchy.ts) das Hauptkapitel
//     selbst → chapter-level Retrograde-Memo
//   - bei chosen_level=2|3 das nächste umfassende Heading auf dem gewählten
//     Level → subchapter-level Retrograde-Memo
//   - Pre-Section-Absätze (zwischen L1 und erstem L2 in chosen_level≥2-
//     Kapiteln) fallen auf das Hauptkapitel zurück (kongruent zur Forward-
//     Behandlung in buildH2HierarchicalPlan / paragraphCountForUnit).
//
// Diese Auflösung ist Pflicht — der direkt vorausgehende Heading-Eintrag
// stimmt nur zufällig mit der gewählten Aggregations-Ebene überein, sonst
// landet der Loader auf einem Heading ohne eigenes Retrograde-Memo.
//
// Input:
//   - Forward-interpretierend-Memo: `[interpretierend]` zu paragraphId
//   - Retrograde-Aggregations-Memo: entweder
//     `[kontextualisierend/chapter/synthetic-retrograde]` (scope_level=
//     'chapter') oder `[kontextualisierend/subchapter/synthetic-retrograde]`
//     (scope_level='subchapter'), je nach Aggregations-Einheit
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
import {
	loadChapterUnits,
	loadResolvedOutline,
	getPersistedSubchapterLevel,
} from './heading-hierarchy.js';

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

/**
 * Aggregations-Einheits-Typ für die Prompt-Sprache: 'chapter' = Hauptkapitel
 * ist die Synthese-Einheit (chosen_level=1, oder Pre-Section-Fallback);
 * 'subchapter' = ein L2/L3-Heading auf dem gewählten Aggregations-Level
 * ist die Synthese-Einheit. Beide Pfade sind legitim und produzieren
 * jeweils das passende Retrograde-Memo (chapter- vs. subchapter-scope).
 */
type AggregationUnitKind = 'chapter' | 'subchapter';

interface RetrogradeContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: { name: string; work_type: string; criteria: string; persona: string };

	paragraphId: string;
	paragraphText: string;
	/** ID des Aggregations-Einheits-Headings (L1 oder Subkapitel-Heading). */
	unitHeadingId: string;
	/** Sprachform: "Hauptkapitel" oder "Subkapitel". */
	unitKind: AggregationUnitKind;
	/** Trimmter Heading-Text der Aggregations-Einheit. */
	unitLabel: string;
	/** 1-basierte Position des Absatzes innerhalb der Aggregations-Einheit. */
	positionInUnit: number;
	/** Gesamtanzahl Absätze in der Aggregations-Einheit. */
	unitTotalParagraphs: number;

	forwardInterpretierend: string;
	/** Retrograde-Memo der Aggregations-Einheit (chapter- oder subchapter-scope). */
	retrogradeUnitMemo: {
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

	// Aggregations-Einheit auflösen — kongruent zur Forward-Choreographie
	// (buildH2HierarchicalPlan / loadCollapseContext / paragraphCountForUnit):
	//   1. umfassendes L1 finden (latest L1 at-or-before paragraph)
	//   2. chosen_level via getPersistedSubchapterLevel
	//   3. bei chosen=1: Aggregation = L1, Memo-Scope = chapter
	//      bei chosen≥2: Aggregation = letztes Heading auf chosen-Level vor
	//      diesem Absatz innerhalb des L1; falls keines existiert (Pre-Section-
	//      Absatz vor erstem L2 in chosen=2-Kapitel) → Fallback auf L1 +
	//      chapter-Scope-Memo
	const chapters = await loadChapterUnits(caseRow.central_document_id);
	const enclosingChapter = [...chapters]
		.reverse()
		.find((c) => c.l1.charStart <= para.char_start);
	if (!enclosingChapter) {
		throw new Error(
			`No enclosing L1 chapter found for paragraph ${paragraphId} ` +
				`(orphan paragraph — retrograde requires a chapter context)`
		);
	}

	const chosenLevel = await getPersistedSubchapterLevel(enclosingChapter.l1.headingId);
	let unitHeadingId = enclosingChapter.l1.headingId;
	let unitHeadingCharStart = enclosingChapter.l1.charStart;
	let unitHeadingCharEnd = enclosingChapter.l1.charEnd;
	let unitLevel = enclosingChapter.l1.level;
	let unitKind: AggregationUnitKind = 'chapter';

	if (chosenLevel === 2 || chosenLevel === 3) {
		const candidates = enclosingChapter.innerHeadings.filter(
			(h) => h.level === chosenLevel && h.charStart <= para.char_start
		);
		if (candidates.length > 0) {
			const last = candidates[candidates.length - 1];
			unitHeadingId = last.headingId;
			unitHeadingCharStart = last.charStart;
			unitHeadingCharEnd = last.charEnd;
			unitLevel = last.level;
			unitKind = 'subchapter';
		}
		// else: pre-section-Absatz, bleibt bei der L1-Aggregations-Einheit
	}
	// chosenLevel===1 oder null: bleibt bei L1 + chapter-Scope.

	// Aggregations-Einheits-Boundary: nächstes Heading auf SAME-OR-HIGHER level
	// (kongruent zu loadCollapseContext.section-collapse-synthetic). Eine L2-
	// Einheit umfasst auch ihre L3-Subheadings; eine L1-Einheit reicht bis
	// zum nächsten L1.
	const outline = await loadResolvedOutline(caseRow.central_document_id);
	const nextSiblingOrHigher = outline.find(
		(h) => h.charStart > unitHeadingCharStart && h.level <= unitLevel
	);
	const unitEnd = nextSiblingOrHigher?.charStart ?? docRow.full_text.length;

	const unitPars = (
		await query<{ id: string; char_start: number }>(
			`SELECT id, char_start FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			   AND char_start >= $2 AND char_start < $3
			 ORDER BY char_start`,
			[caseRow.central_document_id, unitHeadingCharStart, unitEnd]
		)
	).rows;
	const idx = unitPars.findIndex((p) => p.id === paragraphId);
	if (idx === -1) {
		throw new Error(
			`Paragraph ${paragraphId} not found in its aggregation unit ` +
				`(${unitKind} ${unitHeadingId}) — outline/paragraph mismatch`
		);
	}

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

	// Retrograde-Aggregations-Memo laden (Pflicht-Vorbedingung). Scope hängt
	// von unitKind ab — chapter- oder subchapter-level Retrograde-Memo.
	const memoScope = unitKind === 'chapter' ? 'chapter' : 'subchapter';
	const memoTagPrefix =
		unitKind === 'chapter'
			? '[kontextualisierend/chapter/synthetic-retrograde]'
			: '[kontextualisierend/subchapter/synthetic-retrograde]';
	const retroRow = await queryOne<{
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = $2
		   AND n.inscription LIKE $3
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[unitHeadingId, memoScope, memoTagPrefix + '%']
	);
	if (!retroRow) {
		const upstreamPhase =
			unitKind === 'chapter' ? 'chapter_collapse_retrograde' : 'section_collapse_retrograde';
		throw new Error(
			`Cannot run runParagraphRetrograde for ${paragraphId}: ` +
				`no retrograde ${unitKind} memo exists for enclosing heading ${unitHeadingId}. ` +
				`Run ${upstreamPhase} first.`
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
		unitHeadingId,
		unitKind,
		unitLabel: docRow.full_text.substring(unitHeadingCharStart, unitHeadingCharEnd).trim(),
		positionInUnit: idx + 1,
		unitTotalParagraphs: unitPars.length,
		forwardInterpretierend: fwdRow.content,
		retrogradeUnitMemo: {
			synthese: retroRow.content,
			auffaelligkeiten: retroRow.properties?.auffaelligkeiten ?? [],
		},
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: RetrogradeContext): string {
	const retroAuff =
		ctx.retrogradeUnitMemo.auffaelligkeiten.length === 0
			? ''
			: `\n\nAuffälligkeiten des retrograden ${ctx.unitKind === 'chapter' ? 'Hauptkapitel' : 'Subkapitel'}-Memos:\n` +
				ctx.retrogradeUnitMemo.auffaelligkeiten
					.map((a) => `  [${a.scope}] ${a.observation}`)
					.join('\n');

	const unitNoun = ctx.unitKind === 'chapter' ? 'Hauptkapitels' : 'Subkapitels';
	const unitNounNominative = ctx.unitKind === 'chapter' ? 'Hauptkapitel' : 'Subkapitel';
	// Bei chapter-scope ist das retrograde Memo direkt das W-absorbierte
	// Hauptkapitel-Memo (ohne dazwischenliegendes Subkapitel-Memo). Bei
	// subchapter-scope hat das Subkapitel-Retro das Hauptkapitel-Retro absorbiert.
	const absorptionPhrase =
		ctx.unitKind === 'chapter'
			? 'es hat die Werk-Synthese W absorbiert und reformuliert die Lesart des Hauptkapitels unter der Werk-Perspektive'
			: 'es hat das retrograde Hauptkapitel-Memo und damit die Werk-Synthese W absorbiert und reformuliert die Lesart des umfassenden Subkapitels unter der Werk-Perspektive';
	const reLightShort =
		ctx.unitKind === 'chapter' ? 'Hauptkapitel-Retro-Licht' : 'Subkapitel-Retro-Licht';
	const knowledgeDescriptor =
		ctx.unitKind === 'chapter' ? 'Werk-/Hauptkap-Wissen' : 'Werk-/Subkap-Wissen';

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — ABSATZ-RETROGRADE-PASS]
Du hast in einem früheren Pass bereits eine interpretierende Memo zu diesem Absatz verfasst (Forward-Memo, siehe User-Message). Inzwischen liegt das **retrograde** ${unitNounNominative}-Memo vor — ${absorptionPhrase}.

Mit diesem nachgereichten Wissen liest du den Absatz **erneut** und legst eine **revidierte** interpretierende Memo vor.

Aufgabe: das Forward-Memo nicht wiederholen, sondern *re-akzentuieren*.
- **Bestätigen**, wenn die Forward-Lesart unter dem ${reLightShort} trägt — kurz so benennen.
- **Verschieben**, wenn das ${knowledgeDescriptor} die Funktions-Diagnose des Absatzes verändert (z.B. ein im Forward als "Nebenklärung" gelesener Absatz erweist sich rückblickend als pivot, oder umgekehrt).
- **Korrigieren**, wenn die Forward-Lesart dem Absatz im Werk-Kontext substantiell unrecht tut.

Schreibe NICHT noch einmal die Forward-Lesart aus, wenn nichts zu revidieren ist — knappe Bestätigung ("die Forward-Lesart trägt unter Werk-Licht ohne Akzent-Verschiebung") genügt dann. Nur eine Sektion (INTERPRETIEREND), 2–4 Sätze, retrograd-revidierend.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}

[UMFASSENDES ${unitNounNominative.toUpperCase()} — RETROGRADE-MEMO (W-${ctx.unitKind === 'chapter' ? '' : ' und Hauptkapitel-'}absorbiert)]
${unitNounNominative}: "${ctx.unitLabel}"
Position dieses Absatzes im ${unitNounNominative}: ${ctx.positionInUnit} von ${ctx.unitTotalParagraphs}.

${ctx.retrogradeUnitMemo.synthese}${retroAuff}

[OUTPUT-FORMAT]
${describeProseFormat(PARAGRAPH_RETROGRADE_SPEC)}

Inhalt der INTERPRETIEREND-Sektion: 2–4 Sätze, retrograd-revidierend gegenüber der Forward-Lesart. Klare Diagnose: bestätigt / verschoben / korrigiert.`;
}

function buildUserMessage(ctx: RetrogradeContext): string {
	const unitNounNominative = ctx.unitKind === 'chapter' ? 'Hauptkapitel' : 'Subkapitel';
	return `Absatz ${ctx.positionInUnit} von ${ctx.unitTotalParagraphs} im ${unitNounNominative} "${ctx.unitLabel}".

[ABSATZ-TEXT]
"${ctx.paragraphText}"

[FORWARD-INTERPRETIEREND-MEMO (zu revidieren)]
${ctx.forwardInterpretierend}

[AUFGABE]
Lege jetzt das **retrograde** interpretierende Memo vor — im Licht des retrograden ${unitNounNominative}-Memos (siehe System-Prompt). Bestätige / verschiebe / korrigiere; wiederhole das Forward-Memo nicht.`;
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

		const label = `[interpretierend-retrograde] ${ctx.unitLabel} §${ctx.positionInUnit}`;
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
