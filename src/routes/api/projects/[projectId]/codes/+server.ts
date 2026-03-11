import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getCodeTree, createCode } from '$lib/server/db/queries/codes.js';

export const GET: RequestHandler = async ({ params }) => {
	const codes = await getCodeTree(params.projectId);
	return json(codes);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, color, parentId, description } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	try {
		const code = await createCode(params.projectId, locals.user!.id, label, {
			color,
			parentId,
			description
		});
		return json(code, { status: 201 });
	} catch (e: any) {
		if (e.message?.includes('already exists')) {
			return json({ error: e.message }, { status: 409 });
		}
		throw e;
	}
};
