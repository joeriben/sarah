// Delegation system: allows the chief model to spawn sub-agents with cheaper models.
// The chief decides autonomously when to delegate — it only needs accurate descriptions
// of available agent-LLMs.

import { chat, type ToolDef, type ChatResponse, loadSettings, PROVIDERS, readApiKey, type Provider } from '../client.js';

// ── Available agent descriptions ──────────────────────────────────
// These must be PRECISE and ABSOLUTELY accurate — the chief model
// decides delegation based on these descriptions.

export interface AgentModel {
	/** Provider + model identifier for the chat() call */
	provider: Provider;
	model: string;
	/** Human-readable label */
	label: string;
	/** Precise capability description for the chief model */
	description: string;
	/** Relative cost tier: 'low' | 'medium' | 'high' */
	costTier: 'low' | 'medium' | 'high';
	/** Whether this model is currently available (key present, etc.) */
	available: boolean;
}

export function getAvailableAgents(): AgentModel[] {
	const settings = loadSettings();
	const agents: AgentModel[] = [];

	// Check what's actually available based on configured keys
	const hasOllama = true; // Always available locally
	const hasAnthropic = !!readApiKey('anthropic');
	const hasOpenRouter = !!readApiKey('openrouter');
	const hasMistral = !!readApiKey('mistral');
	const hasOpenAI = !!readApiKey('openai');

	// Low-cost agents for text search, simple extraction
	if (hasOllama) {
		agents.push({
			provider: 'ollama',
			model: 'llama3.1',
			label: 'Llama 3.1 (local)',
			description: 'Local model, no API cost. Good for: text search, simple extraction, keyword matching, summarizing short passages. NOT suitable for: complex reasoning, methodology, multi-step analysis.',
			costTier: 'low',
			available: true
		});
	}

	if (hasMistral) {
		agents.push({
			provider: 'mistral',
			model: 'mistral-small-latest',
			label: 'Mistral Small (EU)',
			description: 'Fast, low-cost EU model (DSGVO-compliant). Good for: text search, extraction, simple classification, translation. NOT suitable for: deep analytical reasoning, methodology interpretation.',
			costTier: 'low',
			available: true
		});
	}

	// Medium-cost agents for analysis, image processing
	if (hasAnthropic) {
		agents.push({
			provider: 'anthropic',
			model: 'claude-haiku-4-5-20251001',
			label: 'Claude Haiku',
			description: 'Fast, efficient. Good for: text search, passage extraction, simple coding/classification, GREP-like pattern matching across documents. Reads well but does not do deep analytical reasoning.',
			costTier: 'low',
			available: true
		});
		agents.push({
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			label: 'Claude Sonnet',
			description: 'Strong general intelligence. Good for: document analysis, image analysis (if enabled), pattern recognition, moderate analytical reasoning, coding assistance. Capable of methodology-informed work but not as deep as Opus.',
			costTier: 'medium',
			available: true
		});
	}

	if (hasOpenRouter) {
		agents.push({
			provider: 'openrouter',
			model: 'anthropic/claude-haiku-4-5-20251001',
			label: 'Claude Haiku (OpenRouter)',
			description: 'Fast, efficient via OpenRouter. Good for: text search, passage extraction, simple coding/classification.',
			costTier: 'low',
			available: true
		});
		agents.push({
			provider: 'openrouter',
			model: 'anthropic/claude-sonnet-4-6',
			label: 'Claude Sonnet (OpenRouter)',
			description: 'Strong general intelligence via OpenRouter. Good for: document analysis, pattern recognition, moderate analytical reasoning.',
			costTier: 'medium',
			available: true
		});
	}

	return agents;
}

// ── Delegation tool definition ────────────────────────────────────

export const DELEGATE_TOOL: ToolDef = {
	name: 'delegate_task',
	description:
		'Delegate a subtask to a cheaper/faster AI model. Use for tasks that don\'t require your full reasoning capacity: text search, passage extraction, simple classification, pattern matching. The sub-agent receives your instructions and returns its result.',
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
	maxTokens: number = 1024
): Promise<{ success: boolean; result: string; model: string; tokensUsed: number }> {
	const agents = getAvailableAgents();
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

	if (!agent.available) {
		return {
			success: false,
			result: `Agent "${agentLabel}" is not currently available (missing API key?)`,
			model: agent.model,
			tokensUsed: 0
		};
	}

	try {
		// Override the global settings temporarily for this call
		const response = await delegateChat(agent.provider, agent.model, task, maxTokens);

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
	maxTokens: number
): Promise<ChatResponse> {
	const def = PROVIDERS[provider];
	const apiKey = readApiKey(provider);

	if (provider === 'anthropic') {
		const client = new Anthropic({ apiKey: apiKey! });
		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
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

		const response = await client.chat.completions.create({
			model,
			...tokenParam,
			messages: [{ role: 'user', content: task }]
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
