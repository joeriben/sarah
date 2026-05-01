// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Provider-agnostic AI client with runtime-configurable provider and model.
// All providers except Anthropic use the OpenAI-compatible SDK.
// Settings from ai-settings.json, API keys from *.key files (gitignored).

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Provider definitions ──────────────────────────────────────────

export type Provider = 'ollama' | 'mistral' | 'ionos' | 'mammouth' | 'anthropic' | 'openai' | 'openrouter';

export interface ProviderDef {
	label: string;
	baseURL: string;
	defaultModel: string;
	keyFile: string | null; // null = no key needed (e.g. Ollama)
	dsgvo: boolean;
	region: string;
}

export const PROVIDERS: Record<Provider, ProviderDef> = {
	ollama:     { label: 'Ollama (local)',  baseURL: 'http://localhost:11434/v1',                            defaultModel: 'llama3.1',                            keyFile: null,             dsgvo: true,  region: 'local' },
	mistral:    { label: 'Mistral AI',      baseURL: 'https://api.mistral.ai/v1',                           defaultModel: 'mistral-large-latest',                 keyFile: 'mistral.key',    dsgvo: true,  region: 'EU' },
	ionos:      { label: 'IONOS',           baseURL: 'https://openai.inference.de-txl.ionos.com/v1',        defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct', keyFile: 'ionos.key',   dsgvo: true,  region: 'EU (Berlin)' },
	mammouth:   { label: 'Mammouth AI',     baseURL: 'https://api.mammouth.ai/v1',                          defaultModel: 'claude-sonnet-4-6',                    keyFile: 'mammouth.key',   dsgvo: true,  region: 'EU' },
	anthropic:  { label: 'Anthropic',       baseURL: 'https://api.anthropic.com',                           defaultModel: 'claude-opus-4-6',                      keyFile: 'anthropic.key',  dsgvo: false, region: 'US' },
	openai:     { label: 'OpenAI',          baseURL: 'https://api.openai.com/v1',                           defaultModel: 'gpt-5.4-pro',                          keyFile: 'openai.key',    dsgvo: false, region: 'US' },
	openrouter: { label: 'OpenRouter',      baseURL: 'https://openrouter.ai/api/v1',                        defaultModel: 'anthropic/claude-opus-4-6',            keyFile: 'openrouter.key', dsgvo: false, region: 'US' },
};

// ── Settings persistence ──────────────────────────────────────────

export interface DelegationAgent {
	provider: Provider;
	model: string;
}

export interface AiSettings {
	provider: Provider;
	model: string;
	/** Sub-agent for delegation (cheaper/faster model for simple tasks) */
	delegationAgent?: DelegationAgent;
	/** Analysis language — codes, memos, and AI output will use this language */
	language?: string;
}

export const SUPPORTED_LANGUAGES: Record<string, string> = {
	auto: 'Auto-detect (from documents)',
	de: 'Deutsch',
	en: 'English',
	fr: 'Français',
	es: 'Español',
	pt: 'Português',
	it: 'Italiano',
	nl: 'Nederlands',
	pl: 'Polski',
	ja: '日本語',
	zh: '中文',
	ko: '한국어'
};

const SETTINGS_FILE = join(process.cwd(), 'ai-settings.json');

const DEFAULT_SETTINGS: AiSettings = { provider: 'openrouter', model: '' };

export function loadSettings(): AiSettings {
	try {
		const raw = readFileSync(SETTINGS_FILE, 'utf-8');
		const parsed = JSON.parse(raw);
		const settings: AiSettings = {
			provider: parsed.provider && parsed.provider in PROVIDERS ? parsed.provider : DEFAULT_SETTINGS.provider,
			model: parsed.model || ''
		};
		// Load delegation agent if configured
		if (parsed.delegationAgent?.provider && parsed.delegationAgent.provider in PROVIDERS) {
			settings.delegationAgent = {
				provider: parsed.delegationAgent.provider,
				model: parsed.delegationAgent.model || ''
			};
		}
		// Load language preference
		if (parsed.language && parsed.language in SUPPORTED_LANGUAGES) {
			settings.language = parsed.language;
		}
		return settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AiSettings): void {
	writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
	// Force re-init on next call
	_initialized = false;
}

// ── API key management ────────────────────────────────────────────

export function readApiKey(provider: Provider): string | null {
	const def = PROVIDERS[provider];
	if (!def.keyFile) return null; // Ollama needs no key
	try {
		return readFileSync(join(process.cwd(), def.keyFile), 'utf-8').trim();
	} catch {
		return null;
	}
}

export function writeApiKey(provider: Provider, key: string): void {
	const def = PROVIDERS[provider];
	if (!def.keyFile) return;
	writeFileSync(join(process.cwd(), def.keyFile), key.trim() + '\n', 'utf-8');
	// Force re-init on next call
	_initialized = false;
}

export function maskKey(key: string | null): string {
	if (!key) return '';
	if (key.length <= 12) return '***';
	return key.slice(0, 7) + '...' + key.slice(-4);
}

// ── Client init ───────────────────────────────────────────────────

let _initialized = false;
let _provider: Provider = 'openrouter';
let _model = '';
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function init() {
	if (_initialized) return;

	const settings = loadSettings();
	_provider = settings.provider;
	const def = PROVIDERS[_provider];
	_model = settings.model || def.defaultModel;

	if (_provider === 'anthropic') {
		const apiKey = readApiKey('anthropic');
		if (!apiKey) throw new Error('No API key found. Add anthropic.key or change provider in settings.');
		anthropicClient = new Anthropic({ apiKey });
		openaiClient = null;
	} else {
		// All other providers use OpenAI-compatible API
		const apiKey = readApiKey(_provider);
		if (def.keyFile && !apiKey) {
			throw new Error(`No API key found for ${def.label}. Add ${def.keyFile} or change provider in settings.`);
		}
		openaiClient = new OpenAI({
			apiKey: apiKey || 'ollama', // Ollama doesn't need a real key
			baseURL: def.baseURL
		});
		anthropicClient = null;
	}

	_initialized = true;
}

export function getModel(): string {
	init();
	return _model;
}

export function getProvider(): Provider {
	init();
	return _provider;
}

// ── Unified types ─────────────────────────────────────────────────

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
	provider: Provider;
	inputTokens: number;          // fresh input tokens (neither cached nor cache-creating)
	outputTokens: number;
	cacheCreationTokens: number;  // tokens written into cache on this call (1.25× input rate on Anthropic)
	cacheReadTokens: number;      // tokens served from cache (10% of input rate on Anthropic)
	tokensUsed: number;           // sum of all input + output, for backwards compat
	stopReason: string;
}

// ── Chat ──────────────────────────────────────────────────────────

export async function chat(opts: {
	system?: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	maxTokens: number;
	tools?: ToolDef[];
	/**
	 * If true, mark the system prompt as cacheable (Anthropic prompt caching,
	 * 5-min TTL). Honoured natively on the Anthropic provider, passed through
	 * on OpenAI-compatible providers that proxy Anthropic models (OpenRouter,
	 * Mammouth). Silently ignored elsewhere.
	 *
	 * Caching is prefix-based: identical leading text across calls hits cache.
	 * Order the system prompt so the most stable parts come first and the
	 * variable parts come last for maximum hit ratio.
	 */
	cacheSystem?: boolean;
	/**
	 * Stable, cache-friendly prefix of the system prompt. When set, this is
	 * sent as a separate system block with `cache_control: ephemeral`, while
	 * `system` (the variable suffix) is sent as a second uncached block.
	 *
	 * Use this when the system prompt has a stable head (PERSONA, KRITERIEN,
	 * static OUTLINE, OUTPUT-FORMAT) and a variable tail (current scope,
	 * completed sections, interpretive chain). Anthropic prompt caching is
	 * prefix-based: with everything stable in the prefix block and everything
	 * variable in the suffix, cache hits become reliable across calls.
	 *
	 * Honoured natively on Anthropic provider, passed through on Mammouth /
	 * OpenRouter for Anthropic-proxied models. Silently ignored elsewhere.
	 *
	 * If `cacheableSystemPrefix` is set, `cacheSystem` is implicit (the prefix
	 * is always cacheable). If only `system` is set with `cacheSystem: true`,
	 * the original single-block behaviour applies (backward compat).
	 */
	cacheableSystemPrefix?: string;
	/**
	 * Per-call provider/model override. Bypasses the module-level settings for
	 * this single call only — used by experimental drivers (model comparison
	 * runs). The override builds a one-shot client; it does NOT mutate the
	 * shared `_provider` / `_model` state, so concurrent default-config calls
	 * are unaffected.
	 */
	modelOverride?: { provider: Provider; model: string };
	/**
	 * If 'json', request strict JSON output. Passed as `response_format:
	 * { type: 'json_object' }` on OpenAI-compat providers (OpenRouter, Mistral,
	 * Mammouth, OpenAI, Ollama). Drastically reduces Markdown-wrapper /
	 * preamble / control-char issues for many models. On Anthropic native this
	 * is a no-op (Anthropic uses tool-use for guaranteed structured output;
	 * for JSON-mode we rely on prompt-engineering instead).
	 */
	responseFormat?: 'json';
}): Promise<ChatResponse> {
	init();

	const provider = opts.modelOverride?.provider ?? _provider;
	const model = opts.modelOverride?.model ?? _model;

	let oneShotAnthropic: Anthropic | null = null;
	let oneShotOpenAI: OpenAI | null = null;
	if (opts.modelOverride && provider !== _provider) {
		const def = PROVIDERS[provider];
		const apiKey = readApiKey(provider);
		if (def.keyFile && !apiKey) {
			throw new Error(`No API key found for ${def.label}. Add ${def.keyFile} to use override.`);
		}
		if (provider === 'anthropic') {
			oneShotAnthropic = new Anthropic({ apiKey: apiKey! });
		} else {
			oneShotOpenAI = new OpenAI({ apiKey: apiKey || 'ollama', baseURL: def.baseURL });
		}
	}
	const useAnthropic = provider === 'anthropic'
		? (oneShotAnthropic ?? anthropicClient!)
		: null;
	const useOpenAI = provider !== 'anthropic'
		? (oneShotOpenAI ?? openaiClient!)
		: null;

	if (provider === 'anthropic') {
		// Build system param — three modes:
		//   1. cacheableSystemPrefix set → two-block: cached prefix + uncached suffix
		//   2. cacheSystem true (legacy) → single cached block
		//   3. plain → string passthrough
		let systemParam: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] | undefined;
		if (opts.cacheableSystemPrefix) {
			const blocks: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [
				{ type: 'text', text: opts.cacheableSystemPrefix, cache_control: { type: 'ephemeral' } }
			];
			if (opts.system) blocks.push({ type: 'text', text: opts.system });
			systemParam = blocks;
		} else if (opts.cacheSystem && opts.system) {
			systemParam = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }];
		} else {
			systemParam = opts.system;
		}

		const response = await useAnthropic!.messages.create({
			model,
			max_tokens: opts.maxTokens,
			system: systemParam,
			messages: opts.messages,
			tools: opts.tools as Anthropic.Messages.Tool[]
		});

		const inputTokens = response.usage.input_tokens;
		const outputTokens = response.usage.output_tokens;
		const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
		const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;

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
			provider,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			tokensUsed: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
			stopReason: response.stop_reason || 'end_turn'
		};
	} else {
		// OpenAI-compatible path (OpenRouter, Mistral, IONOS, Mammouth, OpenAI, Ollama)
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
		// Only providers that pass cache_control through to Anthropic-style caching.
		// Mistral native does its own implicit caching (no cache_control needed; the
		// stable string prefix is detected server-side); sending cache_control returns
		// 422.
		const supportsCachePassThrough = provider === 'openrouter' || provider === 'mammouth';
		if (opts.cacheableSystemPrefix) {
			if (supportsCachePassThrough) {
				// Two-block system: cached prefix + uncached suffix
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const content: any[] = [
					{ type: 'text', text: opts.cacheableSystemPrefix, cache_control: { type: 'ephemeral' } }
				];
				if (opts.system) content.push({ type: 'text', text: opts.system });
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				messages.push({ role: 'system', content } as any);
			} else {
				// Provider doesn't support cache pass-through — collapse to plain string.
				const collapsed = opts.system
					? opts.cacheableSystemPrefix + '\n\n' + opts.system
					: opts.cacheableSystemPrefix;
				messages.push({ role: 'system', content: collapsed });
			}
		} else if (opts.system) {
			if (opts.cacheSystem && supportsCachePassThrough) {
				// Pass-through cache_control for Anthropic-proxying providers and Mistral native.
				// Cast escapes the OpenAI SDK type that doesn't model cache_control.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				messages.push({
					role: 'system',
					content: [
						{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }
					]
				} as any);
			} else {
				messages.push({ role: 'system', content: opts.system });
			}
		}
		for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

		const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = opts.tools?.map(t => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema
			}
		}));

		// OpenAI newer models (o-series, gpt-4.1+) require max_completion_tokens
		const tokenParam = provider === 'openai'
			? { max_completion_tokens: opts.maxTokens }
			: { max_tokens: opts.maxTokens };

		// JSON-mode opt-in. OpenRouter passes through to native JSON-mode for
		// providers that support it (Anthropic via OR, OpenAI, Mistral, DeepSeek,
		// Qwen, etc.). Falls back silently to no-op for routes that don't.
		const responseFormatParam = opts.responseFormat === 'json'
			? { response_format: { type: 'json_object' as const } }
			: {};

		const response = await useOpenAI!.chat.completions.create({
			model,
			...tokenParam,
			...responseFormatParam,
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

		// OpenAI-compat usage. OpenRouter and Mammouth (when proxying Anthropic)
		// expose cache reads via prompt_tokens_details.cached_tokens. Cache writes
		// for Anthropic-proxying routes are reported as a separate field on the
		// raw payload — read defensively and fall back to 0.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const usage = response.usage as any | undefined;
		const promptTotal = usage?.prompt_tokens ?? 0;
		const cacheReadTokens =
			usage?.prompt_tokens_details?.cached_tokens
			?? usage?.cache_read_input_tokens
			?? 0;
		const cacheCreationTokens =
			usage?.prompt_tokens_details?.cache_creation_tokens
			?? usage?.cache_creation_input_tokens
			?? 0;
		// inputTokens = the slice of prompt_tokens that is neither cached nor newly cached
		const inputTokens = Math.max(0, promptTotal - cacheReadTokens - cacheCreationTokens);
		const outputTokens = usage?.completion_tokens ?? 0;

		return {
			text: choice.message.content || '',
			toolCalls,
			model: response.model || model,
			provider,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			tokensUsed: promptTotal + outputTokens,
			stopReason: choice.finish_reason || 'end_turn'
		};
	}
}

// ── Connection test ───────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; model?: string }> {
	try {
		init();
		const response = await chat({
			messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
			maxTokens: 16
		});
		return { ok: true, model: response.model };
	} catch (e: unknown) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
