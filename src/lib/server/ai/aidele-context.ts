// Aidele context builder: gathers project state for the didactic persona.
// Read-only queries — Aidele never writes to the project data.

import { query, queryOne } from '../db/index.js';
import { getMapsByProject, getMapStructure } from '../db/queries/maps.js';

export async function buildAideleContext(
	projectId: string,
	currentPage: string,
	currentMapId?: string
): Promise<string> {
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

		// Get element counts + designation profiles per map (single query)
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

	// Current page context
	parts.push(`\nCURRENT PAGE: ${currentPage}`);

	// Detailed map context if viewing a specific map
	if (currentMapId) {
		try {
			const structure = await getMapStructure(currentMapId, projectId);

			parts.push(`\nCURRENT MAP DETAIL:`);

			// Build element inscription map for relation display
			const elementMap = new Map<string, string>();
			for (const el of structure.elements) {
				elementMap.set(el.naming_id, el.inscription);
			}

			// Elements (without AI flags — Aidele doesn't need those)
			if (structure.elements.length > 0) {
				parts.push('  Elements:');
				for (const el of structure.elements.slice(0, 30)) {
					const desig = el.designation || 'cue';
					const prov = el.has_document_anchor ? ' 📄' : el.has_memo_link ? ' 📝' : ' ∅';
					const role = el.sw_role ? ` [${el.sw_role}]` : '';
					parts.push(`    [${desig}]${prov}${role} "${el.inscription}"`);
				}
				if (structure.elements.length > 30) {
					parts.push(`    ... and ${structure.elements.length - 30} more`);
				}
			}

			// Relations summary
			if (structure.relations.length > 0) {
				parts.push(`  Relations: ${structure.relations.length} total`);
				for (const rel of structure.relations.slice(0, 10)) {
					const label = rel.inscription ? `: "${rel.inscription}"` : '';
					const srcName = elementMap.get(rel.directed_from) || '?';
					const tgtName = elementMap.get(rel.directed_to) || '?';
					parts.push(`    "${srcName}" → "${tgtName}"${label}`);
				}
				if (structure.relations.length > 10) {
					parts.push(`    ... and ${structure.relations.length - 10} more`);
				}
			}

			// Silences
			if (structure.silences.length > 0) {
				parts.push(`  Silences: ${structure.silences.map((s: any) => `"${s.inscription}"`).join(', ')}`);
			}

			// Phases
			if (structure.phases.length > 0) {
				parts.push(`  Phases: ${structure.phases.map((p: any) => `"${p.label}" (${p.element_count} elements)`).join(', ')}`);
			}

			// Designation profile
			if (structure.designationProfile.length > 0) {
				const profile = structure.designationProfile.map((d: any) => `${d.count} ${d.designation}`).join(', ');
				parts.push(`  Designation profile: ${profile}`);
			}

			// Axes for positional maps
			if (structure.axes?.length > 0) {
				parts.push(`  Axes: ${structure.axes.map((a: any) => `${a.properties?.axisDimension?.toUpperCase() || '?'}: "${a.inscription}"`).join(', ')}`);
			}
		} catch (e) {
			console.warn(`Aidele: failed to load map detail for ${currentMapId}:`, e);
		}
	}

	// Recent memos (project-wide, last 5)
	const recentMemos = (await query(
		`SELECT n.inscription as label, LEFT(mc.content, 200) as preview
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND n.inscription NOT LIKE 'Discussion:%'
		   AND n.inscription NOT LIKE 'MemoDiscussion:%'
		 ORDER BY n.created_at DESC
		 LIMIT 5`,
		[projectId]
	)).rows;

	if (recentMemos.length > 0) {
		parts.push('\nRECENT MEMOS:');
		for (const m of recentMemos) {
			parts.push(`  "${m.label}": ${m.preview}`);
		}
	}

	return parts.join('\n');
}
