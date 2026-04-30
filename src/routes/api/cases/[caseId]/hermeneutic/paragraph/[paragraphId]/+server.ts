// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runParagraphPass } from '$lib/server/ai/hermeneutic/per-paragraph.js';

export const POST: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const { caseId, paragraphId } = params;
	if (!caseId || !paragraphId) {
		return json({ error: 'caseId and paragraphId required' }, { status: 400 });
	}

	try {
		const run = await runParagraphPass(caseId, paragraphId, userId);
		return json(run, { status: 200 });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[hermeneutic/paragraph] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
