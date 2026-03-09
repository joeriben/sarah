import type { PageServerLoad } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { getAnnotationsByDocument, getCodeTree } from '$lib/server/db/queries/codes.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const doc = await queryOne<{
		id: string;
		label: string;
		full_text: string | null;
		mime_type: string;
		file_size: number;
	}>(
		`SELECT n.id, n.inscription as label, dc.full_text, dc.mime_type, dc.file_size
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);

	if (!doc) error(404, 'Document not found');

	const [annotations, codes] = await Promise.all([
		getAnnotationsByDocument(params.projectId, params.docId),
		getCodeTree(params.projectId)
	]);

	return {
		document: doc,
		annotations,
		codes,
		projectId: params.projectId
	};
};
