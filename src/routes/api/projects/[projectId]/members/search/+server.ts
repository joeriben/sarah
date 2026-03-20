import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const userId = locals.user!.id;
	const { projectId } = params;

	// Only owners/admins can search for users to add
	const role = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!role || !['owner', 'admin'].includes(role.role)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 2) {
		return json([]);
	}

	// Search by username, display_name, or email — exclude existing members
	const result = await query<{ id: string; username: string; display_name: string | null }>(
		`SELECT u.id, u.username, u.display_name
		 FROM users u
		 WHERE (u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1)
		   AND u.id NOT IN (SELECT user_id FROM project_members WHERE project_id = $2)
		 ORDER BY u.username
		 LIMIT 10`,
		[`%${q}%`, projectId]
	);

	return json(result.rows);
};
