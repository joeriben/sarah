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
