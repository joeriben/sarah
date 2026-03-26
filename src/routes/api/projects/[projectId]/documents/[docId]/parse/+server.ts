import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { pool, query } from '$lib/server/db/index.js';
import { reparseDocument } from '$lib/server/documents/parsers/index.js';
import { embedDocumentElements } from '$lib/server/documents/embed-elements.js';

/**
 * Parse (or re-parse) a document into elements and compute embeddings.
 */
export const POST: RequestHandler = async ({ params }) => {
	const { projectId, docId } = params;

	const doc = await query<{ full_text: string; mime_type: string }>(
		`SELECT dc.full_text, dc.mime_type
		 FROM document_content dc
		 JOIN namings n ON n.id = dc.naming_id
		 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);

	if (doc.rows.length === 0 || !doc.rows[0].full_text) {
		return json({ error: 'Document not found or has no text' }, { status: 404 });
	}

	// Step 1: Parse
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await reparseDocument(client, docId, doc.rows[0].full_text, doc.rows[0].mime_type);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		return json({ error: 'Parse failed' }, { status: 500 });
	} finally {
		client.release();
	}

	// Step 2: Embed
	const embedded = await embedDocumentElements(docId);

	// Get counts
	const counts = await query<{ elements: number; embeddings: number }>(
		`SELECT
		   COUNT(*)::int AS elements,
		   COUNT(embedding)::int AS embeddings
		 FROM document_elements WHERE document_id = $1`,
		[docId]
	);

	return json({
		elements: counts.rows[0].elements,
		embeddings: counts.rows[0].embeddings
	});
};
