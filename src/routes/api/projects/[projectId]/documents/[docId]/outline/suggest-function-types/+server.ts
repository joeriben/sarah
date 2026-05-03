// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// POST-Endpoint zur Auslösung der Vor-Heuristik FUNKTIONSTYP_ZUWEISEN
// gemäß project_three_heuristics_architecture.md.
//
// Verhalten:
//   * Computed pro Outline-Knoten einen Funktionstyp-/Granularitäts-
//     Vorschlag (inferenzarm: Heading-Regex + Position).
//   * Persistiert die Vorschläge in heading_classifications mit
//     outline_function_type_user_set=false — bestehende User-Setzungen
//     (user_set=true) werden nicht überschrieben.
//   * Antwortet mit der Liste der Vorschläge inkl. Confidence/Reason,
//     damit das UI die Heuristik-Wirkung sichtbar machen kann.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { suggestFunctionTypesForDocument } from '$lib/server/pipeline/function-type-assignment.js';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { docId } = params;
	if (!docId) throw error(400, 'docId required');

	try {
		const result = await suggestFunctionTypesForDocument(docId);
		return json(result);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};
