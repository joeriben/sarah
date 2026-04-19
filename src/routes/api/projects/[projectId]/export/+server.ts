// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RequestHandler } from './$types.js';
import { exportProject } from '$lib/server/qdpx/export.js';
import { queryOne } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	// Verify membership
	const member = await queryOne(
		`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[params.projectId, locals.user!.id]
	);
	if (!member) {
		return new Response('Not found', { status: 404 });
	}

	const project = await queryOne<{ name: string }>(
		`SELECT name FROM projects WHERE id = $1`,
		[params.projectId]
	);

	const buffer = await exportProject(params.projectId);

	const filename = (project?.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_') + '.qdpx';

	return new Response(new Uint8Array(buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': buffer.length.toString()
		}
	});
};
