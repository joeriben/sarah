// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import pg from 'pg';
import { ensureDbRunning } from './docker.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://joerissen@localhost:5432/sarah';

export const pool = new pg.Pool({
	connectionString: DATABASE_URL,
	max: 20,
	connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
	console.error('[db/pool] Idle client error:', err.message);
});

function isConnectionError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	const code = (err as any).code;
	return (
		code === 'ECONNREFUSED' ||
		code === 'ENOTFOUND' ||
		code === 'ETIMEDOUT' ||
		msg.includes('connection refused') ||
		msg.includes('connection terminated') ||
		msg.includes('connect etimedout') ||
		msg.includes('the database system is starting up') ||
		msg.includes('could not connect')
	);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (!isConnectionError(err)) throw err;

		console.warn('[db] Connection error, attempting auto-start...');
		const ok = await ensureDbRunning();
		if (!ok) throw err;

		return fn();
	}
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
	text: string,
	params?: unknown[]
): Promise<pg.QueryResult<T>> {
	return withRetry(() => pool.query<T>(text, params));
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
	text: string,
	params?: unknown[]
): Promise<T | null> {
	return withRetry(async () => {
		const result = await pool.query<T>(text, params);
		return result.rows[0] ?? null;
	});
}

export async function transaction<T>(
	fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
	return withRetry(async () => {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const result = await fn(client);
			await client.query('COMMIT');
			return result;
		} catch (e) {
			await client.query('ROLLBACK');
			throw e;
		} finally {
			client.release();
		}
	});
}
