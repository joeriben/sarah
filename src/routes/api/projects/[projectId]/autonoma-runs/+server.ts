import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

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

	const rows = await query<{
		run_id: string;
		naming_count: string;
		started_at: string;
		ended_at: string;
	}>(
		`SELECT a.properties->>'aiRunId' AS run_id,
		        COUNT(DISTINCT n.id) AS naming_count,
		        MIN(n.created_at) AS started_at,
		        MAX(n.created_at) AS ended_at
		 FROM appearances a
		 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
		 WHERE n.project_id = $1
		   AND a.properties->>'aiRunId' IS NOT NULL
		   AND a.properties->>'aiPersona' = 'autonoma'
		 GROUP BY a.properties->>'aiRunId'
		 ORDER BY MIN(n.created_at) DESC`,
		[params.projectId]
	);

	return json(rows.rows.map(r => ({
		runId: r.run_id,
		namingCount: parseInt(r.naming_count, 10),
		startedAt: r.started_at,
		endedAt: r.ended_at
	})));
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');
	await assertMember(params.projectId, locals.user.id);

	const body = await request.json().catch(() => ({}));
	const { runId, action } = body;
	if (!runId || typeof runId !== 'string') error(400, 'runId required');
	if (action !== 'rollback') error(400, `Unknown action: ${action}`);

	// Soft-delete every naming that has at least one appearance tagged with
	// this aiRunId in this project. Naming_acts and appearances are filtered
	// out elsewhere via deleted_at IS NULL on the parent naming, so this
	// hides the run everywhere without cascading. Reversible by clearing
	// deleted_at if the researcher changes their mind.
	const result = await query<{ id: string }>(
		`UPDATE namings n
		 SET deleted_at = now()
		 WHERE n.deleted_at IS NULL
		   AND n.project_id = $1
		   AND EXISTS (
		     SELECT 1 FROM appearances a
		     WHERE a.naming_id = n.id
		       AND a.properties->>'aiRunId' = $2
		   )
		 RETURNING n.id`,
		[params.projectId, runId]
	);

	return json({ ok: true, deletedCount: result.rowCount ?? 0, deletedIds: result.rows.map(r => r.id) });
};
