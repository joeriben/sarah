// Delegation system: allows the chief model to spawn sub-agents with cheaper models.
// The chief decides autonomously when to delegate — it only needs accurate descriptions
// of available agent-LLMs.

import { type ToolDef, type ChatResponse, loadSettings, PROVIDERS, readApiKey, type Provider } from '../client.js';
import { logInteraction } from '../index.js';

// ── Agent model interface ────────────────────────────────────────

export interface AgentModel {
	provider: Provider;
	model: string;
	label: string;
	description: string;
	costTier: 'low' | 'medium' | 'high';
	available: boolean;
}

// Ollama availability cache (re-checked every 60s)
let _ollamaAvailable: boolean | null = null;
let _ollamaCheckedAt = 0;
const OLLAMA_CHECK_INTERVAL_MS = 60_000;

async function isOllamaAvailable(): Promise<boolean> {
	const now = Date.now();
	if (_ollamaAvailable !== null && now - _ollamaCheckedAt < OLLAMA_CHECK_INTERVAL_MS) {
		return _ollamaAvailable;
	}
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
		clearTimeout(timeout);
		_ollamaAvailable = res.ok;
	} catch {
		_ollamaAvailable = false;
	}
	_ollamaCheckedAt = now;
	return _ollamaAvailable;
}

export async function getAvailableAgents(): Promise<AgentModel[]> {
	const configured = await getConfiguredDelegationAgent();
	return configured ? [configured] : [];
}

// Get the user-configured delegation agent directly (settings preference)
export async function getConfiguredDelegationAgent(): Promise<AgentModel | null> {
	const settings = loadSettings();
	if (settings.delegationAgent) {
		const da = settings.delegationAgent;
		const provDef = PROVIDERS[da.provider];
		if (!provDef) return null;

		// Check availability
		if (da.provider === 'ollama') {
			const available = await isOllamaAvailable();
			if (!available) return null;
		} else if (!readApiKey(da.provider)) {
			return null;
		}

		return {
			provider: da.provider,
			model: da.model || provDef.defaultModel,
			label: `${provDef.label}: ${da.model || provDef.defaultModel}`,
			description: 'User-configured delegation agent.',
			costTier: 'low',
			available: true
		};
	}
	return null;
}

// Synchronous version for prompt building (uses cached Ollama check)
export function getAvailableAgentsSync(): AgentModel[] {
	const settings = loadSettings();
	if (!settings.delegationAgent) return [];

	const da = settings.delegationAgent;
	const provDef = PROVIDERS[da.provider];
	if (!provDef) return [];

	// Check availability synchronously
	if (da.provider === 'ollama') {
		if (!(_ollamaAvailable ?? false)) return [];
	} else if (!readApiKey(da.provider)) {
		return [];
	}

	return [{
		provider: da.provider,
		model: da.model || provDef.defaultModel,
		label: `${provDef.label}: ${da.model || provDef.defaultModel}`,
		description: 'Configured delegation agent.',
		costTier: 'low',
		available: true
	}];
}

// ── Delegation tool definition ────────────────────────────────────

export const DELEGATE_TOOL: ToolDef = {
	name: 'delegate_task',
	description:
		'Delegate a subtask to another model. The sub-agent works in its own context — use this to save your context window for analytical decisions. Good for: reading large documents, passage extraction, classification, text search, pattern matching. The sub-agent receives your instructions and returns its result. If the task involves a specific document, pass document_id — the sub-agent will receive the full document text automatically.',
	input_schema: {
		type: 'object' as const,
		properties: {
			agent_label: {
				type: 'string',
				description: 'Which agent to delegate to (use the label from AVAILABLE AGENTS in your context)'
			},
			task: {
				type: 'string',
				description: 'Clear, specific instructions for the sub-agent. Include all necessary context — the sub-agent has no conversation history.'
			},
			document_id: {
				type: 'string',
				description: 'Optional: ID of a project document. If provided, the sub-agent receives the full document text as context.'
			},
			max_tokens: {
				type: 'number',
				description: 'Maximum response tokens for the sub-agent (default: 1024)'
			}
		},
		required: ['agent_label', 'task']
	}
};

// ── Delegation execution ──────────────────────────────────────────

export async function executeDelegation(
	agentLabel: string,
	task: string,
	maxTokens: number = 1024,
	projectId?: string,
	documentId?: string,
	systemPrompt?: string
): Promise<{ success: boolean; result: string; model: string; tokensUsed: number }> {
	const agents = await getAvailableAgents();
	const agent = agents.find(a => a.label === agentLabel);

	if (!agent) {
		const available = agents.map(a => a.label).join(', ');
		return {
			success: false,
			result: `Agent "${agentLabel}" not found. Available: ${available}`,
			model: '',
			tokensUsed: 0
		};
	}

	// If document_id is provided, prepend document text to the task
	let fullTask = task;
	if (documentId && projectId) {
		const docText = await loadDocumentText(projectId, documentId);
		if (docText) {
			fullTask = `DOCUMENT:\n"""\n${docText.text}\n"""\n\nTITLE: "${docText.title}"\n\nTASK:\n${task}`;
		} else {
			fullTask = `(Document not found or has no text content)\n\nTASK:\n${task}`;
		}
	}

	try {
		const response = await delegateChat(agent.provider, agent.model, fullTask, maxTokens, systemPrompt);

		// Log the delegated call
		if (projectId) {
			await logInteraction(
				projectId,
				'delegation',
				response.model,
				{ delegatedTo: agentLabel, taskPreview: task.slice(0, 200) },
				{ textPreview: response.text.slice(0, 200) },
				response.tokensUsed,
				response.provider,
				response.inputTokens,
				response.outputTokens
			).catch(() => {}); // Don't fail the delegation if logging fails
		}

		return {
			success: true,
			result: response.text,
			model: response.model,
			tokensUsed: response.tokensUsed
		};
	} catch (e) {
		return {
			success: false,
			result: `Delegation failed: ${e instanceof Error ? e.message : String(e)}`,
			model: agent.model,
			tokensUsed: 0
		};
	}
}

// Chat with a specific provider/model, bypassing global settings
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

async function delegateChat(
	provider: Provider,
	model: string,
	task: string,
	maxTokens: number,
	systemPrompt?: string
): Promise<ChatResponse> {
	const def = PROVIDERS[provider];
	const apiKey = readApiKey(provider);

	if (provider === 'anthropic') {
		const client = new Anthropic({ apiKey: apiKey! });
		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
			...(systemPrompt ? { system: systemPrompt } : {}),
			messages: [{ role: 'user', content: task }]
		});

		const inputTokens = response.usage.input_tokens;
		const outputTokens = response.usage.output_tokens;

		return {
			text: response.content
				.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
				.map(b => b.text)
				.join(''),
			toolCalls: [],
			model: response.model,
			provider,
			inputTokens,
			outputTokens,
			tokensUsed: inputTokens + outputTokens,
			stopReason: response.stop_reason || 'end_turn'
		};
	} else {
		const client = new OpenAI({
			apiKey: apiKey || 'ollama',
			baseURL: def.baseURL
		});

		const tokenParam = provider === 'openai'
			? { max_completion_tokens: maxTokens }
			: { max_tokens: maxTokens };

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: task });

		const response = await client.chat.completions.create({
			model,
			...tokenParam,
			messages
		});

		const choice = response.choices[0];
		const inputTokens = response.usage?.prompt_tokens || 0;
		const outputTokens = response.usage?.completion_tokens || 0;

		return {
			text: choice.message.content || '',
			toolCalls: [],
			model: response.model || model,
			provider,
			inputTokens,
			outputTokens,
			tokensUsed: inputTokens + outputTokens,
			stopReason: choice.finish_reason || 'end_turn'
		};
	}
}

// Load document text for delegation context
import { query } from '../../db/index.js';

async function loadDocumentText(projectId: string, documentId: string): Promise<{ title: string; text: string } | null> {
	const result = await query<{ title: string; text: string }>(
		`SELECT n.inscription as title, dc.full_text as text
		 FROM document_content dc
		 JOIN namings n ON n.id = dc.naming_id
		 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[documentId, projectId]
	);
	if (result.rows.length === 0 || !result.rows[0].text) return null;
	return result.rows[0];
}
