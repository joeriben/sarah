/**
 * Project Sync — PostgreSQL ↔ Project Directory
 *
 * PostgreSQL is the runtime query engine.
 * The project directory is the canonical storage (COPY text format + files).
 * Periodic sync (~60s) writes DB state to directory.
 */

import { pool } from '$lib/server/db';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, rename, readdir, stat, rm, copyFile, open as openFile } from 'fs/promises';
import { join, basename } from 'path';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import type pg from 'pg';

const PROJECTS_DIR = join(process.cwd(), 'projekte');

/**
 * Tables in FK-safe load order.
 * Each entry: [filename, COPY TO query, COPY FROM target table, sequence columns to reset]
 */
const PROJECT_TABLES: {
	file: string;
	copyToQuery: (projectId: string) => string;
	copyFromTable: string;
	sequences?: { table: string; column: string }[];
}[] = [
	// 1. Users subset (referenced by namings.created_by, project_members.user_id, etc.)
	{
		file: 'users.copy',
		copyToQuery: (pid) => `COPY (
			SELECT DISTINCT u.* FROM users u WHERE u.id IN (
				SELECT created_by FROM namings WHERE project_id = '${pid}'
				UNION SELECT user_id FROM project_members WHERE project_id = '${pid}'
				UNION SELECT user_id FROM researcher_namings WHERE project_id = '${pid}'
			)
		) TO STDOUT`,
		copyFromTable: 'users'
	},
	// 2. Project (single row)
	{
		file: 'projects.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM projects WHERE id = '${pid}') TO STDOUT`,
		copyFromTable: 'projects'
	},
	// 3. Project members
	{
		file: 'project_members.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM project_members WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'project_members'
	},
	// 4. Namings (everything else depends on this)
	{
		file: 'namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'namings',
		sequences: [{ table: 'namings', column: 'seq' }]
	},
	// 5. Naming acts
	{
		file: 'naming_acts.copy',
		copyToQuery: (pid) => `COPY (
			SELECT na.* FROM naming_acts na
			JOIN namings n ON n.id = na.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'naming_acts',
		sequences: [{ table: 'naming_acts', column: 'seq' }]
	},
	// 6. Appearances
	{
		file: 'appearances.copy',
		copyToQuery: (pid) => `COPY (
			SELECT a.* FROM appearances a
			JOIN namings n ON n.id = a.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'appearances'
	},
	// 7. Participations
	{
		file: 'participations.copy',
		copyToQuery: (pid) => `COPY (
			SELECT p.* FROM participations p
			JOIN namings n ON n.id = p.id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'participations'
	},
	// 8. Document content
	{
		file: 'document_content.copy',
		copyToQuery: (pid) => `COPY (
			SELECT dc.* FROM document_content dc
			JOIN namings n ON n.id = dc.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'document_content'
	},
	// 9. Memo content
	{
		file: 'memo_content.copy',
		copyToQuery: (pid) => `COPY (
			SELECT mc.* FROM memo_content mc
			JOIN namings n ON n.id = mc.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'memo_content'
	},
	// 10. Cluster memberships
	{
		file: 'cluster_memberships.copy',
		copyToQuery: (pid) => `COPY (
			SELECT cm.* FROM cluster_memberships cm
			JOIN namings n ON n.id = cm.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'cluster_memberships',
		sequences: [{ table: 'cluster_memberships', column: 'seq' }]
	},
	// 11. Topology snapshots
	{
		file: 'topology_snapshots.copy',
		copyToQuery: (pid) => `COPY (
			SELECT ts.* FROM topology_snapshots ts
			JOIN namings n ON n.id = ts.map_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'topology_snapshots'
	},
	// 12. Researcher namings
	{
		file: 'researcher_namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM researcher_namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'researcher_namings'
	},
	// 13. AI namings
	{
		file: 'ai_namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM ai_namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'ai_namings'
	},
	// 14. AI interactions (can be large, but included for completeness)
	{
		file: 'ai_interactions.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM ai_interactions WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'ai_interactions'
	}
];

/**
 * Export a project from PostgreSQL to its project directory.
 * Writes each table as a PostgreSQL COPY text file.
 * Uses atomic writes (tmp → rename) to prevent corruption.
 */
export async function exportProjectToDir(projectId: string, projectSlug: string): Promise<string> {
	const dir = join(PROJECTS_DIR, projectSlug);
	await mkdir(dir, { recursive: true });
	await mkdir(join(dir, 'files'), { recursive: true });

	const client = await pool.connect();
	try {
		for (const table of PROJECT_TABLES) {
			const tmpPath = join(dir, table.file + '.tmp');
			const finalPath = join(dir, table.file);
			const outStream = createWriteStream(tmpPath);
			const pgStream = client.query(copyTo(table.copyToQuery(projectId)));
			await pipeline(pgStream, outStream);
			await rename(tmpPath, finalPath);
		}

		// Sync files from legacy uploads/ to project dir if needed
		const legacyDir = join(process.cwd(), 'uploads', projectId);
		const legacyExists = await stat(legacyDir).catch(() => null);
		if (legacyExists?.isDirectory()) {
			const files = await readdir(legacyDir);
			for (const file of files) {
				const dest = join(dir, 'files', file);
				const destExists = await stat(dest).catch(() => null);
				if (!destExists) {
					await copyFile(join(legacyDir, file), dest);
				}
			}
		}
	} finally {
		client.release();
	}

	return dir;
}

/**
 * Read the column count of the first data row in a COPY text file.
 * Returns null on empty file or single end-of-data marker. Used to make
 * imports forward-compatible: when newer migrations have appended columns
 * at the end of a table, an older .copy file can still be loaded by
 * naming only the columns it actually contains; the rest take DEFAULTs.
 */
async function countColumnsInFile(filePath: string): Promise<number | null> {
	const fh = await openFile(filePath, 'r');
	try {
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await fh.read(buf, 0, 8192, 0);
		if (bytesRead === 0) return null;
		const text = buf.subarray(0, bytesRead).toString('utf8');
		const nl = text.indexOf('\n');
		const firstLine = nl === -1 ? text : text.slice(0, nl);
		if (!firstLine || firstLine === '\\.') return null;
		// COPY text format: tab-separated; tabs in data are escaped as \t,
		// so a literal \t separator is always a single tab character.
		return firstLine.split('\t').length;
	} finally {
		await fh.close();
	}
}

async function getTableColumns(client: pg.PoolClient, tableName: string): Promise<string[]> {
	const r = await client.query<{ column_name: string }>(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1
		 ORDER BY ordinal_position`,
		[tableName]
	);
	return r.rows.map((x) => x.column_name);
}

/**
 * Build the COPY FROM target clause. If the file has fewer columns than the
 * current table (older export, newer schema), explicitly name the leading
 * columns; the trailing ones get their DEFAULT. Postgres always appends new
 * columns at the end, so taking the first N is correct.
 */
async function buildCopyTarget(
	client: pg.PoolClient,
	tableName: string,
	filePath: string
): Promise<string> {
	const fileCols = await countColumnsInFile(filePath);
	const tableCols = await getTableColumns(client, tableName);
	if (fileCols === null || fileCols >= tableCols.length) {
		return `COPY ${tableName} FROM STDIN`;
	}
	const useCols = tableCols.slice(0, fileCols).map((c) => `"${c}"`).join(', ');
	return `COPY ${tableName} (${useCols}) FROM STDIN`;
}

/**
 * Import a project from its directory into PostgreSQL.
 * Reads COPY text files in FK order, uses COPY FROM STDIN.
 * Users are imported with ON CONFLICT DO NOTHING (UPSERT).
 */
export async function importProjectFromDir(dir: string): Promise<string> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		for (const table of PROJECT_TABLES) {
			const filePath = join(dir, table.file);
			try {
				await stat(filePath);
			} catch {
				continue; // File doesn't exist, skip (e.g. no ai_interactions)
			}

			if (table.file === 'users.copy') {
				// Users: load into temp table, then UPSERT
				await client.query(`
					CREATE TEMP TABLE _tmp_users (LIKE users INCLUDING ALL) ON COMMIT DROP
				`);
				const copyTarget = await buildCopyTarget(client, '_tmp_users', filePath);
				const inStream = createReadStream(filePath);
				const pgStream = client.query(copyFrom(copyTarget));
				await pipeline(inStream, pgStream);
				await client.query(`
					INSERT INTO users SELECT * FROM _tmp_users
					ON CONFLICT (id) DO NOTHING
				`);
			} else {
				const copyTarget = await buildCopyTarget(client, table.copyFromTable, filePath);
				const inStream = createReadStream(filePath);
				const pgStream = client.query(copyFrom(copyTarget));
				await pipeline(inStream, pgStream);
			}

			// Reset sequences if needed
			if (table.sequences) {
				for (const seq of table.sequences) {
					await client.query(`
						SELECT setval(
							pg_get_serial_sequence('${seq.table}', '${seq.column}'),
							COALESCE((SELECT MAX(${seq.column}) FROM ${seq.table}), 0) + 1,
							false
						)
					`);
				}
			}
		}

		// Read back the project ID we just loaded
		// The projects.copy contains exactly one row — find it by reading the file
		const projectResult = await client.query(`SELECT id FROM projects ORDER BY created_at DESC LIMIT 1`);
		const projectId = projectResult.rows[0]?.id;
		if (!projectId) throw new Error('No project found after import');

		await client.query('COMMIT');
		return projectId;
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
}

/**
 * Unload a project from PostgreSQL (data remains in project directory).
 * Runs a final sync before deleting from DB.
 */
export async function unloadProject(projectId: string, projectSlug: string): Promise<void> {
	// Final sync to directory
	await exportProjectToDir(projectId, projectSlug);
	// Delete from DB (CASCADE handles all dependent tables)
	await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
}

/**
 * List available projects from the project directories.
 * Reads projects.copy from each subdirectory.
 */
export async function listProjectDirs(): Promise<{ slug: string; name: string; id: string }[]> {
	try {
		await mkdir(PROJECTS_DIR, { recursive: true });
		const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
		const projects: { slug: string; name: string; id: string }[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			// We could parse projects.copy, but for listing we need a manifest
			// For now, the directory name is the slug
			projects.push({ slug: entry.name, name: entry.name, id: '' });
		}
		return projects;
	} catch {
		return [];
	}
}

/**
 * Check if a project is currently loaded in PostgreSQL.
 */
export async function isProjectLoaded(projectId: string): Promise<boolean> {
	const result = await pool.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
	return result.rows.length > 0;
}

/**
 * Get the project directory path for a given slug.
 */
export function getProjectDir(slug: string): string {
	return join(PROJECTS_DIR, slug);
}

/**
 * Get the base projects directory.
 */
export function getProjectsBaseDir(): string {
	return PROJECTS_DIR;
}

// --- Periodic Sync ---

let syncInterval: ReturnType<typeof setInterval> | null = null;
let activeProjectId: string | null = null;
let activeProjectSlug: string | null = null;

export function startPeriodicSync(projectId: string, projectSlug: string, intervalMs = 60_000): void {
	// Skip if already syncing this project
	if (activeProjectId === projectId && syncInterval) return;
	stopPeriodicSync();
	activeProjectId = projectId;
	activeProjectSlug = projectSlug;

	// Initial sync
	exportProjectToDir(projectId, projectSlug).catch(err =>
		console.error('[project-sync] Initial sync failed:', err)
	);

	syncInterval = setInterval(() => {
		if (activeProjectId && activeProjectSlug) {
			exportProjectToDir(activeProjectId, activeProjectSlug).catch(err =>
				console.error('[project-sync] Periodic sync failed:', err)
			);
		}
	}, intervalMs);
}

export function stopPeriodicSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	activeProjectId = null;
	activeProjectSlug = null;
}

export function getActiveProject(): { id: string; slug: string } | null {
	if (activeProjectId && activeProjectSlug) {
		return { id: activeProjectId, slug: activeProjectSlug };
	}
	return null;
}
