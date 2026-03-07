import type { RequestHandler } from './$types.js';
import { subscribe } from '$lib/server/ai/sse.js';

// SSE endpoint for real-time AI notifications on a map.
// Clients subscribe by opening a persistent GET connection.
export const GET: RequestHandler = async ({ params }) => {
	const { mapId } = params;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			// Send initial connection event
			controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', mapId })}\n\n`));

			// Heartbeat every 30s to keep connection alive
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: heartbeat\n\n`));
				} catch {
					clearInterval(heartbeat);
				}
			}, 30000);

			// Subscribe to map events
			const unsubscribe = subscribe(mapId, (data) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Client disconnected
					unsubscribe();
					clearInterval(heartbeat);
				}
			});

			// Cleanup on cancel
			controller.enqueue(encoder.encode(``)); // no-op to detect closed
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};
