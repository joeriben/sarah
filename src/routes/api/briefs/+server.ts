// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { listBriefs, createBrief, WORK_TYPES, type WorkType } from '$lib/server/db/queries/briefs.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const briefs = await listBriefs();
	return json({ briefs });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const workType = body.work_type as WorkType;
	if (!name) error(400, 'name is required');
	if (!WORK_TYPES.includes(workType)) error(400, `work_type must be one of: ${WORK_TYPES.join(', ')}`);

	const brief = await createBrief(locals.user.id, {
		name,
		work_type: workType,
		criteria: typeof body.criteria === 'string' ? body.criteria : '',
		persona: typeof body.persona === 'string' ? body.persona : '',
		include_formulierend: !!body.include_formulierend,
		argumentation_graph: body.argumentation_graph !== false,
		validity_check: !!body.validity_check
	});

	return json({ brief }, { status: 201 });
};
