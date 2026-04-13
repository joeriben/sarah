import * as argon2 from 'argon2';
import crypto from 'node:crypto';
import { query, queryOne } from '../db/index.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(password: string): Promise<string> {
	return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
	return argon2.verify(hash, password);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = crypto.randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	await query(
		'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
		[userId, token, expiresAt]
	);

	return { token, expiresAt };
}

export async function validateSession(token: string) {
	const session = await queryOne<{
		id: string;
		user_id: string;
		expires_at: Date;
		username: string;
		email: string;
		display_name: string | null;
		role: string;
		must_change_password: boolean;
	}>(
		`SELECT s.id, s.user_id, s.expires_at,
		        u.username, u.email, u.display_name, u.role, u.must_change_password
		 FROM sessions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.token = $1 AND s.expires_at > now()`,
		[token]
	);

	if (!session) return null;

	return {
		sessionId: session.id,
		user: {
			id: session.user_id,
			username: session.username,
			email: session.email,
			displayName: session.display_name,
			role: session.role,
			mustChangePassword: session.must_change_password
		}
	};
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
	const user = await queryOne<{ password_hash: string }>(
		'SELECT password_hash FROM users WHERE id = $1',
		[userId]
	);
	if (!user) return { ok: false, error: 'User not found' };
	if (!(await verifyPassword(user.password_hash, oldPassword))) {
		return { ok: false, error: 'Current password is incorrect' };
	}
	if (newPassword.length < 8) {
		return { ok: false, error: 'New password must be at least 8 characters' };
	}
	if (newPassword === oldPassword) {
		return { ok: false, error: 'New password must differ from current password' };
	}
	const newHash = await hashPassword(newPassword);
	await query(
		'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
		[newHash, userId]
	);
	return { ok: true };
}

export async function deleteSession(token: string): Promise<void> {
	await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function deleteExpiredSessions(): Promise<void> {
	await query('DELETE FROM sessions WHERE expires_at < now()');
}
