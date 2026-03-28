import type { PageServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { getAnnotationsByDocument, getAnnotationsByProject, getAnnotationCandidates } from '$lib/server/db/queries/codes.js';
import { error } from '@sveltejs/kit';

export interface DocumentElement {
	id: string;
	element_type: string;
	content: string | null;
	parent_id: string | null;
	seq: number;
	char_start: number;
	char_end: number;
}

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

	const [annotations, candidates, elementsResult, projectAnnotations, documentsResult, stackResult] = await Promise.all([
		getAnnotationsByDocument(params.projectId, params.docId),
		getAnnotationCandidates(params.projectId),
		query<DocumentElement>(
			`SELECT id, element_type, content, parent_id, seq, char_start, char_end
			 FROM document_elements WHERE document_id = $1
			 ORDER BY char_start, seq`,
			[params.docId]
		),
		getAnnotationsByProject(params.projectId),
		query<{ id: string; label: string }>(
			`SELECT n.id, n.inscription as label
			 FROM namings n
			 JOIN document_content dc ON dc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY n.inscription`,
			[params.projectId]
		),
		query<{ naming_id: string; designation: string | null; inscription: string | null; memo_text: string | null; seq: number }>(
			`SELECT na.naming_id, na.designation, na.inscription, na.memo_text, na.seq
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.naming_id AND n.deleted_at IS NULL
			 WHERE n.project_id = $1
			 ORDER BY na.naming_id, na.seq`,
			[params.projectId]
		)
	]);

	return {
		document: doc,
		annotations,
		candidates,
		elements: elementsResult.rows,
		projectId: params.projectId,
		projectAnnotations,
		documents: documentsResult.rows,
		namingStacks: stackResult.rows
	};
};
