// Generic agent runtime: persona-agnostic loop that composes
// shared knowledge + persona instructions + context → chat → execute.
//
// Replaces direct coupling between routes and agent.ts.
// Each persona provides its prompt additions, tools, and context needs;
// the runtime handles composition, calling the LLM, and dispatching tool results.

import { chat, getModel, getProvider } from '../client.js';
import { FULL_KNOWLEDGE } from '../base/knowledge.js';
import { MANUAL } from '../base/manual.js';
import { buildProjectContext, buildMapDetail, buildMemoContext, buildLibraryContext, buildStructuredMapContext, type MapContext } from '../base/context.js';
import { SEARCH_TOOLS, executeSearchTool } from '../base/search-tools.js';
import { DELEGATE_TOOL, executeDelegation, getAvailableAgents } from '../base/delegation.js';
import { TICKET_TOOL, createTicket } from '../base/tickets.js';
import { getPersona, type Persona, type PersonaName } from '../personas/index.js';
import { getOrCreateAiNaming, logAiInteraction } from '../../db/queries/ai.js';
import type { ToolDef, ChatResponse, ToolCall } from '../client.js';

// ── System prompt composition ─────────────────────────────────────

function buildSystemPrompt(persona: Persona, mapType?: string): string {
	const parts: string[] = [];

	// Shared knowledge base (methodology + data model + map types + memos)
	parts.push(FULL_KNOWLEDGE);

	// Persona-specific instructions
	parts.push(persona.systemPromptAdditions);

	// Map-type supplement (if applicable)
	if (mapType && persona.getMapSupplement) {
		const supplement = persona.getMapSupplement(mapType as any);
		if (supplement) parts.push(supplement);
	}

	// Platform manual
	if (MANUAL) {
		parts.push(`
═══════════════════════════════════════
TRANSACT-QDA SYSTEM MANUAL
═══════════════════════════════════════

${MANUAL}`);
	}

	// Available agents for delegation (if persona can delegate)
	if (persona.canDelegate) {
		const agents = getAvailableAgents();
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

	// Persona-specific tools (map agent tools, etc.)
	tools.push(...persona.getTools(mapType as any));

	// Search tools (available to all personas)
	tools.push(...SEARCH_TOOLS);

	// Delegation tool (if persona can delegate)
	if (persona.canDelegate) {
		tools.push(DELEGATE_TOOL);
	}

	// Ticket tool (available to all personas)
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

// ── Tool execution dispatch ───────────────────────────────────────

export interface ToolExecutor {
	(toolName: string, input: Record<string, unknown>): Promise<{ success: boolean; result: unknown }>;
}

async function executeInfrastructureTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string,
	personaName: PersonaName
): Promise<{ success: boolean; result: unknown } | null> {
	// Search tools
	if (['search_documents', 'search_namings', 'search_memos', 'search_manual'].includes(toolName)) {
		return executeSearchTool(toolName, input, projectId);
	}

	// Delegation
	if (toolName === 'delegate_task') {
		const result = await executeDelegation(
			input.agent_label as string,
			input.task as string,
			(input.max_tokens as number) || 1024
		);
		return { success: result.success, result: result.result };
	}

	// Tickets
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

	// Not an infrastructure tool — return null to let persona-specific executor handle it
	return null;
}

// ── Main runtime entry points ─────────────────────────────────────

/**
 * Run a persona in conversational mode (like Aidele).
 * No tool execution — just returns the text response.
 */
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

/**
 * Get the structured map context for a persona (for map agent tool execution).
 * Used by the existing agent.ts which handles tool execution for map operations.
 */
export async function getMapContextForPersona(
	personaName: PersonaName,
	mapId: string,
	projectId: string
): Promise<MapContext> {
	return buildStructuredMapContext(mapId, projectId);
}

/**
 * Build the full system prompt for a persona + map type.
 * Exposed for the existing agent.ts to use during the transition.
 */
export function getPersonaSystemPrompt(personaName: PersonaName, mapType?: string): string {
	const persona = getPersona(personaName);
	return buildSystemPrompt(persona, mapType);
}

/**
 * Get the full tool set for a persona + map type.
 * Exposed for the existing agent.ts to use during the transition.
 */
export function getPersonaTools(personaName: PersonaName, mapType?: string): ToolDef[] {
	const persona = getPersona(personaName);
	return buildToolSet(persona, mapType);
}

// ── Helpers ───────────────────────────────────────────────────────

import { query } from '../../db/index.js';

async function getMapType(mapId: string): Promise<string | undefined> {
	const result = await query(
		`SELECT a.properties FROM appearances a
		 WHERE a.naming_id = $1 AND a.perspective_id = $1 AND a.mode = 'perspective'`,
		[mapId]
	);
	return result.rows[0]?.properties?.mapType;
}
