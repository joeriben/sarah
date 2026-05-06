// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// DEPRECATED bis auf weiteres (User-Setzung 2026-05-06).
// Nicht im aktiven Pipeline-Pfad — orchestrator.phasesForRun ignoriert das
// retrograde_pass-Flag und runH2Hierarchical wird nur mit retrograde=false
// aufgerufen. Modul bleibt erhalten, weil die `case`-Branches in
// orchestrator.executeStep weiter typchecken und persistierte
// Retrograde-Memos sonst nicht refresh-bar wären.
//
// Erkenntnis aus dem ersten Spot-Check (2026-05-06): die Strecke
// implementiert nur die *Top-Down-Halbiteration* eines hermeneutischen
// Zirkels (W → ¶), nicht den Bottom-Up-Rückweg. Außerdem deutet das
// Hauptkapitel-Retro Plattform-Artefakte (Heading-Numerierungs-Lücken
// aus dem DOCX-Parser) als textsubstanzielle Befunde — also Halluzination
// auf einem Substrat-Bug.
//
// Reaktivierungs-Plan inklusive Bottom-Up-Halbiteration und Substrat-
// Hygiene: docs/ticket_hermeneutischer_zirkel_bottom_up.md.

// Chapter-collapse retrograde pass — H2-Aggregations-Linie (synthetisch,
// retrograder Verfeinerungs-Durchlauf).
//
// Nachdem der Forward-Pass W (Werk-Synthese) erzeugt hat, wird hier das
// *bereits vorhandene* Hauptkapitel-Memo mit dem Werk-Wissen aus W neu
// gelesen und verfeinert (Top-Down-Halbiteration des hermeneutischen
// Zirkels — nicht „Backprop", wie früher gelabelt). Der Refinement-Output
// wird als eigenes Memo persistiert (Tag `synthetic-retrograde`), das
// Forward-Memo bleibt unverändert — beide stehen nebeneinander.
//
// Input:
//   - Forward-Chapter-Memo: `[kontextualisierend/chapter/synthetic]` zu l1HeadingId
//     (synthese, verlaufswiedergabe, auffaelligkeiten via appearances.properties)
//   - Werk-Synthese W: `[kontextualisierend/work/synthetic]` für das zentrale
//     Dokument des Cases (synthese, auffaelligkeiten)
//
// Output-Schema: identisch zum Forward-Chapter-Pass (synthese +
// verlaufswiedergabe + auffaelligkeiten). Diktion ist
// retrograd-revisionierend statt erst-konstruierend.
//
// Storage: Tag `[kontextualisierend/chapter/synthetic-retrograde]`,
// scope_level='chapter'. Idempotent: skipt, wenn ein retrograde-Memo für
// diese L1 existiert. Re-run: DELETE über naming-id.
//
// Linien-Trennung zum Forward-Loader: Forward-Chapter-Loader filtert auf
// `[kontextualisierend/chapter/synthetic]%` — das Wildcard matcht nicht
// `[kontextualisierend/chapter/synthetic-retrograde]%` (keine LIKE-Kollision,
// weil zwischen `synthetic` und `]` ein Trennzeichen fehlt: `synthetic]` vs
// `synthetic-retrograde]`).

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { RepairCallExhaustedError } from '../json-extract.js';
import { runProseCallWithRepair, describeProseFormat, type SectionSpec } from '../prose-extract.js';
import { loadChapterUnits, type ChapterUnit } from './heading-hierarchy.js';

// ── Output schema + prose section spec ────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const ChapterRetrogradeResultSchema = z.object({
	synthese: z.string().min(1),
	verlaufswiedergabe: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type ChapterRetrogradeResult = z.infer<typeof ChapterRetrogradeResultSchema>;

const CHAPTER_RETROGRADE_SPEC: SectionSpec = {
	singletons: {
		SYNTHESE: 'multiline',
		VERLAUFSWIEDERGABE: 'multiline',
	},
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

interface ForwardChapterMemo {
	synthese: string;
	verlaufswiedergabe: string | null;
	auffaelligkeiten: { scope: string; observation: string }[];
	aggregationLevel: number | null;
	inputMode: string | null;
}

interface WorkMemo {
	synthese: string;
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface RetrogradeContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapter: ChapterUnit;
	chapterPosition: number;
	totalChapters: number;
	chapterLabelOutline: string[];

	forwardMemo: ForwardChapterMemo;
	workMemo: WorkMemo;
}

// ── Loader ────────────────────────────────────────────────────────

async function loadRetrogradeContext(
	caseId: string,
	l1HeadingId: string
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

	const chapters = await loadChapterUnits(caseRow.central_document_id);
	const chapterIdx = chapters.findIndex((c) => c.l1.headingId === l1HeadingId);
	if (chapterIdx === -1) {
		throw new Error(
			`L1 heading ${l1HeadingId} not found in resolved chapter outline of document ` +
				`${caseRow.central_document_id}`
		);
	}
	const chapter = chapters[chapterIdx];

	// Forward-Chapter-Memo laden (Pflicht-Vorbedingung).
	const fwdRow = await queryOne<{
		content: string;
		properties: {
			verlaufswiedergabe?: string;
			auffaelligkeiten?: { scope: string; observation: string }[];
			aggregation_level?: number;
			input_mode?: string;
		} | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = $1
		   AND mc.scope_level = 'chapter'
		   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic]%'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[l1HeadingId]
	);
	if (!fwdRow) {
		throw new Error(
			`Cannot run runChapterCollapseRetrograde for "${chapter.l1.text}": ` +
				`no forward chapter-synthetic memo exists. Run chapter_collapse_synthetic first.`
		);
	}

	// Werk-Synthese W laden (Pflicht-Vorbedingung).
	const workRow = await queryOne<{
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	}>(
		`SELECT mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE n.inscription LIKE '[kontextualisierend/work/synthetic]%'
		   AND mc.scope_level = 'work'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[caseRow.central_document_id]
	);
	if (!workRow) {
		throw new Error(
			`Cannot run runChapterCollapseRetrograde: no work-synthetic memo (W) exists ` +
				`for document ${caseRow.central_document_id}. Run document_collapse_synthetic first.`
		);
	}

	const chapterLabelOutline = chapters.map((c, i) =>
		i === chapterIdx
			? `- ${c.l1.numbering ?? '?'} ${c.l1.text}           ← AKTUELL HIER (Retrograde-Pass)`
			: `- ${c.l1.numbering ?? '?'} ${c.l1.text}`
	);

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
		chapter,
		chapterPosition: chapterIdx + 1,
		totalChapters: chapters.length,
		chapterLabelOutline,
		forwardMemo: {
			synthese: fwdRow.content,
			verlaufswiedergabe: fwdRow.properties?.verlaufswiedergabe ?? null,
			auffaelligkeiten: fwdRow.properties?.auffaelligkeiten ?? [],
			aggregationLevel: fwdRow.properties?.aggregation_level ?? null,
			inputMode: fwdRow.properties?.input_mode ?? null,
		},
		workMemo: {
			synthese: workRow.content,
			auffaelligkeiten: workRow.properties?.auffaelligkeiten ?? [],
		},
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: RetrogradeContext): string {
	const outlineLines = ctx.chapterLabelOutline.join('\n');
	const workAuff =
		ctx.workMemo.auffaelligkeiten.length === 0
			? ''
			: '\n\nAuffälligkeiten der Werk-Synthese:\n' +
				ctx.workMemo.auffaelligkeiten.map((a) => `  [${a.scope}] ${a.observation}`).join('\n');

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — HAUPTKAPITEL-RETROGRADE-PASS]
Du hast in einem früheren Pass bereits ein Hauptkapitel-Memo zu diesem Hauptkapitel verfasst (Forward-Memo, siehe unten). Inzwischen liegt die abschließende Werk-Synthese vor — die kennt jetzt die Gesamtbewegung des Werks, die Forschungsbeitrags-Linie und die werkarchitektonischen Brüche. Mit diesem nachgereichten Werkwissen liest du das Hauptkapitel **erneut** und legst ein **revidiertes** Hauptkapitel-Memo vor.

Aufgabe: das Forward-Memo nicht wiederholen, sondern *re-akzentuieren*. Drei Bewegungen sind zulässig:
- **Bestätigen**, wenn die Forward-Lesart unter dem Werk-Licht trägt (klar so benennen, nicht stillschweigend kopieren).
- **Verschieben**, wenn das Werk-Licht eine Komponente des Kapitels stärker oder schwächer machen müsste, als die Forward-Lesart das gewichtet.
- **Korrigieren**, wenn die Forward-Lesart dem Hauptkapitel im Werk-Ganzen substantiell unrecht tut (z.B. eine vorausgreifende Bewegung übersehen, die im späteren Werk eingelöst wird).

Wo Forward und Retrograde sich nicht unterscheiden würden, schreibe das offen ("die Forward-Lesart trägt unverändert; der Werk-Kontext bestätigt sie ohne Akzent-Verschiebung"). Schreibe NICHT noch einmal das Forward-Memo aus, wenn nichts zu revidieren ist — knappe Bestätigung genügt.

Schema gleich wie Forward (Synthese / Verlaufswiedergabe / Auffälligkeiten):

1. **Synthese** (6–10 Sätze, hermeneutisch). Vier Pflichtbestandteile wie im Forward (Hermeneutische Bewegung / Kernbewegung-Identifikation / Werk-Architektur-Verortung / Hermeneutische Tragfähigkeit) — aber jeweils im Licht der Werk-Synthese **revidiert**: was sieht man jetzt anders, was bestätigt sich, welche Lesart drängt sich nach Werk-Lektüre auf, die im Forward-Pass nicht zugänglich war? Bei Bestätigungen explizit "trägt unter Werk-Licht" formulieren statt zu wiederholen.

2. **Verlaufswiedergabe** (1–3 Absätze, expositorisch, gutachten-fertig). **Reproduziere oder revidiere** die Forward-Verlaufswiedergabe so, dass sie unter Berücksichtigung des Werk-Wissens stimmig ist — wenn die Forward-Wiedergabe inhaltlich trägt, kann sie weitgehend übernommen werden; wo das Werk-Wissen eine Akzent-Verschiebung verlangt (z.B. ein im Kapitel angelegtes Motiv, das erst später eingelöst wird, knapp markieren), revidieren. KEINE bewertende Diktion, KEINE retrograde-Reflexion in der Wiedergabe — die Wiedergabe bleibt sachlich-darstellend, third-person, gutachten-fertig.

3. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen, die ERST im Werk-Licht sichtbar werden — z.B. "Im Forward-Memo nicht thematisiert: Kap. 3 nimmt eine Annahme aus Kap. 1 nicht zurück, obwohl Kap. 5 sie aufkündigt — werkarchitektonische Lücke, die erst aus W-Sicht sichtbar wird." Forward-Auffälligkeiten, die unverändert bleiben, NICHT wiederholen.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Position dieses Hauptkapitels: ${ctx.chapterPosition} von ${ctx.totalChapters}.

Outline (Hauptkapitel, sequentiell):
${outlineLines}

[WERK-SYNTHESE W (abschließende Begutachtungsdiagnose, Forward-Pass)]
${ctx.workMemo.synthese}${workAuff}

[OUTPUT-FORMAT]
${describeProseFormat(CHAPTER_RETROGRADE_SPEC)}

SYNTHESE — 6–10 Sätze, retrograd-revidierend (bestätigen / verschieben / korrigieren), vier Pflichtbestandteile.

VERLAUFSWIEDERGABE — 1–3 Absätze, expositorisch, neutral, gutachten-fertig (übernommen oder akzent-verschoben gegenüber Forward).

AUFFAELLIGKEITEN (pro Eintrag):
- scope: Subkapitel- oder ¶-Referenz oder freitextliche kapitelweite Bemerkung
- observation: Eine Beobachtung, die ERST im Werk-Licht sichtbar wird. Forward-Auffälligkeiten nicht wiederholen.

Wenn keine Werk-Licht-spezifische Auffälligkeit hervorzuheben ist: lasse alle AUFFAELLIGKEITEN-Einträge weg.`;
}

function buildUserMessage(ctx: RetrogradeContext): string {
	const fwdAuff =
		ctx.forwardMemo.auffaelligkeiten.length === 0
			? ''
			: '\n\n**Auffälligkeiten des Forward-Memos:**\n' +
				ctx.forwardMemo.auffaelligkeiten.map((a) => `  [${a.scope}] ${a.observation}`).join('\n');

	const fwdVerlauf = ctx.forwardMemo.verlaufswiedergabe
		? `\n\n**Forward-Verlaufswiedergabe:**\n${ctx.forwardMemo.verlaufswiedergabe}`
		: '';

	return `Hauptkapitel: "${ctx.chapter.l1.numbering ?? '?'} ${ctx.chapter.l1.text}"

[FORWARD-HAUPTKAPITEL-MEMO (zu revidieren)]

**Forward-Synthese:**
${ctx.forwardMemo.synthese}${fwdVerlauf}${fwdAuff}

[AUFGABE]
Lege jetzt das **retrograde** Hauptkapitel-Memo vor — Synthese + Verlaufswiedergabe + Auffälligkeiten — im Licht der Werk-Synthese W (siehe System-Prompt). Bestätige / verschiebe / korrigiere; wiederhole das Forward-Memo nicht.`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeChapterRetrogradeMemo(
	ctx: RetrogradeContext,
	result: ChapterRetrogradeResult,
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

		const numLabel = ctx.chapter.l1.numbering ?? '?';
		const label = `[kontextualisierend/chapter/synthetic-retrograde] ${numLabel} ${ctx.chapter.l1.text}`;
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
					verlaufswiedergabe: result.verlaufswiedergabe,
					auffaelligkeiten: result.auffaelligkeiten,
				}),
			]
		);

		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', $3, 'chapter')`,
			[memoId, result.synthese, ctx.chapter.l1.headingId]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface ChapterRetrogradeRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: ChapterRetrogradeResult | null;
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

export async function runChapterCollapseRetrograde(
	caseId: string,
	l1HeadingId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<ChapterRetrogradeRun> {
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/chapter/synthetic-retrograde]%'
		   AND mc.scope_element_id = $1
		   AND mc.scope_level = 'chapter'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[l1HeadingId]
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

	const ctx = await loadRetrogradeContext(caseId, l1HeadingId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runProseCallWithRepair({
			system,
			cacheSystem: true,
			user,
			spec: CHAPTER_RETROGRADE_SPEC,
			schema: ChapterRetrogradeResultSchema,
			label: 'chapter-collapse-retrograde',
			maxTokens: opts.maxTokens ?? 6000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/chapter-collapse-retrograde-failure-${l1HeadingId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`l1_heading_id: ${l1HeadingId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeChapterRetrogradeMemo(ctx, parsed, userId);

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
