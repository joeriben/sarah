import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runRaichelAnalysis, type RaichelProgress } from '$lib/server/ai/runtime/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { projectId } = params;
	const body = await request.json().catch(() => ({}));
	const { action } = body;

	if (action === 'start') {
		// Collect progress events, run analysis, return result
		const progressLog: RaichelProgress[] = [];

		try {
			const result = await runRaichelAnalysis(projectId, (progress) => {
				progressLog.push(progress);
			});

			return json({
				success: true,
				mapId: result.mapId,
				summary: result.summary,
				progress: progressLog
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return json({
				success: false,
				error: msg,
				progress: progressLog
			}, { status: 500 });
		}
	}

	return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
