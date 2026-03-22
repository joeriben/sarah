import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';
import { getProjectsBaseDir } from '$lib/server/project-sync/index.js';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export const load: PageServerLoad = async ({ locals }) => {
	const result = await query<{
		id: string;
		name: string;
		description: string | null;
		created_by: string;
		created_at: string;
		role: string;
	}>(
		`SELECT p.id, p.name, p.description, p.created_by, p.created_at, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE pm.user_id = $1
		 ORDER BY p.created_at DESC`,
		[locals.user!.id]
	);

	// List project directories
	const baseDir = getProjectsBaseDir();
	let directories: { slug: string; hasData: boolean }[] = [];
	try {
		const entries = await readdir(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			try {
				await stat(join(baseDir, entry.name, 'namings.copy'));
				directories.push({ slug: entry.name, hasData: true });
			} catch {
				directories.push({ slug: entry.name, hasData: false });
			}
		}
	} catch {
		// projekte/ doesn't exist yet
	}

	return {
		projects: result.rows.map((r: typeof result.rows[number]) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			createdAt: r.created_at,
			role: r.role
		})),
		directories,
		projectsDir: getProjectsBaseDir()
	};
};
