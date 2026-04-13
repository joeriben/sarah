import { query, queryOne, transaction } from '../index.js';
import type { CollapseMode } from '$lib/shared/types/index.js';
import { createMemo } from './memos.js';

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

// ---- Aggregated view: everything known about a single naming ----

export async function getAggregatedNaming(namingId: string, projectId: string) {
	const { getNamingStack } = await import('./maps.js');

	const [naming, stack, appearances, participations] = await Promise.all([
		queryOne<{
			id: string; inscription: string; created_at: string; seq: string; created_by: string;
		}>(
			`SELECT id, inscription, created_at, seq, created_by FROM namings
			 WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
			[namingId, projectId]
		),
		getNamingStack(namingId, projectId),
		// All map perspectives this naming appears on (excluding self-refs and infrastructure)
		query<{
			perspective_id: string; perspective_label: string; map_type: string;
			mode: string; valence: string | null; properties: Record<string, any>;
			directed_from: string | null; directed_to: string | null;
			cluster_id: string | null; cluster_label: string | null;
		}>(
			`SELECT a.perspective_id, m.inscription as perspective_label,
			        ma.properties->>'mapType' as map_type,
			        a.mode, a.valence, a.properties,
			        a.directed_from, a.directed_to,
			        -- Cluster membership (if any)
			        (SELECT ch.naming_id FROM cluster_memberships ch
			         JOIN appearances cha ON cha.naming_id = ch.cluster_id AND cha.perspective_id = a.perspective_id
			         WHERE ch.naming_id = $1 AND ch.action = 'assign'
			           AND NOT EXISTS (SELECT 1 FROM cluster_memberships ch2
			             WHERE ch2.cluster_id = ch.cluster_id AND ch2.naming_id = ch.naming_id
			               AND ch2.action = 'remove' AND ch2.seq > ch.seq)
			         ORDER BY ch.seq DESC LIMIT 1) as cluster_id,
			        (SELECT chn.inscription FROM cluster_memberships ch
			         JOIN namings chn ON chn.id = ch.cluster_id
			         JOIN appearances cha ON cha.naming_id = ch.cluster_id AND cha.perspective_id = a.perspective_id
			         WHERE ch.naming_id = $1 AND ch.action = 'assign'
			           AND NOT EXISTS (SELECT 1 FROM cluster_memberships ch2
			             WHERE ch2.cluster_id = ch.cluster_id AND ch2.naming_id = ch.naming_id
			               AND ch2.action = 'remove' AND ch2.seq > ch.seq)
			         ORDER BY ch.seq DESC LIMIT 1) as cluster_label
			 FROM appearances a
			 JOIN namings m ON m.id = a.perspective_id AND m.deleted_at IS NULL
			 JOIN appearances ma ON ma.naming_id = m.id AND ma.perspective_id = m.id
			   AND ma.mode = 'perspective' AND ma.properties ? 'mapType'
			 WHERE a.naming_id = $1 AND a.perspective_id != $1`,
			[namingId]
		),
		// All participations (relations this naming is involved in)
		query<{
			relation_id: string; relation_inscription: string;
			partner_id: string; partner_inscription: string;
			partner_designation: string | null;
			role: 'source' | 'target';
			valence: string | null;
			map_labels: string | null;
		}>(
			`SELECT p.id as relation_id, pn.inscription as relation_inscription,
			        partner.id as partner_id, partner.inscription as partner_inscription,
			        (SELECT na.designation FROM naming_acts na
			         WHERE na.naming_id = partner.id AND na.designation IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as partner_designation,
			        CASE WHEN p.naming_id = $1 THEN 'source' ELSE 'target' END as role,
			        (SELECT a.valence FROM appearances a WHERE a.naming_id = p.id AND a.mode = 'relation' LIMIT 1) as valence,
			        (SELECT string_agg(DISTINCT mp.inscription, ', ')
			         FROM appearances ra
			         JOIN namings mp ON mp.id = ra.perspective_id AND mp.deleted_at IS NULL
			         JOIN appearances mpa ON mpa.naming_id = mp.id AND mpa.perspective_id = mp.id
			           AND mpa.mode = 'perspective' AND mpa.properties ? 'mapType'
			         WHERE ra.naming_id = p.id AND ra.perspective_id != p.id) as map_labels
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings partner ON partner.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			   AND partner.deleted_at IS NULL
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			 ORDER BY pn.created_at DESC`,
			[namingId]
		)
	]);

	if (!naming) return null;

	// Current designation
	const currentDesignation = stack.designations.length > 0
		? stack.designations[stack.designations.length - 1].designation
		: 'cue';

	// Grounding status
	const hasDocumentAnchor = (stack.annotations?.length ?? 0) > 0;
	const hasMemoLink = (stack.memos?.length ?? 0) > 0;

	// Mode (from any appearance)
	const primaryMode = appearances.rows.find(a => ['entity', 'relation', 'silence'].includes(a.mode))?.mode || 'entity';

	// Relation endpoints (if this naming IS a relation via participations table)
	const relationEndpoints = await queryOne<{
		source_id: string; target_id: string;
		source_inscription: string; target_inscription: string;
	}>(
		`SELECT p.naming_id as source_id, p.participant_id as target_id,
		        src.inscription as source_inscription, tgt.inscription as target_inscription
		 FROM participations p
		 JOIN namings src ON src.id = p.naming_id
		 JOIN namings tgt ON tgt.id = p.participant_id
		 WHERE p.id = $1`,
		[namingId]
	);

	return {
		naming,
		currentDesignation,
		primaryMode,
		hasDocumentAnchor,
		hasMemoLink,
		relationEndpoints,
		stack,
		appearances: appearances.rows,
		participations: participations.rows
	};
}

// ---- All project namings (uncollapsed, for Namings workspace) ----

export async function getAllProjectNamings(projectId: string) {
	return (
		await query<{
			naming_id: string;
			inscription: string;
			created_at: string;
			seq: string;
			designation: string | null;
			current_inscription: string | null;
			has_document_anchor: boolean;
			has_memo_link: boolean;
			mode: string | null;
			directed_from: string | null;
			directed_to: string | null;
			source_inscription: string | null;
			target_inscription: string | null;
			valence: string | null;
			properties: Record<string, any> | null;
			ai_persona: string | null;
			appears_on_maps: { id: string; label: string }[] | null;
		}>(
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
			   -- AI persona that created this naming (derived from any appearance that carries it)
			   (SELECT a.properties->>'aiPersona' FROM appearances a
			    WHERE a.naming_id = n.id AND a.properties->>'aiPersona' IS NOT NULL
			    LIMIT 1) as ai_persona,
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
			             AND a.mode IN ('entity','relation','silence')
			             AND (a.valence IS NULL OR a.valence != 'codes'))
			     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
			   )
			 ORDER BY n.seq DESC`,
			[projectId]
		)
	).rows;
}

// ---- Merge: two namings that turn out to be the same ----
// The survivor keeps its ID. The merged naming's participations, appearances,
// and directed_from/to references are transferred. The merged naming is soft-deleted.
// This is ground-truth surgery — the merge is recorded as a naming_act on the survivor.
export async function mergeNamings(
	projectId: string,
	userId: string,
	survivorId: string,
	mergedId: string
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// Verify both exist
		const [survivor, merged] = await Promise.all([
			client.query(
				`SELECT id, inscription FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
				[survivorId, projectId]
			),
			client.query(
				`SELECT id, inscription FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
				[mergedId, projectId]
			)
		]);
		if (survivor.rows.length === 0 || merged.rows.length === 0) {
			throw new Error('Both namings must exist');
		}

		// Reject if merged naming IS a relation (participations.id = mergedId)
		const isRelation = await client.query(
			`SELECT 1 FROM participations WHERE id = $1`, [mergedId]
		);
		if (isRelation.rows.length > 0) {
			throw new Error('Cannot merge relation namings — only entity namings');
		}

		const mergedInscription = merged.rows[0].inscription;
		const survivorInscription = survivor.rows[0].inscription;

		// Collect details about the merged naming BEFORE surgery
		const mergedDesignation = await client.query(
			`SELECT designation FROM naming_acts
			 WHERE naming_id = $1 AND designation IS NOT NULL
			 ORDER BY seq DESC LIMIT 1`,
			[mergedId]
		);
		const mergedParts = await client.query(
			`SELECT n.inscription as partner_inscription
			 FROM participations p
			 JOIN namings n ON n.id = CASE
			   WHEN p.naming_id = $1 THEN p.participant_id
			   ELSE p.naming_id END
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   AND n.deleted_at IS NULL AND n.id != $1`,
			[mergedId]
		);
		const mergedMaps = await client.query(
			`SELECT m.inscription as map_label
			 FROM appearances a
			 JOIN namings m ON m.id = a.perspective_id AND m.deleted_at IS NULL
			 WHERE a.naming_id = $1 AND a.naming_id != a.perspective_id
			   AND EXISTS (SELECT 1 FROM appearances self
			     WHERE self.naming_id = m.id AND self.perspective_id = m.id
			       AND self.mode = 'perspective' AND self.properties ? 'mapType')`,
			[mergedId]
		);

		// 1. Transfer participations (as endpoint)
		// Update naming_id where merged is the first endpoint
		await client.query(
			`UPDATE participations SET naming_id = $1
			 WHERE naming_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM participations p2
			     WHERE p2.naming_id = $1 AND p2.participant_id = participations.participant_id
			   )`,
			[survivorId, mergedId]
		);
		// Update participant_id where merged is the second endpoint
		await client.query(
			`UPDATE participations SET participant_id = $1
			 WHERE participant_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM participations p2
			     WHERE p2.naming_id = participations.naming_id AND p2.participant_id = $1
			   )`,
			[survivorId, mergedId]
		);
		// Soft-delete conflicting participation-namings that couldn't be transferred
		await client.query(
			`UPDATE namings SET deleted_at = now()
			 WHERE id IN (
			   SELECT id FROM participations WHERE naming_id = $1 OR participant_id = $1
			 ) AND project_id = $2`,
			[mergedId, projectId]
		);

		// 2. Transfer appearances
		// Move appearances where survivor doesn't already appear on that perspective
		await client.query(
			`UPDATE appearances SET naming_id = $1
			 WHERE naming_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances a2
			     WHERE a2.naming_id = $1 AND a2.perspective_id = appearances.perspective_id
			   )`,
			[survivorId, mergedId]
		);
		// Delete remaining (conflicting) appearances of merged
		await client.query(
			`DELETE FROM appearances WHERE naming_id = $1`,
			[mergedId]
		);

		// 3. Update directed_from/directed_to references in other appearances
		await client.query(
			`UPDATE appearances SET directed_from = $1 WHERE directed_from = $2`,
			[survivorId, mergedId]
		);
		await client.query(
			`UPDATE appearances SET directed_to = $1 WHERE directed_to = $2`,
			[survivorId, mergedId]
		);

		// 4. Transfer cluster memberships
		await client.query(
			`UPDATE cluster_memberships SET naming_id = $1 WHERE naming_id = $2`,
			[survivorId, mergedId]
		);

		// 5. Record merge as naming_act on the survivor
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, memo_text)
			 VALUES ($1, $2, $3)`,
			[survivorId, researcherNamingId, `Merged with "${mergedInscription}"`]
		);

		// 6. Soft-delete the merged naming
		await client.query(
			`UPDATE namings SET deleted_at = now() WHERE id = $1`,
			[mergedId]
		);

		// 7. Create a memo documenting the merge (linked to survivor)
		const desig = mergedDesignation.rows[0]?.designation || 'cue';
		const partners = mergedParts.rows.map((r: any) => r.partner_inscription).join(', ');
		const maps = mergedMaps.rows.map((r: any) => r.map_label).join(', ');
		const memoLines = [
			`Merged "${mergedInscription}" into "${survivorInscription}".`,
			``,
			`Absorbed naming:`,
			`- Inscription: ${mergedInscription}`,
			`- Designation: ${desig}`,
			partners ? `- Participations with: ${partners}` : `- No participations`,
			maps ? `- Appeared on: ${maps}` : `- Not on any map`,
		];
		// createMemo needs userId (not researcherNamingId) and runs its own transaction,
		// so we do it after the main transaction commits.
		// Store the memo content for post-commit creation.
		const memoContent = memoLines.join('\n');

		return {
			survivorId,
			mergedId,
			mergedInscription,
			survivorInscription,
			_memoContent: memoContent,
			_userId: userId,
		};
	});
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
