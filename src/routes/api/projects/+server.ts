// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { transaction } from '$lib/server/db/index.js';
import { projectSchema } from '$lib/shared/validation.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const userId = locals.user!.id;

	const parsed = projectSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input' }, { status: 400 });
	}
	const { name, description } = parsed.data;

	const project = await transaction(async (client) => {
		const res = await client.query(
			`INSERT INTO projects (name, description, created_by)
			 VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
			[name, description || null, userId]
		);
		const p = res.rows[0];
		await client.query(
			`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
			[p.id, userId]
		);
		return p;
	});

	return json(project, { status: 201 });
};
