// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { loadEffectiveOutline } from '$lib/server/documents/outline.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { docId } = params;
	if (!docId) throw error(400, 'docId required');
	const outline = await loadEffectiveOutline(docId);
	if (!outline) throw error(404, 'document not found');
	return json(outline);
};
