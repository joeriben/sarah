import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDocNetsByProject, createDocNet } from '$lib/server/db/queries/docnets.js';

export const GET: RequestHandler = async ({ params }) => {
	const docnets = await getDocNetsByProject(params.projectId);
	return json(docnets);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	const docnet = await createDocNet(params.projectId, locals.user!.id, label);
	return json(docnet, { status: 201 });
};
