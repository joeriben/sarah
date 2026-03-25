// Generic agent runtime: persona-agnostic loop that composes
// shared knowledge + persona instructions + context → chat → execute.
//
// All AI entry points live here:
// - runConversation: conversational mode (Aidele)
// - runMapAgent: map agent mode (Cairrie) — reacts to researcher actions
// - discussCue: cue discussion mode — researcher discusses an AI-generated cue
// - discussMemo: memo discussion mode — researcher discusses an analytical memo

import { chat, getModel, getProvider } from '../client.js';
import { FULL_KNOWLEDGE } from '../base/knowledge.js';
import { MANUAL } from '../base/manual.js';
import { buildProjectContext, buildMapDetail, buildMemoContext, buildLibraryContext, buildStructuredMapContext, type MapContext } from '../base/context.js';
import { SEARCH_TOOLS, executeSearchTool } from '../base/search-tools.js';
import { DELEGATE_TOOL, executeDelegation, getAvailableAgentsSync } from '../base/delegation.js';
import { TICKET_TOOL, createTicket } from '../base/tickets.js';
import { getPersona, type Persona, type PersonaName } from '../personas/index.js';
import { getOrCreateAiNaming, logAiInteraction } from '../../db/queries/ai.js';
import { createMemo } from '../../db/queries/memos.js';
import { getMap } from '../../db/queries/maps.js';
import { query } from '../../db/index.js';
import { executeMapTool, executeCueDiscussionTool, executeMemoDiscussionTool, isAiEnabled } from './tool-executor.js';
import { buildContextMessage, buildDiscussionMessage, buildMemoDiscussionMessage, DISCUSSION_SYSTEM_PROMPT, MEMO_DISCUSSION_PROMPT, type TriggerEvent, type DiscussionContext, type MemoDiscussionContext } from '../prompts.js';
import { DISCUSSION_TOOLS, MEMO_DISCUSSION_TOOLS } from '../tools.js';
import type { ToolDef } from '../client.js';
export type { TriggerEvent };

const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

// ── System prompt composition ─────────────────────────────────────

function buildSystemPrompt(persona: Persona, mapType?: string): string {
	const parts: string[] = [];

	parts.push(FULL_KNOWLEDGE);
	parts.push(persona.systemPromptAdditions);

	if (mapType && persona.getMapSupplement) {
		const supplement = persona.getMapSupplement(mapType as any);
		if (supplement) parts.push(supplement);
	}

	if (MANUAL) {
		parts.push(`
═══════════════════════════════════════
TRANSACT-QDA SYSTEM MANUAL
═══════════════════════════════════════

${MANUAL}`);
	}

	if (persona.canDelegate) {
		const agents = getAvailableAgentsSync();
		if (agents.length > 0) {
			parts.push(`
═══════════════════════════════════════
AVAILABLE AGENTS FOR DELEGATION
═══════════════════════════════════════

You can delegate subtasks to cheaper/faster models when appropriate:
${agents.map(a => `- ${a.label} [${a.costTier} cost]: ${a.description}`).join('\n')}`);
		}
	}

	return parts.join('\n');
}

// ── Tool composition ──────────────────────────────────────────────

function buildToolSet(persona: Persona, mapType?: string): ToolDef[] {
	const tools: ToolDef[] = [];

	tools.push(...persona.getTools(mapType as any));
	tools.push(...SEARCH_TOOLS);

	if (persona.canDelegate) {
		tools.push(DELEGATE_TOOL);
	}

	tools.push(TICKET_TOOL);

	return tools;
}

// ── Context composition ───────────────────────────────────────────

async function buildContext(
	persona: Persona,
	projectId: string,
	opts: {
		currentPage?: string;
		mapId?: string;
		userMessage?: string;
	}
): Promise<string> {
	const parts: string[] = [];
	const needs = persona.contextNeeds;

	if (needs.projectOverview) {
		parts.push(await buildProjectContext(projectId));
	}

	if (opts.currentPage) {
		parts.push(`CURRENT PAGE: ${opts.currentPage}`);
	}

	if (needs.mapDetail && opts.mapId) {
		parts.push(await buildMapDetail(opts.mapId, projectId, {
			includeAiMetadata: persona.canWrite
		}));
	}

	if (needs.memos) {
		const memoCtx = await buildMemoContext(projectId);
		if (memoCtx) parts.push(memoCtx);
	}

	if (needs.library && opts.userMessage) {
		const libraryCtx = await buildLibraryContext(opts.userMessage);
		if (libraryCtx) parts.push(libraryCtx);
	}

	return parts.filter(Boolean).join('\n\n');
}

// ── Infrastructure tool dispatch ─────────────────────────────────

async function executeInfrastructureTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	personaName: PersonaName
): Promise<{ success: boolean; result: unknown } | null> {
	if (['search_documents', 'search_namings', 'search_memos', 'search_manual'].includes(toolName)) {
		return executeSearchTool(toolName, input, projectId);
	}

	if (toolName === 'delegate_task') {
		const result = await executeDelegation(
			input.agent_label as string,
			input.task as string,
			(input.max_tokens as number) || 1024,
			projectId
		);
		return { success: result.success, result: result.result };
	}

	if (toolName === 'create_ticket') {
		const ticket = await createTicket(
			personaName,
			input.type as any,
			input.title as string,
			input.description as string,
			{ projectId }
		);
		return { success: true, result: `Ticket created: ${ticket.title} (${ticket.id})` };
	}

	return null;
}

// ── Entry point: Conversational mode (Aidele) ────────────────────

export async function runConversation(
	personaName: PersonaName,
	projectId: string,
	message: string,
	history: Array<{ role: 'user' | 'assistant'; content: string }>,
	opts: {
		currentPage?: string;
		mapId?: string;
		maxTokens?: number;
		maxHistory?: number;
	} = {}
): Promise<{ response: string; model: string; tokensUsed: number }> {
	const persona = getPersona(personaName);
	const mapType = opts.mapId ? await getMapType(opts.mapId) : undefined;

	const systemPrompt = buildSystemPrompt(persona, mapType);
	const context = await buildContext(persona, projectId, {
		currentPage: opts.currentPage,
		mapId: opts.mapId,
		userMessage: message
	});
	const tools = buildToolSet(persona, mapType);

	const maxHistory = opts.maxHistory || 40;
	const trimmedHistory = history.slice(-maxHistory);
	const userMessage = `CURRENT PROJECT STATE:\n${context}\n\nRESEARCHER'S MESSAGE:\n${message}`;

	const response = await chat({
		system: systemPrompt,
		messages: [
			...trimmedHistory,
			{ role: 'user', content: userMessage }
		],
		maxTokens: opts.maxTokens || 16000,
		tools: tools.length > 0 ? tools : undefined
	});

	// Handle any infrastructure tool calls in the response
	let responseText = response.text;
	for (const tc of response.toolCalls) {
		const infraResult = await executeInfrastructureTool(tc.name, tc.input, projectId, personaName);
		if (infraResult) {
			responseText += `\n\n[${tc.name}: ${typeof infraResult.result === 'string' ? infraResult.result : JSON.stringify(infraResult.result)}]`;
		}
	}

	// Log interaction
	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);
	await logAiInteraction(
		projectId,
		aiNamingId,
		personaName,
		model,
		{ currentPage: opts.currentPage, mapId: opts.mapId, messageCount: trimmedHistory.length },
		{ text: responseText.slice(0, 500) },
		response.tokensUsed,
		response.provider,
		response.inputTokens,
		response.outputTokens
	);

	return {
		response: responseText,
		model: response.model,
		tokensUsed: response.tokensUsed
	};
}

// ── Entry point: Map agent (Cairrie) ─────────────────────────────

export async function runMapAgent(
	projectId: string,
	mapId: string,
	triggerEvent: TriggerEvent
): Promise<void> {
	if (!(await isAiEnabled(mapId))) return;

	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);
	const persona = getPersona('cairrie');
	const context = await buildStructuredMapContext(mapId, projectId);

	// Positional maps: only respond to explicit analysis requests
	if (context.mapType === 'positional' && triggerEvent.action !== 'requestAnalysis') return;

	const systemPrompt = buildSystemPrompt(persona, context.mapType);
	const tools = buildToolSet(persona, context.mapType);
	const contextMessage = buildContextMessage(context, triggerEvent);

	try {
		const response = await chat({
			system: systemPrompt,
			maxTokens: 2048,
			tools,
			messages: [
				{ role: 'user', content: contextMessage }
			]
		});

		// Execute tool calls: map tools first, then infrastructure
		const toolResults: Array<{ tool: string; input: unknown; result: unknown }> = [];

		for (const tc of response.toolCalls) {
			// Try infrastructure tools first (search, delegation, tickets)
			const infraResult = await executeInfrastructureTool(tc.name, tc.input, projectId, 'cairrie');
			if (infraResult) {
				toolResults.push({ tool: tc.name, input: tc.input, result: infraResult.result });
				continue;
			}
			// Map-specific tools (naming acts)
			const result = await executeMapTool(tc.name, tc.input, projectId, mapId, aiNamingId);
			toolResults.push({ tool: tc.name, input: tc.input, result: result.result });
		}

		await logAiInteraction(
			projectId,
			aiNamingId,
			`map:${triggerEvent.action}`,
			model,
			{ mapId, triggerEvent, contextSummary: { elements: context.elements.length, relations: context.relations.length } },
			{ toolResults, stopReason: response.stopReason },
			response.tokensUsed,
			response.provider,
			response.inputTokens,
			response.outputTokens
		);
	} catch (error) {
		console.error('[AI Agent] Error:', error instanceof Error ? error.stack || error.message : error);
	}
}

// ── Entry point: Cue discussion ──────────────────────────────────

export async function discussCue(
	projectId: string,
	mapId: string,
	namingId: string,
	researcherMessage: string,
	userId?: string
): Promise<{ response: string; actions: Array<{ type: string; detail: unknown }> }> {
	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);

	// Build discussion context
	const namingRow = await query(
		`SELECT n.inscription, a.mode, a.properties, a.directed_from, a.directed_to, a.valence
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = $2
		 WHERE n.id = $1`,
		[namingId, mapId]
	);
	if (namingRow.rows.length === 0) throw new Error('Naming not found on this map');
	const naming = namingRow.rows[0];

	const cueType = naming.mode === 'relation' ? 'relation' as const
		: naming.mode === 'silence' ? 'silence' as const
		: 'element' as const;

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

	// Previous discussion memos
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
		const role = memo.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const;
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

	// Save researcher's message BEFORE calling AI (correct chronological ordering)
	await createMemo(projectId, userId || AI_SYSTEM_UUID,
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
		const errMsg = error instanceof Error ? error.message : String(error);
		await createMemo(projectId, AI_SYSTEM_UUID,
			`Discussion: response`, `(AI could not respond: ${errMsg})`, [namingId]);
		return { response: `AI could not respond: ${errMsg}`, actions: [] };
	}

	// Execute discussion tool calls
	const actions: Array<{ type: string; detail: unknown }> = [];
	let responseText = response.text;

	for (const tc of response.toolCalls) {
		const action = await executeCueDiscussionTool(tc.name, tc.input, projectId, mapId, namingId, aiNamingId);
		if (action) actions.push(action);
	}

	// If AI responded with text but no respond tool call, save it
	if (responseText && !actions.some(a => a.type === 'respond')) {
		await createMemo(projectId, AI_SYSTEM_UUID,
			`Discussion: response`, responseText, [namingId]);
		actions.push({ type: 'respond', detail: { content: responseText } });
	}

	await logAiInteraction(
		projectId,
		aiNamingId,
		'discussion',
		model,
		{ mapId, namingId, researcherMessage },
		{ actions, text: responseText, stopReason: response.stopReason },
		response.tokensUsed,
		response.provider,
		response.inputTokens,
		response.outputTokens
	);

	const aiResponseText = actions
		.filter(a => a.type === 'respond')
		.map(a => (a.detail as { content: string }).content)
		.join('\n\n') || responseText;

	return { response: aiResponseText, actions };
}

// ── Entry point: Memo discussion ─────────────────────────────────

export async function discussMemo(
	projectId: string,
	mapId: string,
	memoId: string,
	researcherMessage: string,
	userId?: string
): Promise<{ response: string; actions: Array<{ type: string; detail: unknown }> }> {
	const model = getModel();
	const aiNamingId = await getOrCreateAiNaming(projectId, model);

	// Get the memo
	const memoRow = await query(
		`SELECT n.id, n.inscription as label, mc.content, n.created_by
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[memoId, projectId]
	);
	if (memoRow.rows.length === 0) throw new Error('Memo not found');
	const memo = memoRow.rows[0];

	const memoAuthor = memo.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const;

	// Linked elements (via participations, excluding other memos)
	const linkedRows = await query(
		`SELECT t.id, t.inscription
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		   AND t.deleted_at IS NULL AND t.id != $1
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)`,
		[memoId]
	);
	const linkedElementRows = await query(
		`SELECT n.id, n.inscription
		 FROM unnest($1::uuid[]) AS uid(id)
		 JOIN namings n ON n.id = uid.id
		 WHERE NOT EXISTS (SELECT 1 FROM memo_content mc WHERE mc.naming_id = n.id)`,
		[linkedRows.rows.map((r: any) => r.id)]
	);
	const linkedElements = linkedElementRows.rows.map((r: any) => ({ id: r.id, inscription: r.inscription }));

	// Previous discussion
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

	// Save researcher's message BEFORE calling AI
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
		const action = await executeMemoDiscussionTool(tc.name, tc.input, projectId, mapId, memoId);
		if (action) actions.push(action);
	}

	// If AI responded with text but no respond tool call, save it
	if (responseText && !actions.some(a => a.type === 'respond')) {
		await createMemo(projectId, AI_SYSTEM_UUID,
			`MemoDiscussion: response`, responseText, [memoId]);
		actions.push({ type: 'respond', detail: { content: responseText } });
	}

	await logAiInteraction(
		projectId,
		aiNamingId,
		'memo-discussion',
		model,
		{ mapId, memoId, researcherMessage },
		{ actions, text: responseText, stopReason: response.stopReason },
		response.tokensUsed,
		response.provider,
		response.inputTokens,
		response.outputTokens
	);

	const aiResponseText = actions
		.filter(a => a.type === 'respond')
		.map(a => (a.detail as { content: string }).content)
		.join('\n\n') || responseText;

	return { response: aiResponseText, actions };
}

// ── Helpers ───────────────────────────────────────────────────────

async function getMapType(mapId: string): Promise<string | undefined> {
	const result = await query(
		`SELECT a.properties FROM appearances a
		 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
		[mapId]
	);
	return result.rows[0]?.properties?.mapType;
}
