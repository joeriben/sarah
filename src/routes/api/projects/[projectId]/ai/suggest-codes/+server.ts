import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { suggestCodes, logInteraction } from '$lib/server/ai/index.js';
import { getAnnotationCandidates } from '$lib/server/db/queries/codes.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { passage } = await request.json();
	if (!passage) return json({ error: 'passage required' }, { status: 400 });

	try {
		const candidates = await getAnnotationCandidates(params.projectId);
		const existingCodes = candidates.map((c: any) => ({
			label: c.label,
			description: undefined
		}));

		const result = await suggestCodes(params.projectId, passage, existingCodes);

		await logInteraction(
			params.projectId,
			'suggest-codes',
			result.model,
			{ passage: passage.slice(0, 500), existingCodeCount: existingCodes.length },
			{ suggestions: result.suggestions },
			result.tokensUsed
		);

		return json({ suggestions: result.suggestions });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
