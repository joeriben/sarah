import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { resolveFilePath } from '$lib/server/files/index.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const GET: RequestHandler = async ({ params }) => {
	const doc = await queryOne<{ file_path: string; mime_type: string }>(
		`SELECT dc.file_path, dc.mime_type
		 FROM document_content dc
		 JOIN namings n ON n.id = dc.naming_id
		 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);

	if (!doc) error(404, 'Document not found');
	if (!doc.mime_type.startsWith('image/')) error(400, 'Not an image document');

	const absolutePath = await resolveFilePath(params.projectId, doc.file_path);
	if (!absolutePath) error(404, 'File not found on disk');

	const fileStat = await stat(absolutePath);
	const stream = createReadStream(absolutePath);
	const webStream = Readable.toWeb(stream) as ReadableStream;

	return new Response(webStream, {
		headers: {
			'Content-Type': doc.mime_type,
			'Content-Length': String(fileStat.size),
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
