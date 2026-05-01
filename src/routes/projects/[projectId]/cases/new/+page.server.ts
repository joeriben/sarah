// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export interface CaselessDoc {
	id: string;
	label: string;
}

export interface BriefOption {
	id: string;
	name: string;
	workType: string | null;
	isSystemTemplate: boolean;
}

export const load: PageServerLoad = async ({ params }) => {
	const caselessDocs = await query<{ id: string; label: string }>(
		`SELECT n.id, n.inscription AS label
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 LEFT JOIN cases c ON (c.central_document_id = n.id
		                    OR c.annotation_document_id = n.id
		                    OR c.review_draft_document_id = n.id)
		 WHERE n.project_id = $1
		   AND n.deleted_at IS NULL
		   AND c.id IS NULL
		 ORDER BY n.inscription`,
		[params.projectId]
	);

	const briefs = await query<{ id: string; name: string; work_type: string | null; created_by: string | null }>(
		`SELECT id, name, work_type, created_by
		 FROM assessment_briefs
		 ORDER BY (created_by IS NULL) DESC, name ASC`,
		[]
	);

	return {
		projectId: params.projectId,
		caselessDocs: caselessDocs.rows as CaselessDoc[],
		briefOptions: briefs.rows.map((b) => ({
			id: b.id,
			name: b.name,
			workType: b.work_type,
			isSystemTemplate: b.created_by === null,
		})) as BriefOption[],
	};
};
