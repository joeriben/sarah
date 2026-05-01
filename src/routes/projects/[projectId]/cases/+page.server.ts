// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export interface CaseRow {
	id: string;
	name: string;
	createdAt: string;
	briefId: string | null;
	briefName: string | null;
	centralDocumentId: string;
	centralDocumentLabel: string;
}

export const load: PageServerLoad = async ({ params }) => {
	const cases = await query<{
		id: string;
		name: string;
		created_at: string;
		brief_id: string | null;
		brief_name: string | null;
		central_document_id: string;
		central_document_label: string;
	}>(
		`SELECT c.id, c.name, c.created_at,
		        c.assessment_brief_id AS brief_id,
		        b.name AS brief_name,
		        c.central_document_id,
		        n.inscription AS central_document_label
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 JOIN namings n ON n.id = c.central_document_id
		 WHERE c.project_id = $1
		 ORDER BY c.created_at DESC`,
		[params.projectId]
	);

	const caseRows: CaseRow[] = cases.rows.map((r) => ({
		id: r.id,
		name: r.name,
		createdAt: r.created_at,
		briefId: r.brief_id,
		briefName: r.brief_name,
		centralDocumentId: r.central_document_id,
		centralDocumentLabel: r.central_document_label,
	}));

	return {
		cases: caseRows,
		projectId: params.projectId,
	};
};
