// Provider-agnostic AI client: OpenRouter (OpenAI SDK) or Anthropic direct.
// OpenRouter only supports OpenAI-format API (/chat/completions), not Anthropic's /messages.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Provider = 'openrouter' | 'anthropic';

let provider: Provider | null = null;
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let _model = 'claude-opus-4-6';

function init() {
	if (provider) return;

	try {
		const apiKey = readFileSync(join(process.cwd(), 'openrouter.key'), 'utf-8').trim();
		openaiClient = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
		_model = 'anthropic/claude-opus-4-6';
		provider = 'openrouter';
	} catch {
		try {
			const apiKey = readFileSync(join(process.cwd(), 'anthropic.key'), 'utf-8').trim();
			anthropicClient = new Anthropic({ apiKey });
			_model = 'claude-opus-4-6';
			provider = 'anthropic';
		} catch {
			throw new Error('No API key found. Place openrouter.key or anthropic.key in the project root.');
		}
	}
}

export function getModel(): string {
	init();
	return _model;
}

// Unified tool format (Anthropic-style, converted for OpenAI internally)
export interface ToolDef {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface ToolCall {
	name: string;
	input: Record<string, unknown>;
	id: string;
}

export interface ChatResponse {
	text: string;
	toolCalls: ToolCall[];
	model: string;
	tokensUsed: number;
	stopReason: string;
}

export async function chat(opts: {
	system?: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	maxTokens: number;
	tools?: ToolDef[];
}): Promise<ChatResponse> {
	init();

	if (provider === 'openrouter') {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
		if (opts.system) messages.push({ role: 'system', content: opts.system });
		for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

		const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = opts.tools?.map(t => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema
			}
		}));

		const response = await openaiClient!.chat.completions.create({
			model: _model,
			max_tokens: opts.maxTokens,
			messages,
			tools
		});

		const choice = response.choices[0];
		const toolCalls: ToolCall[] = [];
		for (const tc of choice.message.tool_calls || []) {
			if ('function' in tc) {
				toolCalls.push({
					name: tc.function.name,
					input: JSON.parse(tc.function.arguments),
					id: tc.id
				});
			}
		}
		return {
			text: choice.message.content || '',
			toolCalls,
			model: response.model || _model,
			tokensUsed: response.usage?.total_tokens || 0,
			stopReason: choice.finish_reason || 'end_turn'
		};
	} else {
		const response = await anthropicClient!.messages.create({
			model: _model,
			max_tokens: opts.maxTokens,
			system: opts.system,
			messages: opts.messages,
			tools: opts.tools as Anthropic.Messages.Tool[]
		});

		return {
			text: response.content
				.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
				.map(b => b.text)
				.join(''),
			toolCalls: response.content
				.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
				.map(b => ({
					name: b.name,
					input: b.input as Record<string, unknown>,
					id: b.id
				})),
			model: response.model,
			tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
			stopReason: response.stop_reason || 'end_turn'
		};
	}
}
