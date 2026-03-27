import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db/index.js';
import { embedDocumentElements } from '$lib/server/documents/embed-elements.js';

/**
 * POST: Compute missing embeddings for a document (no re-parsing).
 */
export async function POST({ params }: { params: { projectId: string; docId: string } }) {
	const { projectId, docId } = params;

	// Verify document exists
	const doc = await query(
		`SELECT n.id FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);
	if (doc.rows.length === 0) {
		return json({ error: 'Document not found' }, { status: 404 });
	}

	const embedded = await embedDocumentElements(docId);

	const counts = await query<{ elements: number; embeddings: number }>(
		`SELECT
		   COUNT(*) FILTER (WHERE content IS NOT NULL)::int AS elements,
		   COUNT(embedding)::int AS embeddings
		 FROM document_elements WHERE document_id = $1`,
		[docId]
	);

	return json({
		embedded,
		elements: counts.rows[0].elements,
		embeddings: counts.rows[0].embeddings
	});
}
