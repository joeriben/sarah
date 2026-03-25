import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runConversation } from '$lib/server/ai/runtime/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { message, history, currentPage, currentMapId } = body as {
		message: string;
		history: Array<{ role: 'user' | 'assistant'; content: string }>;
		currentPage: string;
		currentMapId?: string;
	};

	if (!message?.trim()) {
		return json({ error: 'message required' }, { status: 400 });
	}

	try {
		const result = await runConversation('coach', params.projectId, message, history || [], {
			currentPage,
			mapId: currentMapId,
			maxTokens: 16000
		});

		return json({ response: result.response });
	} catch (e: any) {
		console.error('Coach error:', e.message);
		return json({ error: e.message }, { status: 500 });
	}
};
