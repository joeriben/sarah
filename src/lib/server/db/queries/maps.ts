import { query, queryOne, transaction } from '../index.js';
import type { MapType, DesignationStage } from '$lib/shared/types/index.js';
import { getOrCreateResearcherNaming } from './namings.js';
import { getAnnotationsByCode } from './codes.js';

// A map IS a naming that serves as a perspective.
// Everything "on the map" has an appearance from this perspective.
// "Messy" vs "ordered" is not a mode — it's the aggregate designation
// state of the map's elements.

// ---- Map CRUD ----

export async function createMap(
	projectId: string,
	userId: string,
	label: string,
	mapType: MapType,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// The map is a naming
		const mapRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const map = mapRes.rows[0];

		// It appears as a perspective FROM ITSELF (self-referential)
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[map.id, JSON.stringify({ mapType, ...properties })]
		);

		// Initial act
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[map.id, researcherNamingId]
		);

		// Positional maps: create two axis namings
		if (mapType === 'positional') {
			for (const dim of ['x', 'y'] as const) {
				const axisRes = await client.query(
					`INSERT INTO namings (project_id, inscription, created_by)
					 VALUES ($1, $2, $3) RETURNING *`,
					[projectId, dim === 'x' ? 'Axis 1' : 'Axis 2', userId]
				);
				await client.query(
					`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
					 VALUES ($1, $2, 'entity', $3)`,
					[axisRes.rows[0].id, map.id, JSON.stringify({ isAxis: true, axisDimension: dim })]
				);
				await client.query(
					`INSERT INTO naming_acts (naming_id, designation, by)
					 VALUES ($1, 'cue', $2)`,
					[axisRes.rows[0].id, researcherNamingId]
				);
			}
		}

		return { ...map, properties: { mapType, ...properties } };
	});
}

export async function duplicateMap(
	projectId: string,
	userId: string,
	sourceMapId: string,
	newLabel: string
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// 1. Get source map's perspective appearance (for mapType + properties)
		const srcApp = (await client.query(
			`SELECT properties FROM appearances
			 WHERE naming_id = $1 AND perspective_id = $1 AND mode = 'perspective'`,
			[sourceMapId]
		)).rows[0];
		if (!srcApp) throw new Error('Source map not found');

		// 2. Create new map naming
		const mapRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, newLabel, userId]
		);
		const newMapId = mapRes.rows[0].id;

		// 3. Self-referential perspective appearance (copies mapType etc.)
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[newMapId, JSON.stringify(srcApp.properties)]
		);

		// 4. Initial naming act
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[newMapId, researcherNamingId]
		);

		// 5. Copy all non-perspective appearances (elements, relations, silences, etc.)
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 SELECT naming_id, $2, mode, directed_from, directed_to, valence, properties
			 FROM appearances
			 WHERE perspective_id = $1
			   AND naming_id != $1
			   AND mode != 'perspective'`,
			[sourceMapId, newMapId]
		);

		// 6. Copy clusters (sub-perspectives): each cluster is its own naming
		const srcClusters = (await client.query(
			`SELECT a.naming_id, n.inscription, a.properties
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = $1 AND a.mode = 'perspective'
			   AND a.naming_id != $1 AND n.deleted_at IS NULL`,
			[sourceMapId]
		)).rows;

		for (const cluster of srcClusters) {
			// Create new cluster naming
			const clusterRes = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, cluster.inscription, userId]
			);
			const newClusterId = clusterRes.rows[0].id;

			// Cluster appears on the new map as a sub-perspective
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $2, 'perspective', $3)`,
				[newClusterId, newMapId, JSON.stringify(cluster.properties || {})]
			);

			// Cluster's self-referential appearance
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $1, 'perspective', '{}')`,
				[newClusterId]
			);

			// Initial naming act for the cluster
			await client.query(
				`INSERT INTO naming_acts (naming_id, designation, by)
				 VALUES ($1, 'characterization', $2)`,
				[newClusterId, researcherNamingId]
			);

			// Copy cluster memberships: elements that appear in this cluster
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 SELECT naming_id, $2, mode, properties
				 FROM appearances
				 WHERE perspective_id = $1 AND naming_id != $1`,
				[cluster.naming_id, newClusterId]
			);
		}

		return { ...mapRes.rows[0], properties: srcApp.properties };
	});
}

export async function getMapsByProject(projectId: string) {
	return (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at, a.properties
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.mode = 'perspective'
			   AND a.properties ? 'mapType'
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;
}

export async function getMap(mapId: string, projectId: string) {
	return queryOne(
		`SELECT n.id, n.inscription as label, n.created_at, a.properties
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL
		   AND a.mode = 'perspective'`,
		[mapId, projectId]
	);
}

// ---- Situational Map: element operations ----

// Add an element to the map. Initial designation: cue.
// The element is a naming that appears as 'entity' from the map perspective.
export async function addElementToMap(
	projectId: string,
	userId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// Create the naming
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const naming = namingRes.rows[0];

		// Appearance on the map: initially as entity
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[naming.id, mapId, JSON.stringify(properties || {})]
		);

		// Initial act: cue (just registered, not yet determined)
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, researcherNamingId]
		);

		return naming;
	});
}

// Place an existing naming on this map without creating a new naming.
// This is the key operation for multi-map work: the same naming can appear
// on multiple maps, each appearance being a perspectival collapse.
// Returns null if the naming already has an appearance on this map.
export async function placeExistingOnMap(
	projectId: string,
	userId: string,
	mapId: string,
	namingId: string,
	mode: string = 'entity',
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		// Verify the naming exists and belongs to this project
		const naming = await client.query(
			`SELECT id, inscription FROM namings
			 WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
			[namingId, projectId]
		);
		if (naming.rows.length === 0) return null;

		// Check if already on this map
		const existing = await client.query(
			`SELECT 1 FROM appearances
			 WHERE naming_id = $1 AND perspective_id = $2`,
			[namingId, mapId]
		);
		if (existing.rows.length > 0) return null;

		// Create appearance on the map
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, $3, $4)`,
			[namingId, mapId, mode, JSON.stringify(properties || {})]
		);

		return naming.rows[0];
	});
}

// Search project namings for placement on a map.
// Returns namings matching the query that are NOT already on this map.
export async function searchNamingsForPlacement(
	projectId: string,
	mapId: string,
	searchQuery: string,
	limit: number = 10
) {
	return (
		await query(
			`SELECT n.id, n.inscription, n.created_at,
			   COALESCE(
			     (SELECT na.designation FROM naming_acts na
			      WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			      ORDER BY na.seq DESC LIMIT 1),
			     'cue'
			   ) as designation,
			   (SELECT count(*) FROM appearances a2
			    WHERE a2.naming_id = n.id AND a2.naming_id != a2.perspective_id) as appearance_count
			 FROM namings n
			 WHERE n.project_id = $1
			   AND n.deleted_at IS NULL
			   AND LOWER(n.inscription) LIKE LOWER($3)
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances a
			     WHERE a.naming_id = n.id AND a.perspective_id = $2
			   )
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances self
			     WHERE self.naming_id = n.id AND self.perspective_id = n.id
			       AND self.mode = 'perspective'
			   )
			 ORDER BY n.seq DESC
			 LIMIT $4`,
			[projectId, mapId, `%${searchQuery}%`, limit]
		)
	).rows;
}

// Relate two elements: creates a participation (co-constitution)
// and an appearance of the participation as 'relation' on the map.
// Both related elements move toward characterization — unless skipDesignationAdvance
// is set (for AI suggestions and spatially derived relations, which are not
// positive analytical acts by the researcher).
export async function relateElements(
	projectId: string,
	userId: string,
	mapId: string,
	sourceId: string,
	targetId: string,
	opts?: {
		inscription?: string;
		valence?: string;
		symmetric?: boolean;
		properties?: Record<string, unknown>;
		skipDesignationAdvance?: boolean;
	}
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// Ensure both endpoints have appearances on this map (structural integrity)
		for (const endpointId of [sourceId, targetId]) {
			const onMap = await client.query(
				`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
				[endpointId, mapId]
			);
			if (onMap.rows.length === 0) {
				await client.query(
					`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
					 VALUES ($1, $2, 'entity', '{}')`,
					[endpointId, mapId]
				);
			}
		}

		// The participation is itself a naming
		const partNamingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, opts?.inscription || '', userId]
		);
		const partNaming = partNamingRes.rows[0];

		// Create the undirected participation
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partNaming.id, sourceId, targetId]
		);

		// The participation appears as relation on the map.
		// If symmetric: no directed_from/to (the participation is undirected).
		// If directed: perspectival reading with from/to.
		const dirFrom = opts?.symmetric ? null : sourceId;
		const dirTo = opts?.symmetric ? null : targetId;
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, $5, $6)`,
			[
				partNaming.id, mapId,
				dirFrom, dirTo,
				opts?.valence || null,
				JSON.stringify(opts?.properties || {})
			]
		);

		// Auto-designation based on determination level:
		// Valence alone is structural (like ATLAS.ti edge types), not a naming act.
		// Only the researcher's own inscription constitutes characterization.
		// valence only (or neither) → cue
		// inscription only → characterization
		// both → specification
		const hasInscription = !!opts?.inscription?.trim();
		const hasValence = !!opts?.valence?.trim();
		let relDesignation: string = 'cue';
		if (hasInscription && hasValence) relDesignation = 'specification';
		else if (hasInscription) relDesignation = 'characterization';

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, $2, $3)`,
			[partNaming.id, relDesignation, researcherNamingId]
		);

		// Relating is an act of determination: the related elements
		// advance from cue toward characterization (if they aren't already beyond it).
		// Skip for non-researcher relations (AI suggestions, spatial derivation) —
		// a provisional/automatic relation is not a positive analytical act.
		if (!opts?.skipDesignationAdvance) {
			for (const elementId of [sourceId, targetId]) {
				const current = await client.query(
					`SELECT designation FROM naming_acts
					 WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
					[elementId]
				);
				if (current.rows[0]?.designation === 'cue') {
					await client.query(
						`INSERT INTO naming_acts (naming_id, designation, by)
						 VALUES ($1, 'characterization', $2)`,
						[elementId, researcherNamingId]
					);
				}
			}
		}

		return { id: partNaming.id, sourceId, targetId, valence: opts?.valence };
	});
}

// Create a cluster: a sub-perspective within the map.
// A cluster is a naming that appears as 'perspective' from the map.
// It produces its own set of appearances for elements assigned to it.
export async function createCluster(
	projectId: string,
	userId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// The cluster is a naming
		const clusterRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const cluster = clusterRes.rows[0];

		// Self-referential: the cluster appears as perspective from itself
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[cluster.id, JSON.stringify({ parentMapId: mapId, ...properties })]
		);

		// The cluster also appears on the map as a perspective-naming
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'perspective', $3)`,
			[cluster.id, mapId, JSON.stringify(properties || {})]
		);

		// Participation: the cluster co-constitutes with the map
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[cluster.id, cluster.id, mapId]
		);

		// Initial act: characterization (clustering IS characterizing — D/B)
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $2)`,
			[cluster.id, researcherNamingId]
		);

		return cluster;
	});
}

// Assign an element to a cluster: the element gets an appearance
// from the cluster-as-perspective.
// Captures the naming's current seq as collapseAt — the cluster freezes
// the naming's state at the moment of assignment.
// If byNamingId is provided, logs the act to cluster_memberships (append-only).
export async function assignToCluster(
	clusterId: string,
	namingId: string,
	mode?: string,
	properties?: Record<string, unknown>,
	byNamingId?: string
) {
	// Get the current highest seq for this naming's acts
	const currentSeq = await queryOne<{ seq: string }>(
		`SELECT COALESCE(MAX(seq), 0) as seq FROM naming_acts WHERE naming_id = $1`,
		[namingId]
	);
	const collapseAt = currentSeq ? parseInt(currentSeq.seq) : null;

	const props = { ...properties };
	if (collapseAt) {
		(props as any).collapseAt = collapseAt;
	}

	const resolvedMode = mode || 'entity';

	const result = await queryOne(
		`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (naming_id, perspective_id)
		 DO UPDATE SET mode = $3, properties = appearances.properties || $4::jsonb, updated_at = now()
		 RETURNING *`,
		[namingId, clusterId, resolvedMode, JSON.stringify(props)]
	);

	// Log the membership act (append-only history)
	if (byNamingId) {
		await query(
			`INSERT INTO cluster_memberships (cluster_id, naming_id, action, mode, by, properties)
			 VALUES ($1, $2, 'assign', $3, $4, $5)`,
			[clusterId, namingId, resolvedMode, byNamingId, JSON.stringify(props)]
		);
	}

	return result;
}

// Remove an element from a cluster.
// If byNamingId is provided, logs the removal act to cluster_memberships (append-only).
export async function removeFromCluster(clusterId: string, namingId: string, byNamingId?: string) {
	await query(
		`DELETE FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, clusterId]
	);

	// Log the membership act (append-only history)
	if (byNamingId) {
		await query(
			`INSERT INTO cluster_memberships (cluster_id, naming_id, action, mode, by)
			 VALUES ($1, $2, 'remove', 'entity', $3)`,
			[clusterId, namingId, byNamingId]
		);
	}
}

// Get the full membership history for a cluster (append-only chain).
// Returns all assign/remove acts in chronological order.
export async function getClusterMembershipHistory(clusterId: string) {
	return (
		await query(
			`SELECT cm.*, n.inscription as naming_inscription, b.inscription as by_inscription
			 FROM cluster_memberships cm
			 JOIN namings n ON n.id = cm.naming_id
			 JOIN namings b ON b.id = cm.by
			 WHERE cm.cluster_id = $1
			 ORDER BY cm.seq ASC`,
			[clusterId]
		)
	).rows;
}

// Set the collapse point for a naming in a perspective.
// collapseAt = global seq value → shows inscription + designation as of that seq.
// Pass null to clear (return to showing latest).
export async function setCollapse(
	namingId: string,
	perspectiveId: string,
	collapseAt: number | null
) {
	if (collapseAt === null) {
		// Remove collapseAt from properties
		return queryOne(
			`UPDATE appearances
			 SET properties = properties - 'collapseAt', updated_at = now()
			 WHERE naming_id = $1 AND perspective_id = $2
			 RETURNING *`,
			[namingId, perspectiveId]
		);
	}
	return queryOne(
		`UPDATE appearances
		 SET properties = properties || $3::jsonb, updated_at = now()
		 WHERE naming_id = $1 AND perspective_id = $2
		 RETURNING *`,
		[namingId, perspectiveId, JSON.stringify({ collapseAt })]
	);
}

// Get the full stack of a naming: all inscription and designation layers.
// This is not "history" — it IS the naming's constitution.
export async function getNamingStack(namingId: string, projectId?: string) {
	const [inscriptions, designations, memos, aiMeta] = await Promise.all([
		query(
			`SELECT na.seq, na.inscription, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.inscription IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		),
		query(
			`SELECT na.seq, na.designation, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.designation IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		),
		query(
			`SELECT DISTINCT m.id, m.inscription as label, mc.content, m.created_at,
			        m.created_by, mc.status
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings m ON m.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			 JOIN memo_content mc ON mc.naming_id = m.id
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   AND m.deleted_at IS NULL
			   AND m.id != $1
			 ORDER BY m.created_at ASC`,
			[namingId]
		),
		// Fetch AI + withdrawal metadata from any appearance of this naming
		query(
			`SELECT a.properties->>'aiReasoning' as ai_reasoning,
			        (a.properties->>'aiSuggested')::boolean as ai_suggested,
			        COALESCE((a.properties->>'aiWithdrawn')::boolean, (a.properties->>'withdrawn')::boolean, false) as is_withdrawn
			 FROM appearances a
			 WHERE a.naming_id = $1
			 ORDER BY (a.properties ? 'aiSuggested') DESC
			 LIMIT 1`,
			[namingId]
		)
	]);

	const ai = aiMeta.rows[0];
	const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

	// Separate discussion memos from regular memos
	const allMemos = memos.rows;
	const discussion = allMemos.filter((m: any) => m.label?.startsWith('Discussion:'));
	const regularMemos = allMemos.filter((m: any) => !m.label?.startsWith('Discussion:'));

	// Enrich memos with provenance + per-memo discussion threads
	// Discussion entries are linked to the MEMO (not the element), so we need
	// a second-level participation query for each memo that has discussions.
	const memoIds = regularMemos.map((m: any) => m.id);
	let memoDiscussionMap = new Map<string, any[]>();
	if (memoIds.length > 0) {
		const discRows = await query(
			`SELECT DISTINCT d.id, d.inscription as label, dc.content, d.created_at, d.created_by,
			        CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.naming_id ELSE p.participant_id END as parent_memo_id
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings d ON d.id = CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.participant_id ELSE p.naming_id END
			 JOIN memo_content dc ON dc.naming_id = d.id
			 WHERE (p.naming_id = ANY($1::uuid[]) OR p.participant_id = ANY($1::uuid[]))
			   AND d.deleted_at IS NULL
			   AND NOT (d.id = ANY($1::uuid[]))
			   AND d.inscription LIKE 'MemoDiscussion:%'
			 ORDER BY d.created_at ASC`,
			[memoIds]
		);
		for (const row of discRows.rows) {
			const parentId = row.parent_memo_id;
			if (!memoDiscussionMap.has(parentId)) memoDiscussionMap.set(parentId, []);
			memoDiscussionMap.get(parentId)!.push({
				id: row.id,
				role: row.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const,
				type: row.label?.includes(': researcher') ? 'researcher'
					: row.label?.includes(': revise') ? 'revise'
					: 'response',
				content: row.content,
				created_at: row.created_at,
			});
		}
	}

	const enrichedMemos = regularMemos.map((m: any) => ({
		id: m.id,
		label: m.label,
		content: m.content,
		created_at: m.created_at,
		authorId: m.created_by,
		isAiAuthored: m.created_by === AI_SYSTEM_UUID,
		status: m.status || 'active',
		discussion: memoDiscussionMap.get(m.id) || [],
	}));

	// Fetch document annotations (material) for this naming
	const annotations = projectId ? await getAnnotationsByCode(projectId, namingId) : [];

	return {
		inscriptions: inscriptions.rows,
		designations: designations.rows,
		memos: enrichedMemos,
		annotations,
		discussion: discussion.map((m: any) => ({
			id: m.id,
			role: m.label === 'Discussion: researcher' ? 'researcher' : 'ai',
			type: m.label?.replace('Discussion: ', '') || 'response',
			content: m.content,
			created_at: m.created_at
		})),
		aiReasoning: ai?.ai_reasoning || null,
		aiSuggested: ai?.ai_suggested || false,
		aiWithdrawn: ai?.is_withdrawn || false
	};
}

// ---- Queries ----

// Get all appearances on the map, enriched with designation and inscription.
// Supports perspectival collapse: if appearance.properties.collapseAt is set,
// shows the inscription and designation as of that global seq — not the latest.
// A naming IS its stack; the perspective chooses which layer to collapse to.
export async function getMapAppearances(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT a.*,
			   -- Inscription: collapsed (at collapseAt seq) or current
			   COALESCE(
			     (SELECT na.inscription FROM naming_acts na
			      WHERE na.naming_id = a.naming_id AND na.inscription IS NOT NULL
			        AND (a.properties->>'collapseAt' IS NULL
			             OR na.seq <= (a.properties->>'collapseAt')::bigint)
			      ORDER BY na.seq DESC LIMIT 1),
			     n.inscription
			   ) as inscription,
			   n.inscription as current_inscription,
			   n.created_at as naming_created_at,
			   -- Designation: collapsed or current
			   COALESCE(
			     (SELECT na.designation FROM naming_acts na
			      WHERE na.naming_id = a.naming_id AND na.designation IS NOT NULL
			        AND (a.properties->>'collapseAt' IS NULL
			             OR na.seq <= (a.properties->>'collapseAt')::bigint)
			      ORDER BY na.seq DESC LIMIT 1),
			     'cue'
			   ) as designation,
			   -- Whether this appearance is collapsed (pinned) or showing latest
			   (a.properties->>'collapseAt') IS NOT NULL as is_collapsed,
			   -- Provenance: empirical grounding (has document annotations)
			   EXISTS (
			     SELECT 1 FROM appearances ann
			     WHERE ann.directed_from = a.naming_id AND ann.valence = 'codes'
			   ) as has_document_anchor,
			   -- Provenance: analytical grounding (linked to a memo)
			   EXISTS (
			     SELECT 1 FROM participations mp
			     JOIN memo_content mc ON mc.naming_id = CASE
			       WHEN mp.naming_id = a.naming_id THEN mp.participant_id
			       ELSE mp.naming_id END
			     JOIN namings mn ON mn.id = mc.naming_id AND mn.deleted_at IS NULL
			     WHERE mp.naming_id = a.naming_id OR mp.participant_id = a.naming_id
			   ) as has_memo_link,
			   -- Memo previews (all memos incl. AI, for hover tooltips + badges)
			   COALESCE(
			     (SELECT json_agg(json_build_object(
			        'label', msub.inscription,
			        'content', mcsub.content,
			        'isAi', msub.created_by = '00000000-0000-0000-0000-000000000000',
			        'status', mcsub.status
			      ) ORDER BY msub.created_at DESC)
			      FROM participations psub
			      JOIN namings pnsub ON pnsub.id = psub.id AND pnsub.deleted_at IS NULL
			      JOIN namings msub ON msub.id = CASE WHEN psub.naming_id = a.naming_id THEN psub.participant_id ELSE psub.naming_id END
			        AND msub.deleted_at IS NULL AND msub.id != a.naming_id
			      JOIN memo_content mcsub ON mcsub.naming_id = msub.id
			      WHERE (psub.naming_id = a.naming_id OR psub.participant_id = a.naming_id)
			     ), '[]'::json
			   ) as memo_previews,
			   -- SW/A role: extracted from first "Formation:" classification memo
			   (SELECT substring(msw.inscription FROM 'Formation: (.+)')
			    FROM participations psw
			    JOIN namings pnsw ON pnsw.id = psw.id AND pnsw.deleted_at IS NULL
			    JOIN namings msw ON msw.id = CASE WHEN psw.naming_id = a.naming_id THEN psw.participant_id ELSE psw.naming_id END
			      AND msw.deleted_at IS NULL AND msw.id != a.naming_id
			    JOIN memo_content mcsw ON mcsw.naming_id = msw.id
			    WHERE (psw.naming_id = a.naming_id OR psw.participant_id = a.naming_id)
			      AND msw.inscription LIKE 'Formation:%'
			    ORDER BY msw.created_at ASC
			    LIMIT 1
			   ) as sw_role,
			   p.naming_id as part_source_id,
			   p.participant_id as part_target_id,
			   ARRAY(
			     SELECT sub.perspective_id::text FROM appearances sub
			     WHERE sub.naming_id = a.naming_id
			       AND sub.naming_id != sub.perspective_id
			       AND sub.perspective_id IN (
			         SELECT pa.naming_id FROM appearances pa
			         WHERE pa.perspective_id = $1
			           AND pa.mode = 'perspective'
			           AND pa.naming_id != $1
			       )
			   ) as cluster_ids,
			   -- Cross-boundary: participations where the other endpoint is not on this map
			   (SELECT count(DISTINCT p_out.id)
			    FROM participations p_out
			    JOIN namings pn_out ON pn_out.id = p_out.id AND pn_out.deleted_at IS NULL
			    WHERE (p_out.naming_id = a.naming_id OR p_out.participant_id = a.naming_id)
			      AND NOT EXISTS (
			        SELECT 1 FROM appearances a_other
			        WHERE a_other.perspective_id = $1
			          AND a_other.naming_id = CASE
			            WHEN p_out.naming_id = a.naming_id THEN p_out.participant_id
			            ELSE p_out.naming_id
			          END
			      )
			   )::int as outside_participation_count
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 LEFT JOIN participations p ON p.id = a.naming_id
			 WHERE a.perspective_id = $1
			   AND a.naming_id != $1
			   AND n.project_id = $2
			   AND n.deleted_at IS NULL
			 ORDER BY n.seq`,
			[mapId, projectId]
		)
	).rows;
}

// Withdraw (soft-delete) a relation's appearance on a map.
// Used by spatial relation sync to remove stale containment/overlap relations.
export async function withdrawRelation(namingId: string, mapId: string) {
	return query(
		`UPDATE appearances SET properties = properties || '{"withdrawn": true}'::jsonb, updated_at = now()
		 WHERE naming_id = $1 AND perspective_id = $2 AND mode = 'relation'`,
		[namingId, mapId]
	);
}

// Get details of participations where the other endpoint is outside this map.
// Returns the outside namings with their inscriptions and designations,
// plus the relation naming that connects them.
export async function getOutsideParticipations(
	mapId: string,
	projectId: string,
	namingId: string
) {
	return (
		await query(
			`SELECT
			   p_out.id as relation_id,
			   pn_out.inscription as relation_inscription,
			   other.id as outside_naming_id,
			   other.inscription as outside_inscription,
			   COALESCE(
			     (SELECT na.designation FROM naming_acts na
			      WHERE na.naming_id = other.id AND na.designation IS NOT NULL
			      ORDER BY na.seq DESC LIMIT 1),
			     'cue'
			   ) as outside_designation,
			   (SELECT count(*) FROM appearances a2
			    WHERE a2.naming_id = other.id AND a2.naming_id != a2.perspective_id) as outside_appearance_count
			 FROM participations p_out
			 JOIN namings pn_out ON pn_out.id = p_out.id AND pn_out.deleted_at IS NULL
			 JOIN namings other ON other.id = CASE
			   WHEN p_out.naming_id = $3 THEN p_out.participant_id
			   ELSE p_out.naming_id
			 END AND other.deleted_at IS NULL
			 WHERE (p_out.naming_id = $3 OR p_out.participant_id = $3)
			   AND other.project_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances a_other
			     WHERE a_other.perspective_id = $1
			       AND a_other.naming_id = other.id
			   )
			 ORDER BY other.inscription`,
			[mapId, projectId, namingId]
		)
	).rows;
}

// Get all namings that annotate a document but aren't yet on this map.
// "Namings of a document" = code namings used in annotations (valence='codes').
export async function getDocumentNamingsForPlacement(
	projectId: string,
	mapId: string,
	documentId: string
) {
	return (
		await query(
			`SELECT DISTINCT code.id, code.inscription,
			   COALESCE(
			     (SELECT na.designation FROM naming_acts na
			      WHERE na.naming_id = code.id AND na.designation IS NOT NULL
			      ORDER BY na.seq DESC LIMIT 1),
			     'cue'
			   ) as designation
			 FROM appearances ann
			 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
			 JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
			 WHERE ann.directed_to = $3 AND ann.valence = 'codes'
			   AND code.project_id = $1
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances a_map
			     WHERE a_map.naming_id = code.id AND a_map.perspective_id = $2
			   )
			 ORDER BY code.inscription`,
			[projectId, mapId, documentId]
		)
	).rows;
}

// Batch-place multiple namings on a map (returns count placed).
export async function placeMultipleOnMap(
	projectId: string,
	userId: string,
	mapId: string,
	namingIds: string[]
) {
	let placed = 0;
	for (const namingId of namingIds) {
		const result = await placeExistingOnMap(projectId, userId, mapId, namingId);
		if (result) placed++;
	}
	return placed;
}

// Get clusters visible on a map: all project clusters that have at least one
// member appearing on this map. Clusters are project-level, maps just display them.
export async function getMapClusters(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT c.id, c.label,
			   (SELECT count(*) FROM appearances sub
			    WHERE sub.perspective_id = c.id
			      AND sub.naming_id != c.id) as element_count
			 FROM (${PROJECT_CLUSTERS_CTE}) c
			 WHERE EXISTS (
			   -- At least one member of this cluster appears on this map
			   SELECT 1 FROM appearances member
			   JOIN appearances on_map ON on_map.naming_id = member.naming_id
			     AND on_map.perspective_id = $1
			   WHERE member.perspective_id = c.id
			     AND member.naming_id != c.id
			 )
			 ORDER BY c.label`,
			[mapId, projectId]
		)
	).rows;
}

// Shared CTE for finding project clusters
const PROJECT_CLUSTERS_CTE = `
  SELECT DISTINCT ON (n.id) n.id, n.inscription as label
  FROM namings n
  JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
    AND a.mode = 'perspective'
  WHERE n.project_id = $2
    AND n.deleted_at IS NULL
    AND NOT (a.properties ? 'mapType')
    AND NOT (a.properties->>'role' = 'grounding-workspace')
  ORDER BY n.id, n.seq
`;

// Get the aggregate designation state of a map:
// how many elements at each designation stage (respects collapseAt)
export async function getMapDesignationProfile(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT * FROM (
			   SELECT
			     COALESCE(
			       (SELECT na.designation FROM naming_acts na
			        WHERE na.naming_id = a.naming_id AND na.designation IS NOT NULL
			          AND (a.properties->>'collapseAt' IS NULL
			               OR na.seq <= (a.properties->>'collapseAt')::bigint)
			        ORDER BY na.seq DESC LIMIT 1),
			       'cue'
			     ) as designation,
			     count(*) as count
			   FROM appearances a
			   JOIN namings n ON n.id = a.naming_id
			   WHERE a.perspective_id = $1
			     AND a.naming_id != $1
			     AND a.mode != 'perspective'
			     AND n.project_id = $2
			     AND n.deleted_at IS NULL
			   GROUP BY 1
			 ) sub
			 ORDER BY CASE designation
			   WHEN 'cue' THEN 1
			   WHEN 'characterization' THEN 2
			   WHEN 'specification' THEN 3
			 END`,
			[mapId, projectId]
		)
	).rows;
}

// Get cross-map participations for SW/A maps: find elements on this map
// that participate with elements on situational maps (cross-boundary context).
export async function getCrossMapParticipations(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT
			   local_n.id as local_id,
			   local_n.inscription as local_inscription,
			   outside_n.id as outside_id,
			   outside_n.inscription as outside_inscription,
			   map_n.inscription as outside_map_label
			 FROM appearances a_local
			 JOIN namings local_n ON local_n.id = a_local.naming_id AND local_n.deleted_at IS NULL
			 JOIN participations p ON p.naming_id = a_local.naming_id OR p.participant_id = a_local.naming_id
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings outside_n ON outside_n.id = CASE
			   WHEN p.naming_id = a_local.naming_id THEN p.participant_id
			   ELSE p.naming_id
			 END AND outside_n.deleted_at IS NULL AND outside_n.project_id = $2
			 JOIN appearances a_outside ON a_outside.naming_id = outside_n.id
			   AND a_outside.perspective_id != $1
			   AND a_outside.naming_id != a_outside.perspective_id
			 JOIN appearances a_map ON a_map.naming_id = a_outside.perspective_id
			   AND a_map.perspective_id = a_outside.perspective_id
			   AND a_map.mode = 'perspective'
			   AND (a_map.properties->>'mapType') = 'situational'
			 JOIN namings map_n ON map_n.id = a_outside.perspective_id AND map_n.deleted_at IS NULL
			 WHERE a_local.perspective_id = $1
			   AND a_local.naming_id != $1
			   AND a_local.mode != 'perspective'
			   AND local_n.project_id = $2
			 ORDER BY local_n.inscription, outside_n.inscription
			 LIMIT 30`,
			[mapId, projectId]
		)
	).rows;
}

// Get the full structure of a map: elements, relations, clusters, designations
export async function getMapStructure(mapId: string, projectId: string) {
	const [appearances, clusters, designationProfile] = await Promise.all([
		getMapAppearances(mapId, projectId),
		getMapClusters(mapId, projectId),
		getMapDesignationProfile(mapId, projectId)
	]);

	const axes = appearances.filter((a: any) => a.mode === 'entity' && a.properties?.isAxis);
	const elements = appearances.filter((a: any) => a.mode === 'entity' && !a.properties?.isAxis);
	const relations = appearances.filter((a: any) => a.mode === 'relation');
	const silences = appearances.filter((a: any) => a.mode === 'silence');
	const processes = appearances.filter((a: any) => a.mode === 'process');
	const constellations = appearances.filter((a: any) => a.mode === 'constellation');

	return {
		axes,
		elements,
		relations,
		silences,
		processes,
		constellations,
		clusters,
		designationProfile
	};
}

// ---- Project-level cluster operations ----

// Get all clusters in a project (across all maps + grounding workspace)
export async function getProjectClusters(projectId: string) {
	return (
		await query(
			`SELECT c.id, c.label,
			   (SELECT count(*) FROM appearances sub
			    WHERE sub.perspective_id = c.id
			      AND sub.naming_id != c.id) as member_count
			 FROM (
			   SELECT DISTINCT ON (n.id) n.id, n.inscription as label
			   FROM namings n
			   JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			     AND a.mode = 'perspective'
			   WHERE n.project_id = $1
			     AND n.deleted_at IS NULL
			     AND NOT (a.properties ? 'mapType')
			     AND NOT (a.properties->>'role' = 'grounding-workspace')
			   ORDER BY n.id, n.seq
			 ) c
			 ORDER BY c.label`,
			[projectId]
		)
	).rows;
}

// Get members of a cluster with their current state
export async function getClusterMembers(clusterId: string) {
	return (
		await query(
			`SELECT a.naming_id, n.inscription,
			   (SELECT na.designation FROM naming_acts na
			    WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			    ORDER BY na.seq DESC LIMIT 1) as designation,
			   a.mode, a.properties
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 WHERE a.perspective_id = $1
			   AND a.naming_id != $1
			 ORDER BY n.inscription`,
			[clusterId]
		)
	).rows;
}

// Get all passages (annotations) for all members of a cluster
export async function getClusterPassages(clusterId: string, projectId: string) {
	return (
		await query(
			`SELECT ann.naming_id as id, ann.directed_from as code_id,
			   code.inscription as code_label,
			   ann.directed_to as document_id,
			   doc.inscription as document_label,
			   ann.properties
			 FROM appearances member
			 JOIN appearances ann ON ann.directed_from = member.naming_id
			   AND ann.valence = 'codes'
			 JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
			 JOIN namings doc ON doc.id = ann.directed_to AND doc.deleted_at IS NULL
			 WHERE member.perspective_id = $1
			   AND member.naming_id != $1
			   AND code.project_id = $2
			 ORDER BY code.inscription, doc.inscription, (ann.properties->'anchor'->>'pos0')::int`,
			[clusterId, projectId]
		)
	).rows;
}

// Create a project-level cluster (anchored to grounding workspace)
export async function createProjectCluster(
	projectId: string,
	userId: string,
	inscription: string
) {
	return transaction(async (client) => {
		const { getOrCreateGroundingWorkspace } = await import('./codes.js');
		const gwId = await getOrCreateGroundingWorkspace(projectId, userId);
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// The cluster is a naming
		const clusterRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const cluster = clusterRes.rows[0];

		// Self-referential appearance
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[cluster.id, JSON.stringify({ parentMapId: gwId })]
		);

		// Appear on grounding workspace as sub-perspective
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'perspective', '{}')`,
			[cluster.id, gwId]
		);

		// Participation: cluster co-constitutes with grounding workspace
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[cluster.id, cluster.id, gwId]
		);

		// Clustering IS characterizing (D/B)
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $2)`,
			[cluster.id, researcherNamingId]
		);

		return cluster;
	});
}
