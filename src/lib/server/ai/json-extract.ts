// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Robust JSON extraction pipeline for LLM outputs.
//
// Three-tier repair before JSON.parse:
//   1. Brace-trim + typographic-quote repair (existing pattern from
//      argumentation-graph.ts; handles DOCX/OCR „..." artifacts the LLM
//      faithfully transcribes into JSON values).
//   2. jsonrepair (npm) — handles control chars in strings, single quotes,
//      trailing commas, missing escapes, comments, partial outputs etc. Wide
//      coverage of LLM-typical JSON-output failure modes.
//   3. Raw JSON.parse on the repaired string.
//
// Returns either the parsed-and-validated value (via the supplied Zod schema)
// OR a structured failure result that names what was extracted, what was
// attempted, and where the chain broke. Callers can decide whether to retry,
// dump, or surface the error.

import { jsonrepair } from 'jsonrepair';
import type { ZodType } from 'zod';
import { chat, getModel, getProvider, type Provider } from './client.js';
import { logPipelineCall } from './pipeline-call-log.js';

export interface ExtractSuccess<T> {
	ok: true;
	value: T;
	stagesUsed: string[];   // e.g. ['brace-trim', 'typographic-quote-repair', 'jsonrepair', 'JSON.parse', 'zod']
}

export interface ExtractFailure {
	ok: false;
	stage: 'brace-trim' | 'JSON.parse' | 'zod' | 'jsonrepair';
	error: string;
	rawText: string;
	candidateJson: string | null;  // best-effort extraction so far
	stagesUsed: string[];
}

export type ExtractResult<T> = ExtractSuccess<T> | ExtractFailure;

/**
 * Extract+parse+validate JSON from LLM text output. Uses a layered repair
 * pipeline so transient LLM-output noise doesn't kill the call.
 */
export function extractAndValidateJSON<T>(
	rawText: string,
	schema: ZodType<T>
): ExtractResult<T> {
	const stages: string[] = [];

	// Stage 1: brace-trim
	const start = rawText.indexOf('{');
	const end = rawText.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		return {
			ok: false,
			stage: 'brace-trim',
			error: 'No JSON object found in response (no { } pair)',
			rawText,
			candidateJson: null,
			stagesUsed: stages,
		};
	}
	let candidate = rawText.slice(start, end + 1);
	stages.push('brace-trim');

	// Stage 2: typographic-quote repair (cheap, targeted; preserves content)
	candidate = repairTypographicQuotes(candidate);
	stages.push('typographic-quote-repair');

	// Stage 3: try parse-as-is. If success, validate with schema.
	const direct = tryParseAndValidate(candidate, schema);
	if (direct.ok) {
		return { ok: true, value: direct.value, stagesUsed: [...stages, 'JSON.parse', 'zod'] };
	}
	if (direct.stage === 'zod') {
		// Schema mismatch on otherwise-valid JSON. Repair won't fix this — bail.
		return {
			ok: false,
			stage: 'zod',
			error: direct.error,
			rawText,
			candidateJson: candidate,
			stagesUsed: [...stages, 'JSON.parse', 'zod'],
		};
	}

	// Stage 4: jsonrepair fallback (handles control chars, trailing commas,
	// single quotes, unquoted keys, partial truncation, ...).
	let repaired: string;
	try {
		repaired = jsonrepair(candidate);
	} catch (err) {
		return {
			ok: false,
			stage: 'jsonrepair',
			error: err instanceof Error ? err.message : String(err),
			rawText,
			candidateJson: candidate,
			stagesUsed: [...stages, 'JSON.parse-fail', 'jsonrepair-fail'],
		};
	}
	stages.push('jsonrepair');

	const repairedAttempt = tryParseAndValidate(repaired, schema);
	if (repairedAttempt.ok) {
		return { ok: true, value: repairedAttempt.value, stagesUsed: [...stages, 'JSON.parse', 'zod'] };
	}
	return {
		ok: false,
		stage: repairedAttempt.stage,
		error: repairedAttempt.error,
		rawText,
		candidateJson: repaired,
		stagesUsed: [...stages, 'JSON.parse', repairedAttempt.stage],
	};
}

interface ParseSuccess<T> { ok: true; value: T; }
interface ParseFailure { ok: false; stage: 'JSON.parse' | 'zod'; error: string; }

function tryParseAndValidate<T>(jsonText: string, schema: ZodType<T>): ParseSuccess<T> | ParseFailure {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		return {
			ok: false,
			stage: 'JSON.parse',
			error: err instanceof Error ? err.message : String(err),
		};
	}
	const validated = schema.safeParse(parsed);
	if (!validated.success) {
		return {
			ok: false,
			stage: 'zod',
			error: validated.error.message,
		};
	}
	return { ok: true, value: validated.data };
}

// The source documents often contain malformed quote pairs like „...XYZ"
// (German typographic opener U+201E + straight ASCII closer — a recurring
// DOCX/OCR artifact). When the LLM faithfully transcribes such substrings
// into a JSON string value, the unescaped straight " breaks JSON parsing. We
// rewrite the closing straight " to its typographic counterpart so JSON is
// parseable and the string content is preserved.
//
// Mapping:
//   „...   (U+201E low-9 opener)         → close with " (U+201C left)   — German style
//   "...   (U+201C left opener)          → close with " (U+201D right)  — English style
//
// Conservative: only fires when the opener is one of these typographic chars
// AND the close is a straight ASCII " AND there is no nested quote of any
// kind in between.
export function repairTypographicQuotes(jsonText: string): string {
	const opener  = '[„“]';                        // „ or "
	const bodyNeg = '[^„“”"]';                     // no nested quote
	const re = new RegExp(`(${opener})(${bodyNeg}*?)"`, 'g');
	return jsonText.replace(re, (_match, open: string, body: string) => {
		const close = open === '„' ? '“' : '”';
		return `${open}${body}${close}`;
	});
}

// ── Self-Healing Call-Wrapper ────────────────────────────────────
//
// runJsonCallWithRepair: wraps a chat() call with the layered repair pipeline
// (extractAndValidateJSON) AND a self-repair retry loop. When the first
// extraction fails, we hand the broken output + parser error back to the LLM
// as a follow-up turn and ask for a corrected JSON. Up to maxRetries times.
//
// The conversation grows: [user(task), assistant(broken), user(repair-feedback),
// assistant(repaired-or-still-broken), ...]. Token usage accumulates over all
// attempts. On exhaustion we throw RepairCallExhaustedError carrying the full
// stage history so callers can dump for diagnosis.

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheCreation: number;
	total: number;
}

export interface RepairCallResult<T> {
	value: T;
	tokens: TokenUsage;            // accumulated across all attempts
	stagesUsed: string[];          // stages from final successful extract
	retries: number;               // 0 = first call succeeded
	attempts: number;              // = retries + 1
	stagesPerAttempt: string[][];  // diagnostic: what each attempt went through
}

export class RepairCallExhaustedError extends Error {
	constructor(
		message: string,
		public readonly attempts: number,
		public readonly lastStage: string,
		public readonly lastError: string,
		public readonly lastRawText: string,
		public readonly tokens: TokenUsage,
		public readonly stagesPerAttempt: string[][]
	) {
		super(message);
		this.name = 'RepairCallExhaustedError';
	}
}

export interface JsonRepairCallOpts<T> {
	system?: string;
	user: string;
	schema: ZodType<T>;
	label: string;                 // module identifier for telemetry
	modelOverride?: { provider: Provider; model: string };
	maxTokens: number;
	maxRetries?: number;           // default 2
	cacheableSystemPrefix?: string;
	cacheSystem?: boolean;
	documentIds?: string[];
	responseFormat?: 'json';
	/** Telemetry context, optional. */
	caseId?: string | null;
	paragraphId?: string | null;
}

export async function runJsonCallWithRepair<T>(opts: JsonRepairCallOpts<T>): Promise<RepairCallResult<T>> {
	const maxRetries = opts.maxRetries ?? 2;
	const totalTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
	const stagesPerAttempt: string[][] = [];
	const t0 = Date.now();

	const messages: { role: 'user' | 'assistant'; content: string }[] = [
		{ role: 'user', content: opts.user },
	];

	let lastFailure: ExtractFailure | null = null;
	let lastRawText = '';
	const provider = opts.modelOverride?.provider ?? getProvider();
	const modelKey = opts.modelOverride?.model ?? getModel();

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const response = await chat({
			system: opts.system,
			messages,
			maxTokens: opts.maxTokens,
			modelOverride: opts.modelOverride,
			cacheableSystemPrefix: opts.cacheableSystemPrefix,
			cacheSystem: opts.cacheSystem,
			documentIds: opts.documentIds,
			responseFormat: opts.responseFormat,
		});

		totalTokens.input          += response.inputTokens;
		totalTokens.output         += response.outputTokens;
		totalTokens.cacheRead      += response.cacheReadTokens;
		totalTokens.cacheCreation  += response.cacheCreationTokens;
		totalTokens.total          += response.tokensUsed;
		lastRawText = response.text;

		const result = extractAndValidateJSON(response.text, opts.schema);
		const stages = attempt === 0
			? result.stagesUsed
			: result.stagesUsed.map((s) => `retry-${attempt}:${s}`);
		stagesPerAttempt.push(stages);

		if (result.ok) {
			logPipelineCall({
				module: opts.label,
				modelKey,
				provider,
				parseStrategy: 'json',
				stagesUsed: stages,
				stagesPerAttempt,
				retries: attempt,
				attempts: attempt + 1,
				success: true,
				wallSeconds: (Date.now() - t0) / 1000,
				tokens: totalTokens,
				caseId: opts.caseId,
				paragraphId: opts.paragraphId,
			});
			return {
				value: result.value,
				tokens: totalTokens,
				stagesUsed: stages,
				retries: attempt,
				attempts: attempt + 1,
				stagesPerAttempt,
			};
		}

		lastFailure = result;

		if (attempt < maxRetries) {
			messages.push({ role: 'assistant', content: response.text });
			messages.push({ role: 'user', content: buildJsonRetryFeedback(result) });
		}
	}

	logPipelineCall({
		module: opts.label,
		modelKey,
		provider,
		parseStrategy: 'json',
		stagesUsed: stagesPerAttempt[stagesPerAttempt.length - 1] ?? [],
		stagesPerAttempt,
		retries: maxRetries,
		attempts: maxRetries + 1,
		success: false,
		wallSeconds: (Date.now() - t0) / 1000,
		tokens: totalTokens,
		caseId: opts.caseId,
		paragraphId: opts.paragraphId,
		errorStage: lastFailure?.stage ?? 'unknown',
		errorMessage: lastFailure?.error,
	});

	throw new RepairCallExhaustedError(
		`${opts.label}: JSON repair exhausted after ${maxRetries + 1} attempts (last stage=${lastFailure?.stage}, error=${lastFailure?.error.slice(0, 200)})`,
		maxRetries + 1,
		lastFailure?.stage ?? 'unknown',
		lastFailure?.error ?? 'unknown',
		lastRawText,
		totalTokens,
		stagesPerAttempt,
	);
}

function buildJsonRetryFeedback(failure: ExtractFailure): string {
	const lines: string[] = [];
	lines.push('Dein vorheriger Output war kein gültiges JSON für das geforderte Schema.');
	lines.push('');
	lines.push(`Stufe: ${failure.stage}`);
	lines.push(`Fehler: ${failure.error.slice(0, 500)}`);

	if (failure.stage === 'JSON.parse' || failure.stage === 'jsonrepair') {
		const positionMatch = failure.error.match(/position\s+(\d+)/i);
		if (positionMatch && failure.candidateJson) {
			const pos = parseInt(positionMatch[1], 10);
			const start = Math.max(0, pos - 60);
			const end = Math.min(failure.candidateJson.length, pos + 60);
			lines.push('');
			lines.push(`Auszug an der Bruchstelle (±60 chars um Position ${pos}):`);
			lines.push('---');
			lines.push(failure.candidateJson.slice(start, end));
			lines.push('---');
		}
	}

	lines.push('');
	lines.push('Erzeuge das vollständige Resultat JETZT erneut. Strikt:');
	lines.push('- Reines JSON, keine Code-Fences (kein ```json), kein Markdown, keine Erklärung');
	lines.push('- Halte das im System-Prompt vorgegebene Schema präzise ein');
	lines.push('- Achte auf konsistente Anführungszeichen: innerhalb von JSON-Strings KEINE doppelten ASCII-Quotes ("); für Zitate aus dem Quelltext typographische Quotes („…“ deutsch oder “…” englisch) verwenden, oder mit \\" escapen');
	lines.push('- Behebe den oben markierten Fehler');
	return lines.join('\n');
}
