import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { importProject } from '$lib/server/qdpx/import.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const projectName = formData.get('name') as string | null;

	if (!file) {
		return json({ error: 'No file uploaded' }, { status: 400 });
	}

	if (!file.name.endsWith('.qdpx')) {
		return json({ error: 'File must be a .qdpx archive' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	try {
		const result = await importProject(buffer, userId, projectName || undefined);
		return json(result, { status: 201 });
	} catch (error: any) {
		const msg = error instanceof Error ? error.message : String(error);
		const { writeFileSync } = await import('fs');
		writeFileSync('/tmp/qdpx-import-error.log', `${new Date().toISOString()}\n${msg}\n${error?.detail || ''}\n${error?.stack || ''}\n`);
		return new Response(JSON.stringify({ error: msg }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
