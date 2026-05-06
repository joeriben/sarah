// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { validateSession } from '$lib/server/auth/index.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';
import { queryOne } from '$lib/server/db/index.js';

const DEV_AUTOLOGIN_USERNAME = 'sarah';
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

	// Dev-Single-User-Autologin: in `vite dev` ohne gültige Session
	// automatisch als DEV_AUTOLOGIN_USERNAME einsteigen. Production-Build
	// (npm run build) hat `dev === false`, dort greift dieser Pfad nicht.
	if (dev && !event.locals.user) {
		try {
			const u = await queryOne<{
				id: string;
				username: string;
				email: string;
				display_name: string | null;
				role: string;
				must_change_password: boolean;
			}>(
				'SELECT id, username, email, display_name, role, must_change_password FROM users WHERE username = $1',
				[DEV_AUTOLOGIN_USERNAME]
			);
			if (u) {
				event.locals.user = {
					id: u.id,
					username: u.username,
					email: u.email,
					displayName: u.display_name,
					role: u.role as 'admin' | 'user',
					mustChangePassword: false
				};
			}
		} catch (err) {
			console.warn('[hooks] Dev autologin failed:', (err as Error).message);
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
