import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';
import { getDocNetsByProject } from '$lib/server/db/queries/docnets.js';

export const load: PageServerLoad = async ({ params }) => {
	const [result, docnets] = await Promise.all([
		query(
			`SELECT n.id, n.inscription as label, n.created_at, dc.mime_type, dc.file_size
			 FROM namings n
			 JOIN document_content dc ON dc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY n.created_at DESC`,
			[params.projectId]
		),
		getDocNetsByProject(params.projectId)
	]);

	return {
		documents: result.rows,
		docnets,
		projectId: params.projectId
	};
};
