import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runAutonomousAnalysis, type AutonomousProgress } from '$lib/server/ai/runtime/index.js';
import { queryOne } from '$lib/server/db/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { projectId } = params;
	const body = await request.json().catch(() => ({}));
	const { action } = body;

	if (action === 'start') {
		// Autonoma is project-gated: opt-in via Project Settings to avoid
		// accidentally bulk-coding a non-empty project.
		const proj = await queryOne<{ properties: Record<string, unknown> | null }>(
			`SELECT properties FROM projects WHERE id = $1`,
			[projectId]
		);
		if (!proj || (proj.properties as any)?.autonomaEnabled !== true) {
			error(403, 'Autonoma is disabled for this project. Enable it in Project Settings first.');
		}
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

					send('done', { mapId: result.mapId, summary: result.summary, runId: result.runId });
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
