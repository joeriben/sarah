// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { insertSyntheticHeading } from '$lib/server/documents/outline.js';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { docId } = params;
	if (!docId) throw error(400, 'docId required');
	let body: { afterElementId?: string | null; text?: string; level?: number };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json body');
	}
	const text = (body.text ?? '').trim();
	const level = body.level;
	const afterElementId = body.afterElementId ?? null;
	if (!text) throw error(400, 'text required');
	if (!Number.isInteger(level) || level! < 1 || level! > 9) {
		throw error(400, 'level must be integer in [1, 9]');
	}
	try {
		const r = await insertSyntheticHeading(docId, afterElementId, text, level!);
		return json(r);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};
