import { query, queryOne, transaction } from '../index.js';
import type { CollapseMode } from '$lib/shared/types/index.js';

// ---- Researcher-naming: the user as naming in the data space ----

export async function getOrCreateResearcherNaming(
	projectId: string,
	userId: string
): Promise<string> {
	// Check if researcher-naming already exists
	const existing = await queryOne<{ naming_id: string }>(
		`SELECT naming_id FROM researcher_namings WHERE user_id = $1 AND project_id = $2`,
		[userId, projectId]
	);
	if (existing) return existing.naming_id;

	// Create researcher-naming in a transaction
	return transaction(async (client) => {
		// Get user display name for the inscription
		const user = await client.query(
			`SELECT display_name, username FROM users WHERE id = $1`,
			[userId]
		);
		const name = user.rows[0]?.display_name || user.rows[0]?.username || 'unknown';

		// Create the naming
		const naming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, name, userId]
		);
		const namingId = naming.rows[0].id;

		// Self-referential appearance: the researcher appears as perspective from itself
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', '{"role": "researcher"}')`,
			[namingId]
		);

		// Register the link
		await client.query(
			`INSERT INTO researcher_namings (user_id, project_id, naming_id)
			 VALUES ($1, $2, $3)`,
			[userId, projectId, namingId]
		);

		// Initial act: the researcher characterizes itself
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $1)`,
			[namingId]
		);

		return namingId;
	});
}

// ---- Core naming operations ----

export async function createNaming(
	projectId: string,
	userId: string,
	inscription: string
) {
	// Ensure researcher-naming exists (first act creates it)
	const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

	const res = await queryOne<{ id: string; inscription: string; created_at: string; seq: string }>(
		`INSERT INTO namings (project_id, inscription, created_by)
		 VALUES ($1, $2, $3) RETURNING *`,
		[projectId, inscription, userId]
	);
	const naming = res!;

	// Initial act: inscription + designation in one stack entry
	await query(
		`INSERT INTO naming_acts (naming_id, by, inscription, designation)
		 VALUES ($1, $2, $3, 'characterization')`,
		[naming.id, researcherNamingId, inscription]
	);

	return naming;
}

export async function renameNaming(
	namingId: string,
	projectId: string,
	userId: string,
	inscription: string
) {
	const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

	return transaction(async (client) => {
		// Update current inscription
		const result = await client.query(
			`UPDATE namings SET inscription = $1
			 WHERE id = $2 AND project_id = $3 AND deleted_at IS NULL
			 RETURNING *`,
			[inscription, namingId, projectId]
		);

		// Record in stack
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, inscription)
			 VALUES ($1, $2, $3)`,
			[namingId, researcherNamingId, inscription]
		);

		return result.rows[0];
	});
}

export async function getInscriptionHistory(namingId: string) {
	return (
		await query(
			`SELECT na.seq, na.inscription, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.inscription IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		)
	).rows;
}

export async function softDelete(namingId: string, projectId: string) {
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[namingId, projectId]
	);
}

export async function getNaming(namingId: string, projectId: string) {
	return queryOne(
		`SELECT * FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[namingId, projectId]
	);
}

export async function getNamingsByProject(projectId: string) {
	return (
		await query(
			`SELECT * FROM namings WHERE project_id = $1 AND deleted_at IS NULL ORDER BY seq`,
			[projectId]
		)
	).rows;
}

// ---- Participation operations ----

export async function createParticipation(
	projectId: string,
	userId: string,
	namingId: string,
	participantId: string,
	inscription?: string
) {
	return transaction(async (client) => {
		// A participation IS a naming
		const partNaming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, inscription || `${namingId} ↔ ${participantId}`, userId]
		);
		const partId = partNaming.rows[0].id;

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partId, namingId, participantId]
		);

		return { id: partId, namingId, participantId };
	});
}

export async function getParticipations(namingId: string) {
	return (
		await query(
			`SELECT p.*, n.inscription as participant_inscription
			 FROM participations p
			 JOIN namings n ON n.id = p.participant_id
			 WHERE p.naming_id = $1 AND n.deleted_at IS NULL
			 UNION
			 SELECT p.*, n.inscription as participant_inscription
			 FROM participations p
			 JOIN namings n ON n.id = p.naming_id
			 WHERE p.participant_id = $1 AND n.deleted_at IS NULL`,
			[namingId]
		)
	).rows;
}

export async function removeParticipation(participationId: string, projectId: string) {
	// Soft-delete the participation naming
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[participationId, projectId]
	);
}

// ---- Appearance operations ----

export async function setAppearance(
	namingId: string,
	perspectiveId: string,
	mode: CollapseMode,
	opts?: {
		directedFrom?: string;
		directedTo?: string;
		valence?: string;
		properties?: Record<string, unknown>;
	}
) {
	return queryOne(
		`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (naming_id, perspective_id)
		 DO UPDATE SET
		   mode = $3,
		   directed_from = $4,
		   directed_to = $5,
		   valence = COALESCE($6, appearances.valence),
		   properties = appearances.properties || $7::jsonb,
		   updated_at = now()
		 RETURNING *`,
		[
			namingId,
			perspectiveId,
			mode,
			opts?.directedFrom || null,
			opts?.directedTo || null,
			opts?.valence || null,
			JSON.stringify(opts?.properties || {})
		]
	);
}

export async function getAppearance(namingId: string, perspectiveId: string) {
	return queryOne(
		`SELECT * FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, perspectiveId]
	);
}

export async function getAppearances(namingId: string) {
	return (
		await query(
			`SELECT a.*, p.inscription as perspective_inscription
			 FROM appearances a
			 JOIN namings p ON p.id = a.perspective_id
			 WHERE a.naming_id = $1`,
			[namingId]
		)
	).rows;
}

export async function getAppearancesInPerspective(perspectiveId: string, opts?: { mode?: CollapseMode }) {
	const conditions = ['a.perspective_id = $1', 'n.deleted_at IS NULL'];
	const params: unknown[] = [perspectiveId];

	if (opts?.mode) {
		conditions.push(`a.mode = $2`);
		params.push(opts.mode);
	}

	return (
		await query(
			`SELECT a.*, n.inscription, n.created_at as naming_created_at, n.seq
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE ${conditions.join(' AND ')}
			 ORDER BY n.seq`,
			params
		)
	).rows;
}

export async function removeAppearance(namingId: string, perspectiveId: string) {
	await query(
		`DELETE FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, perspectiveId]
	);
}

// ---- Convenience: create naming + appearance in one transaction ----

export async function createNamedAppearance(
	projectId: string,
	userId: string,
	inscription: string,
	perspectiveId: string,
	mode: CollapseMode,
	opts?: {
		directedFrom?: string;
		directedTo?: string;
		valence?: string;
		properties?: Record<string, unknown>;
	}
) {
	return transaction(async (client) => {
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				naming.id,
				perspectiveId,
				mode,
				opts?.directedFrom || null,
				opts?.directedTo || null,
				opts?.valence || null,
				JSON.stringify(opts?.properties || {})
			]
		);

		return naming;
	});
}

// ---- Designation operations (append-only) ----

export async function designate(
	namingId: string,
	designation: 'cue' | 'characterization' | 'specification',
	byNamingId: string
) {
	return queryOne(
		`INSERT INTO naming_acts (naming_id, designation, by)
		 VALUES ($1, $2, $3) RETURNING *`,
		[namingId, designation, byNamingId]
	);
}

export async function getCurrentDesignation(namingId: string) {
	return queryOne<{ designation: string; by: string; created_at: string }>(
		`SELECT designation, by, created_at FROM naming_acts
		 WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
		[namingId]
	);
}

export async function getDesignationHistory(namingId: string) {
	return (
		await query(
			`SELECT na.seq, na.designation, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.designation IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		)
	).rows;
}

// ---- All project namings (uncollapsed, for Namings workspace) ----

export async function getAllProjectNamings(projectId: string) {
	return (
		await query(
			`SELECT n.id as naming_id, n.inscription, n.created_at, n.seq,
			   -- Current designation (latest non-NULL in stack)
			   (SELECT na.designation FROM naming_acts na
			    WHERE na.naming_id = n.id AND na.designation IS NOT NULL ORDER BY na.seq DESC LIMIT 1) as designation,
			   -- Current inscription (latest non-NULL in stack)
			   (SELECT na.inscription FROM naming_acts na
			    WHERE na.naming_id = n.id AND na.inscription IS NOT NULL ORDER BY na.seq DESC LIMIT 1) as current_inscription,
			   -- Grounding: has document anchor
			   EXISTS(SELECT 1 FROM appearances a
			    WHERE a.directed_from = n.id AND a.valence = 'codes') as has_document_anchor,
			   -- Grounding: has memo link
			   EXISTS(SELECT 1 FROM participations mp
			    JOIN namings pn ON pn.id = mp.id AND pn.deleted_at IS NULL
			    JOIN memo_content mc ON mc.naming_id = CASE
			      WHEN mp.naming_id = n.id THEN mp.participant_id
			      ELSE mp.naming_id END
			    JOIN namings mn ON mn.id = mc.naming_id AND mn.deleted_at IS NULL
			    WHERE mp.naming_id = n.id OR mp.participant_id = n.id) as has_memo_link,
			   -- Mode from any appearance
			   (SELECT a.mode FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode IN ('entity','relation','silence')
			    LIMIT 1) as mode,
			   -- Relation endpoints (if relation via participation)
			   (SELECT p.naming_id FROM participations p WHERE p.id = n.id) as directed_from,
			   (SELECT p.participant_id FROM participations p WHERE p.id = n.id) as directed_to,
			   -- Source/target inscriptions for relations
			   (SELECT src.inscription FROM participations p
			    JOIN namings src ON src.id = p.naming_id
			    WHERE p.id = n.id) as source_inscription,
			   (SELECT tgt.inscription FROM participations p
			    JOIN namings tgt ON tgt.id = p.participant_id
			    WHERE p.id = n.id) as target_inscription,
			   -- Valence (for relations)
			   (SELECT a.valence FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode = 'relation' LIMIT 1) as valence,
			   -- Properties (withdrawn, aiSuggested etc.)
			   (SELECT a.properties FROM appearances a
			    WHERE a.naming_id = n.id AND a.naming_id != a.perspective_id
			    LIMIT 1) as properties,
			   -- Which maps does this naming appear on?
			   (SELECT json_agg(json_build_object('id', mp.id, 'label', mp.inscription))
			    FROM (SELECT DISTINCT m.id, m.inscription
			          FROM appearances a2
			          JOIN namings m ON m.id = a2.perspective_id
			          WHERE a2.naming_id = n.id AND a2.perspective_id != n.id
			            AND m.deleted_at IS NULL) mp) as appears_on_maps
			 FROM namings n
			 WHERE n.project_id = $1
			   AND n.deleted_at IS NULL
			   AND (
			     EXISTS (SELECT 1 FROM appearances a WHERE a.naming_id = n.id
			             AND a.mode IN ('entity','relation','silence'))
			     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
			   )
			 ORDER BY n.seq DESC`,
			[projectId]
		)
	).rows;
}

// ---- History: namings ARE the event log ----

export async function getHistory(projectId: string, opts?: { afterSeq?: number; limit?: number }) {
	const conditions = ['project_id = $1', 'deleted_at IS NULL'];
	const params: unknown[] = [projectId];
	let idx = 2;

	if (opts?.afterSeq) {
		conditions.push(`seq > $${idx++}`);
		params.push(opts.afterSeq);
	}

	const limit = opts?.limit || 100;
	params.push(limit);

	return (
		await query(
			`SELECT * FROM namings
			 WHERE ${conditions.join(' AND ')}
			 ORDER BY seq ASC
			 LIMIT $${idx}`,
			params
		)
	).rows;
}
