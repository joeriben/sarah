// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

export interface DocumentElement {
	id: string;
	element_type: string;
	text: string | null;          // computed: substring(full_text, char_start, char_end)
	parent_id: string | null;
	seq: number;
	char_start: number;
	char_end: number;
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

	// Element rows carry only structure + char range. The text of any
	// element is its slice of the document's full_text — computed here
	// in the loader so the page receives ready-to-render text without
	// having to JOIN document_content per element on the client.
	const rawElements = await query<{
		id: string;
		element_type: string;
		parent_id: string | null;
		seq: number;
		char_start: number;
		char_end: number;
	}>(
		`SELECT id, element_type, parent_id, seq, char_start, char_end
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

	return {
		document: doc,
		elements,
		projectId: params.projectId
	};
};
