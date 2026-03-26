import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { transaction } from '$lib/server/db/index.js';
import { saveFile } from '$lib/server/files/index.js';
import { extractText, detectMimeType } from '$lib/server/documents/index.js';
import { parseAndStore } from '$lib/server/documents/parsers/index.js';
import { embedDocumentElements } from '$lib/server/documents/embed-elements.js';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		return json({ error: 'projectId required' }, { status: 400 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const mimeType = detectMimeType(file.name);
	const filePath = await saveFile(buffer, file.name, projectId);
	const fullText = await extractText(buffer, mimeType);

	const doc = await transaction(async (client) => {
		// The document is a naming
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id, inscription as label, created_at`,
			[projectId, file.name, locals.user!.id]
		);
		const namingId = namingRes.rows[0].id;

		// Store content
		await client.query(
			`INSERT INTO document_content (naming_id, full_text, file_path, mime_type, file_size)
			 VALUES ($1, $2, $3, $4, $5)`,
			[namingId, fullText, filePath, mimeType, buffer.length]
		);

		// Parse into addressable elements (paragraphs, sentences, ...)
		if (fullText) {
			await parseAndStore(client, namingId, fullText, mimeType);
		}

		// Count parsed leaf elements (sentences/headings with content)
		const countRes = await client.query(
			`SELECT COUNT(*)::int as cnt FROM document_elements WHERE document_id = $1 AND content IS NOT NULL`, [namingId]
		);

		return {
			id: namingId,
			label: namingRes.rows[0].label,
			created_at: namingRes.rows[0].created_at,
			mime_type: mimeType,
			file_size: buffer.length,
			element_count: countRes.rows[0].cnt,
			embedded_count: 0
		};
	});

	// Compute embeddings after transaction commits (async, non-blocking)
	if (fullText) {
		embedDocumentElements(doc.id).catch(err =>
			console.error(`Embedding failed for document ${doc.id}:`, err)
		);
	}

	return json(doc, { status: 201 });
};
