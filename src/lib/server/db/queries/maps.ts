import { query, queryOne, transaction } from '../index.js';
import type { MapType, DesignationStage } from '$lib/shared/types/index.js';
import { getOrCreateResearcherNaming } from './namings.js';

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

		// Initial designation
		await client.query(
			`INSERT INTO naming_designations (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[map.id, researcherNamingId]
		);

		return { ...map, properties: { mapType, ...properties } };
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

		// Initial designation: cue (just registered, not yet determined)
		await client.query(
			`INSERT INTO naming_designations (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, researcherNamingId]
		);

		return naming;
	});
}

// Relate two elements: creates a participation (co-constitution)
// and an appearance of the participation as 'relation' on the map.
// Both related elements move toward characterization.
export async function relateElements(
	projectId: string,
	userId: string,
	mapId: string,
	sourceId: string,
	targetId: string,
	opts?: {
		inscription?: string;
		valence?: string;
		properties?: Record<string, unknown>;
	}
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

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

		// The participation appears as relation on the map (directed reading)
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, $5, $6)`,
			[
				partNaming.id, mapId,
				sourceId, targetId,
				opts?.valence || null,
				JSON.stringify(opts?.properties || {})
			]
		);

		// Designation for the relation itself: cue
		await client.query(
			`INSERT INTO naming_designations (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[partNaming.id, researcherNamingId]
		);

		// Relating is an act of determination: the related elements
		// advance from cue toward characterization (if they aren't already beyond it)
		for (const elementId of [sourceId, targetId]) {
			const current = await client.query(
				`SELECT designation FROM naming_designations
				 WHERE naming_id = $1 ORDER BY seq DESC LIMIT 1`,
				[elementId]
			);
			if (current.rows[0]?.designation === 'cue') {
				await client.query(
					`INSERT INTO naming_designations (naming_id, designation, by)
					 VALUES ($1, 'characterization', $2)`,
					[elementId, researcherNamingId]
				);
			}
		}

		return { id: partNaming.id, sourceId, targetId, valence: opts?.valence };
	});
}

// Create a phase: a sub-perspective within the map.
// A phase is a naming that appears as 'perspective' from the map.
// It produces its own set of appearances for elements assigned to it.
export async function createPhase(
	projectId: string,
	userId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// The phase is a naming
		const phaseRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const phase = phaseRes.rows[0];

		// Self-referential: the phase appears as perspective from itself
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[phase.id, JSON.stringify({ parentMapId: mapId, ...properties })]
		);

		// The phase also appears on the map as a perspective-naming
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'perspective', $3)`,
			[phase.id, mapId, JSON.stringify(properties || {})]
		);

		// Participation: the phase co-constitutes with the map
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[phase.id, phase.id, mapId]
		);

		// Designation: cue
		await client.query(
			`INSERT INTO naming_designations (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[phase.id, researcherNamingId]
		);

		return phase;
	});
}

// Assign an element to a phase: the element gets an appearance
// from the phase-as-perspective.
export async function assignToPhase(
	phaseId: string,
	namingId: string,
	mode?: string,
	properties?: Record<string, unknown>
) {
	return queryOne(
		`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (naming_id, perspective_id)
		 DO UPDATE SET mode = $3, properties = appearances.properties || $4::jsonb, updated_at = now()
		 RETURNING *`,
		[namingId, phaseId, mode || 'entity', JSON.stringify(properties || {})]
	);
}

// Remove an element from a phase
export async function removeFromPhase(phaseId: string, namingId: string) {
	await query(
		`DELETE FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, phaseId]
	);
}

// ---- Queries ----

// Get all appearances on the map, enriched with current designation
export async function getMapAppearances(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT a.*, n.inscription, n.created_at as naming_created_at,
			   (SELECT nd.designation FROM naming_designations nd
			    WHERE nd.naming_id = a.naming_id ORDER BY nd.seq DESC LIMIT 1) as designation
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = $1
			   AND a.naming_id != $1
			   AND n.project_id = $2
			   AND n.deleted_at IS NULL
			 ORDER BY n.seq`,
			[mapId, projectId]
		)
	).rows;
}

// Get phases (sub-perspectives) within a map
export async function getMapPhases(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, n.inscription as label, a.properties,
			   (SELECT count(*) FROM appearances sub
			    WHERE sub.perspective_id = a.naming_id
			      AND sub.naming_id != a.naming_id) as element_count
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = $1
			   AND a.mode = 'perspective'
			   AND a.naming_id != $1
			   AND n.project_id = $2
			   AND n.deleted_at IS NULL
			 ORDER BY n.seq`,
			[mapId, projectId]
		)
	).rows;
}

// Get the aggregate designation state of a map:
// how many elements at each designation stage
export async function getMapDesignationProfile(mapId: string, projectId: string) {
	return (
		await query(
			`SELECT * FROM (
			   SELECT
			     COALESCE(
			       (SELECT nd.designation FROM naming_designations nd
			        WHERE nd.naming_id = a.naming_id ORDER BY nd.seq DESC LIMIT 1),
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

// Get the full structure of a map: elements, relations, phases, designations
export async function getMapStructure(mapId: string, projectId: string) {
	const [appearances, phases, designationProfile] = await Promise.all([
		getMapAppearances(mapId, projectId),
		getMapPhases(mapId, projectId),
		getMapDesignationProfile(mapId, projectId)
	]);

	const elements = appearances.filter((a: any) => a.mode === 'entity');
	const relations = appearances.filter((a: any) => a.mode === 'relation');
	const silences = appearances.filter((a: any) => a.mode === 'silence');
	const processes = appearances.filter((a: any) => a.mode === 'process');
	const constellations = appearances.filter((a: any) => a.mode === 'constellation');

	return {
		elements,
		relations,
		silences,
		processes,
		constellations,
		phases,
		designationProfile
	};
}
