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

export interface OutlineEntry {
	elementId: string;
	level: number;
	numbering: string | null;
	text: string;
	excluded: boolean;
}


export interface CaseInfo {
	id: string;
	name: string;
	briefId: string | null;
	briefName: string | null;
	briefWorkType: string | null;
	includeFormulierend: boolean;
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
	}>(
		`SELECT n.id, n.inscription as label, dc.full_text, dc.mime_type, dc.file_size
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
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
	}>(
		`SELECT c.id, c.name, c.assessment_brief_id AS brief_id,
		        b.name AS brief_name, b.work_type, b.include_formulierend
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
	}

	const effectiveOutline = await loadEffectiveOutline(params.docId);
	const outlineEntries: OutlineEntry[] = (effectiveOutline?.headings ?? []).map((h) => ({
		elementId: h.elementId,
		level: h.effectiveLevel,
		numbering: h.effectiveNumbering,
		text: h.effectiveText,
		excluded: h.excluded,
	}));

	return {
		document: doc,
		elements,
		projectId: params.projectId,
		case: caseInfo,
		memosByElement,
		codesByElement,
		synthesesByHeading,
		outlineEntries,
		briefOptions,
		paragraphHasAg,
		aggregationLevelByL1,
		workSynthesis,
	};
};
