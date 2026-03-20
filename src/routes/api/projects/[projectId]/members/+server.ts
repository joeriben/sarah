import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { addMemberSchema, changeMemberRoleSchema, removeMemberSchema } from '$lib/shared/validation.js';

async function requireRole(projectId: string, userId: string, ...roles: string[]): Promise<string | null> {
	const row = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!row || !roles.includes(row.role)) return null;
	return row.role;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const { projectId } = params;

	// Any member can list members
	const myRole = await requireRole(projectId, userId, 'owner', 'admin', 'member', 'viewer');
	if (!myRole) return json({ error: 'Not a member' }, { status: 403 });

	const result = await query(
		`SELECT u.id, u.username, u.display_name, u.email, pm.role
		 FROM project_members pm
		 JOIN users u ON u.id = pm.user_id
		 WHERE pm.project_id = $1
		 ORDER BY
		   CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
		   u.username`,
		[projectId]
	);

	return json({ members: result.rows, myRole });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.user!.id;
	const { projectId } = params;

	const myRole = await requireRole(projectId, userId, 'owner', 'admin');
	if (!myRole) return json({ error: 'Only owners and admins can add members' }, { status: 403 });

	const body = await request.json();
	const parsed = addMemberSchema.safeParse(body);
	if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });

	const { username, role } = parsed.data;

	// Only owners can add admins
	if (role === 'admin' && myRole !== 'owner') {
		return json({ error: 'Only owners can add admins' }, { status: 403 });
	}

	// Find user by username (case-insensitive)
	const targetUser = await queryOne<{ id: string; username: string; display_name: string | null }>(
		`SELECT id, username, display_name FROM users WHERE LOWER(username) = LOWER($1)`,
		[username]
	);
	if (!targetUser) return json({ error: `User "${username}" not found` }, { status: 404 });

	// Check if already a member
	const existing = await queryOne(
		`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, targetUser.id]
	);
	if (existing) return json({ error: `${username} is already a member` }, { status: 409 });

	await query(
		`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)`,
		[projectId, targetUser.id, role]
	);

	return json({
		id: targetUser.id,
		username: targetUser.username,
		display_name: targetUser.display_name,
		role
	}, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.user!.id;
	const { projectId } = params;

	const myRole = await requireRole(projectId, userId, 'owner', 'admin');
	if (!myRole) return json({ error: 'Only owners and admins can change roles' }, { status: 403 });

	const body = await request.json();
	const parsed = changeMemberRoleSchema.safeParse(body);
	if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });

	const { userId: targetUserId, role: newRole } = parsed.data;

	// Can't change own role
	if (targetUserId === userId) return json({ error: "Can't change your own role" }, { status: 400 });

	// Check target's current role
	const target = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, targetUserId]
	);
	if (!target) return json({ error: 'User is not a member' }, { status: 404 });

	// Can't change owner role
	if (target.role === 'owner') return json({ error: "Can't change owner's role" }, { status: 403 });

	// Only owners can promote to admin
	if (newRole === 'admin' && myRole !== 'owner') {
		return json({ error: 'Only owners can promote to admin' }, { status: 403 });
	}

	// Admins can't change other admins
	if (target.role === 'admin' && myRole !== 'owner') {
		return json({ error: "Only owners can change admin roles" }, { status: 403 });
	}

	await query(
		`UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3`,
		[newRole, projectId, targetUserId]
	);

	return json({ ok: true, role: newRole });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.user!.id;
	const { projectId } = params;

	const myRole = await requireRole(projectId, userId, 'owner', 'admin');
	if (!myRole) return json({ error: 'Only owners and admins can remove members' }, { status: 403 });

	const body = await request.json();
	const parsed = removeMemberSchema.safeParse(body);
	if (!parsed.success) return json({ error: 'Invalid input' }, { status: 400 });

	const { userId: targetUserId } = parsed.data;

	// Can't remove yourself
	if (targetUserId === userId) return json({ error: "Can't remove yourself" }, { status: 400 });

	const target = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, targetUserId]
	);
	if (!target) return json({ error: 'User is not a member' }, { status: 404 });

	// Can't remove owner
	if (target.role === 'owner') return json({ error: "Can't remove the project owner" }, { status: 403 });

	// Admins can't remove other admins
	if (target.role === 'admin' && myRole !== 'owner') {
		return json({ error: "Only owners can remove admins" }, { status: 403 });
	}

	await query(
		`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, targetUserId]
	);

	return json({ ok: true });
};
