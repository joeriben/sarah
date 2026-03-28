import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAnnotationsByDocument, createAnnotation, deleteAnnotation, countCodeUsages, addAnnotationMemo } from '$lib/server/db/queries/codes.js';

export const GET: RequestHandler = async ({ params }) => {
	const annotations = await getAnnotationsByDocument(params.projectId, params.docId);
	return json(annotations);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { codeId, anchorType, anchor, comment } = await request.json();
	if (!codeId || !anchorType || !anchor) {
		return json({ error: 'codeId, anchorType, and anchor required' }, { status: 400 });
	}

	const annotation = await createAnnotation(
		params.projectId,
		locals.user!.id,
		codeId,
		params.docId,
		anchorType,
		anchor,
		comment
	);
	return json(annotation, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { annotationId, codeId, memo } = await request.json();
	if (!annotationId || !codeId || !memo?.trim()) {
		return json({ error: 'annotationId, codeId, and memo required' }, { status: 400 });
	}
	await addAnnotationMemo(params.projectId, locals.user!.id, annotationId, codeId, memo);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	const annotationId = url.searchParams.get('id');
	if (!annotationId) return json({ error: 'id required' }, { status: 400 });

	// Check mode: return what WOULD happen without deleting
	if (url.searchParams.get('check') === '1') {
		const codeId = url.searchParams.get('codeId');
		if (!codeId) return json({ error: 'codeId required for check' }, { status: 400 });
		const otherUsages = await countCodeUsages(codeId, params.projectId, annotationId);
		return json({ wouldDeleteCode: otherUsages === 0 });
	}

	const result = await deleteAnnotation(annotationId, params.projectId);
	return json(result);
};
