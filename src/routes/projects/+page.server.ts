// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ locals }) => {
	const result = await query<{
		id: string;
		name: string;
		description: string | null;
		created_by: string;
		created_at: string;
		role: string;
	}>(
		`SELECT p.id, p.name, p.description, p.created_by, p.created_at, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE pm.user_id = $1
		 ORDER BY p.created_at DESC`,
		[locals.user!.id]
	);

	return {
		projects: result.rows.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			createdAt: r.created_at,
			role: r.role
		}))
	};
};
