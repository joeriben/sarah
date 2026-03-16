import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { updateMemoStatus } from '$lib/server/db/queries/memos.js';

export const PUT: RequestHandler = async ({ params, request }) => {
	const { status } = await request.json();
	if (!status) return json({ error: 'status required' }, { status: 400 });
	const validStatuses = ['active', 'presented', 'discussed', 'acknowledged', 'promoted', 'dismissed'];
	if (!validStatuses.includes(status)) return json({ error: 'Invalid status' }, { status: 400 });

	await updateMemoStatus(params.memoId, status);
	return json({ ok: true, status });
};
