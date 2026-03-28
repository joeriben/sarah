import { query, queryOne, transaction } from '../index.js';
import { createNaming, setAppearance } from './namings.js';

// The "grounding workspace" perspective is a project-level naming
// that holds orphan in-vivo codes (not yet placed on a map) and
// annotation relation appearances. It is infrastructure, not a
// separate analytical domain.

export async function getOrCreateGroundingWorkspace(projectId: string, userId: string) {
	let perspective = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1 AND a.mode = 'perspective'
		   AND a.properties->>'role' = 'grounding-workspace'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[projectId]
	);

	if (!perspective) {
		const n = await createNaming(projectId, userId, 'Grounding Workspace');
		await setAppearance(n.id, n.id, 'perspective', {
			properties: { role: 'grounding-workspace' }
		});
		perspective = { id: n.id };
	}

	return perspective.id;
}

/**
 * All namings that can be used as annotation anchors.
 * Pulls entities from ALL map perspectives AND the grounding workspace.
 * Prefers map appearances over grounding workspace for color/source info.
 */
export async function getAnnotationCandidates(projectId: string) {
	const result = await query<{
		id: string;
		label: string;
		color: string | null;
		source_map_id: string | null;
		source_map_label: string | null;
		is_orphan: boolean;
		has_document_anchor: boolean;
	}>(
		`SELECT DISTINCT ON (n.id)
		        n.id,
		        n.inscription as label,
		        a.properties->>'color' as color,
		        -- Source map info (NULL for grounding workspace orphans)
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN NULL
		             ELSE a.perspective_id END as source_map_id,
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN NULL
		             ELSE map_n.inscription END as source_map_label,
		        -- Is this an orphan (only on grounding workspace, no map)?
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN true
		             ELSE false END as is_orphan,
		        -- Has document anchor?
		        EXISTS (
		          SELECT 1 FROM appearances ann
		          WHERE ann.directed_from = n.id AND ann.valence = 'codes'
		            AND EXISTS (SELECT 1 FROM namings ann_n WHERE ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL)
		        ) as has_document_anchor
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN appearances pa ON pa.naming_id = a.perspective_id AND pa.perspective_id = a.perspective_id AND pa.mode = 'perspective'
		 LEFT JOIN namings map_n ON map_n.id = a.perspective_id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND (pa.properties ? 'mapType' OR pa.properties->>'role' = 'grounding-workspace')
		 ORDER BY n.id,
		          -- Prefer map appearances over grounding workspace
		          CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN 1 ELSE 0 END,
		          n.inscription`,
		[projectId]
	);
	return result.rows;
}

/**
 * Create an orphan naming on the grounding workspace.
 * Used for in-vivo coding when no map context is active.
 */
export async function createOrphanNaming(
	projectId: string,
	userId: string,
	label: string,
	opts?: { color?: string; description?: string }
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateGroundingWorkspace(projectId, userId);

		// Check for duplicate label (case-insensitive) across ALL entity appearances
		const existing = await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND LOWER(n.inscription) = LOWER($2)
			 LIMIT 1`,
			[projectId, label]
		);
		if (existing.rows.length > 0) {
			throw new Error(`Code "${label}" already exists`);
		}

		// Create the naming
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const naming = namingRes.rows[0];

		// It appears as entity from the grounding workspace
		const props: Record<string, unknown> = {};
		if (opts?.color) props.color = opts.color;
		if (opts?.description) props.description = opts.description;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[naming.id, perspectiveId, JSON.stringify(props)]
		);

		return { ...naming, properties: props };
	});
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
		const perspectiveId = await getOrCreateGroundingWorkspace(projectId, userId);

		// Duplicate check: same code + document + same anchor position
		const existing = await client.query(
			`SELECT a.naming_id as id FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 WHERE a.directed_from = $1 AND a.directed_to = $2 AND a.valence = 'codes'
			   AND n.project_id = $3
			   AND a.properties->>'anchorType' = $4
			   AND a.properties->'anchor'->>'pos0' = $5
			   AND a.properties->'anchor'->>'pos1' = $6`,
			[codeId, documentId, projectId, anchorType,
			 String(anchor.pos0 ?? ''), String(anchor.pos1 ?? '')]
		);
		if (existing.rows.length > 0) {
			return existing.rows[0];
		}

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

		// From the grounding workspace, the annotation appears as a directed relation
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, 'codes', $5)`,
			[annId, perspectiveId, codeId, documentId,
			 JSON.stringify({ anchorType, anchor, comment: comment || null })]
		);

		// If comment provided, record a naming_act on the CODE (not the annotation)
		// This makes the passage-specific note part of the code's designation stack
		if (comment && comment.trim()) {
			const rn = await client.query(
				`SELECT naming_id FROM researcher_namings WHERE user_id = $1 AND project_id = $2`,
				[userId, projectId]
			);
			const byId = rn.rows[0]?.naming_id || userId;
			await client.query(
				`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids)
				 VALUES ($1, $2, $3, $4)`,
				[codeId, byId, comment.trim(), [annId]]
			);
		}

		return annNaming.rows[0];
	});
}

export async function getAnnotationsByDocument(projectId: string, documentId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as code_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        code.inscription as code_label,
			        -- Resolve color from ANY entity appearance (any map or grounding workspace)
			        (SELECT ca.properties->>'color'
			         FROM appearances ca
			         WHERE ca.naming_id = code.id AND ca.mode = 'entity'
			           AND ca.properties->>'color' IS NOT NULL
			         LIMIT 1) as code_color,
			        -- Passage-specific stack entry (naming_act on the code referencing this annotation)
			        (SELECT na.memo_text
			         FROM naming_acts na
			         WHERE na.naming_id = code.id
			           AND a.naming_id = ANY(na.linked_naming_ids)
			           AND na.memo_text IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as stack_memo
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings code ON code.id = a.directed_from
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

export async function getAnnotationsByProject(projectId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as code_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        code.inscription as code_label,
			        doc.inscription as document_label,
			        (SELECT ca.properties->>'color'
			         FROM appearances ca
			         WHERE ca.naming_id = code.id AND ca.mode = 'entity'
			           AND ca.properties->>'color' IS NOT NULL
			         LIMIT 1) as code_color,
			        (SELECT na.memo_text
			         FROM naming_acts na
			         WHERE na.naming_id = code.id
			           AND a.naming_id = ANY(na.linked_naming_ids)
			           AND na.memo_text IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as stack_memo
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings code ON code.id = a.directed_from
			 JOIN namings doc ON doc.id = a.directed_to AND doc.deleted_at IS NULL
			 WHERE a.valence = 'codes'
			   AND n.project_id = $1
			 ORDER BY doc.inscription, n.created_at`,
			[projectId]
		)
	).rows;
}

/**
 * Count how many annotations reference a given code (excluding a specific annotation).
 */
export async function countCodeUsages(codeId: string, projectId: string, excludeAnnotationId?: string) {
	const result = await queryOne<{ count: string }>(
		`SELECT COUNT(*) as count
		 FROM appearances a
		 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
		 WHERE a.directed_from = $1 AND a.valence = 'codes'
		   AND n.project_id = $2
		   ${excludeAnnotationId ? `AND a.naming_id != $3` : ''}`,
		excludeAnnotationId ? [codeId, projectId, excludeAnnotationId] : [codeId, projectId]
	);
	return parseInt(result?.count || '0', 10);
}

/**
 * Delete an annotation. If the code has no other usages, also delete the code.
 * Returns { annotationDeleted: true, codeDeleted: boolean, codeLabel?: string }
 */
/**
 * Add a memo to an existing annotation (naming_act on the code, linked to the annotation).
 */
export async function addAnnotationMemo(
	projectId: string,
	userId: string,
	annotationId: string,
	codeId: string,
	memoText: string
) {
	const rn = await queryOne<{ naming_id: string }>(
		`SELECT naming_id FROM researcher_namings WHERE user_id = $1 AND project_id = $2`,
		[userId, projectId]
	);
	const byId = rn?.naming_id || userId;
	await query(
		`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids)
		 VALUES ($1, $2, $3, $4)`,
		[codeId, byId, memoText.trim(), [annotationId]]
	);
}

export async function deleteAnnotation(annotationId: string, projectId: string) {
	return transaction(async (client) => {
		// Find the code this annotation references
		const ann = await client.query(
			`SELECT a.directed_from as code_id, code.inscription as code_label
			 FROM appearances a
			 JOIN namings code ON code.id = a.directed_from
			 WHERE a.naming_id = $1 AND a.valence = 'codes'`,
			[annotationId]
		);
		const codeId = ann.rows[0]?.code_id;
		const codeLabel = ann.rows[0]?.code_label;

		// Soft-delete the annotation
		await client.query(
			`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
			[annotationId, projectId]
		);

		let codeDeleted = false;
		if (codeId) {
			// Count remaining usages of this code
			const remaining = await client.query(
				`SELECT COUNT(*) as count
				 FROM appearances a
				 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
				 WHERE a.directed_from = $1 AND a.valence = 'codes'
				   AND n.project_id = $2`,
				[codeId, projectId]
			);
			if (parseInt(remaining.rows[0].count, 10) === 0) {
				// No more usages — also soft-delete the code
				await client.query(
					`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
					[codeId, projectId]
				);
				codeDeleted = true;
			}
		}

		return { annotationDeleted: true, codeDeleted, codeLabel };
	});
}
