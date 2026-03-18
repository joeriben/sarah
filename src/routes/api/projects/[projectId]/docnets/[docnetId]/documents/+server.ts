import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDocNetDocuments,
	addDocumentToDocNet,
	removeDocumentFromDocNet
} from '$lib/server/db/queries/docnets.js';

export const GET: RequestHandler = async ({ params }) => {
	const documents = await getDocNetDocuments(params.docnetId);
	return json(documents);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { documentId } = await request.json();
	if (!documentId) return json({ error: 'documentId required' }, { status: 400 });

	const result = await addDocumentToDocNet(
		params.projectId, locals.user!.id, params.docnetId, documentId
	);
	return json(result, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const { documentId } = await request.json();
	if (!documentId) return json({ error: 'documentId required' }, { status: 400 });

	await removeDocumentFromDocNet(params.projectId, params.docnetId, documentId);
	return json({ ok: true });
};
