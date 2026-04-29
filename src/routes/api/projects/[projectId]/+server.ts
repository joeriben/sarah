// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;
	// Only allow owner to delete.
	const role = await query<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[params.projectId, userId]
	);
	if (role.rows.length === 0 || role.rows[0].role !== 'owner') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	await query(`DELETE FROM projects WHERE id = $1`, [params.projectId]);
	return json({ ok: true });
};
