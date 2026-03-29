// Unified context builder for all AI personas.
// Provides composable functions that each persona can call as needed.
// Extracted from context.ts (project overview) and agent.ts (map detail).

import { query, queryOne } from '../../db/index.js';
import { getMapsByProject, getMapStructure, getMap, getCrossMapParticipations } from '../../db/queries/maps.js';
import { getMemosByProject } from '../../db/queries/memos.js';
import { searchChunks } from '../coach-library.js';

// ── Project overview context ──────────────────────────────────────
// Used by all personas: project name, element counts, maps summary.

export async function buildProjectContext(projectId: string): Promise<string> {
	const parts: string[] = [];

	// Project info
	const project = await queryOne<{ name: string; description: string | null }>(
		`SELECT name, description FROM projects WHERE id = $1`,
		[projectId]
	);
	if (project) {
		parts.push(`PROJECT: "${project.name}"`);
		if (project.description) parts.push(`Description: ${project.description}`);
	}

	// Counts
	const counts = await queryOne<{ documents: string; namings: string; memos: string }>(
		`SELECT
			(SELECT COUNT(*) FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
			(SELECT COUNT(*) FROM namings n
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND (
			     EXISTS (SELECT 1 FROM appearances a WHERE a.naming_id = n.id
			             AND a.mode IN ('entity','relation','silence'))
			     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
			   )) as namings,
			(SELECT COUNT(*) FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription NOT LIKE 'Discussion:%'
			   AND n.inscription NOT LIKE 'MemoDiscussion:%') as memos`,
		[projectId]
	);

	// Maps with per-map element counts and designation profiles
	const maps = await getMapsByProject(projectId);

	const mapCount = maps.length;
	const docCount = parseInt(counts?.documents || '0');
	const namingCount = parseInt(counts?.namings || '0');
	const memoCount = parseInt(counts?.memos || '0');

	parts.push(`COUNTS: ${docCount} documents, ${namingCount} namings, ${mapCount} maps, ${memoCount} memos`);

	// Per-map summary (top 5 by element count)
	if (maps.length > 0) {
		parts.push('\nMAPS:');

		const mapIds = maps.map((m: any) => m.id);
		const mapStats = (await query(
			`SELECT a.perspective_id as map_id,
			        COUNT(*) FILTER (WHERE a.mode IN ('entity','silence')) as element_count,
			        COUNT(*) FILTER (WHERE a.mode = 'relation') as relation_count,
			        COUNT(*) FILTER (WHERE a.mode = 'silence') as silence_count
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = ANY($1::uuid[])
			   AND a.naming_id != a.perspective_id
			   AND n.deleted_at IS NULL
			   AND n.project_id = $2
			 GROUP BY a.perspective_id`,
			[mapIds, projectId]
		)).rows;

		const statsMap = new Map(mapStats.map((s: any) => [s.map_id, s]));

		// Designation profiles per map
		const desigProfiles = (await query(
			`SELECT a.perspective_id as map_id,
			        COALESCE(
			          (SELECT na.designation FROM naming_acts na
			           WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			           ORDER BY na.seq DESC LIMIT 1),
			          'cue'
			        ) as designation,
			        COUNT(*) as cnt
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = ANY($1::uuid[])
			   AND a.naming_id != a.perspective_id
			   AND n.deleted_at IS NULL
			   AND n.project_id = $2
			   AND a.mode IN ('entity','relation','silence')
			 GROUP BY a.perspective_id, designation`,
			[mapIds, projectId]
		)).rows;

		const desigMap = new Map<string, string[]>();
		for (const d of desigProfiles) {
			if (!desigMap.has(d.map_id)) desigMap.set(d.map_id, []);
			desigMap.get(d.map_id)!.push(`${d.cnt} ${d.designation}`);
		}

		// Sort by element count descending, limit to 5
		const sorted = maps
			.map((m: any) => {
				const s = statsMap.get(m.id);
				return { ...m, elementCount: parseInt(s?.element_count || '0'), stats: s };
			})
			.sort((a: any, b: any) => b.elementCount - a.elementCount)
			.slice(0, 5);

		for (const m of sorted) {
			const type = m.properties?.mapType || 'situational';
			const s = m.stats;
			const elCount = parseInt(s?.element_count || '0');
			const relCount = parseInt(s?.relation_count || '0');
			const silCount = parseInt(s?.silence_count || '0');
			const desig = desigMap.get(m.id)?.join(', ') || 'empty';
			parts.push(`  "${m.label}" (${type}) — ${elCount} elements, ${relCount} relations, ${silCount} silences [${desig}]`);
		}
	}

	return parts.join('\n');
}

// ── Map detail context ────────────────────────────────────────────
// Detailed map structure for personas working on a specific map.

export interface MapDetailOptions {
	/** Include AI metadata (aiSuggested, aiWithdrawn, discussionSummary). Default: false. */
	includeAiMetadata?: boolean;
	/** Include cross-map participations for SW/A maps. Default: true. */
	includeCrossMap?: boolean;
	/** Maximum elements to show. Default: 30. */
	maxElements?: number;
	/** Maximum relations to show. Default: 10. */
	maxRelations?: number;
}

export async function buildMapDetail(
	mapId: string,
	projectId: string,
	opts: MapDetailOptions = {}
): Promise<string> {
	const {
		includeAiMetadata = false,
		includeCrossMap = true,
		maxElements = 30,
		maxRelations = 10
	} = opts;

	const parts: string[] = [];

	try {
		const map = await getMap(mapId, projectId);
		const structure = await getMapStructure(mapId, projectId);
		const mapType = map?.properties?.mapType || 'situational';

		parts.push(`MAP: "${map?.label || ''}" (${mapType})`);

		// Build element inscription map for relation display
		const elementMap = new Map<string, string>();
		for (const el of structure.elements) {
			elementMap.set(el.naming_id, el.inscription);
		}

		// Designation profile
		if (structure.designationProfile.length > 0) {
			const profile = structure.designationProfile.map((d: any) => `${d.count} ${d.designation}`).join(', ');
			parts.push(`DESIGNATION PROFILE: ${profile}`);
		}

		// AI metadata: discussion summaries (batch fetch)
		const discussionMap = new Map<string, string>();
		if (includeAiMetadata) {
			const allAppearances = [...structure.elements, ...structure.relations, ...structure.silences];
			const aiNamingIds = allAppearances
				.filter((a: any) => a.properties?.aiSuggested)
				.map((a: any) => a.naming_id);

			if (aiNamingIds.length > 0) {
				const discussionRows = await query(
					`SELECT p_outer.naming_id as cue_id,
					        string_agg(
					          CASE WHEN m.inscription = 'Discussion: researcher' THEN 'Researcher: ' ELSE 'AI: ' END
					          || left(mc.content, 150),
					          ' → ' ORDER BY m.created_at ASC
					        ) as summary
					 FROM (
					   SELECT DISTINCT ON (m2.id) p2.naming_id, m2.id as memo_id
					   FROM participations p2
					   JOIN namings m2 ON m2.id = CASE WHEN p2.naming_id = ANY($1::uuid[]) THEN p2.participant_id ELSE p2.naming_id END
					   WHERE (p2.naming_id = ANY($1::uuid[]) OR p2.participant_id = ANY($1::uuid[]))
					     AND m2.deleted_at IS NULL
					     AND m2.inscription LIKE 'Discussion:%'
					 ) p_outer
					 JOIN namings m ON m.id = p_outer.memo_id
					 JOIN memo_content mc ON mc.naming_id = m.id
					 GROUP BY p_outer.naming_id`,
					[aiNamingIds]
				);
				for (const row of discussionRows.rows) {
					discussionMap.set(row.cue_id, row.summary);
				}
			}
		}

		// Positional map: axes, coordinates, quadrant analysis
		const isPositional = mapType === 'positional';
		if (isPositional && structure.axes?.length > 0) {
			parts.push('\nAXES:');
			for (const ax of structure.axes) {
				const dim = ax.properties?.axisDimension || 'x';
				parts.push(`  ${dim.toUpperCase()}: "${ax.inscription}" [${ax.designation || 'cue'}] (id: ${ax.naming_id})`);
			}

			const positions = structure.elements
				.filter((el: any) => el.properties?.x != null)
				.map((el: any) => ({
					id: el.naming_id,
					inscription: el.inscription,
					x: Math.round(el.properties.x),
					y: Math.round(Math.abs(el.properties.y || 0)),
					absent: !!el.properties.absent,
					designation: el.designation || 'cue',
				}));

			if (positions.length > 0) {
				parts.push('\nPOSITIONAL FIELD (0–800 per axis, origin = bottom-left):');
				for (const pos of positions) {
					const absent = pos.absent ? '[ABSENT] ' : '';
					parts.push(`  ${absent}"${pos.inscription}" at (${pos.x}, ${pos.y}) [${pos.designation}] (id: ${pos.id})`);
				}

				// Quadrant analysis
				const MID = 400;
				const q1: string[] = [], q2: string[] = [], q3: string[] = [], q4: string[] = [];
				for (const pos of positions) {
					const highX = pos.x >= MID;
					const highY = pos.y >= MID;
					if (highX && highY) q1.push(pos.inscription);
					else if (!highX && highY) q2.push(pos.inscription);
					else if (!highX && !highY) q3.push(pos.inscription);
					else q4.push(pos.inscription);
				}
				const xAxis = structure.axes?.find((a: any) => (a.properties?.axisDimension || 'x') === 'x');
				const yAxis = structure.axes?.find((a: any) => (a.properties?.axisDimension || 'x') === 'y');
				const xLabel = xAxis?.inscription || 'X';
				const yLabel = yAxis?.inscription || 'Y';
				parts.push('\nQUADRANT ANALYSIS:');
				parts.push(`  Q1 (high ${xLabel} / high ${yLabel}): ${q1.length > 0 ? `${q1.length} — ${q1.join(', ')}` : 'EMPTY'}`);
				parts.push(`  Q2 (low ${xLabel} / high ${yLabel}): ${q2.length > 0 ? `${q2.length} — ${q2.join(', ')}` : 'EMPTY'}`);
				parts.push(`  Q3 (low ${xLabel} / low ${yLabel}): ${q3.length > 0 ? `${q3.length} — ${q3.join(', ')}` : 'EMPTY'}`);
				parts.push(`  Q4 (high ${xLabel} / low ${yLabel}): ${q4.length > 0 ? `${q4.length} — ${q4.join(', ')}` : 'EMPTY'}`);
			}
		}

		// Elements
		if (structure.elements.length > 0) {
			parts.push('\nELEMENTS:');
			for (const el of structure.elements.slice(0, maxElements)) {
				const desig = el.designation || 'cue';
				const prov = el.has_document_anchor ? ' 📄' : el.has_memo_link ? ' 📝' : ' ∅';
				const role = el.sw_role ? ` [${el.sw_role}]` : '';
				let aiTags = '';
				if (includeAiMetadata) {
					const withdrawn = el.properties?.aiWithdrawn || el.properties?.withdrawn;
					const aiSuggested = el.properties?.aiSuggested;
					aiTags = withdrawn ? ' [WITHDRAWN]' : aiSuggested ? ' [AI]' : '';
				}
				parts.push(`  [${desig}]${prov}${aiTags}${role} "${el.inscription}" (id: ${el.naming_id})`);
				if (includeAiMetadata) {
					const summary = discussionMap.get(el.naming_id);
					if (summary) parts.push(`    Discussion: ${summary}`);
				}
			}
			if (structure.elements.length > maxElements) {
				parts.push(`    ... and ${structure.elements.length - maxElements} more`);
			}
		} else {
			parts.push('\nELEMENTS: (none yet)');
		}

		// Relations
		if (structure.relations.length > 0) {
			parts.push(`\nRELATIONS: ${structure.relations.length} total`);
			for (const rel of structure.relations.slice(0, maxRelations)) {
				const label = rel.inscription ? `: "${rel.inscription}"` : '';
				const srcName = elementMap.get(rel.directed_from) || '?';
				const tgtName = elementMap.get(rel.directed_to) || '?';
				const symmetric = !rel.directed_from && !rel.directed_to;
				const arrow = symmetric ? '↔' : '→';
				const val = rel.valence ? ` [${rel.valence}]` : '';
				const desig = rel.designation || 'cue';
				const prov = rel.has_document_anchor ? ' 📄' : rel.has_memo_link ? ' 📝' : ' ∅';
				let aiTags = '';
				if (includeAiMetadata) {
					const withdrawn = rel.properties?.aiWithdrawn || rel.properties?.withdrawn;
					const aiSuggested = rel.properties?.aiSuggested;
					aiTags = withdrawn ? ' [WITHDRAWN]' : aiSuggested ? ' [AI]' : '';
				}
				parts.push(`  [${desig}]${prov}${aiTags} "${srcName}" ${arrow} "${tgtName}"${label}${val} (id: ${rel.naming_id})`);
				if (includeAiMetadata) {
					const summary = discussionMap.get(rel.naming_id);
					if (summary) parts.push(`    Discussion: ${summary}`);
				}
			}
			if (structure.relations.length > maxRelations) {
				parts.push(`    ... and ${structure.relations.length - maxRelations} more`);
			}
		}

		// Silences
		if (structure.silences.length > 0) {
			parts.push('\nIDENTIFIED SILENCES:');
			for (const s of structure.silences) {
				let aiTags = '';
				if (includeAiMetadata) {
					const withdrawn = s.properties?.aiWithdrawn || s.properties?.withdrawn;
					const aiSuggested = s.properties?.aiSuggested;
					aiTags = withdrawn ? ' [WITHDRAWN]' : aiSuggested ? ' [AI]' : '';
				}
				parts.push(`  ${aiTags}"${s.inscription}" (id: ${s.naming_id})`);
				if (includeAiMetadata) {
					const summary = discussionMap.get(s.naming_id);
					if (summary) parts.push(`    Discussion: ${summary}`);
				}
			}
		}

		// Clusters
		if (structure.clusters.length > 0) {
			parts.push('\nCLUSTERS:');
			for (const p of structure.clusters) {
				parts.push(`  "${p.label}" (${p.element_count} elements, id: ${p.id})`);
			}
		}

		// SW/A: Spatial structure
		const isSwa = mapType === 'social-worlds';
		if (isSwa) {
			const spatial = structure.relations
				.filter((r: any) => r.properties?.spatiallyDerived && !(r.properties?.withdrawn))
				.map((r: any) => ({
					type: (r.valence === 'contains' ? 'contains' : 'overlaps') as string,
					a: elementMap.get(r.directed_from) || '?',
					b: elementMap.get(r.directed_to) || '?',
				}));
			if (spatial.length > 0) {
				parts.push('\nSPATIAL STRUCTURE:');
				for (const sr of spatial) {
					if (sr.type === 'contains') {
						parts.push(`  "${sr.a}" contains "${sr.b}"`);
					} else {
						parts.push(`  "${sr.a}" overlaps "${sr.b}"`);
					}
				}
			}

			// Cross-map participations
			if (includeCrossMap) {
				const crossRows = await getCrossMapParticipations(mapId, projectId);
				if (crossRows.length > 0) {
					parts.push('\nCROSS-MAP CONTEXT:');
					for (const cp of crossRows) {
						parts.push(`  "${cp.local_inscription}" ↔ "${cp.outside_inscription}" (from map "${cp.outside_map_label}")`);
					}
				}
			}
		}

	} catch (e) {
		console.warn(`[AI Context] Failed to load map detail for ${mapId}:`, e);
	}

	return parts.join('\n');
}

// ── Recent memos context ──────────────────────────────────────────

export async function buildMemoContext(projectId: string, limit: number = 5): Promise<string> {
	const recentMemos = (await query(
		`SELECT n.inscription as label, LEFT(mc.content, 200) as preview
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND n.inscription NOT LIKE 'Discussion:%'
		   AND n.inscription NOT LIKE 'MemoDiscussion:%'
		 ORDER BY n.created_at DESC
		 LIMIT $2`,
		[projectId, limit]
	)).rows;

	if (recentMemos.length === 0) return '';

	const parts = ['RECENT MEMOS:'];
	for (const m of recentMemos) {
		parts.push(`  "${m.label}": ${m.preview}`);
	}
	return parts.join('\n');
}

// ── Reference library context ─────────────────────────────────────
// Searches uploaded methodological texts for relevant passages.

export async function buildLibraryContext(userMessage: string, maxChunks: number = 3): Promise<string> {
	try {
		const chunks = await searchChunks(userMessage, maxChunks);
		if (chunks.length === 0) return '';

		const parts = ['REFERENCE LIBRARY (relevant passages from uploaded methodological texts):'];
		for (const ch of chunks) {
			const src = ch.reference_author
				? `${ch.reference_author}: ${ch.reference_title}`
				: ch.reference_title;
			const sec = ch.section ? ` — ${ch.section}` : '';
			parts.push(`\n[${src}${sec}]`);
			if (ch.summary) {
				parts.push(`Index note: ${ch.summary}`);
				if (ch.questions?.length) {
					parts.push(`Answers: ${ch.questions.join('; ')}`);
				}
			}
			parts.push(ch.content);
		}
		return parts.join('\n');
	} catch (e) {
		console.warn('[AI Context] Reference library search failed:', e);
		return '';
	}
}

// ── Structured map context (for agent tool execution) ─────────────
// Returns the structured MapContext object used by the agent runtime
// for tool execution decisions. This is a richer representation than
// the text context — it includes IDs, coordinates, and typed fields.

export interface MapContext {
	mapLabel: string;
	mapType: string;
	elements: Array<{
		id: string;
		inscription: string;
		designation: string;
		mode: string;
		provenance: 'empirical' | 'analytical' | 'ungrounded';
		swRole?: string;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	relations: Array<{
		id: string;
		inscription: string;
		designation: string;
		source: { id: string; inscription: string };
		target: { id: string; inscription: string };
		valence: string | null;
		symmetric: boolean;
		provenance: 'empirical' | 'analytical' | 'ungrounded';
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	silences: Array<{
		id: string;
		inscription: string;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	clusters: Array<{
		id: string;
		label: string;
		elementCount: number;
	}>;
	designationProfile: Array<{
		designation: string;
		count: number;
	}>;
	recentMemos: Array<{
		label: string;
		content: string;
	}>;
	crossMapParticipations?: Array<{
		localId: string;
		localInscription: string;
		outsideId: string;
		outsideInscription: string;
		outsideMapLabel: string;
	}>;
	spatialRelations?: Array<{
		type: 'contains' | 'overlaps';
		formationA: string;
		formationB: string;
	}>;
	axes?: Array<{
		id: string;
		inscription: string;
		designation: string;
		dimension: 'x' | 'y';
	}>;
	positionCoordinates?: Array<{
		id: string;
		inscription: string;
		x: number;
		y: number;
		absent: boolean;
		designation: string;
	}>;
	quadrantAnalysis?: {
		q1: string[];
		q2: string[];
		q3: string[];
		q4: string[];
	};
}

export async function buildStructuredMapContext(mapId: string, projectId: string): Promise<MapContext> {
	const map = await getMap(mapId, projectId);
	const structure = await getMapStructure(mapId, projectId);

	const elementMap = new Map<string, string>();
	for (const el of structure.elements) {
		elementMap.set(el.naming_id, el.inscription);
	}

	// Batch-fetch discussion summaries for AI-suggested cues
	const allAppearances = [...structure.elements, ...structure.relations, ...structure.silences];
	const aiNamingIds = allAppearances
		.filter((a: any) => a.properties?.aiSuggested)
		.map((a: any) => a.naming_id);

	const discussionMap = new Map<string, string>();
	if (aiNamingIds.length > 0) {
		const discussionRows = await query(
			`SELECT p_outer.naming_id as cue_id,
			        string_agg(
			          CASE WHEN m.inscription = 'Discussion: researcher' THEN 'Researcher: ' ELSE 'AI: ' END
			          || left(mc.content, 150),
			          ' → ' ORDER BY m.created_at ASC
			        ) as summary
			 FROM (
			   SELECT DISTINCT ON (m2.id) p2.naming_id, m2.id as memo_id
			   FROM participations p2
			   JOIN namings m2 ON m2.id = CASE WHEN p2.naming_id = ANY($1::uuid[]) THEN p2.participant_id ELSE p2.naming_id END
			   WHERE (p2.naming_id = ANY($1::uuid[]) OR p2.participant_id = ANY($1::uuid[]))
			     AND m2.deleted_at IS NULL
			     AND m2.inscription LIKE 'Discussion:%'
			 ) p_outer
			 JOIN namings m ON m.id = p_outer.memo_id
			 JOIN memo_content mc ON mc.naming_id = m.id
			 GROUP BY p_outer.naming_id`,
			[aiNamingIds]
		);
		for (const row of discussionRows.rows) {
			discussionMap.set(row.cue_id, row.summary);
		}
	}

	const mapType = map?.properties?.mapType || 'situational';
	const isSwa = mapType === 'social-worlds';
	const isPositional = mapType === 'positional';

	// Elements
	const elements = structure.elements.map((el: any) => ({
		id: el.naming_id,
		inscription: el.inscription,
		designation: el.designation || 'cue',
		mode: el.mode,
		provenance: el.has_document_anchor ? 'empirical' as const : el.has_memo_link ? 'analytical' as const : 'ungrounded' as const,
		swRole: el.sw_role || undefined,
		aiSuggested: el.properties?.aiSuggested || false,
		aiWithdrawn: el.properties?.aiWithdrawn || el.properties?.withdrawn || false,
		discussionSummary: discussionMap.get(el.naming_id)
	}));

	// Relations
	const relations = structure.relations.map((rel: any) => ({
		id: rel.naming_id,
		inscription: rel.inscription || '',
		designation: rel.designation || 'cue',
		source: {
			id: rel.directed_from || '',
			inscription: elementMap.get(rel.directed_from) || '?'
		},
		target: {
			id: rel.directed_to || '',
			inscription: elementMap.get(rel.directed_to) || '?'
		},
		valence: rel.valence,
		symmetric: !rel.directed_from && !rel.directed_to,
		provenance: rel.has_document_anchor ? 'empirical' as const : rel.has_memo_link ? 'analytical' as const : 'ungrounded' as const,
		aiSuggested: rel.properties?.aiSuggested || false,
		aiWithdrawn: rel.properties?.aiWithdrawn || rel.properties?.withdrawn || false,
		discussionSummary: discussionMap.get(rel.naming_id)
	}));

	// Silences
	const silences = structure.silences.map((s: any) => ({
		id: s.naming_id,
		inscription: s.inscription,
		aiSuggested: s.properties?.aiSuggested || false,
		aiWithdrawn: s.properties?.aiWithdrawn || s.properties?.withdrawn || false,
		discussionSummary: discussionMap.get(s.naming_id)
	}));

	// Clusters
	const clusters = structure.clusters.map((p: any) => ({
		id: p.id,
		label: p.label,
		elementCount: parseInt(p.element_count) || 0
	}));

	// Designation profile
	const designationProfile = structure.designationProfile.map((d: any) => ({
		designation: d.designation,
		count: parseInt(d.count) || 0
	}));

	// Recent memos
	const memos = await getMemosByProject(projectId);
	const recentMemos = memos.slice(0, 5).map((m: any) => ({
		label: m.label,
		content: m.content || ''
	}));

	// SW/A specifics
	let crossMapParticipations: MapContext['crossMapParticipations'];
	let spatialRelations: MapContext['spatialRelations'];

	if (isSwa) {
		const crossRows = await getCrossMapParticipations(mapId, projectId);
		if (crossRows.length > 0) {
			crossMapParticipations = crossRows.map((r: any) => ({
				localId: r.local_id,
				localInscription: r.local_inscription,
				outsideId: r.outside_id,
				outsideInscription: r.outside_inscription,
				outsideMapLabel: r.outside_map_label,
			}));
		}

		const spatial = structure.relations
			.filter((r: any) => r.properties?.spatiallyDerived && !r.properties?.withdrawn)
			.map((r: any) => ({
				type: (r.valence === 'contains' ? 'contains' : 'overlaps') as 'contains' | 'overlaps',
				formationA: r.directed_from || '',
				formationB: r.directed_to || '',
			}));
		if (spatial.length > 0) {
			spatialRelations = spatial;
		}
	}

	// Positional specifics
	let posAxes: MapContext['axes'];
	let positionCoordinates: MapContext['positionCoordinates'];
	let quadrantAnalysis: MapContext['quadrantAnalysis'];

	if (isPositional && structure.axes) {
		posAxes = structure.axes.map((ax: any) => ({
			id: ax.naming_id,
			inscription: ax.inscription,
			designation: ax.designation || 'cue',
			dimension: ax.properties?.axisDimension || 'x',
		}));

		positionCoordinates = structure.elements
			.filter((el: any) => el.properties?.x != null)
			.map((el: any) => ({
				id: el.naming_id,
				inscription: el.inscription,
				x: Math.round(el.properties.x),
				y: Math.round(Math.abs(el.properties.y || 0)),
				absent: !!el.properties.absent,
				designation: el.designation || 'cue',
			}));

		const MID = 400;
		const q1: string[] = [], q2: string[] = [], q3: string[] = [], q4: string[] = [];
		for (const pos of positionCoordinates) {
			const highX = pos.x >= MID;
			const highY = pos.y >= MID;
			if (highX && highY) q1.push(pos.inscription);
			else if (!highX && highY) q2.push(pos.inscription);
			else if (!highX && !highY) q3.push(pos.inscription);
			else q4.push(pos.inscription);
		}
		quadrantAnalysis = { q1, q2, q3, q4 };
	}

	return {
		mapLabel: map?.label || '',
		mapType,
		elements,
		relations,
		silences,
		clusters,
		designationProfile,
		recentMemos,
		crossMapParticipations,
		spatialRelations,
		axes: posAxes,
		positionCoordinates,
		quadrantAnalysis,
	};
}
