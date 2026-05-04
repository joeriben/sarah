// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// H3-Konstrukt-Inhalts-Endpoint für die Werk-Analyse-Sicht.
// Im Gegensatz zu /pipeline-status (liefert nur Done-Counts) gibt dieser
// Endpoint die vollständigen function_constructs.content-Inhalte zurück,
// damit die UI die Werk-Analyse aufbauen kann (Bezugsrahmen, theoretische
// Verortung, Methodik, Befunde, Synthese, Schlussreflexion, Werk-Sicht).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

interface H3Construct {
	id: string;
	outline_function_type: string;
	construct_kind: string;
	content: unknown;
	anchor_element_ids: string[];
	version_stack: unknown[];
	virtual_container_id: string | null;
	source_run_id: string | null;
	created_at: string;
	updated_at: string;
}

interface H3ConstructsResponse {
	case_id: string;
	document_id: string | null;
	constructs: H3Construct[];
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) error(404, 'Case not found');

	const docId = caseRow.central_document_id;
	if (!docId) {
		const empty: H3ConstructsResponse = { case_id: caseId, document_id: null, constructs: [] };
		return json(empty);
	}

	const rows = (await query<H3Construct>(
		`SELECT id, outline_function_type, construct_kind, content,
		        anchor_element_ids, version_stack, virtual_container_id,
		        source_run_id,
		        created_at::text AS created_at,
		        updated_at::text AS updated_at
		 FROM function_constructs
		 WHERE case_id = $1 AND document_id = $2
		 ORDER BY
		   CASE outline_function_type
		     WHEN 'EXPOSITION' THEN 1
		     WHEN 'GRUNDLAGENTHEORIE' THEN 2
		     WHEN 'FORSCHUNGSDESIGN' THEN 3
		     WHEN 'DURCHFUEHRUNG' THEN 4
		     WHEN 'SYNTHESE' THEN 5
		     WHEN 'SCHLUSSREFLEXION' THEN 6
		     WHEN 'WERK_DESKRIPTION' THEN 7
		     WHEN 'WERK_GUTACHT' THEN 8
		     WHEN 'EXKURS' THEN 9
		     WHEN 'WERK_STRUKTUR' THEN 10
		     ELSE 99
		   END,
		   construct_kind,
		   created_at`,
		[caseId, docId]
	)).rows;

	const result: H3ConstructsResponse = {
		case_id: caseId,
		document_id: docId,
		constructs: rows,
	};
	return json(result);
};
