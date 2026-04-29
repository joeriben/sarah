// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LayoutServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const project = await queryOne<{
		id: string;
		name: string;
		description: string | null;
		role: string;
		properties: Record<string, unknown> | null;
	}>(
		`SELECT p.id, p.name, p.description, p.properties, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		[params.projectId, locals.user!.id]
	);

	if (!project) {
		error(404, 'Project not found');
	}

	const counts = await queryOne<{ documents: string; memos: string }>(
		`SELECT
			(SELECT COUNT(*) FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
			(SELECT COUNT(*) FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as memos`,
		[params.projectId]
	);

	const docsResult = await query<{ id: string; label: string }>(
		`SELECT n.id, n.inscription as label
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		 ORDER BY n.inscription`,
		[params.projectId]
	);

	return {
		project,
		documents: docsResult.rows,
		counts: {
			documents: parseInt(counts?.documents || '0'),
			memos: parseInt(counts?.memos || '0')
		}
	};
};
