// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db/index.js';
import { anonymizeDocumentDeterministic, getPersistedSeeds } from '$lib/server/documents/anonymize/index.js';

/**
 * POST: Führt die deterministische Anonymisierung (UC1) aus.
 *
 * Idempotent: zweiter Aufruf auf einem bereits anonymisierten Dokument
 * findet keine neuen Seeds und endet mit status='no_candidates' — bereits
 * persistierte Seeds bleiben erhalten und der Failsafe-Tripwire weiter
 * scharf.
 *
 * UC2 (LLM-assistiert) wird via ?mode=peer-review angesprochen — derzeit
 * noch nicht implementiert.
 */
export const POST: RequestHandler = async ({ params, url }) => {
	const { projectId, docId } = params;
	const mode = url.searchParams.get('mode') ?? 'deterministic';

	// Doc-Existenz + Project-Zugehörigkeit prüfen.
	const ownerCheck = await query(
		`SELECT 1 FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[docId, projectId]
	);
	if (ownerCheck.rows.length === 0) {
		return json({ error: 'Document not found in project' }, { status: 404 });
	}

	if (mode === 'peer-review') {
		// UC2 (Peer-Review, LLM-assistiert) ist Phase B — Stub.
		return json({ error: 'mode=peer-review not yet implemented' }, { status: 501 });
	}

	if (mode !== 'deterministic') {
		return json({ error: `unknown mode '${mode}'` }, { status: 400 });
	}

	try {
		const result = await anonymizeDocumentDeterministic(docId);
		return json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return json({ error: 'Anonymization failed', detail: msg }, { status: 500 });
	}
};

/**
 * GET: Gibt persistierte PII-Seeds und Status für das Dokument zurück.
 * Für Audit / spätere UI-Anzeige.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { projectId, docId } = params;

	const statusRes = await query(
		`SELECT dc.anonymization_status, dc.anonymized_at, dc.original_filename, n.inscription
		   FROM document_content dc
		   JOIN namings n ON n.id = dc.naming_id
		  WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);
	if (statusRes.rows.length === 0) {
		return json({ error: 'Document not found in project' }, { status: 404 });
	}

	const seeds = await getPersistedSeeds(docId);

	return json({
		status: statusRes.rows[0].anonymization_status,
		anonymizedAt: statusRes.rows[0].anonymized_at,
		originalFilename: statusRes.rows[0].original_filename,
		currentInscription: statusRes.rows[0].inscription,
		seeds: seeds.map((s) => ({
			category: s.category,
			role: s.role,
			value: s.value,
			variants: s.variants,
			replacement: s.replacement,
			source: s.source
		}))
	});
};
