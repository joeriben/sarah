// Search tools available to all AI personas.
// These are AI-callable tools for searching project data, documents, and manual.

import type { ToolDef } from '../client.js';
import { query } from '../../db/index.js';
import { MANUAL } from './manual.js';

// ── Tool definitions (for AI tool calling) ────────────────────────

export const SEARCH_TOOLS: ToolDef[] = [
	{
		name: 'search_documents',
		description:
			'Full-text search across all documents in the current project. Returns matching passages with document names. Use this to find relevant material for analysis.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query (natural language or keywords)'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 5, max: 20)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_namings',
		description:
			'Search across all namings (elements, relations, silences) in the project. Returns matching inscriptions with their designation stage and map locations.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query to match against naming inscriptions'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 10, max: 50)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_memos',
		description:
			'Search across all analytical memos in the project. Returns matching memos with their titles and content previews.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query to match against memo titles and content'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 5, max: 20)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_manual',
		description:
			'Search the transact-qda platform manual for information about features, concepts, and how to use the application.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'What to search for in the manual'
				}
			},
			required: ['query']
		}
	}
];

// ── Tool execution ────────────────────────────────────────────────

export async function executeSearchTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string
): Promise<{ success: boolean; result: string }> {
	switch (toolName) {
		case 'search_documents':
			return searchDocuments(projectId, input.query as string, Math.min((input.max_results as number) || 5, 20));
		case 'search_namings':
			return searchNamings(projectId, input.query as string, Math.min((input.max_results as number) || 10, 50));
		case 'search_memos':
			return searchMemos(projectId, input.query as string, Math.min((input.max_results as number) || 5, 20));
		case 'search_manual':
			return searchManual(input.query as string);
		default:
			return { success: false, result: `Unknown search tool: ${toolName}` };
	}
}

async function searchDocuments(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		// Use German FTS primarily (most projects), fall back to English
		const words = searchQuery.trim().split(/\s+/).filter(w => w.length > 1);
		if (words.length === 0) return { success: false, result: 'Empty search query' };

		const tsquery = words.map(w => `${w}:*`).join(' & ');

		const results = await query(
			`SELECT n.inscription as title,
			        ts_headline('german', dc.full_text, to_tsquery('german', $1),
			          'StartSel=>>>, StopSel=<<<, MaxFragments=3, MaxWords=50, MinWords=20') as headline,
			        LEFT(dc.full_text, 200) as preview
			 FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $2 AND n.deleted_at IS NULL
			   AND dc.full_text IS NOT NULL
			   AND (
			     to_tsvector('german', dc.full_text) @@ to_tsquery('german', $1)
			     OR to_tsvector('english', dc.full_text) @@ to_tsquery('english', $1)
			     OR dc.full_text ILIKE '%' || $3 || '%'
			   )
			 LIMIT $4`,
			[tsquery, projectId, words[0], limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No documents found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} document(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			parts.push(`📄 "${row.title}"`);
			parts.push(row.headline || row.preview);
			parts.push('');
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

async function searchNamings(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		const results = await query(
			`SELECT DISTINCT n.id, n.inscription,
			        COALESCE(
			          (SELECT na.designation FROM naming_acts na
			           WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			           ORDER BY na.seq DESC LIMIT 1),
			          'cue'
			        ) as designation,
			        array_agg(DISTINCT a.mode) FILTER (WHERE a.mode IS NOT NULL) as modes,
			        array_agg(DISTINCT p_map.inscription) FILTER (WHERE p_map.inscription IS NOT NULL) as map_names
			 FROM namings n
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode IN ('entity','relation','silence')
			 LEFT JOIN namings p_map ON p_map.id = a.perspective_id AND p_map.id != n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription ILIKE '%' || $2 || '%'
			 GROUP BY n.id, n.inscription
			 ORDER BY n.inscription
			 LIMIT $3`,
			[projectId, searchQuery, limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No namings found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} naming(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			const modes = row.modes?.join(', ') || 'no appearances';
			const maps = row.map_names?.join(', ') || 'no maps';
			parts.push(`  [${row.designation}] "${row.inscription}" — ${modes} — on: ${maps}`);
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

async function searchMemos(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		const results = await query(
			`SELECT n.inscription as title, LEFT(mc.content, 300) as preview, n.created_at
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription NOT LIKE 'Discussion:%'
			   AND n.inscription NOT LIKE 'MemoDiscussion:%'
			   AND (n.inscription ILIKE '%' || $2 || '%' OR mc.content ILIKE '%' || $2 || '%')
			 ORDER BY n.created_at DESC
			 LIMIT $3`,
			[projectId, searchQuery, limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No memos found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} memo(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			parts.push(`📝 "${row.title}"`);
			parts.push(`   ${row.preview}`);
			parts.push('');
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

function searchManual(searchQuery: string): { success: boolean; result: string } {
	if (!MANUAL) {
		return { success: false, result: 'Manual not loaded' };
	}

	const queryLower = searchQuery.toLowerCase();
	const lines = MANUAL.split('\n');
	const matches: { section: string; content: string }[] = [];
	let currentSection = '';

	for (let i = 0; i < lines.length; i++) {
		// Track section headers
		if (lines[i].startsWith('#')) {
			currentSection = lines[i].replace(/^#+\s*/, '');
		}

		// Check for query match
		if (lines[i].toLowerCase().includes(queryLower)) {
			// Grab context: 2 lines before and 5 after
			const start = Math.max(0, i - 2);
			const end = Math.min(lines.length, i + 6);
			const context = lines.slice(start, end).join('\n');
			matches.push({ section: currentSection, content: context });

			if (matches.length >= 5) break;
			i = end; // skip ahead to avoid overlapping matches
		}
	}

	if (matches.length === 0) {
		return { success: true, result: `No manual entries found matching "${searchQuery}"` };
	}

	const parts = [`Found ${matches.length} section(s) in the manual matching "${searchQuery}":\n`];
	for (const m of matches) {
		parts.push(`── ${m.section} ──`);
		parts.push(m.content);
		parts.push('');
	}
	return { success: true, result: parts.join('\n') };
}
