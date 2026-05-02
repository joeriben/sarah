// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Endpoint für den Kapitelverlauf-Pass — narrativer Mittelabsatz des
// Gutachtens. User-getriggert (Pipeline-Tab Button) nach abgeschlossener
// analytischer Hauptlinie.
//
// POST /api/cases/[caseId]/chapter-flow-summary
//   Body: { force?: boolean }
//   - force=true: vorhandenen Kapitelverlauf vor Re-Generierung soft-löschen
//   - force=false (default): wenn Memo schon existiert, skip (idempotent)
//
// GET-Variante existiert nicht — der bestehende Memo wird via
// +page.server.ts geladen und im Outline-Tab angezeigt.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runChapterFlowSummary } from '$lib/server/ai/hermeneutic/chapter-flow-summary.js';
import { queryOne } from '$lib/server/db/index.js';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const userId = locals.user.id;
	const { caseId } = params;
	if (!caseId) return json({ error: 'caseId required' }, { status: 400 });

	let body: { force?: boolean } = {};
	try {
		const text = await request.text();
		if (text) body = JSON.parse(text);
	} catch {
		// Empty body / invalid JSON → defaults bleiben.
	}

	const guard = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!guard) return json({ error: 'case not found' }, { status: 404 });
	if (!guard.central_document_id) {
		return json(
			{ error: 'NO_CENTRAL_DOCUMENT', message: 'Case hat kein zentrales Dokument.' },
			{ status: 409 }
		);
	}

	try {
		const run = await runChapterFlowSummary(caseId, userId, { force: body.force === true });
		return json(run, { status: 200 });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[chapter-flow-summary] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
