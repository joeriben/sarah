// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Werk-collapse pass — Direction 4, level work.
//
// Synthesizes the work-level memo by aggregating all L1-Hauptkapitel
// memos. This is the abschließende Begutachtungsdiagnose: what does the
// work as a whole accomplish, and how does it measure against the
// expectations of its work_type (Hausarbeit BA / MA, BA-/MA-Arbeit,
// Dissertation, Habilitationsschrift)?
//
// Output schema (single-purpose, unlike chapter-collapse — no
// argumentationswiedergabe at work level; the chapter-level
// wiedergaben already serve that purpose, and a work-level
// "Gesamteinschätzung" is a different textual genre that we'll add
// only if the first work-collapse run shows it's needed):
//   {
//     synthese:           Werk-Synthese (drei Pflichtbestandteile),
//     auffaelligkeiten:   werkweite Beobachtungen (über die Hauptkapitel)
//   }
//
// Storage: tag '[kontextualisierend/work/graph]', scope_level='work',
// scope_element_id NULL (work-level has no document_element to anchor to;
// the link to the document goes via the case → central_document_id path
// and via the appearances.properties.document_id reference for query).
//
// Idempotent: skips if a work-graph memo already exists for the case's
// central document. To re-run, DELETE the namings row by id (cascades
// to memo_content + appearances).

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat } from '../client.js';
import { loadChapterUnits, type ChapterUnit } from './heading-hierarchy.js';

// ── Output schema ─────────────────────────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const DocumentCollapseResultSchema = z.object({
	synthese: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type DocumentCollapseResult = z.infer<typeof DocumentCollapseResultSchema>;

// ── Context ────────────────────────────────────────────────────────

interface BriefMeta {
	name: string;
	work_type: string;
	criteria: string;
	persona: string;
}

interface ChapterMemoInput {
	headingId: string;
	numbering: string | null;
	label: string;
	synthese: string;
	argumentationswiedergabe: string | null;  // from appearances.properties
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface DocumentContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapters: ChapterUnit[];
	chapterMemos: ChapterMemoInput[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadDocumentContext(caseId: string): Promise<DocumentContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
		argumentation_graph: boolean;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona,
		        b.argumentation_graph
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.criteria) throw new Error(`Case ${caseId} has no assessment_brief attached`);
	if (!caseRow.argumentation_graph) {
		throw new Error(`Brief on case ${caseId} does not have argumentation_graph=true`);
	}

	const docRow = await queryOne<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found`);

	const chapters = await loadChapterUnits(caseRow.central_document_id);

	// Load all chapter-graph memos. Hard requirement: every L1 chapter must
	// have one — otherwise the work-synthesis would be partial. The orchestrator
	// (endpoint-level) is responsible for ensuring all chapter-collapses
	// complete before triggering this.
	const headingIds = chapters.map(c => c.l1.headingId);
	const memoRows = (await query<{
		heading_id: string;
		inscription: string;
		content: string;
		properties: {
			argumentationswiedergabe?: string;
			auffaelligkeiten?: { scope: string; observation: string }[];
		} | null;
	}>(
		`SELECT mc.scope_element_id AS heading_id, n.inscription, mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = ANY($1::uuid[])
		   AND mc.scope_level = 'chapter'
		   AND n.inscription LIKE '[kontextualisierend/chapter/graph]%'
		   AND n.deleted_at IS NULL`,
		[headingIds]
	)).rows;

	const memoByHeading = new Map<string, typeof memoRows[number]>();
	for (const m of memoRows) memoByHeading.set(m.heading_id, m);

	const missing = chapters.filter(c => !memoByHeading.has(c.l1.headingId));
	if (missing.length > 0) {
		throw new Error(
			`Cannot run runDocumentCollapse: ${missing.length} of ${chapters.length} ` +
			`Hauptkapitel have no chapter-graph memo yet. Run runChapterCollapse on these first: ` +
			missing.map(c => `"${c.l1.numbering ?? '?'} ${c.l1.text}"`).join(', ')
		);
	}

	const chapterMemos: ChapterMemoInput[] = chapters.map(c => {
		const m = memoByHeading.get(c.l1.headingId)!;
		return {
			headingId: c.l1.headingId,
			numbering: c.l1.numbering,
			label: c.l1.text,
			synthese: m.content,
			argumentationswiedergabe: m.properties?.argumentationswiedergabe ?? null,
			auffaelligkeiten: m.properties?.auffaelligkeiten ?? [],
		};
	});

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
		chapters,
		chapterMemos,
	};
}

// ── Prompt assembly ───────────────────────────────────────────────
//
// Werk-Pflichtbestandteile (Architektur-Diskussion 2026-04-30): drei,
// nicht vier. Forschungsbeitrag-Diagnose, Gesamtkohärenz, Niveau mit
// work_type-Akzent. Eine vierte "werkweite Spannungsdiagnose" wäre
// mechanische Hochskalierung des Subkapitel-Pflichtbestandteils — auf
// Werk-Ebene entstehen integrative Spannungen ohnehin in den drei
// genuinen Bestandteilen. Wenn ein erster Werk-Lauf zeigt, dass
// werkweite Spannungs-Befunde substantiell fehlen, ergänzen wir sie
// nachträglich.

function buildSystemPrompt(ctx: DocumentContext): string {
	const outlineLines = ctx.chapters
		.map(c => `- ${c.l1.numbering ?? '?'} ${c.l1.text}`)
		.join('\n');

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — WERK-SYNTHESE (abschließende Begutachtungsdiagnose)]
Du synthetisierst das **kontextualisierende Memo des gesamten Werks** auf der analytischen Linie.

Dein Input für diesen Pass sind die **Hauptkapitel-Memos** des Werks — vorgeschaltete Synthese-Pässe haben pro Hauptkapitel bereits eine analytische Synthese, eine gutachten-fertige Argumentationswiedergabe und Auffälligkeiten erzeugt. Du fasst diese zu einer Werk-Synthese zusammen.

Dies ist die **abschließende Begutachtungsdiagnose** auf Werk-Ebene — die Position, von der aus die Gesamtbeurteilung des Werks formuliert wird.

Aufgabe in zwei Teilen:

1. **Synthese** (8–14 Sätze, in argumentativer Diktion). Drei *Pflichtbestandteile* — fehlt einer, ist die Synthese unvollständig:

   a. **Forschungsbeitrag-Diagnose** — was leistet das Werk *als Ganzes* in seinem Feld? Wo verläuft die Eigenleistungs-Linie über alle Hauptkapitel hinweg? Was wäre mit einem Satz die zentrale Behauptung oder Bewegung, die das Werk seinem Forschungsfeld hinzufügt? (Bei klar rezeptiv-applizierenden Arbeiten ohne genuine Eigenleistung: das ebenso klar diagnostizieren — nicht überhöhen.)

   b. **Gesamtkohärenz und Werk-Architektur** — wie verhalten sich die Hauptkapitel zueinander, gibt es eine durchgehende argumentative Linie, oder sind die Kapitel parallel-additiv ohne Querverbindungen? Wo liegen werkarchitektonische Brüche (z.B. Theoriekapitel ohne Anschluss an die empirischen Kapitel)?

   c. **Niveau-Beurteilung mit Werktyp-Akzent** — gemessen an den im Feld üblichen Erwartungen an den Werktyp **${ctx.brief.work_type}**: ist das Werk niveau-angemessen, unterhalb oder oberhalb der Latte? Konkret: eine Hausarbeit BA wird nicht an Habilitations-Maßstäben gemessen; eine Dissertation hat eine andere Eigenleistungs-Latte als eine MA-Arbeit. Kalibriere deine Niveau-Diagnose explizit am Werktyp und nenne den Maßstab beim Namen.

   **Diktion:** evaluativ-argumentativ, gutachterlich. Kein Tabu auf scharfen Diagnosen wenn sie aus den Hauptkapitel-Memos klar belegt sind — die Werk-Synthese ist die Position, von der aus die spätere Gesamteinschätzung im Gutachten geschrieben wird.

2. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen zur argumentativen Qualität auf Werk-Ebene, die in der Synthese nicht hineingehören, aber für die Begutachtung relevant sind. Beispiele: "Die Forschungsfrage des Werks (Hauptkapitel 1) wird in den abschließenden Hauptkapiteln nicht explizit zurückgenommen — eine werkarchitektonische Lücke." Halte dich an Auffälligkeiten, die aus der Hauptkapitel-Memo-Struktur erkennbar sind.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Hauptkapitel: ${ctx.chapters.length}

Outline:
${outlineLines}

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst (kein Vor-/Nachtext, kein Markdown-Codefence):

{
  "synthese": "<8–14 Sätze, argumentative Diktion, drei Pflichtbestandteile, Niveau-Beurteilung explizit am Werktyp '${ctx.brief.work_type}' kalibriert>",
  "auffaelligkeiten": [
    { "scope": "<Hauptkapitel-Numerierung oder werkweit>", "observation": "<Eine Beobachtung zur argumentativen Qualität>" }
  ]
}

auffaelligkeiten kann leeres Array sein.`;
}

function buildUserMessage(ctx: DocumentContext): string {
	const blocks = ctx.chapterMemos.map(m => {
		const num = m.numbering ?? '(ohne Numerierung)';
		const auff = m.auffaelligkeiten.length === 0
			? ''
			: '\n\n  Auffälligkeiten dieses Hauptkapitels:\n' +
			  m.auffaelligkeiten.map(a => `    [${a.scope}] ${a.observation}`).join('\n');
		// Argumentationswiedergabe is intentionally NOT included in the input —
		// the synthese already carries the analytical content; the wiedergabe
		// is a parallel deliverable for the Gutachten and would just bloat the
		// work-synthesis input. If a future validation shows the wiedergabe
		// content is needed for the work-level synthesis, append it here.
		return `## Hauptkapitel ${num} "${m.label}"\n\n${m.synthese}${auff}`;
	}).join('\n\n');

	return `Werk: "${ctx.documentTitle}"
Werktyp: ${ctx.brief.work_type}
Hauptkapitel-Memos als Input: ${ctx.chapterMemos.length}

[HAUPTKAPITEL-MEMOS]

${blocks}

Synthetisiere jetzt das kontextualisierende Werk-Memo (Synthese + Auffälligkeiten) als abschließende Begutachtungsdiagnose, kalibriert am Werktyp.`;
}

// ── Output extraction ─────────────────────────────────────────────

function extractJSON(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error('No JSON object found in LLM response');
	}
	return text.slice(start, end + 1);
}

// ── Storage ───────────────────────────────────────────────────────

async function storeDocumentMemo(
	ctx: DocumentContext,
	result: DocumentCollapseResult,
	userId: string
): Promise<{ memoId: string }> {
	return transaction(async (client) => {
		let perspective = (await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND a.mode = 'perspective'
			   AND a.properties->>'role' = 'memo-system'
			   AND n.deleted_at IS NULL
			 LIMIT 1`,
			[ctx.projectId]
		)).rows[0];
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

		const label = `[kontextualisierend/work/graph] ${ctx.documentTitle}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[memoId, perspective.id, JSON.stringify({
				source: 'argumentation_graph',
				document_id: ctx.centralDocumentId,
				work_type: ctx.brief.work_type,
				auffaelligkeiten: result.auffaelligkeiten,
			})]
		);

		// scope_element_id is NULL: work-level memo has no document_element
		// anchor (a "work" element doesn't exist in document_elements); the
		// link to the document goes via appearances.properties.document_id.
		await client.query(
			`INSERT INTO memo_content
			   (naming_id, content, format, status, memo_type, scope_element_id, scope_level)
			 VALUES ($1, $2, 'text', 'active', 'kontextualisierend', NULL, 'work')`,
			[memoId, result.synthese]
		);

		return { memoId };
	});
}

// ── Public orchestration ──────────────────────────────────────────

export interface DocumentCollapseRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: DocumentCollapseResult | null;
	stored: { memoId: string } | null;
	tokens: {
		input: number; output: number;
		cacheCreation: number; cacheRead: number; total: number;
	} | null;
	model: string | null;
	provider: string | null;
	chapterCount: number | null;
}

export async function runDocumentCollapse(
	caseId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string }; maxTokens?: number } = {}
): Promise<DocumentCollapseRun> {
	const caseRow = await queryOne<{ central_document_id: string }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);

	// Idempotency guard: skip if a work-graph memo already exists for this
	// document. The link goes via appearances.properties.document_id since
	// scope_element_id is NULL for work-level memos.
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
		   AND mc.scope_level = 'work'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[caseRow.central_document_id]
	);
	if (existingMemo) {
		return {
			skipped: true,
			existingMemoId: existingMemo.id,
			result: null, stored: null, tokens: null,
			model: null, provider: null,
			chapterCount: null,
		};
	}

	const ctx = await loadDocumentContext(caseId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	const response = await chat({
		system,
		cacheSystem: true,
		messages: [{ role: 'user', content: user }],
		// 5000: work output is single (synthese + auffaelligkeiten); the
		// synthese can run 10-18 sentences with substantial Pflichtbestandteile.
		maxTokens: opts.maxTokens ?? 5000,
		modelOverride: opts.modelOverride,
	});

	const json = extractJSON(response.text);
	let parsed: DocumentCollapseResult;
	try {
		parsed = DocumentCollapseResultSchema.parse(JSON.parse(json));
	} catch (err) {
		const dumpPath = `/tmp/document-collapse-failure-${caseRow.central_document_id}.txt`;
		const fs = await import('node:fs/promises');
		await fs.writeFile(
			dumpPath,
			`document_id: ${caseRow.central_document_id}\noutput_tokens: ${response.outputTokens}\n\n--- RAW RESPONSE ---\n${response.text}\n\n--- EXTRACTED JSON ---\n${json}\n`,
			'utf8'
		);
		console.error(`     dumped raw response to ${dumpPath}`);
		throw err;
	}
	const stored = await storeDocumentMemo(ctx, parsed, userId);

	return {
		skipped: false,
		existingMemoId: null,
		result: parsed,
		stored,
		tokens: {
			input: response.inputTokens,
			output: response.outputTokens,
			cacheCreation: response.cacheCreationTokens,
			cacheRead: response.cacheReadTokens,
			total: response.tokensUsed,
		},
		model: response.model,
		provider: response.provider,
		chapterCount: ctx.chapterMemos.length,
	};
}
