// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Chapter-collapse pass — Direction 4, level L1.
//
// Synthesizes a Hauptkapitel-level memo from one of two input sources,
// chosen per chapter via the aggregation_subchapter_level column on
// heading_classifications:
//
//   - Level 1 (flat chapter, e.g. typical Methodenkapitel/Einleitung):
//     Input is the chapter's paragraphs with their argumentation-graph
//     data — no nested subchapter-collapses ran.
//
//   - Level 2 or 3 (deeper-structured chapter): Input is the leaf-
//     subchapter-memos at the chosen level within this chapter. For
//     Level 3, the L2-numbering grouping is included as structural
//     metadata in the prompt so the LLM can attend to the L2-architecture
//     without an intermediate synthesis pass (decision 2026-04-30: tuning
//     question, start without intermediate, add later if validation shows
//     the L2 architecture gets lost).
//
// Output schema (dual-purpose):
//   {
//     synthese:                analytische Synthese (vier Pflichtbestandteile),
//     argumentationswiedergabe: gutachten-fertige Wiedergabe des Kapitels
//                              (expositorisch, third-person, neutral),
//     auffaelligkeiten:        per-Memo / per-Argument Beobachtungen
//   }
//
// The dual output addresses the user's pain point of having to read,
// analyze, evaluate, AND THEN re-write for the Prüfungsamt — the
// argumentationswiedergabe is meant for direct or near-direct reuse in
// the Gutachten.
//
// Storage: tag '[kontextualisierend/chapter/graph]', scope_level='chapter'.
// Idempotent: skips if a chapter-graph memo for this L1-heading exists.
// To re-run, DELETE the namings row by id (cascades to memo_content +
// appearances).

import { z } from 'zod';
import type { Provider } from '../client.js';
import { query, queryOne, transaction } from '../../db/index.js';
import { runJsonCallWithRepair, RepairCallExhaustedError } from '../json-extract.js';
import {
	loadChapterUnits,
	chooseSubchapterLevel,
	getPersistedSubchapterLevel,
	persistSubchapterLevel,
	type ChapterUnit,
	type ResolvedHeading,
} from './heading-hierarchy.js';
import { extractFallacy, formatFallacyLine, FALLACY_AWARENESS_REGEL } from './validity-helpers.js';

// ── Output schema ─────────────────────────────────────────────────

const AuffaelligkeitSchema = z.object({
	scope: z.string().min(1),
	observation: z.string().min(1),
});

const ChapterCollapseResultSchema = z.object({
	synthese: z.string().min(1),
	argumentationswiedergabe: z.string().min(1),
	auffaelligkeiten: z.array(AuffaelligkeitSchema).default([]),
});

export type ChapterCollapseResult = z.infer<typeof ChapterCollapseResultSchema>;

// ── Context ────────────────────────────────────────────────────────

interface BriefMeta {
	name: string;
	work_type: string;
	criteria: string;
	persona: string;
	validityCheck: boolean;
}

interface SubchapterMemoInput {
	headingId: string;
	numbering: string | null;  // for L2-grouping in L3-mode
	level: number;
	label: string;             // heading text
	memoText: string;          // synthese from the subchapter-memo
	auffaelligkeiten: { scope: string; observation: string }[]; // from properties
}

interface ChapterContext {
	caseId: string;
	projectId: string;
	centralDocumentId: string;
	documentTitle: string;
	brief: BriefMeta;

	chapter: ChapterUnit;
	chapterPosition: number;       // 1-based among L1 chapters
	totalChapters: number;
	chapterLabelOutline: string[]; // label per L1 in order, with marker for current
	aggregationLevel: 1 | 2 | 3;

	// Mode-specific: exactly one of these is populated.
	mode: 'paragraphs' | 'subchapter-memos';

	// Mode 'paragraphs': graph data per paragraph (Level 1).
	paragraphGraphs: ParagraphGraph[] | null;

	// Mode 'subchapter-memos': memos at the chosen aggregation level.
	subchapterMemos: SubchapterMemoInput[] | null;

	// Preceding chapter-memos (for Werk-Architektur-Verortung). Empty array
	// if this is the first chapter.
	precedingChapterMemos: { label: string; synthese: string }[];
}

// Reused from section-collapse-from-graph but trimmed; we recompute here
// rather than import to keep the pass self-contained.
interface ParagraphGraph {
	paragraphId: string;
	positionInChapter: number;
	enclosingSubchapterLabel: string | null; // L2/L3 numbering+title context
	args: {
		argLocalId: string;
		claim: string;
		premiseSummary: string;
		fallacy?: { type: string; targetPremise: string; explanation: string };
	}[];
	interEdges: { from: string; to: string; kind: string }[];
	priorEdges: { from: string; to: string; kind: string }[];
	scaffolding: {
		elementLocalId: string;
		functionType: string;
		functionDescription: string;
		assessment: string;
		anchored_to: string[];
	}[];
}

// ── Loader ────────────────────────────────────────────────────────

async function loadChapterContext(
	caseId: string,
	l1HeadingId: string
): Promise<ChapterContext> {
	const caseRow = await queryOne<{
		project_id: string;
		central_document_id: string;
		brief_name: string;
		work_type: string;
		criteria: string;
		persona: string;
		argumentation_graph: boolean;
		validity_check: boolean;
	}>(
		`SELECT c.project_id, c.central_document_id,
		        b.name AS brief_name, b.work_type, b.criteria, b.persona,
		        b.argumentation_graph, b.validity_check
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
	const chapterIdx = chapters.findIndex(c => c.l1.headingId === l1HeadingId);
	if (chapterIdx === -1) {
		throw new Error(
			`L1 heading ${l1HeadingId} not found in resolved chapter outline of document ` +
			`${caseRow.central_document_id} (must be confirmed-outline + level=1 + non-excluded)`
		);
	}
	const chapter = chapters[chapterIdx];

	// All paragraphs of the document (needed for median calc + paragraph load).
	const allParagraphs = (await query<{ id: string; charStart: number }>(
		`SELECT id, char_start AS "charStart" FROM document_elements
		 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
		 ORDER BY char_start`,
		[caseRow.central_document_id]
	)).rows;

	// Resolve aggregation level: read persisted, else compute + persist.
	let level = await getPersistedSubchapterLevel(l1HeadingId);
	if (level === null) {
		level = chooseSubchapterLevel(chapter, allParagraphs);
		await persistSubchapterLevel(l1HeadingId, caseRow.central_document_id, level as 1 | 2 | 3);
	}
	const aggregationLevel = level as 1 | 2 | 3;

	// Outline display for the prompt (chapter labels with marker).
	const chapterLabelOutline = chapters.map((c, i) =>
		i === chapterIdx
			? `- ${c.l1.numbering ?? '?'} ${c.l1.text}           ← AKTUELL HIER (Hauptkapitel-Synthese)`
			: `- ${c.l1.numbering ?? '?'} ${c.l1.text}`
	);

	// Preceding chapter memos for Werk-Architektur-Verortung.
	const precedingHeadingIds = chapters.slice(0, chapterIdx).map(c => c.l1.headingId);
	const precedingChapterMemos = precedingHeadingIds.length === 0
		? []
		: (await query<{ label: string; content: string }>(
			`SELECT n.inscription AS label, mc.content
			 FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE mc.scope_element_id = ANY($1::uuid[])
			   AND mc.scope_level = 'chapter'
			   AND n.inscription LIKE '[kontextualisierend/chapter/graph]%'
			   AND n.deleted_at IS NULL
			 ORDER BY n.created_at`,
			[precedingHeadingIds]
		)).rows.map(r => ({
			label: r.label.replace(/^\[kontextualisierend\/chapter\/graph\]\s*/, '').trim(),
			synthese: r.content,
		}));

	let mode: ChapterContext['mode'];
	let paragraphGraphs: ParagraphGraph[] | null = null;
	let subchapterMemos: SubchapterMemoInput[] | null = null;

	if (aggregationLevel === 1) {
		mode = 'paragraphs';
		paragraphGraphs = await loadParagraphGraphsForChapter(chapter);
	} else {
		mode = 'subchapter-memos';
		subchapterMemos = await loadSubchapterMemosAtLevel(chapter, aggregationLevel);
		if (subchapterMemos.length === 0) {
			throw new Error(
				`Chapter "${chapter.l1.text}" has aggregation_subchapter_level=${aggregationLevel} ` +
				`but no subchapter-graph memos exist at that level. Run runGraphCollapse on the L${aggregationLevel} subchapters first.`
			);
		}
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
			validityCheck: caseRow.validity_check === true,
		},
		chapter,
		chapterPosition: chapterIdx + 1,
		totalChapters: chapters.length,
		chapterLabelOutline,
		aggregationLevel,
		mode,
		paragraphGraphs,
		subchapterMemos,
		precedingChapterMemos,
	};
}

async function loadParagraphGraphsForChapter(chapter: ChapterUnit): Promise<ParagraphGraph[]> {
	if (chapter.paragraphIds.length === 0) {
		throw new Error(`Chapter "${chapter.l1.text}" has no paragraphs`);
	}

	// Build position map and locate enclosing sub-heading (L2/L3) for each
	// paragraph, so the prompt can carry that as context.
	const positionByPid = new Map<string, number>();
	chapter.paragraphIds.forEach((id, i) => positionByPid.set(id, i + 1));

	const subHeadings = chapter.innerHeadings.filter(h => h.level >= 2);

	const paragraphRows = (await query<{ id: string; char_start: number }>(
		`SELECT id, char_start FROM document_elements
		 WHERE id = ANY($1::uuid[])
		 ORDER BY char_start`,
		[chapter.paragraphIds]
	)).rows;

	const enclosingByPid = new Map<string, string | null>();
	for (const p of paragraphRows) {
		// find deepest subHeading whose char_start <= p.char_start AND whose
		// own end (next sub-heading at same/higher level OR chapter end) > p
		let enclosing: ResolvedHeading | null = null;
		for (const h of subHeadings) {
			if (h.charStart > p.char_start) break;
			const nextSibling = subHeadings.find(
				h2 => h2.charStart > h.charStart && h2.level <= h.level
			);
			const endChar = nextSibling ? nextSibling.charStart : chapter.endChar;
			if (p.char_start < endChar) enclosing = h;
		}
		enclosingByPid.set(
			p.id,
			enclosing ? `${enclosing.numbering ?? '?'} ${enclosing.text}` : null
		);
	}

	const result: ParagraphGraph[] = [];
	for (const p of paragraphRows) {
		const argRows = (await query<{
			id: string; arg_local_id: string; claim: string; premises: { type: string }[];
			validity_assessment: unknown;
		}>(
			`SELECT id, arg_local_id, claim, premises, validity_assessment FROM argument_nodes
			 WHERE paragraph_element_id = $1 ORDER BY position_in_paragraph`,
			[p.id]
		)).rows;
		const argIdToLocal = new Map(argRows.map(r => [r.id, r.arg_local_id]));

		const args = argRows.map(r => {
			const counts: Record<string, number> = {};
			for (const pr of r.premises) counts[pr.type] = (counts[pr.type] ?? 0) + 1;
			const premiseSummary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ');
			const fallacy = extractFallacy(r.validity_assessment);
			const out: { argLocalId: string; claim: string; premiseSummary: string; fallacy?: { type: string; targetPremise: string; explanation: string } } = {
				argLocalId: r.arg_local_id,
				claim: r.claim,
				premiseSummary: premiseSummary || 'no premises',
			};
			if (fallacy) out.fallacy = fallacy;
			return out;
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
				const targetPos = positionByPid.get(t.paragraph_element_id);
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

		const scaffolding = await Promise.all(scRows.map(async sc => {
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
					anchored_to.push(`§${positionByPid.get(t.paragraph_element_id)}:${t.arg_local_id}`);
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

		result.push({
			paragraphId: p.id,
			positionInChapter: positionByPid.get(p.id)!,
			enclosingSubchapterLabel: enclosingByPid.get(p.id) ?? null,
			args,
			interEdges,
			priorEdges,
			scaffolding,
		});
	}
	return result;
}

async function loadSubchapterMemosAtLevel(
	chapter: ChapterUnit,
	level: 2 | 3
): Promise<SubchapterMemoInput[]> {
	const headingsAtLevel = chapter.innerHeadings.filter(h => h.level === level);
	if (headingsAtLevel.length === 0) return [];

	const ids = headingsAtLevel.map(h => h.headingId);
	const memoRows = (await query<{
		heading_id: string;
		content: string;
		properties: { auffaelligkeiten?: { scope: string; observation: string }[] } | null;
	}>(
		`SELECT mc.scope_element_id AS heading_id, mc.content, a.properties
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE mc.scope_element_id = ANY($1::uuid[])
		   AND mc.scope_level = 'subchapter'
		   AND n.inscription LIKE '[kontextualisierend/subchapter/graph]%'
		   AND n.deleted_at IS NULL`,
		[ids]
	)).rows;

	const memoByHeading = new Map<string, typeof memoRows[number]>();
	for (const m of memoRows) memoByHeading.set(m.heading_id, m);

	const result: SubchapterMemoInput[] = [];
	for (const h of headingsAtLevel) {
		const memo = memoByHeading.get(h.headingId);
		if (!memo) continue;  // partial-coverage tolerated; chapter-load decides minimum
		result.push({
			headingId: h.headingId,
			numbering: h.numbering,
			level: h.level,
			label: h.text,
			memoText: memo.content,
			auffaelligkeiten: memo.properties?.auffaelligkeiten ?? [],
		});
	}
	return result;
}

// ── Prompt assembly ───────────────────────────────────────────────
//
// Vier Pflichtbestandteile auf Hauptkapitel-Ebene:
//   (a) Argumentative Bewegung
//   (b) Kernbewegung-Identifikation
//   (c) Werk-Architektur-Verortung
//   (d) Tragweite und Tragfähigkeit
//
// (d) ersetzt die ursprüngliche "Integrative Spannungsdiagnose" (als
// Slop diagnostiziert: Pseudo-Vokabular ohne methodologische Pedigree,
// Selektions-Bias durch Pflicht-Frageform nach Schwächen). Tragweite/
// Tragfähigkeit ist eine echte evaluative Dimension (claim/warrant-
// Proportionalität, Toulmin-nahe) mit opt-out-Klausel direkt im
// Pflichtbestandteil ("wenn Anspruch und Stützung gleich proportioniert
// sind, das ebenso klar diagnostizieren").
//
// Jeder Pflichtbestandteil hat eine explizite opt-out-Klausel, um
// Hallzinations-Druck strukturell abzufangen.
//
// Argumentationswiedergabe ist der einzige intentional NEUE Bestandteil
// auf Hauptkapitel-Ebene (User-Anforderung 2026-04-30: Gutachten-Vorlage,
// um doppeltes Lesen+Aufschreiben fürs Prüfungsamt zu ersparen).
//
// Die Datenstruktur-Hinweise innerhalb der Pflichtbestandteile sind
// mode-conditional, weil L1 (Absatz-Graph) und L2/L3 (Subkapitel-Memos)
// verschiedene strukturelle Spuren tragen.

function buildSystemPrompt(ctx: ChapterContext): string {
	const outlineLines = ctx.chapterLabelOutline.join('\n');
	const preceding = ctx.precedingChapterMemos.length === 0
		? '(Dies ist das erste Hauptkapitel — keine vorausgegangenen Hauptkapitel-Synthesen.)'
		: ctx.precedingChapterMemos
			.map(m => `## ${m.label}\n${m.synthese}`)
			.join('\n\n');

	const inputDescription = ctx.mode === 'paragraphs'
		? `Dein Input für diesen Pass sind die **Argumentations-Graph-Daten der Absätze** dieses Hauptkapitels (Argumente, Premissen, Edges, Stützstrukturen) — das Kapitel ist flach gegliedert und es gibt keine vorgeschalteten Subkapitel-Synthesen. Du synthetisierst direkt aus der Absatz-Ebene auf Hauptkapitel-Ebene.`
		: ctx.aggregationLevel === 2
			? `Dein Input für diesen Pass sind die **Subkapitel-Memos** der L2-Untergliederungen dieses Hauptkapitels — vorgeschaltete Synthese-Pässe haben pro L2-Subkapitel bereits ein Memo erzeugt (Synthese + Auffälligkeiten). Du fasst diese zu einer Hauptkapitel-Synthese zusammen.`
			: `Dein Input für diesen Pass sind die **Subkapitel-Memos der L3-Subkapitel** dieses Hauptkapitels (vorgeschaltete Synthese-Pässe haben pro L3-Subkapitel bereits ein Memo erzeugt). Die L2-Mittelgliederung wird **nicht** durch eigene Memos repräsentiert, sondern durch die Numerierung der L3-Subkapitel: Subkapitel mit gemeinsamem L2-Präfix (z.B. "1.2.1", "1.2.2", "1.2.3" gehören zu L2 "1.2") gruppieren sich. Achte auf diese Gliederung als Architektur-Hinweis, ohne sie als eigene Synthese-Ebene zu behandeln.`;

	return `[PERSONA]
${ctx.brief.persona}

[KONTEXT DIESES PASSES — HAUPTKAPITEL-SYNTHESE]
Du synthetisierst das **kontextualisierende Memo eines Hauptkapitels** auf der analytischen Linie.

${inputDescription}

Aufgabe in drei Teilen:

1. **Synthese** (6–10 Sätze, in argumentativer Diktion). Vier *Pflichtbestandteile* — fehlt einer, ist die Synthese unvollständig:

   a. **Argumentative Bewegung** — welche Position wurde im Hauptkapitel insgesamt bezogen, welche argumentative Architektur entfaltet das Kapitel über seine Subkapitel hinweg? ${ctx.mode === 'paragraphs'
		? 'Cross-Absatz-Edges (prior_paragraph) und wiederkehrende Stützfunktionen sind die Hinweise auf die Architektur.'
		: 'Wiederaufnahmen, Bezugnahmen und durchlaufende Argumentationsfäden über die Subkapitel-Memos hinweg sind die Hinweise auf die Architektur.'}

   b. **Kernbewegung-Identifikation** — falls das Kapitel eine identifizierbare Kernbewegung trägt (oft ein Übergang von Phänomenbeschreibung zu normativ-handlungsorientierter Diagnose, oder von Theorieübernahme zu Eigenleistung), benenne sie explizit. Wenn das Kapitel keine identifizierbare Kernbewegung hat, sondern parallel-additiv mehrere Subkapitel nebeneinander stellt: das ebenso klar diagnostizieren statt eine Bewegung zu konstruieren. ${ctx.mode === 'paragraphs'
		? 'Hinweis: Argumente, auf die später viele cross-paragraph-Edges zeigen oder die viele scaffolding-Elemente aus späteren Absätzen anziehen, sind strukturell besonders tragend.'
		: 'Hinweis: ein Subkapitel, dessen Synthese in den nachfolgenden Subkapitel-Memos häufig wiederaufgegriffen wird oder das eine deutliche Wende markiert, ist strukturell besonders tragend.'}

   c. **Werk-Architektur-Verortung** — welches Hauptkapitel steht *davor* (siehe Outline + bisherige Hauptkapitel-Memos oben), welches *danach*? Welche strukturelle Brückenfunktion erfüllt dieses Hauptkapitel zwischen den beiden — was nimmt es vom Vorgänger auf, was bereitet es für den Nachfolger vor? Beim ersten oder letzten Hauptkapitel entfällt die jeweilige Bezugsrichtung. Wenn keine Brückenfunktion erkennbar ist (das Kapitel steht thematisch isoliert), das ebenso diagnostizieren statt eine Brücke zu konstruieren.

   d. **Tragweite und Tragfähigkeit** — beurteile (i) die argumentative Tragweite des Hauptkapitels: welcher Anspruch wird im Werk-Ganzen geltend gemacht — bescheiden, weitreichend, feldweit? — und (ii) die Tragfähigkeit der Stützung über die Subkapitel hinweg: tragen die Subkapitel zusammen den Kapitel-Anspruch, oder ist die Stützung unter- oder überdimensioniert? Wenn Anspruch und Stützung gleich proportioniert sind, das ebenso klar diagnostizieren.

   **Diktion:** evaluativ-argumentativ ("die Kernbewegung des Hauptkapitels ist X", "das Kapitel verfehlt eine eigenständige Prüfung von Y"). NICHT inhaltlich-darstellend ("im Kapitel wird Y gesagt") — Letzteres gehört in die Argumentationswiedergabe. Wenn ein Pflichtbestandteil substantiell nicht zutrifft (siehe opt-out-Klauseln), das diagnostizieren statt zu fabrizieren.

2. **Argumentationswiedergabe** (1–3 Absätze, expositorische Diktion). Eine **gutachten-fertige Reproduktion** dessen, was das Kapitel inhaltlich behauptet und entfaltet — geeignet zur direkten oder leicht editierten Übernahme in einen Gutachten-Text ans Prüfungsamt.

   **Diktion:** sachlich-darstellend, third-person über das Werk ("Das Kapitel entfaltet die These, dass… Dazu wird zunächst… anschließend… abschließend…"). KEINE Bewertung, KEINE Spannungsdiagnose, KEIN argumentations-analytisches Vokabular ("Kernbewegung", "Pflichtbestandteil"). Reine Wiedergabe in einer Form, die ein:e Gutachter:in unverändert oder mit minimalen Anpassungen ins eigene Gutachten übernehmen würde.

   Diese Wiedergabe darf länger sein als die Synthese — sie soll vollständig genug sein, dass ein Lese:in, der das Hauptkapitel nicht selbst gelesen hat, weiß, was inhaltlich darin behauptet und in welcher Reihenfolge es entfaltet wird.

3. **Auffälligkeiten** (Liste, kann leer sein): Beobachtungen zur argumentativen Qualität auf Kapitel-Ebene, die in Synthese und Wiedergabe nicht hineingehören, aber für die Begutachtung relevant sind. Beispiele: "Das L2-Subkapitel 1.2 (Globalitäts-Theorie) wird im Folge-L2 1.3 nirgends explizit angeschlossen — eine theorie-praxis-Brücke, die als implizit vorausgesetzt wird, aber nirgends expliziert wird." Halte dich an Auffälligkeiten, die aus der Subkapitel-Memo-Struktur (oder bei Mode 'paragraphs': aus den Graph-Daten) erkennbar sind.

[KRITERIEN ALS LESEFOLIE]
${ctx.brief.criteria}

[WERK]
Titel: ${ctx.documentTitle}
Werktyp: ${ctx.brief.work_type}
Position dieses Hauptkapitels: ${ctx.chapterPosition} von ${ctx.totalChapters}.

Outline (Hauptkapitel, sequentiell):
${outlineLines}

[BISHERIGE HAUPTKAPITEL-MEMOS (vorausgegangene Hauptkapitel)]
${preceding}

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst (kein Vor-/Nachtext, kein Markdown-Codefence):

{
  "synthese": "<6–10 Sätze, argumentative Diktion, vier Pflichtbestandteile>",
  "argumentationswiedergabe": "<1–3 Absätze, expositorisch, neutral, gutachten-fertig>",
  "auffaelligkeiten": [
    { "scope": "<L2-Numerierung oder L3-Subkapitel-Numerierung oder §<Position> bei Mode 'paragraphs'>", "observation": "<Eine Beobachtung zur argumentativen Qualität dieser Einheit>" }
  ]
}

auffaelligkeiten kann leeres Array sein, wenn nichts qualitätsmäßig hervorzuheben ist.${ctx.brief.validityCheck && ctx.mode === 'paragraphs' ? FALLACY_AWARENESS_REGEL : ''}`;
}

function buildUserMessage(ctx: ChapterContext): string {
	if (ctx.mode === 'subchapter-memos') {
		const memos = ctx.subchapterMemos!;
		// For Level 3: group by L2 prefix from numbering; show as structural
		// metadata so the LLM can attend to the L2-architecture without an
		// intermediate synthesis pass.
		let block: string;
		if (ctx.aggregationLevel === 3) {
			const byL2 = new Map<string, typeof memos>();
			for (const m of memos) {
				const l2Key = m.numbering
					? m.numbering.split('.').slice(0, 2).join('.')
					: '(ohne Numerierung)';
				const arr = byL2.get(l2Key) ?? [];
				arr.push(m);
				byL2.set(l2Key, arr);
			}
			const groups: string[] = [];
			for (const [l2Key, l2Memos] of byL2) {
				groups.push(`### L2-Gruppe ${l2Key}\n` +
					l2Memos.map(m => formatSubchapterMemoBlock(m)).join('\n\n'));
			}
			block = groups.join('\n\n');
		} else {
			block = memos.map(m => formatSubchapterMemoBlock(m)).join('\n\n');
		}
		return `Hauptkapitel: "${ctx.chapter.l1.numbering ?? '?'} ${ctx.chapter.l1.text}"
Aggregations-Ebene: L${ctx.aggregationLevel} (${memos.length} Subkapitel-Memos als Input)

[SUBKAPITEL-MEMOS (Input für die Hauptkapitel-Synthese)]

${block}

Synthetisiere jetzt das kontextualisierende Hauptkapitel-Memo (Synthese + Argumentationswiedergabe + Auffälligkeiten) ausschließlich aus diesen Subkapitel-Memos.`;
	}

	// Mode 'paragraphs' — flat chapter, direct synthesis from graph data.
	const populated = ctx.paragraphGraphs!.filter(p => p.args.length > 0 || p.scaffolding.length > 0);
	const skipped = ctx.paragraphGraphs!.length - populated.length;
	const block = populated.map(p => formatParagraphGraphBlock(p)).join('\n\n');
	const noteOnSkipped = skipped > 0
		? `\n\nHinweis: ${skipped} der ${ctx.paragraphGraphs!.length} Absätze des Hauptkapitels haben (noch) keine Graph-Daten und sind aus diesem Input ausgespart. Synthetisiere ausschließlich auf Basis der unten dargestellten Absätze.`
		: '';
	return `Hauptkapitel: "${ctx.chapter.l1.numbering ?? '?'} ${ctx.chapter.l1.text}"
Aggregations-Ebene: L1 (flach gegliedert; direkt aus Absatz-Graph-Daten synthetisieren)
Verfügbare Absätze mit Graph-Daten: ${populated.length} von insgesamt ${ctx.paragraphGraphs!.length}.${noteOnSkipped}

[ARGUMENTATIONS-GRAPH DES HAUPTKAPITELS]

${block}

Synthetisiere jetzt das kontextualisierende Hauptkapitel-Memo (Synthese + Argumentationswiedergabe + Auffälligkeiten) ausschließlich aus dieser Graph-Struktur.`;
}

function formatSubchapterMemoBlock(m: SubchapterMemoInput): string {
	const num = m.numbering ?? '(ohne Numerierung)';
	const auff = m.auffaelligkeiten.length === 0
		? ''
		: '\n\n  Auffälligkeiten dieses Subkapitels:\n' +
		  m.auffaelligkeiten.map(a => `    [${a.scope}] ${a.observation}`).join('\n');
	return `## Subkapitel ${num} "${m.label}"\n\n${m.memoText}${auff}`;
}

function formatParagraphGraphBlock(p: ParagraphGraph): string {
	const enclosing = p.enclosingSubchapterLabel ? ` (innerhalb: ${p.enclosingSubchapterLabel})` : '';
	const argLines = p.args.length === 0
		? '  (keine Argumente)'
		: p.args.map(a => {
			const head = `  ${a.argLocalId} [${a.premiseSummary}]: ${a.claim}`;
			return a.fallacy ? `${head}\n${formatFallacyLine(a.fallacy)}` : head;
		}).join('\n');
	const interLines = p.interEdges.length === 0
		? ''
		: '\n  Intra-Edges:\n' + p.interEdges.map(e => `    ${e.from} --${e.kind}--> ${e.to}`).join('\n');
	const priorLines = p.priorEdges.length === 0
		? ''
		: '\n  Cross-Edges (rückwärts):\n' + p.priorEdges.map(e => `    ${e.from} --${e.kind}--> ${e.to}`).join('\n');
	const scLines = p.scaffolding.length === 0
		? ''
		: '\n  Stützstrukturen:\n' + p.scaffolding.map(s => {
			const anchorPart = s.anchored_to.length === 0
				? '(absatz-verankert, ohne Argument-Bezug)'
				: '→ ' + s.anchored_to.join(', ');
			return `    ${s.elementLocalId} [${s.functionType}] ${anchorPart}\n` +
				`      Funktion: ${s.functionDescription}\n` +
				`      Assessment: ${s.assessment}`;
		}).join('\n');
	return `## §${p.positionInChapter}${enclosing}\n${argLines}${interLines}${priorLines}${scLines}`;
}

// ── Storage ───────────────────────────────────────────────────────

async function storeChapterMemo(
	ctx: ChapterContext,
	result: ChapterCollapseResult,
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

		const numLabel = ctx.chapter.l1.numbering ?? '?';
		const label = `[kontextualisierend/chapter/graph] ${numLabel} ${ctx.chapter.l1.text}`;
		const memo = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[ctx.projectId, label, userId]
		);
		const memoId = memo.rows[0].id;

		// Argumentationswiedergabe and auffaelligkeiten ride on appearances.properties
		// — memo_content.content carries only the analytical synthese (consistent
		// with the subchapter pass).
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[memoId, perspective.id, JSON.stringify({
				source: 'argumentation_graph',
				aggregation_level: ctx.aggregationLevel,
				input_mode: ctx.mode,
				argumentationswiedergabe: result.argumentationswiedergabe,
				auffaelligkeiten: result.auffaelligkeiten,
			})]
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

export interface ChapterCollapseRun {
	skipped: boolean;
	existingMemoId: string | null;
	result: ChapterCollapseResult | null;
	stored: { memoId: string } | null;
	tokens: {
		input: number; output: number;
		cacheCreation: number; cacheRead: number; total: number;
	} | null;
	model: string | null;
	provider: string | null;
	aggregationLevel: 1 | 2 | 3 | null;
	inputMode: 'paragraphs' | 'subchapter-memos' | null;
	inputCount: number | null;
}

export async function runChapterCollapse(
	caseId: string,
	l1HeadingId: string,
	userId: string,
	opts: { modelOverride?: { provider: Provider; model: string } } = {}
): Promise<ChapterCollapseRun> {
	// Idempotency guard: skip if a chapter-graph memo for this L1 exists.
	const existingMemo = await queryOne<{ id: string }>(
		`SELECT n.id
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/chapter/graph]%'
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
			result: null, stored: null, tokens: null,
			model: null, provider: null,
			aggregationLevel: null, inputMode: null, inputCount: null,
		};
	}

	const ctx = await loadChapterContext(caseId, l1HeadingId);

	const system = buildSystemPrompt(ctx);
	const user = buildUserMessage(ctx);

	let repairResult;
	try {
		repairResult = await runJsonCallWithRepair({
			system,
			cacheSystem: true,
			user,
			schema: ChapterCollapseResultSchema,
			label: 'chapter-collapse',
			// 6000: chapter output is dual (synthese + argumentationswiedergabe +
			// auffaelligkeiten); the argumentationswiedergabe alone can run 1-3
			// substantial paragraphs.
			maxTokens: 6000,
			modelOverride: opts.modelOverride,
			caseId,
		});
	} catch (err) {
		if (err instanceof RepairCallExhaustedError) {
			const dumpPath = `/tmp/chapter-collapse-failure-${l1HeadingId}.txt`;
			const fs = await import('node:fs/promises');
			await fs.writeFile(
				dumpPath,
				`l1_heading_id: ${l1HeadingId}\nattempts: ${err.attempts}\nlast_stage: ${err.lastStage}\nlast_error: ${err.lastError}\n\n--- STAGES PER ATTEMPT ---\n${err.stagesPerAttempt.map((s, i) => `attempt ${i}: ${s.join(' -> ')}`).join('\n')}\n\n--- LAST RAW RESPONSE ---\n${err.lastRawText}\n`,
				'utf8'
			);
			console.error(`     dumped raw response to ${dumpPath}`);
		}
		throw err;
	}

	const parsed = repairResult.value;
	const stored = await storeChapterMemo(ctx, parsed, userId);

	const inputCount = ctx.mode === 'paragraphs'
		? (ctx.paragraphGraphs?.length ?? 0)
		: (ctx.subchapterMemos?.length ?? 0);

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
		aggregationLevel: ctx.aggregationLevel,
		inputMode: ctx.mode,
		inputCount,
	};
}
