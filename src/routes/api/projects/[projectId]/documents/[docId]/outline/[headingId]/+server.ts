// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	upsertClassification,
	type ClassificationPatch
} from '$lib/server/documents/outline.js';
import {
	OUTLINE_FUNCTION_TYPES,
	GRANULARITY_LEVELS
} from '$lib/shared/h3-vocabulary.js';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { docId, headingId } = params;
	if (!docId || !headingId)
		throw error(400, 'docId and headingId required');

	const body = (await request.json()) as ClassificationPatch;
	const patch: ClassificationPatch = {};
	if ('user_level' in body) {
		const v = body.user_level;
		if (v !== null && v !== undefined && (typeof v !== 'number' || v < 1 || v > 9)) {
			throw error(400, 'user_level must be null or 1..9');
		}
		patch.user_level = v ?? null;
	}
	if ('user_text' in body) {
		const v = body.user_text;
		if (v !== null && v !== undefined && typeof v !== 'string') {
			throw error(400, 'user_text must be string or null');
		}
		patch.user_text = v?.trim() || null;
	}
	if ('excluded' in body) {
		if (typeof body.excluded !== 'boolean')
			throw error(400, 'excluded must be boolean');
		patch.excluded = body.excluded;
	}
	if ('notes' in body) {
		patch.notes = body.notes?.trim() || null;
	}
	if ('outline_function_type' in body) {
		const v = body.outline_function_type;
		if (v !== null && v !== undefined && (typeof v !== 'string' || !OUTLINE_FUNCTION_TYPES.includes(v as never))) {
			throw error(400, `outline_function_type must be one of ${OUTLINE_FUNCTION_TYPES.join(', ')} or null`);
		}
		patch.outline_function_type = v ?? null;
	}
	if ('granularity_level' in body) {
		const v = body.granularity_level;
		if (v !== null && v !== undefined && (typeof v !== 'string' || !GRANULARITY_LEVELS.includes(v as never))) {
			throw error(400, `granularity_level must be one of ${GRANULARITY_LEVELS.join(', ')} or null`);
		}
		patch.granularity_level = v ?? null;
	}

	try {
		const r = await upsertClassification(docId, headingId, patch);
		return json(r);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};
