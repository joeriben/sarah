import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDocNet } from '$lib/server/db/queries/docnets.js';
import { renameNaming } from '$lib/server/db/queries/namings.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { label } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	await renameNaming(params.docnetId, params.projectId, locals.user!.id, label);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteDocNet(params.docnetId, params.projectId);
	return json({ ok: true });
};
