import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

// Whitelist of keys writable from the client. Anything else is silently dropped
// so a malformed PATCH cannot stuff arbitrary state into the project bag.
const ALLOWED_KEYS = new Set(['coworkReactive', 'autonomaEnabled']);

async function assertMember(projectId: string, userId: string) {
	const m = await queryOne(
		`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!m) error(403, 'Not a member of this project');
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	await assertMember(params.projectId, locals.user.id);
	const row = await queryOne<{ properties: Record<string, unknown> | null }>(
		`SELECT properties FROM projects WHERE id = $1`,
		[params.projectId]
	);
	return json(row?.properties || {});
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');
	await assertMember(params.projectId, locals.user.id);
	const body = await request.json().catch(() => ({}));
	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(body)) {
		if (ALLOWED_KEYS.has(k)) patch[k] = v;
	}
	if (Object.keys(patch).length === 0) {
		return json({ ok: true, properties: {} });
	}
	const result = await query<{ properties: Record<string, unknown> }>(
		`UPDATE projects SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb
		 WHERE id = $2
		 RETURNING properties`,
		[JSON.stringify(patch), params.projectId]
	);
	return json({ ok: true, properties: result.rows[0]?.properties || {} });
};
