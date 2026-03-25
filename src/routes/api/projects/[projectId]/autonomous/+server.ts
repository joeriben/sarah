import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runAutonomousAnalysis, type AutonomousProgress } from '$lib/server/ai/runtime/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { projectId } = params;
	const body = await request.json().catch(() => ({}));
	const { action } = body;

	if (action === 'start') {
		// SSE streaming response — client sees Autonomous's thinking live
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const send = (event: string, data: unknown) => {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				};

				try {
					const result = await runAutonomousAnalysis(projectId, (progress) => {
						send('progress', progress);
					});

					send('done', { mapId: result.mapId, summary: result.summary });
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					send('error', { error: msg });
				} finally {
					controller.close();
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	}

	return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
