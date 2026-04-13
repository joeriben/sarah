import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { changePassword } from '$lib/server/auth/index.js';

const schema = z.object({
	oldPassword: z.string().min(1),
	newPassword: z.string().min(8)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ error: 'Invalid request' }, { status: 400 });

	const result = await changePassword(locals.user.id, parsed.data.oldPassword, parsed.data.newPassword);
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json({ ok: true });
};
