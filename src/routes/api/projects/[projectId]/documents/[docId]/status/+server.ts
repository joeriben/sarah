// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import { query } from '$lib/server/db/index.js';

export async function GET({ params }) {
	const { projectId, docId } = params;

	const result = await query(
		`SELECT COUNT(*)::int as element_count,
		        COUNT(de.embedding)::int as embedded_count
		 FROM document_elements de
		 WHERE de.document_id = $1`,
		[docId]
	);

	const row = result.rows[0];
	return json({
		element_count: row?.element_count || 0,
		embedded_count: row?.embedded_count || 0
	});
}
