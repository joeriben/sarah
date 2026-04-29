// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params }) => {
	const result = await query<{
		id: string;
		label: string;
		created_at: string;
		mime_type: string | null;
		file_size: number | null;
		element_count: number;
		embedded_count: number;
	}>(
		`SELECT n.id, n.inscription as label, n.created_at, dc.mime_type, dc.file_size,
		        (SELECT COUNT(*)::int FROM document_elements e
		           WHERE e.document_id = n.id AND e.content IS NOT NULL) AS element_count,
		        (SELECT COUNT(*)::int FROM document_elements e
		           WHERE e.document_id = n.id AND e.embedding IS NOT NULL) AS embedded_count
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		 ORDER BY n.created_at DESC`,
		[params.projectId]
	);

	return {
		documents: result.rows,
		projectId: params.projectId
	};
};
