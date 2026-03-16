// The AI agent: builds context, calls Claude with tools, executes tool calls as naming acts.
// Every tool call produces namings in the data space — the AI is a co-analyst.

import { chat, getModel } from './client.js';
import { getMapStructure, getMap, addElementToMap, relateElements, createPhase, assignToPhase, getCrossMapParticipations } from '../db/queries/maps.js';
import { getOrCreateAiNaming, logAiInteraction } from '../db/queries/ai.js';
import { createMemo, updateMemoContent } from '../db/queries/memos.js';
import { getMemosByProject } from '../db/queries/memos.js';
import { emit } from './sse.js';
import { SYSTEM_PROMPT, SWA_SUPPLEMENT, DISCUSSION_SYSTEM_PROMPT, MEMO_DISCUSSION_PROMPT, buildContextMessage, buildDiscussionMessage, buildMemoDiscussionMessage, type MapContext, type TriggerEvent, type DiscussionContext, type MemoDiscussionContext } from './prompts.js';
import { AI_TOOLS, SUGGEST_FORMATION_TOOL, DISCUSSION_TOOLS, MEMO_DISCUSSION_TOOLS, type SuggestElementInput, type SuggestRelationInput, type IdentifySilenceInput, type WriteMemoInput, type CreatePhaseInput, type SuggestFormationInput, type RewriteCueInput, type RespondInput, type WithdrawCueInput, type ReviseMemoInput } from './tools.js';
import { SW_ROLE_DEFAULTS } from '$lib/shared/constants.js';
import { query } from '../db/index.js';

// Check if AI is enabled for a map (also respects readOnly)
async function isAiEnabled(mapId: string): Promise<boolean> {
	const map = await query(
		`SELECT a.properties FROM appearances a
		 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
		[mapId]
	);
	if (map.rows.length === 0) return false;
	const props = map.rows[0].properties;
	// Read-only maps: AI must not write
	if (props?.readOnly) return false;
	// Default: enabled. Only disabled if explicitly set to false.
	return props?.aiEnabled !== false;
}

// Build the full map context for the AI
async function buildMapContext(mapId: string, projectId: string): Promise<MapContext> {
	const map = await getMap(mapId, projectId);
	const structure = await getMapStructure(mapId, projectId);

	// Enrich relations with source/target inscriptions
	const elementMap = new Map<string, string>();
	for (const el of structure.elements) {
		elementMap.set(el.naming_id, el.inscription);
	}

	// Collect all naming IDs that are AI-suggested to batch-fetch discussion summaries
	const allAppearances = [...structure.elements, ...structure.relations, ...structure.silences];
	const aiNamingIds = allAppearances
		.filter((a: any) => a.properties?.aiSuggested)
		.map((a: any) => a.naming_id);

	// Fetch discussion summaries for AI-suggested cues (batch query)
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

	// Get recent memos (last 5)
	const memos = await getMemosByProject(projectId);
	const recentMemos = memos.slice(0, 5).map((m: any) => ({
		label: m.label,
		content: m.content || ''
	}));

	const mapType = map?.properties?.mapType || 'situational';
	const isSwa = mapType === 'social-worlds';

	// SW/A: cross-map participations and spatial relations
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

		// Extract spatial relations from spatiallyDerived relations
		const spatial = structure.relations
			.filter((r: any) => r.properties?.spatiallyDerived && !r.properties?.withdrawn)
			.map((r: any) => ({
				type: (r.valence === 'contains' ? 'contains' : 'overlaps') as 'contains' | 'overlaps',
				formationA: r.directed_from || r.part_source_id || '',
				formationB: r.directed_to || r.part_target_id || '',
			}));
		if (spatial.length > 0) {
			spatialRelations = spatial;
		}
	}

	return {
		mapLabel: map?.label || '',
		mapType,
		elements: structure.elements.map((el: any) => ({
			id: el.naming_id,
			inscription: el.inscription,
			designation: el.designation || 'cue',
			mode: el.mode,
			provenance: el.has_document_anchor ? 'empirical' as const : el.has_memo_link ? 'analytical' as const : 'ungrounded' as const,
			swRole: el.sw_role || undefined,
			aiSuggested: el.properties?.aiSuggested || false,
			aiWithdrawn: el.properties?.aiWithdrawn || el.properties?.withdrawn || false,
			discussionSummary: discussionMap.get(el.naming_id)
		})),
		relations,
		silences: structure.silences.map((s: any) => ({
			id: s.naming_id,
			inscription: s.inscription,
			aiSuggested: s.properties?.aiSuggested || false,
			aiWithdrawn: s.properties?.aiWithdrawn || s.properties?.withdrawn || false,
			discussionSummary: discussionMap.get(s.naming_id)
		})),
		phases: structure.phases.map((p: any) => ({
			id: p.id,
			label: p.label,
			elementCount: parseInt(p.element_count) || 0
		})),
		designationProfile: structure.designationProfile.map((d: any) => ({
			designation: d.designation,
			count: parseInt(d.count) || 0
		})),
		recentMemos,
		crossMapParticipations,
		spatialRelations,
	};
}

// Execute a single tool call as a naming act
async function executeTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	mapId: string,
	aiNamingId: string
): Promise<{ success: boolean; result: unknown }> {
	try {
		switch (toolName) {
			case 'suggest_element': {
				const { inscription, reasoning } = input as unknown as SuggestElementInput;
				// Use a synthetic user ID — the AI naming system handles attribution via designation.by
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning });
				emit(mapId, 'ai:element', { element, reasoning });
				return { success: true, result: { id: element.id, inscription } };
			}

			case 'suggest_relation': {
				const { source_id, target_id, inscription, valence, symmetric, reasoning } = input as unknown as SuggestRelationInput;
				const relation = await relateElementsAsAi(projectId, aiNamingId, mapId, source_id, target_id, {
					inscription, valence, symmetric, properties: { aiReasoning: reasoning }
				});
				emit(mapId, 'ai:relation', { relation, reasoning });
				return { success: true, result: { id: relation.id, sourceId: source_id, targetId: target_id } };
			}

			case 'identify_silence': {
				const { inscription, reasoning } = input as unknown as IdentifySilenceInput;
				const silence = await addSilenceToMap(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning });
				emit(mapId, 'ai:silence', { silence, reasoning });
				return { success: true, result: { id: silence.id, inscription } };
			}

			case 'write_memo': {
				const { title, content, linked_element_ids } = input as unknown as WriteMemoInput;
				// Create memo with AI as author — use a system user placeholder
				const memo = await createMemo(projectId, '00000000-0000-0000-0000-000000000000', `AI: ${title}`, content, linked_element_ids || [], 'presented');
				emit(mapId, 'ai:memo', {
					memo,
					title,
					content,
					linkedIds: linked_element_ids || [],
					authorId: '00000000-0000-0000-0000-000000000000'
				});
				return { success: true, result: { id: memo.id, title } };
			}

			case 'create_phase': {
				const { inscription, element_ids, reasoning } = input as unknown as CreatePhaseInput;
				const phase = await createPhaseAsAi(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning });
				// Assign elements to phase
				for (const elementId of element_ids) {
					await assignToPhase(phase.id, elementId, undefined, undefined, aiNamingId);
				}
				emit(mapId, 'ai:phase', { phase, elementIds: element_ids, reasoning });
				return { success: true, result: { id: phase.id, inscription, elementCount: element_ids.length } };
			}

			case 'suggest_formation': {
				// Guard: only on SW/A maps
				const mapRow = await query(
					`SELECT a.properties FROM appearances a
					 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
					[mapId]
				);
				if (mapRow.rows[0]?.properties?.mapType !== 'social-worlds') {
					return { success: false, result: 'suggest_formation is only available on social-worlds maps' };
				}
				const { inscription, sw_role, reasoning } = input as unknown as SuggestFormationInput;
				const defaults = SW_ROLE_DEFAULTS[sw_role] || SW_ROLE_DEFAULTS['social-world'];
				const element = await addElementToAiMap(projectId, aiNamingId, mapId, inscription, {
					...defaults, aiReasoning: reasoning
				});
				// Classification memo: mirrors the addFormation API action
				await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
					`Formation: ${sw_role}`, reasoning, [element.id]);
				emit(mapId, 'ai:formation', { element, swRole: sw_role, reasoning });
				return { success: true, result: { id: element.id, inscription, swRole: sw_role } };
			}

			default:
				return { success: false, result: `Unknown tool: ${toolName}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, result: message };
	}
}

// Naming-act variants where the AI is the actor (by = ai_naming_id)
import { transaction } from '../db/index.js';

async function addElementToAiMap(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, '00000000-0000-0000-0000-000000000000']
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[naming.id, mapId, JSON.stringify({ ...properties, aiSuggested: true })]
		);

		// Designation: cue, by the AI naming
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, aiNamingId]
		);

		return naming;
	});
}

async function relateElementsAsAi(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	sourceId: string,
	targetId: string,
	opts?: { inscription?: string; valence?: string; symmetric?: boolean; properties?: Record<string, unknown> }
) {
	return transaction(async (client) => {
		const partNamingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, opts?.inscription || '', '00000000-0000-0000-0000-000000000000']
		);
		const partNaming = partNamingRes.rows[0];

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partNaming.id, sourceId, targetId]
		);

		const dirFrom = opts?.symmetric ? null : sourceId;
		const dirTo = opts?.symmetric ? null : targetId;
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, $5, $6)`,
			[partNaming.id, mapId, dirFrom, dirTo, opts?.valence || null, JSON.stringify({ ...opts?.properties, aiSuggested: true })]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[partNaming.id, aiNamingId]
		);

		return { id: partNaming.id, sourceId, targetId, valence: opts?.valence };
	});
}

async function addSilenceToMap(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, '00000000-0000-0000-0000-000000000000']
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'silence', $3)`,
			[naming.id, mapId, JSON.stringify({ ...properties, aiSuggested: true })]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[naming.id, aiNamingId]
		);

		return naming;
	});
}

async function createPhaseAsAi(
	projectId: string,
	aiNamingId: string,
	mapId: string,
	inscription: string,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const phaseRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, '00000000-0000-0000-0000-000000000000']
		);
		const phase = phaseRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[phase.id, JSON.stringify({ parentMapId: mapId, ...properties, aiSuggested: true })]
		);

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'perspective', $3)`,
			[phase.id, mapId, JSON.stringify({ ...properties, aiSuggested: true })]
		);

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $1, $2)`,
			[phase.id, mapId]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'cue', $2)`,
			[phase.id, aiNamingId]
		);

		return phase;
	});
}

// Main entry point: run the AI agent for a map action
export async function runMapAgent(
	projectId: string,
	mapId: string,
	triggerEvent: TriggerEvent
): Promise<void> {
	// Check if AI is enabled
	if (!(await isAiEnabled(mapId))) return;

	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);
	const context = await buildMapContext(mapId, projectId);
	const contextMessage = buildContextMessage(context, triggerEvent);

	const isSwaMap = context.mapType === 'social-worlds';
	const systemPrompt = isSwaMap ? SYSTEM_PROMPT + '\n\n' + SWA_SUPPLEMENT : SYSTEM_PROMPT;
	const tools = isSwaMap ? [...AI_TOOLS, SUGGEST_FORMATION_TOOL] : AI_TOOLS;

	try {
		const response = await chat({
			system: systemPrompt,
			maxTokens: 2048,
			tools,
			messages: [
				{ role: 'user', content: contextMessage }
			]
		});

		// Process tool calls
		const toolResults: Array<{ tool: string; input: unknown; result: unknown }> = [];

		for (const tc of response.toolCalls) {
			const result = await executeTool(
				tc.name,
				tc.input,
				projectId,
				mapId,
				aiNamingId
			);
			toolResults.push({ tool: tc.name, input: tc.input, result: result.result });
		}

		// Log the interaction
		await logAiInteraction(
			projectId,
			aiNamingId,
			`map:${triggerEvent.action}`,
			model,
			{ mapId, triggerEvent, contextSummary: { elements: context.elements.length, relations: context.relations.length } },
			{ toolResults, stopReason: response.stopReason },
			response.tokensUsed
		);
	} catch (error) {
		console.error('[AI Agent] Error:', error instanceof Error ? error.stack || error.message : error);
		// Don't throw — AI failures should never break the researcher's workflow
	}
}

// Discuss an AI-generated cue: researcher sends a message, AI responds with tools
export async function discussCue(
	projectId: string,
	mapId: string,
	namingId: string,
	researcherMessage: string,
	userId?: string
): Promise<{ response: string; actions: Array<{ type: string; detail: unknown }> }> {
	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);

	// Build discussion context from the naming's properties and linked memos
	const namingRow = await query(
		`SELECT n.inscription, a.mode, a.properties, a.directed_from, a.directed_to, a.valence
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = $2
		 WHERE n.id = $1`,
		[namingId, mapId]
	);
	if (namingRow.rows.length === 0) throw new Error('Naming not found on this map');
	const naming = namingRow.rows[0];

	// Determine cue type
	const cueType = naming.mode === 'relation' ? 'relation' as const
		: naming.mode === 'silence' ? 'silence' as const
		: 'element' as const;

	// Get relation detail if applicable
	let relationDetail: DiscussionContext['relationDetail'];
	if (cueType === 'relation' && (naming.directed_from || naming.directed_to)) {
		const [src, tgt] = await Promise.all([
			naming.directed_from ? query(`SELECT inscription FROM namings WHERE id = $1`, [naming.directed_from]) : null,
			naming.directed_to ? query(`SELECT inscription FROM namings WHERE id = $1`, [naming.directed_to]) : null
		]);
		relationDetail = {
			sourceInscription: src?.rows[0]?.inscription || '?',
			targetInscription: tgt?.rows[0]?.inscription || '?',
			valence: naming.valence || undefined
		};
	}

	// Get previous discussion memos linked to this naming (AI discussions have label prefix "Discussion:")
	const prevMemos = await query(
		`SELECT DISTINCT m.id, m.inscription as label, mc.content, m.created_by, m.created_at
		 FROM participations p
		 JOIN namings m ON m.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		 JOIN memo_content mc ON mc.naming_id = m.id
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)
		   AND m.deleted_at IS NULL
		   AND m.id != $1
		   AND m.inscription LIKE 'Discussion:%'
		 ORDER BY m.created_at ASC
		 LIMIT 30`,
		[namingId]
	);

	const previousDiscussion: DiscussionContext['previousDiscussion'] = [];
	for (const memo of prevMemos.rows) {
		// AI memos use the system user UUID
		const role = memo.created_by === '00000000-0000-0000-0000-000000000000' ? 'ai' as const : 'researcher' as const;
		previousDiscussion.push({ role, content: memo.content });
	}

	const discussionCtx: DiscussionContext = {
		cueId: namingId,
		cueInscription: naming.inscription,
		cueType,
		aiReasoning: naming.properties?.aiReasoning || '(no reasoning recorded)',
		relationDetail,
		previousDiscussion
	};

	const contextMessage = buildDiscussionMessage(discussionCtx, researcherMessage);

	// Save the researcher's message as a discussion memo BEFORE calling AI
	// (ensures correct chronological ordering in the discussion thread)
	await createMemo(projectId, userId || '00000000-0000-0000-0000-000000000000',
		`Discussion: researcher`, researcherMessage, [namingId]);

	let response;
	try {
		response = await chat({
			system: DISCUSSION_SYSTEM_PROMPT,
			maxTokens: 1024,
			tools: DISCUSSION_TOOLS,
			messages: [
				{ role: 'user', content: contextMessage }
			]
		});
	} catch (error) {
		// AI call failed — create an error memo so the thread isn't broken
		const errMsg = error instanceof Error ? error.message : String(error);
		await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
			`Discussion: response`, `(AI could not respond: ${errMsg})`, [namingId]);
		return { response: `AI could not respond: ${errMsg}`, actions: [] };
	}

	// Execute discussion tool calls
	const actions: Array<{ type: string; detail: unknown }> = [];
	let responseText = response.text;

	for (const tc of response.toolCalls) {
		switch (tc.name) {
			case 'rewrite_cue': {
				const { new_inscription, reasoning } = tc.input as unknown as RewriteCueInput;
				if (!new_inscription?.trim()) break; // guard against empty rewrite
				// Rename the naming — this creates a new inscription layer in the stack
				await transaction(async (client) => {
					await client.query(
						`UPDATE namings SET inscription = $1 WHERE id = $2`,
						[new_inscription.trim(), namingId]
					);
					await client.query(
						`INSERT INTO naming_acts (naming_id, inscription, by)
						 VALUES ($1, $2, $3)`,
						[namingId, new_inscription.trim(), aiNamingId]
					);
				});
				// Create discussion memo documenting the rewrite
				await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
					`Discussion: rewrite`, reasoning || new_inscription, [namingId]);
				actions.push({ type: 'rewrite', detail: { newInscription: new_inscription, reasoning } });
				emit(mapId, 'ai:rewrite', { namingId, newInscription: new_inscription, reasoning });
				break;
			}
			case 'respond': {
				const { content } = tc.input as unknown as RespondInput;
				if (!content?.trim()) break;
				await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
					`Discussion: response`, content, [namingId]);
				actions.push({ type: 'respond', detail: { content } });
				break;
			}
			case 'withdraw_cue': {
				const { reasoning } = tc.input as unknown as WithdrawCueInput;
				// Mark as withdrawn via properties flag (soft — stays in stack)
				await query(
					`UPDATE appearances SET properties = properties || '{"aiWithdrawn": true}'::jsonb, updated_at = now()
					 WHERE naming_id = $1 AND perspective_id = $2`,
					[namingId, mapId]
				);
				await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
					`Discussion: withdrawn`, reasoning || '(withdrawn)', [namingId]);
				actions.push({ type: 'withdraw', detail: { reasoning } });
				emit(mapId, 'ai:withdraw', { namingId, reasoning });
				break;
			}
		}
	}

	// If AI responded with text but no respond tool call, save it too
	if (responseText && !actions.some(a => a.type === 'respond')) {
		await createMemo(projectId, '00000000-0000-0000-0000-000000000000',
			`Discussion: response`, responseText, [namingId]);
		actions.push({ type: 'respond', detail: { content: responseText } });
	}

	// Log the interaction
	await logAiInteraction(
		projectId,
		aiNamingId,
		'discussion',
		model,
		{ mapId, namingId, researcherMessage },
		{ actions, text: responseText, stopReason: response.stopReason },
		response.tokensUsed
	);

	// Build response text for frontend
	const aiResponseText = actions
		.filter(a => a.type === 'respond')
		.map(a => (a.detail as { content: string }).content)
		.join('\n\n') || responseText;

	return { response: aiResponseText, actions };
}

// Discuss an analytical memo: researcher sends a message, AI responds
export async function discussMemo(
	projectId: string,
	mapId: string,
	memoId: string,
	researcherMessage: string,
	userId?: string
): Promise<{ response: string; actions: Array<{ type: string; detail: unknown }> }> {
	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);

	// Get the memo and its content
	const memoRow = await query(
		`SELECT n.id, n.inscription as label, mc.content, n.created_by
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[memoId, projectId]
	);
	if (memoRow.rows.length === 0) throw new Error('Memo not found');
	const memo = memoRow.rows[0];

	const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
	const memoAuthor = memo.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const;

	// Get linked elements (via participations)
	const linkedRows = await query(
		`SELECT t.id, t.inscription
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		   AND t.deleted_at IS NULL AND t.id != $1
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)`,
		[memoId]
	);
	// Filter out other memos (those with memo_content) to get map elements only
	const linkedElementRows = await query(
		`SELECT n.id, n.inscription
		 FROM unnest($1::uuid[]) AS uid(id)
		 JOIN namings n ON n.id = uid.id
		 WHERE NOT EXISTS (SELECT 1 FROM memo_content mc WHERE mc.naming_id = n.id)`,
		[linkedRows.rows.map((r: any) => r.id)]
	);
	const linkedElements = linkedElementRows.rows.map((r: any) => ({ id: r.id, inscription: r.inscription }));

	// Get previous discussion entries for this memo
	const prevDiscussion = await query(
		`SELECT DISTINCT m.id, m.inscription as label, mc.content, m.created_by, m.created_at
		 FROM participations p
		 JOIN namings m ON m.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		 JOIN memo_content mc ON mc.naming_id = m.id
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)
		   AND m.deleted_at IS NULL
		   AND m.id != $1
		   AND m.inscription LIKE 'MemoDiscussion:%'
		 ORDER BY m.created_at ASC
		 LIMIT 30`,
		[memoId]
	);

	const previousDiscussion: MemoDiscussionContext['previousDiscussion'] = [];
	for (const entry of prevDiscussion.rows) {
		const role = entry.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const;
		previousDiscussion.push({ role, content: entry.content });
	}

	// Get map context for the AI
	const map = await getMap(mapId, projectId);

	const discussionCtx: MemoDiscussionContext = {
		memoId,
		memoTitle: memo.label,
		memoContent: memo.content,
		memoAuthor,
		linkedElements,
		previousDiscussion,
		mapLabel: map?.label || '',
		mapType: map?.properties?.mapType || 'situational',
	};

	const contextMessage = buildMemoDiscussionMessage(discussionCtx, researcherMessage);

	// Save researcher's message as a discussion entry BEFORE calling AI
	await createMemo(projectId, userId || AI_SYSTEM_UUID,
		`MemoDiscussion: researcher`, researcherMessage, [memoId]);

	let response;
	try {
		response = await chat({
			system: MEMO_DISCUSSION_PROMPT,
			maxTokens: 1024,
			tools: MEMO_DISCUSSION_TOOLS,
			messages: [
				{ role: 'user', content: contextMessage }
			]
		});
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		await createMemo(projectId, AI_SYSTEM_UUID,
			`MemoDiscussion: response`, `(AI could not respond: ${errMsg})`, [memoId]);
		return { response: `AI could not respond: ${errMsg}`, actions: [] };
	}

	// Execute discussion tool calls
	const actions: Array<{ type: string; detail: unknown }> = [];
	let responseText = response.text;

	for (const tc of response.toolCalls) {
		switch (tc.name) {
			case 'respond': {
				const { content } = tc.input as unknown as RespondInput;
				if (!content?.trim()) break;
				await createMemo(projectId, AI_SYSTEM_UUID,
					`MemoDiscussion: response`, content, [memoId]);
				actions.push({ type: 'respond', detail: { content } });
				break;
			}
			case 'revise_memo': {
				const { revised_content, reasoning } = tc.input as unknown as ReviseMemoInput;
				if (!revised_content?.trim()) break;
				// Update memo content
				await updateMemoContent(memoId, revised_content);
				// Log the revision as a discussion entry
				await createMemo(projectId, AI_SYSTEM_UUID,
					`MemoDiscussion: revise`, reasoning || revised_content, [memoId]);
				actions.push({ type: 'revise', detail: { revised_content, reasoning } });
				emit(mapId, 'ai:memo-revised', { memoId, revised_content, reasoning });
				break;
			}
		}
	}

	// If AI responded with text but no respond tool call, save it
	if (responseText && !actions.some(a => a.type === 'respond')) {
		await createMemo(projectId, AI_SYSTEM_UUID,
			`MemoDiscussion: response`, responseText, [memoId]);
		actions.push({ type: 'respond', detail: { content: responseText } });
	}

	// Log the interaction
	await logAiInteraction(
		projectId,
		aiNamingId,
		'memo-discussion',
		model,
		{ mapId, memoId, researcherMessage },
		{ actions, text: responseText, stopReason: response.stopReason },
		response.tokensUsed
	);

	const aiResponseText = actions
		.filter(a => a.type === 'respond')
		.map(a => (a.detail as { content: string }).content)
		.join('\n\n') || responseText;

	return { response: aiResponseText, actions };
}

// Toggle AI for a map
export async function setAiEnabled(mapId: string, enabled: boolean): Promise<void> {
	await query(
		`UPDATE appearances
		 SET properties = properties || $1::jsonb, updated_at = now()
		 WHERE naming_id = $2 AND perspective_id = $2 AND mode = 'perspective'`,
		[JSON.stringify({ aiEnabled: enabled }), mapId]
	);
}
