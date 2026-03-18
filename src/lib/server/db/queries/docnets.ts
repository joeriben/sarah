import { query, transaction } from '../index.js';
import { createNaming } from './namings.js';
import { getOrCreateResearcherNaming } from './namings.js';

/**
 * A DocNet is a naming with a self-referential appearance (role: 'docnet').
 * Documents are linked via participations. Non-destructive, freely formed/dissolved.
 */

export async function createDocNet(projectId: string, userId: string, label: string) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		const res = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const docnet = res.rows[0];

		// Self-referential appearance identifies it as a DocNet
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[docnet.id, JSON.stringify({ role: 'docnet' })]
		);

		// Initial naming act
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, inscription, designation)
			 VALUES ($1, $2, $3, 'cue')`,
			[docnet.id, researcherNamingId, label]
		);

		return docnet;
	});
}

export async function getDocNetsByProject(projectId: string) {
	return (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at,
			        (SELECT COUNT(*) FROM participations p
			         JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			         WHERE (p.naming_id = n.id OR p.participant_id = n.id)
			           AND EXISTS (
			             SELECT 1 FROM document_content dc
			             WHERE dc.naming_id = CASE WHEN p.naming_id = n.id THEN p.participant_id ELSE p.naming_id END
			           )
			        )::int as document_count
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.mode = 'perspective' AND a.properties->>'role' = 'docnet'
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;
}

export async function getDocNetDocuments(docnetId: string) {
	return (
		await query(
			`SELECT doc.id, doc.inscription as label, dc.mime_type, dc.file_size, doc.created_at,
			        p.id as participation_id
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings doc ON doc.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			 JOIN document_content dc ON dc.naming_id = doc.id
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   AND doc.deleted_at IS NULL
			 ORDER BY doc.inscription`,
			[docnetId]
		)
	).rows;
}

export async function addDocumentToDocNet(
	projectId: string,
	userId: string,
	docnetId: string,
	documentId: string
) {
	return transaction(async (client) => {
		// Check not already linked
		const existing = await client.query(
			`SELECT p.id FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 WHERE (p.naming_id = $1 AND p.participant_id = $2)
			    OR (p.naming_id = $2 AND p.participant_id = $1)
			 LIMIT 1`,
			[docnetId, documentId]
		);
		if (existing.rows.length > 0) return existing.rows[0];

		// Create participation naming
		const partRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, `docnet ${docnetId} ↔ ${documentId}`, userId]
		);
		const partId = partRes.rows[0].id;

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partId, docnetId, documentId]
		);

		return { id: partId };
	});
}

export async function removeDocumentFromDocNet(
	projectId: string,
	docnetId: string,
	documentId: string
) {
	// Soft-delete the participation naming
	await query(
		`UPDATE namings SET deleted_at = now()
		 WHERE id IN (
		   SELECT p.id FROM participations p
		   WHERE (p.naming_id = $1 AND p.participant_id = $2)
		      OR (p.naming_id = $2 AND p.participant_id = $1)
		 ) AND project_id = $3`,
		[docnetId, documentId, projectId]
	);
}

export async function deleteDocNet(docnetId: string, projectId: string) {
	// Soft-delete the DocNet naming (participations become orphaned but harmless)
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[docnetId, projectId]
	);
}

/**
 * Get all namings (codes) grounded in documents of a DocNet.
 * Used for DocNet → SitMap generation.
 */
export async function getDocNetGroundedNamings(docnetId: string, projectId: string) {
	return (
		await query(
			`SELECT DISTINCT code.id, code.inscription as label
			 FROM participations dp
			 JOIN namings dpn ON dpn.id = dp.id AND dpn.deleted_at IS NULL
			 JOIN appearances ann ON ann.valence = 'codes'
			   AND ann.directed_to = CASE WHEN dp.naming_id = $1 THEN dp.participant_id ELSE dp.naming_id END
			 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
			 JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
			 WHERE (dp.naming_id = $1 OR dp.participant_id = $1)
			   AND ann_n.project_id = $2
			 ORDER BY code.inscription`,
			[docnetId, projectId]
		)
	).rows;
}
