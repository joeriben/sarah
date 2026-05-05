// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Subchapter-collapse retrograde pass — H2-Aggregations-Linie (synthetisch,
// retrograder Verfeinerungs-Durchlauf).
//
// FFN-Backprop-style Stufe 2 (nach chapter-collapse-retrograde): liest das
// Forward-Subkapitel-Memo zusammen mit dem **retrograde**-Hauptkapitel-Memo
// (das W bereits absorbiert hat) erneut und legt eine revidierte
// Subkapitel-Synthese vor. Forward-Memo bleibt unverändert.
//
// Input:
//   - Forward-Subchapter-Memo: `[kontextualisierend/subchapter/synthetic]`
//     zu subchapterHeadingId (synthese, auffaelligkeiten via properties)
//   - Retrograde-Chapter-Memo: `[kontextualisierend/chapter/synthetic-retrograde]`
//     zum L1 des umfassenden Hauptkapitels (synthese, verlaufswiedergabe,
//     auffaelligkeiten)
//
// Output-Schema: identisch zum Forward-Subkapitel-Pass (synthese +
// auffaelligkeiten). Diktion retrograd-revisionierend.
//
// Storage: Tag `[kontextualisierend/subchapter/synthetic-retrograde]`,
// scope_level='subchapter'. Idempotent: skipt, wenn ein retrograde-Subkap-
// Memo für dieses Heading existiert.

import { z } from 'zod';
import type { Provider } from '../client.js';
import { queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import { loadResolvedOutline, loadChapterUnits } from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const SubchapterRetrogradeResultSchema = z.object({
	synthese: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type SubchapterRetrogradeResult = z.infer<typeof SubchapterRetrogradeResultSchema>;

const SUBCHAPTER_RETROGRADE_SPEC: SectionSpec = {
	singletons: { SYNTHESE: 'multiline' },
	lists: {
		AUFFAELLIGKEITEN: {
			fields: { scope: 'oneline', observation: 'multiline' },
		},
	},
};

// ── Context ────────────────────────────────────────────────────────

interface BriefMeta {
	name: string;
	work_type: string;
	criteria: string;
	persona: string;
}

interface RetrogradeContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterNumbering: string | null;

	enclosingChapterLabel: string;
	enclosingChapterNumbering: string | null;

	forwardSubchapterMemo: {
		synthese: string;
		auffaelligkeiten: { scope: string; observation: string }[];
	};
	retrogradeChapterMemo: {
		synthese: string;
		verlaufswiedergabe: string | null;
		auffaelligkeiten: { scope: string; observation: string }[];
	};
}

// ── Loader ────────────────────────────────────────────────────────

async function loadRetrogradeContext(
	caseId: string,
	subchapterHeadingId: string
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

	const docRow = await queryOne<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found`);

	const heading = await queryOne<{ char_start: number; section_kind: string | null }>(
		`SELECT char_start, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'heading'`,
		[subchapterHeadingId, caseRow.central_document_id]
	);
	if (!heading) throw new Error(`Subchapter heading not found: ${subchapterHeadingId}`);

	const outline = await loadResolvedOutline(caseRow.central_document_id);
	const headingResolved = outline.find((h) => h.headingId === subchapterHeadingId);
	if (!headingResolved) {
		throw new Error(`Heading ${subchapterHeadingId} not in resolved outline`);
	}

	// Umfassendes Hauptkapitel finden (latest L1 at-or-before this heading).
	const chapters = await loadChapterUnits(caseRow.central_document_id);
	const enclosingChapter = [...chapters]
		.reverse()
		.find((c) => c.l1.charStart <= headingResolved.charStart);
	if (!enclosingChapter) {
		throw new Error(
			`No enclosing L1 chapter found for heading ${subchapterHeadingId} ` +
				`(orphan subchapter — retrograde requires a chapter context)`
		);
	}

	// Forward-Subkapitel-Memo laden (Pflicht-Vorbedingung).
	const fwdRow = await queryOne<{
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[subchapterHeadingId]
	);
	if (!fwdRow) {
		throw new Error(
			`Cannot run runSectionCollapseRetrograde for "${headingResolved.text}": ` +
				`no forward subchapter-synthetic memo exists. Run section_collapse_synthetic first.`
		);
	}

	// Retrograde-Hauptkapitel-Memo laden (Pflicht-Vorbedingung — der ganze
	// Sinn des sequenziellen retrograden Pass-Ablaufs ist, dass das Chapter-
	// Retrograde W bereits absorbiert hat und sein Wissen ans Subkapitel
	// weitergibt).
	const retroChapterRow = await queryOne<{
		content: string;
		properties: {
			verlaufswiedergabe?: string;
			auffaelligkeiten?: { scope: string; observation: string }[];
		} | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'chapter'
		   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic-retrograde]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[enclosingChapter.l1.headingId]
	);
	if (!retroChapterRow) {
		throw new Error(
			`Cannot run runSectionCollapseRetrograde for "${headingResolved.text}": ` +
				`no retrograde chapter memo exists for enclosing chapter "${enclosingChapter.l1.text}". ` +
				`Run chapter_collapse_retrograde first.`
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
		subchapterHeadingId,
		subchapterLabel: headingResolved.text,
		subchapterNumbering: headingResolved.numbering,
		enclosingChapterLabel: enclosingChapter.l1.text,
		enclosingChapterNumbering: enclosingChapter.l1.numbering,
		forwardSubchapterMemo: {
			synthese: fwdRow.content,
			auffaelligkeiten: fwdRow.properties?.auffaelligkeiten ?? [],
		},
		retrogradeChapterMemo: {
			synthese: retroChapterRow.content,
			verlaufswiedergabe: retroChapterRow.properties?.verlaufswiedergabe ?? null,
			auffaelligkeiten: retroChapterRow.properties?.auffaelligkeiten ?? [],
		},
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: RetrogradeContext): string {
	const retroChapterAuff =
		ctx.retrogradeChapterMemo.auffaelligkeiten.length === 0
			? ''
			: '\n\nAuffälligkeiten des retrograden Hauptkapitel-Memos:\n' +
				ctx.retrogradeChapterMemo.auffaelligkeiten
					.map((a) => `  [${a.scope}] ${a.observation}`)
					.join('\n');

	const retroChapterVerlauf = ctx.retrogradeChapterMemo.verlaufswiedergabe
		? `\n\n[Verlaufswiedergabe des retrograden Hauptkapitel-Memos]\n${ctx.retrogradeChapterMemo.verlaufswiedergabe}`
		: '';

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — SUBKAPITEL-RETROGRADE-PASS]
Du hast in einem früheren Pass bereits ein Subkapitel-Memo zu diesem Subkapitel verfasst (Forward-Memo, siehe User-Message). Inzwischen liegt das **retrograde** Hauptkapitel-Memo vor — es hat die Werk-Synthese W absorbiert und reformuliert die Lesart des umfassenden Hauptkapitels unter dieser Werk-Perspektive.

Mit diesem nachgereichten Wissen liest du das Subkapitel **erneut** und legst ein **revidiertes** Subkapitel-Memo vor.

Aufgabe: das Forward-Memo nicht wiederholen, sondern *re-akzentuieren*. Drei Bewegungen sind zulässig:
- **Bestätigen**, wenn die Forward-Lesart unter dem Hauptkapitel-Retro-Licht trägt (klar so benennen).
- **Verschieben**, wenn das nachgereichte Werk-/Kapitel-Wissen eine Komponente des Subkapitels stärker oder schwächer machen sollte.
- **Korrigieren**, wenn das Forward-Memo dem Subkapitel im Werk-Kontext substantiell unrecht tut.

Wo Forward und Retrograde sich nicht unterscheiden würden, schreibe das offen. Schreibe NICHT noch einmal das Forward-Memo aus, wenn nichts zu revidieren ist.

Schema gleich wie Forward (Synthese + Auffälligkeiten):

1. **Synthese** (6–10 Sätze, hermeneutisch). Vier Pflichtbestandteile wie im Forward (Hermeneutische Bewegung / Kernbewegung mit ¶-Refs / Werk-Architektur-Verortung / Hermeneutische Tragfähigkeit) — aber jeweils im Licht des retrograden Hauptkapitel-Memos **revidiert**: was sieht man jetzt anders, was bestätigt sich? Bei Bestätigungen explizit "trägt unter Hauptkapitel-/Werk-Licht" formulieren statt zu wiederholen.

2. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen, die ERST im Hauptkapitel-/Werk-Licht sichtbar werden — z.B. eine im Subkapitel angelegte Bewegung, die erst im späteren Werk eingelöst oder fallengelassen wird, eine Spannung, die das Forward-Memo nicht aufgriff, weil sie erst im Werk-Ganzen lesbar ist. Forward-Auffälligkeiten, die unverändert bleiben, NICHT wiederholen.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}

[UMFASSENDES HAUPTKAPITEL — RETROGRADE-MEMO (W-absorbiert)]
Hauptkapitel: "${ctx.enclosingChapterNumbering ?? '?'} ${ctx.enclosingChapterLabel}"

${ctx.retrogradeChapterMemo.synthese}${retroChapterVerlauf}${retroChapterAuff}

[OUTPUT-FORMAT]
${describeProseFormat(SUBCHAPTER_RETROGRADE_SPEC)}

Inhalt der SYNTHESE-Sektion: 6–10 Sätze, retrograd-revidierend, vier Pflichtbestandteile.

Inhalt jeder AUFFAELLIGKEITEN-N-Sektion:
- scope: §<Position> oder §<Position>→§<Position> oder freitextliche subkapitelweite Bemerkung
- observation: Eine Beobachtung, die ERST im Hauptkapitel-/Werk-Licht sichtbar wird.

Wenn nichts hervorzuheben ist: lasse alle AUFFAELLIGKEITEN-Sektionen weg.`;
}

function buildUserMessage(ctx: RetrogradeContext): string {
	const fwdAuff =
		ctx.forwardSubchapterMemo.auffaelligkeiten.length === 0
			? ''
			: '\n\n**Auffälligkeiten des Forward-Memos:**\n' +
				ctx.forwardSubchapterMemo.auffaelligkeiten
					.map((a) => `  [${a.scope}] ${a.observation}`)
					.join('\n');

	return `Subkapitel: "${ctx.subchapterNumbering ?? '?'} ${ctx.subchapterLabel}"

[FORWARD-SUBKAPITEL-MEMO (zu revidieren)]

**Forward-Synthese:**
${ctx.forwardSubchapterMemo.synthese}${fwdAuff}

[AUFGABE]
Lege jetzt das **retrograde** Subkapitel-Memo vor — Synthese + Auffälligkeiten — im Licht des retrograden Hauptkapitel-Memos (siehe System-Prompt). Bestätige / verschiebe / korrigiere; wiederhole das Forward-Memo nicht.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeSubchapterRetrogradeMemo(
	ctx: RetrogradeContext,
	result: SubchapterRetrogradeResult,
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

		const label = `[kontextualisierend/subchapter/synthetic-retrograde] ${ctx.subchapterLabel}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[
				memoId,
				perspective.id,
				JSON.stringify({
					source: 'synthetic_retrograde',
					auffaelligkeiten: result.auffaelligkeiten,
				}),
			]
		);

		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', $3, 'subchapter')`,
			[memoId, result.synthese, ctx.subchapterHeadingId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface SubchapterRetrogradeRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: SubchapterRetrogradeResult | null;
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

export async function runSectionCollapseRetrograde(
	caseId: string,
	subchapterHeadingId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<SubchapterRetrogradeRun> {
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/subchapter/synthetic-retrograde]%'
		   AND mc.scope_element_id = $1
		   AND mc.scope_level = 'subchapter'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[subchapterHeadingId]
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

	const ctx = await loadRetrogradeContext(caseId, subchapterHeadingId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: SUBCHAPTER_RETROGRADE_SPEC,
			schema: SubchapterRetrogradeResultSchema,
			label: 'section-collapse-retrograde',
			maxTokens: opts.maxTokens ?? 4000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/section-collapse-retrograde-failure-${subchapterHeadingId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`subchapter_heading_id: ${subchapterHeadingId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeSubchapterRetrogradeMemo(ctx, parsed, userId);

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
