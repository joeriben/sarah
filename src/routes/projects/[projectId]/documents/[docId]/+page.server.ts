// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

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

export interface SubchapterSynthesis {
	headingElementId: string;
	memoId: string;
	content: string;
}

export interface CaseInfo {
	id: string;
	name: string;
	briefName: string | null;
	briefWorkType: string | null;
	includeFormulierend: boolean;
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
		brief_name: string | null;
		work_type: string | null;
		include_formulierend: boolean | null;
	}>(
		`SELECT c.id, c.name,
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
			briefName: caseRow.brief_name,
			briefWorkType: caseRow.work_type,
			includeFormulierend: caseRow.include_formulierend ?? false,
		}
		: null;

	// Hermeneutic layer — only loaded if there is a case
	let memosByElement: Record<string, ParagraphMemo[]> = {};
	let codesByElement: Record<string, CodeAnchor[]> = {};
	let synthesesByHeading: Record<string, SubchapterSynthesis> = {};

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
			} else if (m.scope_level === 'subchapter' && m.memo_type === 'kontextualisierend') {
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
	}

	return {
		document: doc,
		elements,
		projectId: params.projectId,
		case: caseInfo,
		memosByElement,
		codesByElement,
		synthesesByHeading,
	};
};
