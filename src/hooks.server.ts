// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth/index.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';
// Embeddings deferred — see /api/upload/+server.ts comment.
// preloadEmbedModel() is not called on server start; the model is only
// loaded when the /api/projects/[id]/documents/[id]/embed endpoint is
// invoked explicitly.

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);

	if (token) {
		try {
			const session = await validateSession(token);
			if (session) {
				event.locals.user = { ...session.user, role: session.user.role as 'admin' | 'user' };
				event.locals.sessionId = session.sessionId;
			} else {
				event.cookies.delete(SESSION_COOKIE, { path: '/' });
			}
		} catch (err) {
			console.warn('[hooks] Session validation failed:', (err as Error).message);
		}
	}

	// Protect all routes except login and API auth
	const path = event.url.pathname;
	const isPublic = path === '/login' || path.startsWith('/api/auth') || path === '/api/db-status';

	if (!isPublic && !event.locals.user) {
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(null, {
			status: 303,
			headers: { location: '/login' }
		});
	}

	return resolve(event);
};
