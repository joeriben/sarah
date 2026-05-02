// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getBrief,
	updateBrief,
	deleteBrief,
	WORK_TYPES,
	type WorkType,
	type UpdateBriefInput
} from '$lib/server/db/queries/briefs.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const brief = await getBrief(params.briefId);
	if (!brief) error(404, 'Brief not found');
	return json({ brief });
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const body = await request.json().catch(() => ({}));
	const patch: UpdateBriefInput = {};

	if (typeof body.name === 'string') {
		const trimmed = body.name.trim();
		if (!trimmed) error(400, 'name cannot be empty');
		patch.name = trimmed;
	}
	if (body.work_type !== undefined) {
		if (!WORK_TYPES.includes(body.work_type as WorkType))
			error(400, `work_type must be one of: ${WORK_TYPES.join(', ')}`);
		patch.work_type = body.work_type as WorkType;
	}
	if (typeof body.criteria === 'string') patch.criteria = body.criteria;
	if (typeof body.persona === 'string') patch.persona = body.persona;
	if (typeof body.include_formulierend === 'boolean') patch.include_formulierend = body.include_formulierend;
	if (typeof body.argumentation_graph === 'boolean') patch.argumentation_graph = body.argumentation_graph;
	if (typeof body.validity_check === 'boolean') patch.validity_check = body.validity_check;

	const brief = await updateBrief(params.briefId, patch);
	if (!brief) error(404, 'Brief not found');
	return json({ brief });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const r = await deleteBrief(params.briefId);
	if (!r.deleted && r.case_count > 0) {
		return json(
			{ error: 'in_use', case_count: r.case_count, message: `Brief is referenced by ${r.case_count} case(s)` },
			{ status: 409 }
		);
	}
	if (!r.deleted) error(404, 'Brief not found');
	return json({ ok: true });
};
