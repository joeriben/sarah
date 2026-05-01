// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Brief-Wechsel am Case (Stufe 2e). Ersetzt cases.assessment_brief_id durch
// einen anderen Brief aus der systemweiten Library. Erlaubt auch das
// Entfernen (briefId = null), in dem Fall läuft die Pipeline ohne Brief
// (was die Pässe ablehnen, aber das ist nicht hier zu blocken).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');

	const body = (await request.json().catch(() => null)) as { briefId?: string | null } | null;
	if (!body || (body.briefId !== null && typeof body.briefId !== 'string')) {
		error(400, 'briefId required (string or null)');
	}

	const exists = await queryOne<{ id: string }>(`SELECT id FROM cases WHERE id = $1`, [caseId]);
	if (!exists) error(404, 'Case not found');

	if (body.briefId !== null) {
		const brief = await queryOne<{ id: string }>(
			`SELECT id FROM assessment_briefs WHERE id = $1`,
			[body.briefId]
		);
		if (!brief) error(404, 'Brief not found');
	}

	await query(`UPDATE cases SET assessment_brief_id = $1 WHERE id = $2`, [body.briefId, caseId]);
	return json({ ok: true, caseId, briefId: body.briefId });
};
