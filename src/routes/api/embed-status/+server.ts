import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEmbedStatus } from '$lib/server/documents/embeddings.js';

export const GET: RequestHandler = async () => {
	return json(getEmbedStatus());
};
