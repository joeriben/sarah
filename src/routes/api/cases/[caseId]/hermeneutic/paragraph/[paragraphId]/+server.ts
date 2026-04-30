// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runParagraphPass } from '$lib/server/ai/hermeneutic/per-paragraph.js';
import { queryOne } from '$lib/server/db/index.js';

export const POST: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const { caseId, paragraphId } = params;
	if (!caseId || !paragraphId) {
		return json({ error: 'caseId and paragraphId required' }, { status: 400 });
	}

	const guard = await queryOne<{ document_id: string; outline_status: string }>(
		`SELECT de.document_id, dc.outline_status
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.id = $1`,
		[paragraphId]
	);
	if (!guard) {
		return json({ error: 'paragraph not found' }, { status: 404 });
	}
	if (guard.outline_status !== 'confirmed') {
		return json(
			{
				error: 'OUTLINE_NOT_CONFIRMED',
				message:
					'Die Heading-Hierarchie des Dokuments ist noch nicht bestätigt. Bitte erst die Outline validieren.',
				document_id: guard.document_id
			},
			{ status: 409 }
		);
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
