// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { reopenOutline } from '$lib/server/documents/outline.js';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { docId } = params;
	if (!docId) throw error(400, 'docId required');
	try {
		const r = await reopenOutline(docId);
		return json(r);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};
