// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compute and store embeddings for document elements.
 * Called after parseAndStore — outside the upload transaction
 * (embedding is a network call to the model, shouldn't block DB).
 *
 * As of migration 027, document_elements.content does not exist.
 * The text of any element is its slice of document_content.full_text.
 * Sentences (and other leaf types) are the embedding targets — we
 * filter by element_type rather than by content presence.
 */

import { query } from '../db/index.js';
import { embed, toPgVector } from './embeddings.js';

const LEAF_TYPES = ['sentence', 'heading', 'footnote', 'caption', 'toc_entry', 'turn'];

/**
 * Compute embeddings for all leaf elements of a document that don't
 * have an embedding yet. Reads each element's text by substring against
 * the document's full_text.
 */
export async function embedDocumentElements(documentId: string): Promise<number> {
	const elements = (await query<{ id: string; text: string }>(
		`SELECT e.id,
		        substring(dc.full_text FROM e.char_start + 1
		                  FOR e.char_end - e.char_start) AS text
		 FROM document_elements e
		 JOIN document_content dc ON dc.naming_id = e.document_id
		 WHERE e.document_id = $1
		   AND e.element_type = ANY($2::text[])
		   AND e.embedding IS NULL
		 ORDER BY e.char_start`,
		[documentId, LEAF_TYPES]
	)).rows;

	if (elements.length === 0) return 0;

	let embedded = 0;
	for (const el of elements) {
		if (!el.text || !el.text.trim()) continue;
		try {
			const vec = await embed(el.text);
			await query(
				`UPDATE document_elements SET embedding = $1::vector WHERE id = $2`,
				[toPgVector(vec), el.id]
			);
			embedded++;
		} catch (err) {
			console.error(`Embedding failed for element ${el.id}:`, err);
			// Continue with remaining elements — don't fail the whole batch.
		}
	}

	return embedded;
}

/**
 * Embed all documents in a project that have parsed leaf elements
 * without embeddings.
 */
export async function embedAllDocuments(
	projectId?: string
): Promise<{ embedded: number; documents: number }> {
	const params: unknown[] = [LEAF_TYPES];
	let whereClause = '';
	if (projectId) {
		params.push(projectId);
		whereClause = `AND n.project_id = $${params.length}`;
	}

	const docs = (await query<{ document_id: string }>(
		`SELECT DISTINCT e.document_id
		 FROM document_elements e
		 JOIN namings n ON n.id = e.document_id AND n.deleted_at IS NULL
		 WHERE e.element_type = ANY($1::text[]) AND e.embedding IS NULL
		 ${whereClause}`,
		params
	)).rows;

	let totalEmbedded = 0;
	for (const doc of docs) {
		const count = await embedDocumentElements(doc.document_id);
		totalEmbedded += count;
	}

	return { embedded: totalEmbedded, documents: docs.length };
}
