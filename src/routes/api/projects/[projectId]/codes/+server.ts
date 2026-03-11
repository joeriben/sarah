import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAnnotationCandidates, createOrphanNaming } from '$lib/server/db/queries/codes.js';

export const GET: RequestHandler = async ({ params }) => {
	const candidates = await getAnnotationCandidates(params.projectId);
	return json(candidates);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, color, description } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	try {
		const naming = await createOrphanNaming(params.projectId, locals.user!.id, label, {
			color,
			description
		});
		return json(naming, { status: 201 });
	} catch (e: any) {
		if (e.message?.includes('already exists')) {
			return json({ error: e.message }, { status: 409 });
		}
		throw e;
	}
};
