// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';
import { loadEffectiveOutline } from '$lib/server/documents/outline.js';

export interface DocumentElement {
	id: string;
	element_type: string;
	text: string | null;
	parent_id: string | null;
	seq: number;
	char_start: number;
	char_end: number;
	section_kind: string | null;
}

export interface ParagraphMemo {
	id: string;
	memo_type: 'formulierend' | 'interpretierend';
	content: string;
}

export interface CodeAnchor {
	id: string;
	naming_id: string;
	phrase: string;
	char_start: number;
	char_end: number;
}

export interface HeadingSynthesis {
	headingElementId: string;
	memoId: string;
	content: string;
}

export interface WorkSynthesis {
	memoId: string;
	content: string;
}

export interface ChapterFlow {
	memoId: string;
	content: string;
}

export interface OutlineEntry {
	elementId: string;
	level: number;
	numbering: string | null;
	text: string;
	excluded: boolean;
}

export type ReferentialGrounding = 'none' | 'namedropping' | 'abstract' | 'concrete';

export type ValidityAssessment =
	| {
			carries: true;
			inference_form: 'deductive' | 'inductive' | 'abductive';
			rationale: string;
			fallacy?: null;
	  }
	| {
			carries: false;
			inference_form: 'deductive' | 'inductive' | 'abductive' | null;
			rationale: string;
			fallacy: { type: string; target_premise: string; explanation: string };
	  };

export type ParagraphPremise =
	| { type: 'stated';     text: string }
	| { type: 'carried';    text: string; from_paragraph?: number }
	| { type: 'background'; text: string };

export interface ParagraphArgument {
	id: string;
	argLocalId: string;
	claim: string;
	premises: ParagraphPremise[];
	anchorPhrase: string;
	anchorCharStart: number;
	anchorCharEnd: number;
	positionInParagraph: number;
	referentialGrounding: ReferentialGrounding | null;
	validityAssessment: ValidityAssessment | null;
}

export interface ParagraphEdge {
	kind: 'supports' | 'refines' | 'contradicts' | 'presupposes';
	scope: 'inter_argument' | 'prior_paragraph';
	direction: 'outgoing' | 'incoming';
	selfArgLocalId: string;
	other: {
		argLocalId: string;
		paragraphId: string;
		paraNumWithinChapter: number | null;
		claimSnippet: string;
	};
}

export interface ParagraphScaffolding {
	id: string;
	elementLocalId: string;
	functionType: 'textorganisatorisch' | 'didaktisch' | 'kontextualisierend' | 'rhetorisch';
	functionDescription: string;
	assessment: string;
	positionInParagraph: number;
	anchoredTo: string[];
}

export interface ParagraphAnalysis {
	args: ParagraphArgument[];
	edges: ParagraphEdge[];
	scaffolding: ParagraphScaffolding[];
}


export interface CaseInfo {
	id: string;
	name: string;
	briefId: string | null;
	briefName: string | null;
	briefWorkType: string | null;
	includeFormulierend: boolean;
	briefH3Enabled: boolean;
}

export interface BriefOption {
	id: string;
	name: string;
	workType: string | null;
	isSystemTemplate: boolean;
}

export const load: PageServerLoad = async ({ params }) => {
	const doc = await queryOne<{
		id: string;
		label: string;
		full_text: string | null;
		mime_type: string;
		file_size: number;
		anonymization_status: string | null;
		anonymized_at: Date | null;
		original_filename: string | null;
	}>(
		`SELECT n.id, n.inscription as label, dc.full_text, dc.mime_type, dc.file_size,
		        dc.anonymization_status, dc.anonymized_at, dc.original_filename
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);

	const seedCount = await queryOne<{ cnt: number }>(
		`SELECT COUNT(*)::int as cnt FROM document_pii_seeds
		 WHERE document_id = $1 AND active = true`,
		[params.docId]
	);

	if (!doc) error(404, 'Document not found');

	const rawElements = await query<{
		id: string;
		element_type: string;
		parent_id: string | null;
		seq: number;
		char_start: number;
		char_end: number;
		section_kind: string | null;
	}>(
		`SELECT id, element_type, parent_id, seq, char_start, char_end, section_kind
		 FROM document_elements
		 WHERE document_id = $1
		 ORDER BY char_start ASC, char_end DESC, seq ASC`,
		[params.docId]
	);

	const fullText = doc.full_text ?? '';
	const elements: DocumentElement[] = rawElements.rows.map((r) => ({
		...r,
		text:
			r.char_start != null && r.char_end != null && r.char_end >= r.char_start
				? fullText.substring(r.char_start, r.char_end)
				: null
	}));

	// Is this document the central document of a case?
	const caseRow = await queryOne<{
		id: string;
		name: string;
		brief_id: string | null;
		brief_name: string | null;
		work_type: string | null;
		include_formulierend: boolean | null;
		h3_enabled: boolean | null;
	}>(
		`SELECT c.id, c.name, c.assessment_brief_id AS brief_id,
		        b.name AS brief_name, b.work_type, b.include_formulierend,
		        b.h3_enabled
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.central_document_id = $1`,
		[params.docId]
	);

	const caseInfo: CaseInfo | null = caseRow
		? {
			id: caseRow.id,
			name: caseRow.name,
			briefId: caseRow.brief_id,
			briefName: caseRow.brief_name,
			briefWorkType: caseRow.work_type,
			includeFormulierend: caseRow.include_formulierend ?? false,
			briefH3Enabled: caseRow.h3_enabled ?? false,
		}
		: null;

	// Brief-Library für den Picker am Doc-Header.
	const briefOptions: BriefOption[] = caseInfo
		? (await query<{ id: string; name: string; work_type: string | null; created_by: string | null }>(
			`SELECT id, name, work_type, created_by
			 FROM assessment_briefs
			 ORDER BY (created_by IS NULL) DESC, name ASC`,
			[]
		)).rows.map((b) => ({
			id: b.id,
			name: b.name,
			workType: b.work_type,
			isSystemTemplate: b.created_by === null,
		}))
		: [];

	// Hermeneutic layer — only loaded if there is a case
	let memosByElement: Record<string, ParagraphMemo[]> = {};
	let codesByElement: Record<string, CodeAnchor[]> = {};
	let synthesesByHeading: Record<string, HeadingSynthesis> = {};
	// Welche Paragraphen haben AG-Daten (argument_nodes ODER scaffolding_elements)?
	// Wird im UI als "analytisch erfasst"-Coverage genutzt — unabhängig vom
	// optionalen synthetisch-interpretierenden Per-¶-Memo.
	let paragraphHasAg: Record<string, boolean> = {};
	// Pro L1-Heading: das aggregation_subchapter_level aus heading_classifications.
	// Bei Wert 1 hat der Section-Collapse-Pass die L2-Subkapitel bewusst nicht
	// einzeln synthetisiert, sondern in die chapter-Synthese eingefasst.
	let aggregationLevelByL1: Record<string, 1 | 2 | 3> = {};
	// Werk-Synthese (scope_level='work'): nicht heading-gebunden, daher nicht
	// in synthesesByHeading. Doc-Bezug via appearances.properties.document_id
	// (siehe document-collapse.ts:374-385).
	let workSynthesis: WorkSynthesis | null = null;
	// Kapitelverlauf (memo_type='kapitelverlauf', scope_level='work'): narrativer
	// Mittelabsatz des Gutachtens, parallel zum Werk-Verdikt.
	let chapterFlow: ChapterFlow | null = null;
	// Argument-Graph-Daten pro Paragraph für DocumentReader (Dokument-Tab + Modal-Argumente-Mode).
	// Bei Cases ohne synthetisch-interpretierende Per-¶-Memos (Budget-Route, AG-only)
	// ist das die einzige Analyse-Ebene, die der Reader anzeigen kann.
	let analysisByElement: Record<string, ParagraphAnalysis> = {};

	if (caseInfo) {
		const memoRows = (
			await query<{
				naming_id: string;
				scope_element_id: string;
				memo_type: 'formulierend' | 'interpretierend' | 'kontextualisierend';
				scope_level: 'paragraph' | 'subchapter' | 'chapter' | 'work';
				content: string;
			}>(
				`SELECT mc.naming_id, mc.scope_element_id, mc.memo_type, mc.scope_level, mc.content
				 FROM memo_content mc
				 JOIN document_elements de ON de.id = mc.scope_element_id
				 WHERE de.document_id = $1
				   AND mc.memo_type IS NOT NULL
				   AND mc.scope_element_id IS NOT NULL`,
				[params.docId]
			)
		).rows;

		for (const m of memoRows) {
			if (m.scope_level === 'paragraph' && m.memo_type !== 'kontextualisierend') {
				if (!memosByElement[m.scope_element_id]) memosByElement[m.scope_element_id] = [];
				memosByElement[m.scope_element_id].push({
					id: m.naming_id,
					memo_type: m.memo_type,
					content: m.content,
				});
			} else if (
				(m.scope_level === 'subchapter' || m.scope_level === 'chapter') &&
				m.memo_type === 'kontextualisierend'
			) {
				// Sowohl subchapter- als auch chapter-Synthesen sind heading-gebunden
				// und werden im Outline-Tab unter ihrem heading angezeigt. Pro
				// scope_element_id existiert höchstens eines von beiden (chapter
				// auf L1-headings, subchapter auf L2/L3-headings) — kein Konflikt.
				synthesesByHeading[m.scope_element_id] = {
					headingElementId: m.scope_element_id,
					memoId: m.naming_id,
					content: m.content,
				};
			}
		}

		const codeRows = (
			await query<{
				id: string;
				code_naming_id: string;
				element_id: string;
				char_start: number;
				char_end: number;
				phrase: string;
			}>(
				`SELECT ca.id, ca.code_naming_id, ca.element_id,
				        ca.char_start, ca.char_end,
				        n.inscription AS phrase
				 FROM code_anchors ca
				 JOIN document_elements de ON de.id = ca.element_id
				 JOIN namings n ON n.id = ca.code_naming_id
				 WHERE de.document_id = $1`,
				[params.docId]
			)
		).rows;

		for (const c of codeRows) {
			if (!codesByElement[c.element_id]) codesByElement[c.element_id] = [];
			codesByElement[c.element_id].push({
				id: c.id,
				naming_id: c.code_naming_id,
				phrase: c.phrase,
				char_start: c.char_start,
				char_end: c.char_end,
			});
		}

		// AG-Coverage pro Paragraph: hat ≥1 argument_node ODER ≥1 scaffolding_element?
		// Kongruent zur done-Bedingung im Pipeline-Orchestrator (orchestrator.ts:317-330).
		const agRows = (await query<{ paragraph_id: string }>(
			`SELECT DISTINCT de.id AS paragraph_id
			 FROM document_elements de
			 WHERE de.document_id = $1
			   AND de.element_type = 'paragraph'
			   AND de.section_kind = 'main'
			   AND (EXISTS (SELECT 1 FROM argument_nodes an WHERE an.paragraph_element_id = de.id)
			        OR EXISTS (SELECT 1 FROM scaffolding_elements s WHERE s.paragraph_element_id = de.id))`,
			[params.docId]
		)).rows;
		for (const r of agRows) paragraphHasAg[r.paragraph_id] = true;

		// Werk-Synthese laden (eine pro Dokument, jüngste falls mehrere).
		const workRow = await queryOne<{ id: string; content: string }>(
			`SELECT n.id, mc.content
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
			   AND mc.scope_level = 'work'
			   AND mc.memo_type = 'kontextualisierend'
			   AND a.properties->>'document_id' = $1
			   AND n.deleted_at IS NULL
			 ORDER BY n.created_at DESC
			 LIMIT 1`,
			[params.docId]
		);
		if (workRow) {
			workSynthesis = { memoId: workRow.id, content: workRow.content };
		}

		// Kapitelverlauf laden (eine pro Dokument, jüngste falls mehrere).
		const flowRow = await queryOne<{ id: string; content: string }>(
			`SELECT n.id, mc.content
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.inscription LIKE '[kapitelverlauf/work]%'
			   AND mc.scope_level = 'work'
			   AND mc.memo_type = 'kapitelverlauf'
			   AND a.properties->>'document_id' = $1
			   AND n.deleted_at IS NULL
			 ORDER BY n.created_at DESC
			 LIMIT 1`,
			[params.docId]
		);
		if (flowRow) {
			chapterFlow = { memoId: flowRow.id, content: flowRow.content };
		}

		// Aggregations-Entscheidung pro L1-Heading laden. NULL bleibt unsichtbar
		// (wurde noch nicht entschieden / Section-Collapse noch nicht gelaufen).
		const aggRows = (await query<{ element_id: string; aggregation_subchapter_level: number }>(
			`SELECT element_id, aggregation_subchapter_level
			 FROM heading_classifications
			 WHERE document_id = $1
			   AND aggregation_subchapter_level IS NOT NULL
			   AND element_id IS NOT NULL`,
			[params.docId]
		)).rows;
		for (const r of aggRows) {
			if (r.aggregation_subchapter_level === 1 || r.aggregation_subchapter_level === 2 || r.aggregation_subchapter_level === 3) {
				aggregationLevelByL1[r.element_id] = r.aggregation_subchapter_level;
			}
		}

		// Argument-Graph-Daten pro Paragraph laden. Drei Tabellen + Anchors:
		// argument_nodes, argument_edges, scaffolding_elements, scaffolding_anchors.
		// Pro Paragraph werden die outgoing- und incoming-Edges separat geführt,
		// damit der Reader Beziehungen ähnlich wie der Hover-Popover anzeigt.
		const paraIds = elements
			.filter((e) => e.element_type === 'paragraph' && e.section_kind === 'main')
			.map((e) => e.id);
		if (paraIds.length > 0) {
			const argRows = (await query<{
				id: string;
				paragraph_element_id: string;
				arg_local_id: string;
				claim: string;
				premises: unknown;
				anchor_phrase: string;
				anchor_char_start: number;
				anchor_char_end: number;
				position_in_paragraph: number;
				referential_grounding: ReferentialGrounding | null;
				validity_assessment: unknown;
			}>(
				`SELECT id, paragraph_element_id, arg_local_id, claim, premises,
				        anchor_phrase, anchor_char_start, anchor_char_end, position_in_paragraph,
				        referential_grounding, validity_assessment
				 FROM argument_nodes
				 WHERE paragraph_element_id = ANY($1::uuid[])
				 ORDER BY paragraph_element_id, position_in_paragraph`,
				[paraIds]
			)).rows;

			const edgeRows = argRows.length === 0
				? []
				: (await query<{
					kind: 'supports' | 'refines' | 'contradicts' | 'presupposes';
					scope: 'inter_argument' | 'prior_paragraph';
					from_para_id: string;
					from_arg_local: string;
					from_claim: string;
					to_para_id: string;
					to_arg_local: string;
					to_claim: string;
				}>(
					`SELECT e.kind, e.scope,
					        fn.paragraph_element_id AS from_para_id,
					        fn.arg_local_id AS from_arg_local,
					        fn.claim AS from_claim,
					        tn.paragraph_element_id AS to_para_id,
					        tn.arg_local_id AS to_arg_local,
					        tn.claim AS to_claim
					 FROM argument_edges e
					 JOIN argument_nodes fn ON fn.id = e.from_node_id
					 JOIN argument_nodes tn ON tn.id = e.to_node_id
					 WHERE fn.paragraph_element_id = ANY($1::uuid[])
					    OR tn.paragraph_element_id = ANY($1::uuid[])`,
					[paraIds]
				)).rows;

			const scRows = (await query<{
				id: string;
				paragraph_element_id: string;
				element_local_id: string;
				function_type: 'textorganisatorisch' | 'didaktisch' | 'kontextualisierend' | 'rhetorisch';
				function_description: string;
				assessment: string;
				position_in_paragraph: number;
			}>(
				`SELECT id, paragraph_element_id, element_local_id, function_type,
				        function_description, assessment, position_in_paragraph
				 FROM scaffolding_elements
				 WHERE paragraph_element_id = ANY($1::uuid[])
				 ORDER BY paragraph_element_id, position_in_paragraph`,
				[paraIds]
			)).rows;

			const scIds = scRows.map((r) => r.id);
			const anchorRows = scIds.length === 0
				? []
				: (await query<{
					scaffolding_id: string;
					paragraph_element_id: string;
					arg_local_id: string;
				}>(
					`SELECT sa.scaffolding_id, an.paragraph_element_id, an.arg_local_id
					 FROM scaffolding_anchors sa
					 JOIN argument_nodes an ON an.id = sa.argument_id
					 WHERE sa.scaffolding_id = ANY($1::uuid[])`,
					[scIds]
				)).rows;

			// Paragraph-Numerierung pro Heading-Block (für §-Refs in Cross-Edges
			// und Cross-Anchors). Window-function gleicht der API in
			// /api/cases/[caseId]/paragraph-arguments/[paragraphId]/+server.ts.
			const seqRows = (await query<{ id: string; para_seq: number }>(
				`WITH ordered AS (
				  SELECT id, element_type, char_start, char_end, seq,
				         SUM(CASE WHEN element_type = 'heading' THEN 1 ELSE 0 END)
				           OVER (ORDER BY char_start ASC, char_end DESC, seq ASC) AS heading_block
				  FROM document_elements
				  WHERE document_id = $1 AND section_kind = 'main'
				), paras AS (
				  SELECT id,
				         ROW_NUMBER() OVER (PARTITION BY heading_block ORDER BY char_start ASC, seq ASC)::int AS para_seq
				  FROM ordered WHERE element_type = 'paragraph'
				)
				SELECT id, para_seq FROM paras`,
				[params.docId]
			)).rows;
			const paraNumByPid = new Map<string, number>();
			for (const r of seqRows) paraNumByPid.set(r.id, r.para_seq);

			const paraIdSet = new Set(paraIds);
			for (const pid of paraIds) {
				analysisByElement[pid] = { args: [], edges: [], scaffolding: [] };
			}

			for (const r of argRows) {
				analysisByElement[r.paragraph_element_id].args.push({
					id: r.id,
					argLocalId: r.arg_local_id,
					claim: r.claim,
					premises: Array.isArray(r.premises) ? (r.premises as ParagraphPremise[]) : [],
					anchorPhrase: r.anchor_phrase,
					anchorCharStart: r.anchor_char_start,
					anchorCharEnd: r.anchor_char_end,
					positionInParagraph: r.position_in_paragraph,
					referentialGrounding: r.referential_grounding,
					validityAssessment: (r.validity_assessment as ValidityAssessment | null) ?? null,
				});
			}

			const SNIPPET_MAX = 140;
			const snip = (s: string) =>
				s.length <= SNIPPET_MAX ? s : s.slice(0, SNIPPET_MAX - 1).trimEnd() + '…';

			for (const e of edgeRows) {
				const fromInDoc = paraIdSet.has(e.from_para_id);
				const toInDoc = paraIdSet.has(e.to_para_id);
				if (fromInDoc) {
					analysisByElement[e.from_para_id].edges.push({
						kind: e.kind,
						scope: e.scope,
						direction: 'outgoing',
						selfArgLocalId: e.from_arg_local,
						other: {
							argLocalId: e.to_arg_local,
							paragraphId: e.to_para_id,
							paraNumWithinChapter: paraNumByPid.get(e.to_para_id) ?? null,
							claimSnippet: snip(e.to_claim),
						},
					});
				}
				// intra-paragraph (von ¶ zu sich selbst): nur einmal als outgoing zählen,
				// nicht zusätzlich als incoming desselben ¶ — Doppelanzeige vermeiden.
				if (toInDoc && e.from_para_id !== e.to_para_id) {
					analysisByElement[e.to_para_id].edges.push({
						kind: e.kind,
						scope: e.scope,
						direction: 'incoming',
						selfArgLocalId: e.to_arg_local,
						other: {
							argLocalId: e.from_arg_local,
							paragraphId: e.from_para_id,
							paraNumWithinChapter: paraNumByPid.get(e.from_para_id) ?? null,
							claimSnippet: snip(e.from_claim),
						},
					});
				}
			}

			const anchorsByScId = new Map<string, { paraId: string; argLocalId: string }[]>();
			for (const a of anchorRows) {
				const arr = anchorsByScId.get(a.scaffolding_id) ?? [];
				arr.push({ paraId: a.paragraph_element_id, argLocalId: a.arg_local_id });
				anchorsByScId.set(a.scaffolding_id, arr);
			}

			for (const sc of scRows) {
				const anchors = anchorsByScId.get(sc.id) ?? [];
				const anchoredTo = anchors.map((a) => {
					if (a.paraId === sc.paragraph_element_id) return a.argLocalId;
					const num = paraNumByPid.get(a.paraId);
					return num != null ? `§${num}:${a.argLocalId}` : a.argLocalId;
				});
				analysisByElement[sc.paragraph_element_id].scaffolding.push({
					id: sc.id,
					elementLocalId: sc.element_local_id,
					functionType: sc.function_type,
					functionDescription: sc.function_description,
					assessment: sc.assessment,
					positionInParagraph: sc.position_in_paragraph,
					anchoredTo,
				});
			}
		}
	}

	const effectiveOutline = await loadEffectiveOutline(params.docId);
	const outlineEntries: OutlineEntry[] = (effectiveOutline?.headings ?? []).map((h) => ({
		elementId: h.elementId,
		level: h.effectiveLevel,
		numbering: h.effectiveNumbering,
		text: h.effectiveText,
		excluded: h.excluded,
	}));

	// Pre-Run-Validation-Datenbasis: outline_function_type-Coverage. Map
	// jedes vergebenen Funktionstyps auf die Anzahl der Headings, die ihn
	// tragen (nicht-excluded). H3-Pflicht-Check vergleicht gegen
	// H3_REQUIRED_FUNCTION_TYPES aus h3-vocabulary.
	const outlineFunctionTypeCoverage: Record<string, number> = {};
	for (const h of effectiveOutline?.headings ?? []) {
		if (h.excluded) continue;
		if (!h.outlineFunctionType) continue;
		outlineFunctionTypeCoverage[h.outlineFunctionType] =
			(outlineFunctionTypeCoverage[h.outlineFunctionType] ?? 0) + 1;
	}

	return {
		document: doc,
		anonymization: {
			status: doc.anonymization_status,
			anonymizedAt: doc.anonymized_at,
			originalFilename: doc.original_filename,
			seedCount: seedCount?.cnt ?? 0
		},
		elements,
		projectId: params.projectId,
		case: caseInfo,
		memosByElement,
		codesByElement,
		synthesesByHeading,
		outlineEntries,
		outlineFunctionTypeCoverage,
		briefOptions,
		paragraphHasAg,
		aggregationLevelByL1,
		workSynthesis,
		chapterFlow,
		analysisByElement,
	};
};
