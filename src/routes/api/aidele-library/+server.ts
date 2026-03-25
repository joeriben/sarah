import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { listReferences, addReference, extractTextFromPdf, exportLibrary } from '$lib/server/ai/aidele-library.js';

// List all references
export const GET: RequestHandler = async () => {
	try {
		const refs = await listReferences();
		return json({ references: refs });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};

// Upload a new reference (multipart form or JSON)
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const contentType = request.headers.get('content-type') || '';

		if (contentType.includes('multipart/form-data')) {
			// File upload (PDF or text file)
			const formData = await request.formData();
			const file = formData.get('file') as File | null;
			const title = (formData.get('title') as string) || '';
			const author = (formData.get('author') as string) || '';
			const description = (formData.get('description') as string) || '';

			if (!file || !title) {
				return json({ error: 'file and title required' }, { status: 400 });
			}

			const buffer = Buffer.from(await file.arrayBuffer());
			const filename = file.name;
			const isPdf = filename.toLowerCase().endsWith('.pdf');

			let content: string;
			let format: 'pdf' | 'text' | 'markdown';

			if (isPdf) {
				content = await extractTextFromPdf(buffer);
				format = 'pdf';
			} else if (filename.endsWith('.md')) {
				content = buffer.toString('utf-8');
				format = 'markdown';
			} else {
				content = buffer.toString('utf-8');
				format = 'text';
			}

			if (!content.trim()) {
				return json({ error: 'No text could be extracted from the file' }, { status: 400 });
			}

			const id = await addReference({
				title, author, description, content, filename, format,
				fileBuffer: buffer,
				userId: locals.user?.id
			});

			return json({ id });
		} else {
			// JSON body (paste text directly)
			const body = await request.json();
			const { title, author, description, content } = body as {
				title: string; author?: string; description?: string; content: string;
			};

			if (!title || !content?.trim()) {
				return json({ error: 'title and content required' }, { status: 400 });
			}

			const id = await addReference({
				title, author, description, content,
				format: 'text',
				userId: locals.user?.id
			});

			return json({ id });
		}
	} catch (e: any) {
		console.error('Aidele library upload error:', e);
		return json({ error: e.message }, { status: 500 });
	}
};
