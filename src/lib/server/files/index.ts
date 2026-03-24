import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '$lib/server/db/index.js';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const PROJECTS_DIR = join(process.cwd(), 'projekte');

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] || c)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Look up project name from DB and return slugified version.
 */
async function getProjectSlug(projectId: string): Promise<string> {
	const result = await query('SELECT name FROM projects WHERE id = $1', [projectId]);
	if (!result.rows[0]) throw new Error(`Project not found: ${projectId}`);
	return slugify(result.rows[0].name);
}

/**
 * Save a file to the project directory.
 * Returns a RELATIVE path like `files/uuid.ext`.
 */
export async function saveFile(buffer: Buffer, originalName: string, projectId: string): Promise<string> {
	const ext = originalName.split('.').pop() || 'bin';
	const filename = `${randomUUID()}.${ext}`;
	const slug = await getProjectSlug(projectId);
	const dir = join(PROJECTS_DIR, slug, 'files');
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, filename), buffer);
	return `files/${filename}`;
}

/**
 * Resolve a stored file_path (relative or legacy absolute) to an absolute disk path.
 * Checks project directory first, falls back to legacy uploads/ for unmigrated files.
 */
export async function resolveFilePath(projectId: string, storedPath: string): Promise<string | null> {
	// Already absolute (legacy) — check if it exists
	if (storedPath.startsWith('/')) {
		const exists = await stat(storedPath).catch(() => null);
		return exists ? storedPath : null;
	}

	// Relative path like `files/uuid.ext` — resolve via project dir
	const slug = await getProjectSlug(projectId);
	const projectPath = join(PROJECTS_DIR, slug, storedPath);
	const exists = await stat(projectPath).catch(() => null);
	if (exists) return projectPath;

	// Fallback: try legacy uploads/ location
	const legacyPath = join(UPLOAD_DIR, projectId, basename(storedPath));
	const legacyExists = await stat(legacyPath).catch(() => null);
	return legacyExists ? legacyPath : null;
}

export function getUploadDir(): string {
	return UPLOAD_DIR;
}

export function getProjectsDir(): string {
	return PROJECTS_DIR;
}
