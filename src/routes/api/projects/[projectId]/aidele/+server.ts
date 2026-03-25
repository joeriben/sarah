import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { chat } from '$lib/server/ai/client.js';
import { logInteraction } from '$lib/server/ai/index.js';
import { AIDELE_SYSTEM_PROMPT } from '$lib/server/ai/aidele-prompt.js';
import { buildAideleContext } from '$lib/server/ai/aidele-context.js';

const MAX_HISTORY = 40; // Cap conversation history to prevent unbounded token growth

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
		// Build project context for Aidele
		const context = await buildAideleContext(params.projectId, currentPage || 'unknown', currentMapId, message);

		// Truncate history if too long
		const trimmedHistory = (history || []).slice(-MAX_HISTORY);

		// Inject context into the latest user message so Aidele always sees current state
		const userMessage = `CURRENT PROJECT STATE:\n${context}\n\nRESEARCHER'S MESSAGE:\n${message}`;

		const response = await chat({
			system: AIDELE_SYSTEM_PROMPT,
			messages: [
				...trimmedHistory,
				{ role: 'user', content: userMessage }
			],
			maxTokens: 3000
			// No tools — Aidele is text-only
		});

		// Log interaction for usage tracking
		await logInteraction(
			params.projectId,
			'aidele',
			response.model,
			{ currentPage, currentMapId, messageCount: trimmedHistory.length },
			{ text: response.text.slice(0, 500) },
			response.tokensUsed,
			response.provider,
			response.inputTokens,
			response.outputTokens
		);

		return json({ response: response.text });
	} catch (e: any) {
		console.error('Aidele error:', e.message);
		return json({ error: e.message }, { status: 500 });
	}
};
