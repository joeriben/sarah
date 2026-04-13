import type { LayoutServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';
import { getMapsByProject } from '$lib/server/db/queries/maps.js';
import { startPeriodicSync } from '$lib/server/project-sync/index.js';
import { slugify } from '$lib/server/files/index.js';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const project = await queryOne<{ id: string; name: string; description: string | null; role: string; properties: Record<string, unknown> | null }>(
		`SELECT p.id, p.name, p.description, p.properties, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		[params.projectId, locals.user!.id]
	);

	if (!project) {
		error(404, 'Project not found');
	}

	// Auto-start periodic sync when entering a project
	startPeriodicSync(params.projectId, slugify(project.name));

	const counts = await queryOne<{ documents: string; namings: string; maps: string; memos: string; members: string }>(
		`SELECT
			(SELECT COUNT(*) FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
			(SELECT COUNT(*) FROM namings n
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND (
			     EXISTS (SELECT 1 FROM appearances a WHERE a.naming_id = n.id
			             AND a.mode IN ('entity','relation','silence'))
			     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
			   )) as namings,
			(SELECT COUNT(*) FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.naming_id = a.perspective_id
			   AND a.mode = 'perspective' AND a.properties ? 'mapType') as maps,
			(SELECT COUNT(*) FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as memos,
			(SELECT COUNT(*) FROM project_members
			 WHERE project_id = $1) as members`,
		[params.projectId]
	);

	const maps = await getMapsByProject(params.projectId);
	const mapByType: Record<string, { id: string }> = {};
	const mapsByType: Record<string, { id: string; label: string; isPrimary?: boolean }[]> = {};
	for (const m of maps) {
		const t = m.properties?.mapType;
		if (t) {
			if (!mapByType[t]) mapByType[t] = { id: m.id };
			if (!mapsByType[t]) mapsByType[t] = [];
			mapsByType[t].push({ id: m.id, label: m.label, isPrimary: m.properties?.isPrimary === true });
		}
	}

	const docsResult = await query<{ id: string; label: string }>(
		`SELECT n.id, n.inscription as label
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		 ORDER BY n.inscription`,
		[params.projectId]
	);

	return {
		project,
		mapByType,
		mapsByType,
		documents: docsResult.rows,
		counts: {
			documents: parseInt(counts?.documents || '0'),
			namings: parseInt(counts?.namings || '0'),
			maps: parseInt(counts?.maps || '0'),
			memos: parseInt(counts?.memos || '0'),
			members: parseInt(counts?.members || '0')
		}
	};
};
