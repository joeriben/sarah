import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	exportProjectToDir,
	importProjectFromDir,
	unloadProject,
	startPeriodicSync,
	stopPeriodicSync,
	getActiveProject,
	getProjectDir,
	getProjectsBaseDir
} from '$lib/server/project-sync/index.js';
import { query } from '$lib/server/db/index.js';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] || c)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * POST /api/projects/sync
 *
 * Actions:
 * - export:  Save project to directory (initial export)
 * - save:    Sync current DB state to directory
 * - load:    Load project from directory into DB
 * - unload:  Final sync + remove from DB
 * - delete:  Remove project directory + DB data
 * - export-all: Export all DB projects to directories
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { action } = body;

	try {
		switch (action) {
			case 'export': {
				const { projectId } = body;
				if (!projectId) return json({ error: 'projectId required' }, { status: 400 });

				// Get project name for slug
				const project = await query('SELECT name FROM projects WHERE id = $1', [projectId]);
				if (!project.rows[0]) return json({ error: 'Project not found' }, { status: 404 });

				const slug = slugify(project.rows[0].name);
				const dir = await exportProjectToDir(projectId, slug);
				startPeriodicSync(projectId, slug);

				return json({ slug, dir });
			}

			case 'save': {
				const active = getActiveProject();
				if (!active) return json({ error: 'No active project' }, { status: 400 });

				await exportProjectToDir(active.id, active.slug);
				return json({ ok: true });
			}

			case 'load': {
				const { slug } = body;
				if (!slug) return json({ error: 'slug required' }, { status: 400 });

				const dir = getProjectDir(slug);
				const projectId = await importProjectFromDir(dir);
				startPeriodicSync(projectId, slug);

				return json({ projectId, slug });
			}

			case 'unload': {
				const { projectId, slug } = body;
				if (!projectId || !slug) return json({ error: 'projectId and slug required' }, { status: 400 });

				stopPeriodicSync();
				await unloadProject(projectId, slug);

				return json({ ok: true });
			}

			case 'delete': {
				const { projectId, slug } = body;
				if (!projectId) return json({ error: 'projectId required' }, { status: 400 });

				stopPeriodicSync();

				// Delete from DB
				await query('DELETE FROM projects WHERE id = $1', [projectId]);

				// Delete project directory if slug provided
				if (slug) {
					const dir = getProjectDir(slug);
					const { rm } = await import('fs/promises');
					await rm(dir, { recursive: true, force: true });
				}

				// Delete uploads directory
				const uploadsDir = join(process.cwd(), 'uploads', projectId);
				const { rm: rm2 } = await import('fs/promises');
				await rm2(uploadsDir, { recursive: true, force: true });

				return json({ ok: true });
			}

			case 'export-all': {
				const projects = await query('SELECT id, name FROM projects');
				const results = [];
				for (const p of projects.rows) {
					const slug = slugify(p.name);
					await exportProjectToDir(p.id, slug);
					results.push({ id: p.id, name: p.name, slug });
				}
				return json({ exported: results });
			}

			default:
				return json({ error: `Unknown action: ${action}` }, { status: 400 });
		}
	} catch (e: any) {
		console.error('[project-sync] Error:', e);
		return json({ error: e.message }, { status: 500 });
	}
};

/**
 * GET /api/projects/sync
 *
 * Returns list of project directories + which is currently loaded.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const baseDir = getProjectsBaseDir();
	const active = getActiveProject();

	// List directories
	let dirs: { slug: string; hasData: boolean }[] = [];
	try {
		const entries = await readdir(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			// Check if it has namings.copy (= valid project)
			try {
				await stat(join(baseDir, entry.name, 'namings.copy'));
				dirs.push({ slug: entry.name, hasData: true });
			} catch {
				dirs.push({ slug: entry.name, hasData: false });
			}
		}
	} catch {
		// projekte/ doesn't exist yet
	}

	// List loaded projects in DB
	const loaded = await query(`
		SELECT p.id, p.name, p.description, p.created_at
		FROM projects p
		JOIN project_members pm ON pm.project_id = p.id
		WHERE pm.user_id = $1
		ORDER BY p.created_at DESC
	`, [locals.user.id]);

	return json({
		directories: dirs,
		loaded: loaded.rows,
		active: active ? { id: active.id, slug: active.slug } : null
	});
};
