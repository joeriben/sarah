import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getReference, getReferenceChunks, deleteReference, preprocessReference } from '$lib/server/ai/coach-library.js';

// Get single reference with its chunks
export const GET: RequestHandler = async ({ params }) => {
	try {
		const ref = await getReference(params.id);
		if (!ref) return json({ error: 'Not found' }, { status: 404 });
		const chunks = await getReferenceChunks(params.id);
		return json({ reference: ref, chunks });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};

// Trigger preprocessing or delete
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	if (body.action === 'preprocess') {
		try {
			await preprocessReference(params.id);
			const ref = await getReference(params.id);
			return json({ ok: true, indexed_at: ref?.indexed_at, index_data: ref?.index_data });
		} catch (e: any) {
			console.error('Preprocessing error:', e);
			return json({ error: e.message }, { status: 500 });
		}
	}
	return json({ error: 'Unknown action' }, { status: 400 });
};

// Delete reference
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteReference(params.id);
		return json({ ok: true });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
