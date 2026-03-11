import { query, queryOne, transaction } from '../index.js';
import { createNaming, createParticipation, setAppearance } from './namings.js';

// The "code system" perspective is a project-level naming
// that serves as the perspective for all codes in a project.
// We create it lazily and cache per project.

export async function getOrCreateCodeSystemPerspective(projectId: string, userId: string) {
	let perspective = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1 AND a.mode = 'perspective'
		   AND a.properties->>'role' = 'code-system'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[projectId]
	);

	if (!perspective) {
		const n = await createNaming(projectId, userId, 'Code System');
		await setAppearance(n.id, n.id, 'perspective', {
			properties: { role: 'code-system' }
		});
		perspective = { id: n.id };
	}

	return perspective.id;
}

export async function createCode(
	projectId: string,
	userId: string,
	label: string,
	opts?: { color?: string; parentId?: string; description?: string }
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateCodeSystemPerspective(projectId, userId);

		// Check for duplicate code label (case-insensitive)
		const existing = await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = $1 AND a.mode = 'entity'
			 WHERE n.project_id = $2 AND n.deleted_at IS NULL
			   AND LOWER(n.inscription) = LOWER($3)
			 LIMIT 1`,
			[perspectiveId, projectId, label]
		);
		if (existing.rows.length > 0) {
			throw new Error(`Code "${label}" already exists`);
		}

		// Create the code naming
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const code = namingRes.rows[0];

		// It appears as entity from the code-system perspective
		const props: Record<string, unknown> = {};
		if (opts?.color) props.color = opts.color;
		if (opts?.description) props.description = opts.description;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[code.id, perspectiveId, JSON.stringify(props)]
		);

		// If parent: create participation (parent ↔ child)
		if (opts?.parentId) {
			const partNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, `${opts.parentId} contains ${code.id}`, userId]
			);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id)
				 VALUES ($1, $2, $3)`,
				[partNaming.rows[0].id, opts.parentId, code.id]
			);
			// The participation appears as a directed relation from the code-system perspective
			const maxPos = await client.query(
				`SELECT COUNT(*) as cnt FROM participations p
				 JOIN appearances a ON a.naming_id = p.id AND a.perspective_id = $1
				 WHERE p.naming_id = $2`,
				[perspectiveId, opts.parentId]
			);
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
				 VALUES ($1, $2, 'relation', $3, $4, 'contains', $5)`,
				[partNaming.rows[0].id, perspectiveId, opts.parentId, code.id,
				 JSON.stringify({ position: parseInt(maxPos.rows[0].cnt) })]
			);
		}

		return { ...code, properties: props };
	});
}

export async function getCodeTree(projectId: string) {
	// All namings that appear as 'entity' from the code-system perspective
	const codes = await query(
		`SELECT n.id, n.inscription as label, a.properties,
		        -- find parent via participation that appears as 'contains' relation
		        (SELECT p.naming_id FROM participations p
		         JOIN appearances pa ON pa.naming_id = p.id AND pa.perspective_id = a.perspective_id
		         WHERE p.participant_id = n.id AND pa.valence = 'contains'
		         LIMIT 1) as parent_id,
		        (SELECT (pa.properties->>'position')::int FROM participations p
		         JOIN appearances pa ON pa.naming_id = p.id AND pa.perspective_id = a.perspective_id
		         WHERE p.participant_id = n.id AND pa.valence = 'contains'
		         LIMIT 1) as position
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND a.mode = 'entity'
		   AND a.perspective_id IN (
		     SELECT n2.id FROM namings n2
		     JOIN appearances a2 ON a2.naming_id = n2.id AND a2.perspective_id = n2.id
		     WHERE n2.project_id = $1 AND a2.mode = 'perspective'
		       AND a2.properties->>'role' = 'code-system'
		   )
		 ORDER BY position NULLS FIRST, n.inscription`,
		[projectId]
	);
	return codes.rows;
}

export async function createAnnotation(
	projectId: string,
	userId: string,
	codeId: string,
	documentId: string,
	anchorType: 'text' | 'image_region',
	anchor: Record<string, unknown>,
	comment?: string
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateCodeSystemPerspective(projectId, userId);

		// The annotation is a naming
		const annNaming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, comment || `annotation: ${codeId} → ${documentId}`, userId]
		);
		const annId = annNaming.rows[0].id;

		// It participates with both the code and the document
		for (const targetId of [codeId, documentId]) {
			const partNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, `annotation ${annId} ↔ ${targetId}`, userId]
			);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id)
				 VALUES ($1, $2, $3)`,
				[partNaming.rows[0].id, annId, targetId]
			);
		}

		// From the code-system perspective, the annotation appears as a directed relation
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, 'codes', $5)`,
			[annId, perspectiveId, codeId, documentId,
			 JSON.stringify({ anchorType, anchor, comment: comment || null })]
		);

		return annNaming.rows[0];
	});
}

export async function getAnnotationsByDocument(projectId: string, documentId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as code_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        code.inscription as code_label,
			        code_app.properties as code_properties
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings code ON code.id = a.directed_from
			 LEFT JOIN appearances code_app ON code_app.naming_id = code.id AND code_app.perspective_id = a.perspective_id
			 WHERE a.directed_to = $1 AND a.valence = 'codes'
			   AND n.project_id = $2
			 ORDER BY n.created_at`,
			[documentId, projectId]
		)
	).rows;
}

export async function getAnnotationsByCode(projectId: string, codeId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as code_id, a.directed_to as document_id,
			        a.properties, doc.inscription as document_label
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings doc ON doc.id = a.directed_to
			 WHERE a.directed_from = $1 AND a.valence = 'codes'
			   AND n.project_id = $2
			 ORDER BY n.created_at`,
			[codeId, projectId]
		)
	).rows;
}

export async function deleteAnnotation(annotationId: string, projectId: string) {
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[annotationId, projectId]
	);
}
