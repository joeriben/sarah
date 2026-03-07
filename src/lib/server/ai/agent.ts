// The AI agent: builds context, calls Claude with tools, executes tool calls as naming acts.
// Every tool call produces namings in the data space — the AI is a co-analyst.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMapStructure, getMap, addElementToMap, relateElements, createPhase, assignToPhase } from '../db/queries/maps.js';
import { getOrCreateAiNaming, logAiInteraction } from '../db/queries/ai.js';
import { createMemo } from '../db/queries/memos.js';
import { getMemosByProject } from '../db/queries/memos.js';
import { emit } from './sse.js';
import { SYSTEM_PROMPT, buildContextMessage, type MapContext, type TriggerEvent } from './prompts.js';
import { AI_TOOLS, type SuggestElementInput, type SuggestRelationInput, type IdentifySilenceInput, type WriteMemoInput, type CreatePhaseInput } from './tools.js';
import { query } from '../db/index.js';

const MODEL = 'claude-sonnet-4-20250514';

let client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!client) {
		const keyPath = join(process.cwd(), 'anthropic.key');
		let apiKey: string;
		try {
			apiKey = readFileSync(keyPath, 'utf-8').trim();
		} catch {
			throw new Error('anthropic.key not found. Place your API key in the project root.');
		}
		client = new Anthropic({ apiKey });
	}
	return client;
}

// Check if AI is enabled for a map
async function isAiEnabled(mapId: string): Promise<boolean> {
	const map = await query(
		`SELECT a.properties FROM appearances a
		 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
		[mapId]
	);
	if (map.rows.length === 0) return false;
	const props = map.rows[0].properties;
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
		symmetric: !rel.directed_from && !rel.directed_to
	}));

	// Get recent memos (last 5)
	const memos = await getMemosByProject(projectId);
	const recentMemos = memos.slice(0, 5).map((m: any) => ({
		label: m.label,
		content: m.content || ''
	}));

	return {
		mapLabel: map?.label || '',
		mapType: map?.properties?.mapType || 'situational',
		elements: structure.elements.map((el: any) => ({
			id: el.naming_id,
			inscription: el.inscription,
			designation: el.designation || 'cue',
			mode: el.mode
		})),
		relations,
		silences: structure.silences.map((s: any) => ({
			id: s.naming_id,
			inscription: s.inscription
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
		recentMemos
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
				const memo = await createMemo(projectId, '00000000-0000-0000-0000-000000000000', `AI: ${title}`, content, linked_element_ids || []);
				emit(mapId, 'ai:memo', { memo, title, content });
				return { success: true, result: { id: memo.id, title } };
			}

			case 'create_phase': {
				const { inscription, element_ids, reasoning } = input as unknown as CreatePhaseInput;
				const phase = await createPhaseAsAi(projectId, aiNamingId, mapId, inscription, { aiReasoning: reasoning });
				// Assign elements to phase
				for (const elementId of element_ids) {
					await assignToPhase(phase.id, elementId);
				}
				emit(mapId, 'ai:phase', { phase, elementIds: element_ids, reasoning });
				return { success: true, result: { id: phase.id, inscription, elementCount: element_ids.length } };
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
			`INSERT INTO naming_designations (naming_id, designation, by)
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
			`INSERT INTO naming_designations (naming_id, designation, by)
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
			`INSERT INTO naming_designations (naming_id, designation, by)
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
			`INSERT INTO naming_designations (naming_id, designation, by)
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

	const aiNamingId = await getOrCreateAiNaming(projectId, MODEL);
	const context = await buildMapContext(mapId, projectId);
	const contextMessage = buildContextMessage(context, triggerEvent);

	try {
		const response = await getClient().messages.create({
			model: MODEL,
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			tools: AI_TOOLS,
			messages: [
				{ role: 'user', content: contextMessage }
			]
		});

		// Process tool calls
		const toolResults: Array<{ tool: string; input: unknown; result: unknown }> = [];

		for (const block of response.content) {
			if (block.type === 'tool_use') {
				const result = await executeTool(
					block.name,
					block.input as Record<string, unknown>,
					projectId,
					mapId,
					aiNamingId
				);
				toolResults.push({ tool: block.name, input: block.input, result: result.result });
			}
		}

		// Log the interaction
		await logAiInteraction(
			projectId,
			aiNamingId,
			`map:${triggerEvent.action}`,
			MODEL,
			{ mapId, triggerEvent, contextSummary: { elements: context.elements.length, relations: context.relations.length } },
			{ toolResults, stopReason: response.stop_reason },
			response.usage.input_tokens + response.usage.output_tokens
		);
	} catch (error) {
		console.error('[AI Agent] Error:', error instanceof Error ? error.message : error);
		// Don't throw — AI failures should never break the researcher's workflow
	}
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
