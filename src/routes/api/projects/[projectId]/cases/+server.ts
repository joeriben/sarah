// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Case anlegen im Project. Architektur-Setzung 2026-05-03: jedes Doc gehört
// zu einem Case (no caseless docs). Anlege-Reihenfolge: Project → Case → Doc.
// Bei der Anlage darf das zentrale Dokument noch nicht in einem anderen Case
// hängen (caseless im Sinne von: nicht als central/annotation/review_draft an
// einem Case verwurzelt).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

interface CreateCaseBody {
	name?: string;
	briefId?: string;
	centralDocumentId?: string;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId required');

	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, locals.user.id]
	);
	if (!member) error(403, 'Not a member of this project');

	const body = (await request.json().catch(() => null)) as CreateCaseBody | null;
	if (!body || typeof body.name !== 'string' || typeof body.briefId !== 'string' || typeof body.centralDocumentId !== 'string') {
		error(400, 'name, briefId, centralDocumentId required');
	}
	const name = body.name.trim();
	if (!name) error(400, 'name must not be empty');

	const brief = await queryOne<{ id: string }>(`SELECT id FROM assessment_briefs WHERE id = $1`, [body.briefId]);
	if (!brief) error(404, 'Brief not found');

	const doc = await queryOne<{ id: string; project_id: string }>(
		`SELECT n.id, n.project_id
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.deleted_at IS NULL`,
		[body.centralDocumentId]
	);
	if (!doc) error(404, 'Document not found');
	if (doc.project_id !== projectId) error(400, 'Document belongs to another project');

	const conflict = await queryOne<{ id: string }>(
		`SELECT id FROM cases
		 WHERE central_document_id = $1
		    OR annotation_document_id = $1
		    OR review_draft_document_id = $1`,
		[body.centralDocumentId]
	);
	if (conflict) error(409, 'Document is already attached to another case');

	const inserted = await queryOne<{ id: string }>(
		`INSERT INTO cases (project_id, name, central_document_id, assessment_brief_id, created_by)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		[projectId, name, body.centralDocumentId, body.briefId, locals.user.id]
	);
	if (!inserted) error(500, 'Insert failed');

	return json({ caseId: inserted.id }, { status: 201 });
};
