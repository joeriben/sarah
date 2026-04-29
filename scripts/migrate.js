// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://joerissen@localhost:5432/sarah';

async function migrate() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();

	// Create migrations tracking table
	await client.query(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);

	const applied = await client.query('SELECT name FROM _migrations ORDER BY name');
	const appliedSet = new Set(applied.rows.map((r) => r.name));

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const file of files) {
		if (appliedSet.has(file)) {
			console.log(`  skip: ${file} (already applied)`);
			continue;
		}

		const sql = readFileSync(join(migrationsDir, file), 'utf-8');
		console.log(`  apply: ${file}`);

		await client.query('BEGIN');
		try {
			await client.query(sql);
			await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
			await client.query('COMMIT');
		} catch (e) {
			await client.query('ROLLBACK');
			console.error(`  FAILED: ${file}`, e.message);
			process.exit(1);
		}
	}

	console.log('Migrations complete.');
	await client.end();
}

migrate().catch((e) => {
	console.error('Migration failed:', e);
	process.exit(1);
});
