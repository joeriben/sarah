// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Subchapter-collapse pass — EXPERIMENTAL, graph-fed variant.
//
// Counterpart to section-collapse.ts but consumes ONLY the analytical
// line (argument_nodes + argument_edges + scaffolding_elements) — not the
// synthetic interpretierend memos. Tests question (c) of the
// argumentation-graph experiment: "Kann eine kontextualisierende
// Subkapitel-Synthese aus dem Graph mindestens so gut gespeist werden?"
//
// Output structure:
//   { synthese: string, auffaelligkeiten: [{ scope, observation }] }
//
// `synthese` is the argumentative arc of the subchapter — same brief as
// the existing collapse pass: 4–8 sentences in argumentative diction,
// not paragraph-by-paragraph recap.
//
// `auffaelligkeiten` fills a gap the user identified: per-paragraph
// (or per-argument) quality observations. Scaffolding elements have an
// `assessment` field, but arguments themselves are not evaluated.
// Argument-level evaluation is "eher eine Frage im Blick auf den gesamten
// Absatz" — exactly the scope of this synthesis pass. Intrinsically
// problematic individual arguments (logical fallacy, implausible premise,
// internal contradiction) can be flagged at §N:AM granularity.
//
// Storage: parallel to the synthetic collapse memo (label suffix `/graph`
// distinguishes them). The user can compare both side-by-side.

import { z } from 'zod';
import { query, queryOne, transaction } from '../../db/index.js';
import { chat } from '../client.js';

// ── Output schema ─────────────────────────────────────────────────

// scope is permissive: §N (paragraph), §N:AM (argument), §N:SM (scaffolding),
// or even a subkapitelweite Bemerkung as a free string. The downstream consumer
// is the user reading the report — strictness on this string would just lose
// observations.
const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const GraphCollapseResultSchema = z.object({
	synthese: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type GraphCollapseResult = z.infer<typeof GraphCollapseResultSchema>;

// ── Context ────────────────────────────────────────────────────────

interface CollapseContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	fullText: string;
	brief: { name: string; work_type: string; criteria: string; persona: string };
	mainHeadings: string[];
	mainHeadingCount: number;
	mainParagraphCount: number;

	subchapterHeadingId: string;
	subchapterLabel: string;
	subchapterStart: number;
	subchapterEnd: number;

	paragraphs: ParagraphGraph[];
	completedKontextualisierungen: { sectionLabel: string; content: string }[];
}

interface ParagraphGraph {
	paragraphId: string;
	positionInSubchapter: number;
	args: ArgumentSummary[];
	interEdges: { from: string; to: string; kind: string }[];
	priorEdges: { from: string; to: string; kind: string }[];      // to is "§N:AM"
	scaffolding: ScaffoldingSummary[];
}

interface ArgumentSummary {
	argLocalId: string;
	claim: string;
	premiseSummary: string;  // "stated:2 carried:1 background:1" etc.
}

interface ScaffoldingSummary {
	elementLocalId: string;
	functionType: string;
	functionDescription: string;
	assessment: string;
	anchored_to: string[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadCollapseContext(
	caseId: string,
	subchapterHeadingId: string
): Promise<CollapseContext> {
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

	const docRow = await queryOne<{ inscription: string; full_text: string }>(
		`SELECT n.inscription, dc.full_text
		 FROM namings n JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1`,
		[caseRow.central_document_id]
	);
	if (!docRow) throw new Error(`Central document not found`);

	const heading = await queryOne<{ char_start: number; char_end: number; section_kind: string | null }>(
		`SELECT char_start, char_end, section_kind FROM document_elements
		 WHERE id = $1 AND document_id = $2 AND element_type = 'heading'`,
		[subchapterHeadingId, caseRow.central_document_id]
	);
	if (!heading) throw new Error(`Subchapter heading not found: ${subchapterHeadingId}`);
	if (heading.section_kind !== 'main') {
		throw new Error(`Heading ${subchapterHeadingId} is in section_kind=${heading.section_kind}, not 'main'`);
	}

	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start ASC LIMIT 1`,
		[caseRow.central_document_id, heading.char_start]
	);
	const subchapterEnd = nextHeading?.char_start ?? docRow.full_text.length;

	const subPars = (
		await query<{ id: string; char_start: number; char_end: number }>(
			`SELECT id, char_start, char_end FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			   AND char_start >= $2 AND char_start < $3
			 ORDER BY char_start`,
			[caseRow.central_document_id, heading.char_start, subchapterEnd]
		)
	).rows;
	const paragraphPositionById = new Map<string, number>();
	subPars.forEach((p, i) => paragraphPositionById.set(p.id, i + 1));

	const paragraphs: ParagraphGraph[] = [];
	for (let i = 0; i < subPars.length; i++) {
		const p = subPars[i];

		const argRows = (await query<{
			id: string; arg_local_id: string; claim: string; premises: { type: string }[];
		}>(
			`SELECT id, arg_local_id, claim, premises FROM argument_nodes
			 WHERE paragraph_element_id = $1 ORDER BY position_in_paragraph`,
			[p.id]
		)).rows;
		const argIdToLocal = new Map(argRows.map(r => [r.id, r.arg_local_id]));

		const args: ArgumentSummary[] = argRows.map(r => {
			const counts: Record<string, number> = {};
			for (const pr of r.premises) counts[pr.type] = (counts[pr.type] ?? 0) + 1;
			const premiseSummary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ');
			return { argLocalId: r.arg_local_id, claim: r.claim, premiseSummary: premiseSummary || 'no premises' };
		});

		const edgeRows = (await query<{
			from_id: string; to_id: string; kind: string; scope: string;
		}>(
			`SELECT from_node_id AS from_id, to_node_id AS to_id, kind, scope
			 FROM argument_edges
			 WHERE from_node_id IN (SELECT id FROM argument_nodes WHERE paragraph_element_id = $1)`,
			[p.id]
		)).rows;

		const interEdges: { from: string; to: string; kind: string }[] = [];
		const priorEdges: { from: string; to: string; kind: string }[] = [];
		for (const e of edgeRows) {
			const fromLocal = argIdToLocal.get(e.from_id) ?? '?';
			if (e.scope === 'inter_argument') {
				interEdges.push({ from: fromLocal, to: argIdToLocal.get(e.to_id) ?? '?', kind: e.kind });
			} else {
				const t = await queryOne<{ arg_local_id: string; paragraph_element_id: string }>(
					`SELECT arg_local_id, paragraph_element_id FROM argument_nodes WHERE id = $1`,
					[e.to_id]
				);
				if (!t) continue;
				const targetPos = paragraphPositionById.get(t.paragraph_element_id);
				priorEdges.push({ from: fromLocal, to: `§${targetPos}:${t.arg_local_id}`, kind: e.kind });
			}
		}

		const scRows = (await query<{
			id: string; element_local_id: string; function_type: string;
			function_description: string; assessment: string;
		}>(
			`SELECT id, element_local_id, function_type, function_description, assessment
			 FROM scaffolding_elements WHERE paragraph_element_id = $1
			 ORDER BY position_in_paragraph`,
			[p.id]
		)).rows;

		const scaffolding: ScaffoldingSummary[] = await Promise.all(scRows.map(async sc => {
			const anchorRows = (await query<{ argument_id: string }>(
				`SELECT argument_id FROM scaffolding_anchors WHERE scaffolding_id = $1`,
				[sc.id]
			)).rows;
			const anchored_to: string[] = [];
			for (const a of anchorRows) {
				const t = await queryOne<{ arg_local_id: string; paragraph_element_id: string }>(
					`SELECT arg_local_id, paragraph_element_id FROM argument_nodes WHERE id = $1`,
					[a.argument_id]
				);
				if (!t) continue;
				if (t.paragraph_element_id === p.id) {
					anchored_to.push(t.arg_local_id);
				} else {
					const pos = paragraphPositionById.get(t.paragraph_element_id);
					anchored_to.push(`§${pos}:${t.arg_local_id}`);
				}
			}
			return {
				elementLocalId: sc.element_local_id,
				functionType: sc.function_type,
				functionDescription: sc.function_description,
				assessment: sc.assessment,
				anchored_to,
			};
		}));

		paragraphs.push({
			paragraphId: p.id,
			positionInSubchapter: i + 1,
			args,
			interEdges,
			priorEdges,
			scaffolding,
		});
	}

	const completedKontextualisierungen = (
		await query<{ section_label: string; content: string }>(
			`SELECT
			   substring($1::text FROM de.char_start+1 FOR de.char_end-de.char_start) AS section_label,
			   mc.content
			 FROM memo_content mc
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE mc.memo_type = 'kontextualisierend'
			   AND mc.scope_level = 'subchapter'
			   AND de.document_id = $2
			   AND de.char_start < $3
			 ORDER BY de.char_start`,
			[docRow.full_text, caseRow.central_document_id, heading.char_start]
		)
	).rows;

	const headingRows = await query<{ char_start: number; char_end: number }>(
		`SELECT char_start, char_end FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		 ORDER BY char_start`,
		[caseRow.central_document_id]
	);
	const mainHeadings = headingRows.rows.map(r =>
		docRow.full_text.substring(r.char_start, r.char_end).trim().slice(0, 100)
	);

	const counts = await queryOne<{ paragraphs: string; headings: string }>(
		`SELECT
		   COUNT(*) FILTER (WHERE element_type = 'paragraph') AS paragraphs,
		   COUNT(*) FILTER (WHERE element_type = 'heading')   AS headings
		 FROM document_elements
		 WHERE document_id = $1 AND section_kind = 'main'`,
		[caseRow.central_document_id]
	);

	return {
		caseId,
		projectId: caseRow.project_id,
		centralDocumentId: caseRow.central_document_id,
		documentTitle: docRow.inscription,
		fullText: docRow.full_text,
		brief: {
			name: caseRow.brief_name,
			work_type: caseRow.work_type,
			criteria: caseRow.criteria,
			persona: caseRow.persona,
		},
		mainHeadings,
		mainHeadingCount: parseInt(counts?.headings ?? '0', 10),
		mainParagraphCount: parseInt(counts?.paragraphs ?? '0', 10),
		subchapterHeadingId,
		subchapterLabel: docRow.full_text.substring(heading.char_start, heading.char_end).trim(),
		subchapterStart: heading.char_start,
		subchapterEnd,
		paragraphs,
		completedKontextualisierungen: completedKontextualisierungen.map(r => ({
			sectionLabel: r.section_label.trim(),
			content: r.content,
		})),
	};
}

// ── Prompt assembly ───────────────────────────────────────────────

function buildSystemPrompt(ctx: CollapseContext): string {
	const outlineLines = ctx.mainHeadings
		.map(h => h === ctx.subchapterLabel ? `- ${h}           ← AKTUELL HIER (Synthese-Pass aus Graph)` : `- ${h}`)
		.join('\n');

	const completed = ctx.completedKontextualisierungen.length === 0
		? '(Noch keine Sektionen abgeschlossen.)'
		: ctx.completedKontextualisierungen
			.map(k => `## "${k.sectionLabel}"\n${k.content}`)
			.join('\n\n');

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — SYNTHESE AUS DEM ARGUMENTATIONS-GRAPH]
Du synthetisierst das **kontextualisierende Memo** für ein Subkapitel — aber dieser Pass läuft auf der ANALYTISCHEN Linie: dein Input ist die strukturierte Argumentations-Daten (Argumente, Premissen, Edges, Stützstrukturen), NICHT eine Kette synthetisch-hermeneutischer Memos. Du musst die argumentative Bewegungsfigur des Subkapitels aus dem Graph rekonstruieren.

Aufgabe in zwei Teilen:

1. **Synthese** (4–8 Sätze, in argumentativer Diktion): Was leistet dieses Subkapitel als argumentative Bewegung? Welche Position wurde bezogen, welche argumentative Architektur entfaltet, welche Voraussetzung für nachfolgende Subkapitel geschaffen, welche Spannungen oder offenen Punkte hinterlassen? **Nicht** Absatz-für-Absatz nacherzählen, sondern die *Bewegung* konstruieren. Cross-Absatz-Edges (prior_paragraph) und wiederkehrende Stützfunktionen sind die Hinweise auf die argumentative Architektur.

2. **Auffälligkeiten** (Liste, kann leer sein): per-Absatz oder per-Argument Beobachtungen zur argumentativen Qualität, die in der Synthese nicht hineingehören, aber für die Begutachtung wichtig sind. Beispiele:
   - "§3:A1 stützt sich primär auf eine background-Premisse zur longue durée — die Geltung des claims hängt an einer kontroversen Hintergrundannahme, die im Text nicht expliziert wird."
   - "§5 hat 4 Stützstrukturen aber nur 2 Argumente — die analytische Substanz ist gegenüber Beleg- und Veranschaulichungsmaterial knapp gehalten."
   - "Intrinsisch unplausibel/logisch problematisch ist nichts in dieser Sektion."

   Halte dich an Auffälligkeiten, die aus der Datenstruktur erkennbar sind (Premisse-Mix, Edge-Topologie, Scaffolding-Assessments). Unterlasse stilistische oder rhetorische Bewertungen — die gehören nicht zur argumentationslogischen Lektüre.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Umfang Hauptteil: ${ctx.mainHeadingCount} Hauptkapitel-Überschriften, ${ctx.mainParagraphCount} Hauptabsätze.

Outline (Hauptüberschriften, sequentiell):
${outlineLines}

[BISHERIGE KONTEXTUALISIERENDE MEMOS abgeschlossener Subkapitel]
${completed}

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst (kein Vor-/Nachtext, kein Markdown-Codefence):

{
  "synthese": "<4–8 Sätze, argumentative Diktion (welche Position, welche Bewegung, welche Spannung), keine Inhalts-Diktion (was steht da)>",
  "auffaelligkeiten": [
    { "scope": "§<Position>" | "§<Position>:A<ID>", "observation": "<Eine Beobachtung zur argumentativen Qualität dieses Absatzes/Arguments>" }
  ]
}

auffaelligkeiten kann leeres Array sein, wenn nichts qualitätsmäßig hervorzuheben ist. Schreibe keine Allerwelts-Beobachtungen — nur, was bei Begutachtung wirklich relevant wäre.`;
}

function buildUserMessage(ctx: CollapseContext): string {
	// Filter out paragraphs with no graph data at all. Schema cannot distinguish
	// "processed and found non-argumentative" from "not processed yet"; sending
	// them as empty entries causes the LLM to mistake "missing data" for
	// "missing substance". For a partially-processed subchapter (e.g. only the
	// first few paragraphs run), this preserves accuracy.
	const populated = ctx.paragraphs.filter(p => p.args.length > 0 || p.scaffolding.length > 0);
	const skipped = ctx.paragraphs.length - populated.length;

	const block = populated.map(p => {
		const argLines = p.args.length === 0
			? '  (keine Argumente)'
			: p.args.map(a => `  ${a.argLocalId} [${a.premiseSummary}]: ${a.claim}`).join('\n');

		const interLines = p.interEdges.length === 0
			? ''
			: '\n  Intra-Edges:\n' + p.interEdges.map(e => `    ${e.from} --${e.kind}--> ${e.to}`).join('\n');

		const priorLines = p.priorEdges.length === 0
			? ''
			: '\n  Cross-Edges (rückwärts):\n' + p.priorEdges.map(e => `    ${e.from} --${e.kind}--> ${e.to}`).join('\n');

		const scLines = p.scaffolding.length === 0
			? ''
			: '\n  Stützstrukturen (Layer 2):\n' + p.scaffolding.map(s =>
				`    ${s.elementLocalId} [${s.functionType}] → ${s.anchored_to.join(', ')}\n` +
				`      Funktion: ${s.functionDescription}\n` +
				`      Assessment: ${s.assessment}`
			).join('\n');

		return `## §${p.positionInSubchapter}\n${argLines}${interLines}${priorLines}${scLines}`;
	}).join('\n\n');

	const noteOnSkipped = skipped > 0
		? `\n\nHinweis: ${skipped} der ${ctx.paragraphs.length} Absätze des Subkapitels haben (noch) keine Graph-Daten und sind aus diesem Input ausgespart. Synthetisiere ausschließlich auf Basis der unten dargestellten Absätze; mache keine Aussagen über die ausgesparten Absätze.`
		: '';

	return `Subkapitel: "${ctx.subchapterLabel}"
Verfügbare Absätze mit Graph-Daten: ${populated.length} von insgesamt ${ctx.paragraphs.length}.${noteOnSkipped}

[ARGUMENTATIONS-GRAPH DES SUBKAPITELS]

${block}

Synthetisiere jetzt das kontextualisierende Memo (Synthese + Auffälligkeiten) ausschließlich aus dieser Graph-Struktur.`;
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

async function storeGraphCollapseMemo(
	ctx: CollapseContext,
	result: GraphCollapseResult,
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

		// Distinguish from the synthetic collapse memo via the inscription label.
		// Both can coexist on the same scope_element_id — there's no UNIQUE
		// constraint on memo_content scope/type/level.
		const label = `[kontextualisierend/subchapter/graph] ${ctx.subchapterLabel}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[memoId, perspective.id, JSON.stringify({ source: 'argumentation_graph', auffaelligkeiten: result.auffaelligkeiten })]
		);

		// memo_content stores the synthese text. The auffaelligkeiten list is
		// preserved on the appearances.properties for inspection without
		// changing the memo_content schema.
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

export interface GraphCollapseRun {
	result: GraphCollapseResult;
	stored: { memoId: string };
	tokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		total: number;
	};
	model: string;
	provider: string;
	paragraphsSynthesized: number;
	totalArguments: number;
	totalScaffolding: number;
}

export async function runGraphCollapse(
	caseId: string,
	subchapterHeadingId: string,
	userId: string
): Promise<GraphCollapseRun> {
	const ctx = await loadCollapseContext(caseId, subchapterHeadingId);

	if (ctx.paragraphs.length === 0) {
		throw new Error(`No paragraphs in subchapter "${ctx.subchapterLabel}"`);
	}
	const totalArguments = ctx.paragraphs.reduce((s, p) => s + p.args.length, 0);
	const totalScaffolding = ctx.paragraphs.reduce((s, p) => s + p.scaffolding.length, 0);
	if (totalArguments === 0 && totalScaffolding === 0) {
		throw new Error(
			`Subkapitel "${ctx.subchapterLabel}" has no graph data (run runArgumentationGraphPass on its paragraphs first)`
		);
	}

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	const response = await chat({
		system,
		cacheSystem: true,
		messages: [{ role: 'user', content: user }],
		maxTokens: 2000,
	});

	const json = extractJSON(response.text);
	const parsed = GraphCollapseResultSchema.parse(JSON.parse(json));
	const stored = await storeGraphCollapseMemo(ctx, parsed, userId);

	return {
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
		paragraphsSynthesized: ctx.paragraphs.length,
		totalArguments,
		totalScaffolding,
	};
}
