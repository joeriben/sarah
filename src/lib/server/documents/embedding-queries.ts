// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Embedding-based queries for document navigation.
 * Element text is read by substring against document_content.full_text
 * (migration 027 dropped document_elements.content).
 */

import { query } from '../db/index.js';
import { embed, toPgVector } from './embeddings.js';

export interface SimilarElement {
	id: string;
	documentId: string;
	documentTitle: string;
	content: string;
	elementType: string;
	charStart: number;
	charEnd: number;
	similarity: number;
}

/** SQL fragment that produces an element's text from its char range. */
const TEXT_EXPR =
	"substring(dc.full_text FROM e2.char_start + 1 FOR e2.char_end - e2.char_start)";

/**
 * Find elements most similar to a given element (KNN).
 * Like semantic Ctrl+F — finds related passages across documents.
 */
export async function findSimilarToElement(
	elementId: string,
	projectId: string,
	limit: number = 10,
	sameDocumentOnly: boolean = false
): Promise<SimilarElement[]> {
	const docFilter = sameDocumentOnly
		? `AND e2.document_id = e.document_id`
		: '';

	const result = await query<SimilarElement>(
		`WITH source AS (
		   SELECT embedding, document_id FROM document_elements WHERE id = $1
		 )
		 SELECT e2.id, e2.document_id AS "documentId",
		        n.inscription AS "documentTitle",
		        ${TEXT_EXPR} AS content,
		        e2.element_type AS "elementType",
		        e2.char_start AS "charStart", e2.char_end AS "charEnd",
		        1 - (e2.embedding <=> s.embedding) AS similarity
		 FROM document_elements e2
		 CROSS JOIN source s
		 JOIN namings n ON n.id = e2.document_id AND n.deleted_at IS NULL
		 JOIN document_content dc ON dc.naming_id = e2.document_id
		 JOIN document_elements e ON e.id = $1
		 WHERE e2.embedding IS NOT NULL
		   AND e2.id != $1
		   AND n.project_id = $3
		   ${docFilter}
		 ORDER BY e2.embedding <=> s.embedding
		 LIMIT $2`,
		[elementId, limit, projectId]
	);

	return result.rows;
}

/**
 * Find elements most similar to a free-text query.
 * Computes embedding on the fly, then KNN search.
 */
export async function findSimilarToText(
	text: string,
	projectId: string,
	limit: number = 10,
	documentId?: string
): Promise<SimilarElement[]> {
	const vec = await embed(text);
	const pgVec = toPgVector(vec);

	const docFilter = documentId ? `AND e.document_id = $4` : '';
	const params: unknown[] = [pgVec, limit, projectId];
	if (documentId) params.push(documentId);

	const result = await query<SimilarElement>(
		`SELECT e.id, e.document_id AS "documentId",
		        n.inscription AS "documentTitle",
		        substring(dc.full_text FROM e.char_start + 1 FOR e.char_end - e.char_start) AS content,
		        e.element_type AS "elementType",
		        e.char_start AS "charStart", e.char_end AS "charEnd",
		        1 - (e.embedding <=> $1::vector) AS similarity
		 FROM document_elements e
		 JOIN namings n ON n.id = e.document_id AND n.deleted_at IS NULL
		 JOIN document_content dc ON dc.naming_id = e.document_id
		 WHERE e.embedding IS NOT NULL
		   AND n.project_id = $3
		   ${docFilter}
		 ORDER BY e.embedding <=> $1::vector
		 LIMIT $2`,
		params
	);

	return result.rows;
}

/**
 * Find outlier elements — most distant from the document centroid.
 * Unusual/singular patterns that might be analytically significant.
 */
export async function findOutliers(
	documentId: string,
	projectId: string,
	limit: number = 10
): Promise<SimilarElement[]> {
	const result = await query<SimilarElement>(
		`WITH centroid AS (
		   SELECT AVG(embedding) AS vec
		   FROM document_elements
		   WHERE document_id = $1 AND embedding IS NOT NULL
		 )
		 SELECT e.id, e.document_id AS "documentId",
		        n.inscription AS "documentTitle",
		        substring(dc.full_text FROM e.char_start + 1 FOR e.char_end - e.char_start) AS content,
		        e.element_type AS "elementType",
		        e.char_start AS "charStart", e.char_end AS "charEnd",
		        1 - (e.embedding <=> c.vec) AS similarity
		 FROM document_elements e
		 CROSS JOIN centroid c
		 JOIN namings n ON n.id = e.document_id AND n.deleted_at IS NULL
		 JOIN document_content dc ON dc.naming_id = e.document_id
		 WHERE e.document_id = $1 AND e.embedding IS NOT NULL
		   AND n.project_id = $3
		 ORDER BY e.embedding <=> c.vec DESC
		 LIMIT $2`,
		[documentId, limit, projectId]
	);

	return result.rows;
}

/**
 * Cross-document comparison: for each element in doc A, find the
 * closest element in doc B. Returns pairs showing shared and divergent
 * concepts.
 */
export async function crossDocumentSimilarity(
	docAId: string,
	docBId: string,
	projectId: string,
	limit: number = 20
): Promise<Array<{
	elementA: { id: string; content: string };
	elementB: { id: string; content: string };
	similarity: number;
}>> {
	const result = await query<{
		a_id: string; a_content: string;
		b_id: string; b_content: string;
		similarity: number;
	}>(
		`SELECT DISTINCT ON (a.id)
		        a.id AS a_id,
		        substring(dca.full_text FROM a.char_start + 1 FOR a.char_end - a.char_start) AS a_content,
		        b.id AS b_id,
		        substring(dcb.full_text FROM b.char_start + 1 FOR b.char_end - b.char_start) AS b_content,
		        1 - (a.embedding <=> b.embedding) AS similarity
		 FROM document_elements a
		 JOIN document_content dca ON dca.naming_id = a.document_id
		 JOIN document_elements b ON b.document_id = $2 AND b.embedding IS NOT NULL
		 JOIN document_content dcb ON dcb.naming_id = b.document_id
		 JOIN namings na ON na.id = a.document_id AND na.deleted_at IS NULL
		 JOIN namings nb ON nb.id = b.document_id AND nb.deleted_at IS NULL
		 WHERE a.document_id = $1 AND a.embedding IS NOT NULL
		   AND na.project_id = $4 AND nb.project_id = $4
		 ORDER BY a.id, a.embedding <=> b.embedding
		 LIMIT $3`,
		[docAId, docBId, limit, projectId]
	);

	return result.rows.map(r => ({
		elementA: { id: r.a_id, content: r.a_content },
		elementB: { id: r.b_id, content: r.b_content },
		similarity: r.similarity
	}));
}
