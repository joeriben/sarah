import type { LayoutServerLoad } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const project = await queryOne<{ id: string; name: string; description: string | null; role: string }>(
		`SELECT p.id, p.name, p.description, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		[params.projectId, locals.user!.id]
	);

	if (!project) {
		error(404, 'Project not found');
	}

	const counts = await queryOne<{ documents: string; codes: string; maps: string; memos: string; members: string }>(
		`SELECT
			(SELECT COUNT(*) FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
			(SELECT COUNT(DISTINCT a.directed_from)
			 FROM appearances a
			 JOIN namings n ON n.id = a.directed_from AND n.deleted_at IS NULL
			 WHERE a.valence = 'codes' AND n.project_id = $1) as codes,
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

	return {
		project,
		counts: {
			documents: parseInt(counts?.documents || '0'),
			codes: parseInt(counts?.codes || '0'),
			maps: parseInt(counts?.maps || '0'),
			memos: parseInt(counts?.memos || '0'),
			members: parseInt(counts?.members || '0')
		}
	};
};
