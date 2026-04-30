// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { queryOne } from '$lib/server/db/index.js';
import { loadEffectiveOutline } from '$lib/server/documents/outline.js';

export const load: PageServerLoad = async ({ params }) => {
	const doc = await queryOne<{ id: string; label: string }>(
		`SELECT n.id, n.inscription AS label
		 FROM namings n
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);
	if (!doc) error(404, 'Document not found');

	const outline = await loadEffectiveOutline(params.docId);
	if (!outline) error(404, 'Outline not found');

	return {
		document: doc,
		outline,
		projectId: params.projectId,
		docId: params.docId
	};
};
