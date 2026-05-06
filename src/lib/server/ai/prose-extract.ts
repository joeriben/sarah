// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structured-prose extraction pipeline for LLM outputs.
//
// Replaces JSON-output for modules where the schema is flat enough that a
// section-headered prose format is more robust than JSON. The argument-validity
// pass uses this pattern (VALIDITY A1, VALIDITY A2, ...) and AG uses a similar
// line-based prose-parser. This module generalizes the pattern.
//
// Output-Format-Konvention (verbindlich):
//   ## SECTION_NAME             — singleton section
//   ## SECTION_NAME N           — list-element (N = 1, 2, 3, ...)
//   key: value                  — oneline field within a list-element
//   key:                        — multiline field; content runs until next
//   <multi-line content>          `key:` or `## ...` marker
//
// Section ordering: parser is order-insensitive between sections (singletons
// + lists may interleave) but position-sensitive within sections.
// Empty lists: omit the section entirely → parser defaults to [].

import type { ZodType, ZodTypeDef } from 'zod';
import { chat, getModel, getProvider, type Provider } from './client.js';
import { type TokenUsage, type RepairCallResult, RepairCallExhaustedError } from './json-extract.js';
import { logPipelineCall } from './pipeline-call-log.js';

// Same relaxation as in json-extract: schemas with `.default()` have Input ≠
// Output. `ZodType<T>` would force T to the input shape and lose post-parse
// fields. Letting the Input parameter be `unknown` lets T infer to the output.
type AnyInputZodType<T> = ZodType<T, ZodTypeDef, unknown>;

// ── Section spec ──────────────────────────────────────────────────

export type FieldKind = 'oneline' | 'multiline';

export interface ListSectionSpec {
	fields: Record<string, FieldKind>;
}

export interface SectionSpec {
	/** Singleton sections; key = SECTION_NAME, value = field kind for the section's content. */
	singletons: Record<string, FieldKind>;
	/** List sections; key = SECTION_NAME, value = field schema for each numbered element. */
	lists: Record<string, ListSectionSpec>;
}

// ── Parser ────────────────────────────────────────────────────────

export interface ParseProseSuccess {
	ok: true;
	value: Record<string, unknown>;     // singletons + lists merged into one object
	stagesUsed: string[];
}

export interface ParseProseFailure {
	ok: false;
	stage: 'header-scan' | 'field-extract' | 'zod';
	error: string;
	rawText: string;
	partial: Record<string, unknown> | null;
	stagesUsed: string[];
}

export type ParseProseResult = ParseProseSuccess | ParseProseFailure;

// Header line: optional leading whitespace + 1-3 # + space + NAME (uppercase
// underscore digits) + optional space + optional N digit. Supports `## NAME`
// (singleton) and `## NAME 3` (list-element).
const HEADER_RE = /^\s*(?:#{1,3})\s+([A-Z][A-Z0-9_]*?)(?:\s+(\d+))?\s*$/;
// Any Markdown heading is a hard section boundary. Unknown headings are not
// consumed as sections, but they also must not be glued into a preceding
// singleton's multiline body.
const SECTION_BOUNDARY_RE = /^\s*#{1,6}\s+\S/;
// Inline field: `key: value` (oneline). value may be empty.
const FIELD_RE = /^\s*([a-z][a-z0-9_]*)\s*:\s*(.*)$/;
// Multiline-field-start: `key:` with nothing after the colon.
const FIELD_MULTILINE_START_RE = /^\s*([a-z][a-z0-9_]*)\s*:\s*$/;

interface HeaderToken {
	name: string;
	index: number | null;       // null = singleton, otherwise 1-based list index
	lineNumber: number;
}

export function parseStructuredProse(rawText: string, spec: SectionSpec): ParseProseResult {
	const stages: string[] = [];
	const lines = rawText.split('\n');

	// Stage 1: scan for headers, partition lines into sections
	const headers: HeaderToken[] = [];
	const sectionBoundaries: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (SECTION_BOUNDARY_RE.test(lines[i])) sectionBoundaries.push(i);
		const m = lines[i].match(HEADER_RE);
		if (!m) continue;
		const name = m[1];
		const idx = m[2] ? parseInt(m[2], 10) : null;
		// Reject unknown headers softly: skip them as data sections, while the
		// broader section-boundary scan above still prevents their body from
		// being glued into the previous known section.
		if (idx === null && !(name in spec.singletons)) continue;
		if (idx !== null && !(name in spec.lists)) continue;
		headers.push({ name, index: idx, lineNumber: i });
	}
	stages.push('header-scan');

	if (headers.length === 0) {
		return {
			ok: false,
			stage: 'header-scan',
			error: 'no recognized section headers in output',
			rawText,
			partial: null,
			stagesUsed: stages,
		};
	}

	// Stage 2: extract content per header, parse fields
	const value: Record<string, unknown> = {};
	const lists: Record<string, Map<number, Record<string, unknown>>> = {};
	for (const listName of Object.keys(spec.lists)) lists[listName] = new Map();

	for (let h = 0; h < headers.length; h++) {
		const header = headers[h];
		const startLine = header.lineNumber + 1;
		const nextBoundary = sectionBoundaries.find(lineNumber => lineNumber > header.lineNumber);
		const endLine = nextBoundary ?? lines.length;
		const body = lines.slice(startLine, endLine);

		if (header.index === null) {
			// Singleton: the body is the section's content (multiline)
			const kind = spec.singletons[header.name];
			value[singletonKey(header.name)] = kind === 'multiline'
				? body.join('\n').trim()
				: body.find((l) => l.trim() !== '')?.trim() ?? '';
		} else {
			// List-element: parse fields from body
			const listSpec = spec.lists[header.name];
			const elementFields: Record<string, unknown> = {};
			parseFieldsInto(elementFields, body, listSpec);
			lists[header.name].set(header.index, elementFields);
		}
	}

	// Materialize lists in numerical order (1, 2, 3, ...). Missing indices are
	// skipped silently (e.g., LLM jumps from AUFFAELLIGKEIT 1 to AUFFAELLIGKEIT 3).
	for (const [listName, indexedMap] of Object.entries(lists)) {
		const sorted = Array.from(indexedMap.entries()).sort((a, b) => a[0] - b[0]);
		value[listKey(listName)] = sorted.map(([, fields]) => fields);
	}

	// Defaults for sections that didn't appear at all
	for (const singletonName of Object.keys(spec.singletons)) {
		const k = singletonKey(singletonName);
		if (!(k in value)) value[k] = '';
	}
	for (const listName of Object.keys(spec.lists)) {
		const k = listKey(listName);
		if (!(k in value)) value[k] = [];
	}

	stages.push('field-extract');

	return {
		ok: true,
		value,
		stagesUsed: stages,
	};
}

function parseFieldsInto(target: Record<string, unknown>, body: string[], listSpec: ListSectionSpec): void {
	let i = 0;
	while (i < body.length) {
		const line = body[i];

		// Skip blank lines between fields
		if (line.trim() === '') { i++; continue; }

		// Multiline-field-start: `key:` alone on a line, with the field declared as multiline
		const mlMatch = line.match(FIELD_MULTILINE_START_RE);
		if (mlMatch && listSpec.fields[mlMatch[1]] === 'multiline') {
			const key = mlMatch[1];
			const collected: string[] = [];
			i++;
			while (i < body.length) {
				const next = body[i];
				// Stop at next field marker or section header (we're inside body of one
				// section, so no `##` here, but defensive: any FIELD_RE that names a known field stops).
				const nextField = next.match(FIELD_RE) ?? next.match(FIELD_MULTILINE_START_RE);
				if (nextField && nextField[1] in listSpec.fields) break;
				collected.push(next);
				i++;
			}
			target[key] = collected.join('\n').trim();
			continue;
		}

		// Oneline field: `key: value`
		const olMatch = line.match(FIELD_RE);
		if (olMatch && olMatch[1] in listSpec.fields) {
			const key = olMatch[1];
			if (listSpec.fields[key] === 'multiline') {
				// Field is declared multiline but appeared on one line; treat the
				// inline value as the whole content (LLM may have inlined a short value).
				target[key] = olMatch[2].trim();
			} else {
				target[key] = olMatch[2].trim();
			}
			i++;
			continue;
		}

		// Unknown field name or malformed line — skip (LLM may emit blank prose).
		i++;
	}
}

function singletonKey(headerName: string): string {
	return headerName.toLowerCase();
}

function listKey(headerName: string): string {
	// Convention: list section name is the singular UPPERCASE form, the
	// resulting key is its lowercase form (the schema field name is by convention
	// the plural — caller can rename via schema-mapping if needed).
	return headerName.toLowerCase();
}

// ── Self-Healing Call-Wrapper (prose) ─────────────────────────────

export interface ProseRepairCallOpts<T> {
	system?: string;
	user: string;
	spec: SectionSpec;
	schema: AnyInputZodType<T>;    // final validation after parse
	label: string;                 // module identifier for telemetry
	modelOverride?: { provider: Provider; model: string };
	maxTokens: number;
	maxRetries?: number;           // default 2
	cacheableSystemPrefix?: string;
	cacheSystem?: boolean;
	documentIds?: string[];
	/** Telemetry context, optional. */
	caseId?: string | null;
	paragraphId?: string | null;
}

export async function runProseCallWithRepair<T>(opts: ProseRepairCallOpts<T>): Promise<RepairCallResult<T>> {
	const maxRetries = opts.maxRetries ?? 2;
	const totalTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
	const stagesPerAttempt: string[][] = [];
	const t0 = Date.now();

	const messages: { role: 'user' | 'assistant'; content: string }[] = [
		{ role: 'user', content: opts.user },
	];

	let lastFailure: ParseProseFailure | { stage: 'zod'; error: string; partial: Record<string, unknown> | null } | null = null;
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
		});

		totalTokens.input          += response.inputTokens;
		totalTokens.output         += response.outputTokens;
		totalTokens.cacheRead      += response.cacheReadTokens;
		totalTokens.cacheCreation  += response.cacheCreationTokens;
		totalTokens.total          += response.tokensUsed;
		lastRawText = response.text;

		const parsed = parseStructuredProse(response.text, opts.spec);

		const stagesBase = parsed.ok ? parsed.stagesUsed : parsed.stagesUsed;
		const stages = attempt === 0
			? [...stagesBase]
			: stagesBase.map((s) => `retry-${attempt}:${s}`);

		if (!parsed.ok) {
			stagesPerAttempt.push(stages);
			lastFailure = parsed;
			if (attempt < maxRetries) {
				messages.push({ role: 'assistant', content: response.text });
				messages.push({ role: 'user', content: buildProseRetryFeedback(parsed, opts.spec) });
				continue;
			}
			break;
		}

		const validated = opts.schema.safeParse(parsed.value);
		const stagesWithZod = [...stages, attempt === 0 ? 'zod' : `retry-${attempt}:zod`];
		stagesPerAttempt.push(stagesWithZod);

		if (validated.success) {
			logPipelineCall({
				module: opts.label,
				modelKey,
				provider,
				parseStrategy: 'prose',
				stagesUsed: stagesWithZod,
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
				value: validated.data,
				tokens: totalTokens,
				stagesUsed: stagesWithZod,
				retries: attempt,
				attempts: attempt + 1,
				stagesPerAttempt,
				model: modelKey,
				provider,
			};
		}

		lastFailure = { stage: 'zod', error: validated.error.message, partial: parsed.value };
		if (attempt < maxRetries) {
			messages.push({ role: 'assistant', content: response.text });
			messages.push({
				role: 'user',
				content: buildProseRetryFeedback(
					{
						ok: false,
						stage: 'zod',
						error: validated.error.message,
						rawText: response.text,
						partial: parsed.value,
						stagesUsed: stagesBase,
					},
					opts.spec
				),
			});
		}
	}

	const stage = lastFailure && 'stage' in lastFailure ? lastFailure.stage : 'unknown';
	const errMsg = lastFailure?.error ?? 'unknown';

	logPipelineCall({
		module: opts.label,
		modelKey,
		provider,
		parseStrategy: 'prose',
		stagesUsed: stagesPerAttempt[stagesPerAttempt.length - 1] ?? [],
		stagesPerAttempt,
		retries: maxRetries,
		attempts: maxRetries + 1,
		success: false,
		wallSeconds: (Date.now() - t0) / 1000,
		tokens: totalTokens,
		caseId: opts.caseId,
		paragraphId: opts.paragraphId,
		errorStage: stage,
		errorMessage: errMsg,
	});

	throw new RepairCallExhaustedError(
		`${opts.label}: prose repair exhausted after ${maxRetries + 1} attempts (last stage=${stage}, error=${errMsg.slice(0, 200)})`,
		maxRetries + 1,
		stage,
		errMsg,
		lastRawText,
		totalTokens,
		stagesPerAttempt,
	);
}

function buildProseRetryFeedback(failure: ParseProseFailure, spec: SectionSpec): string {
	const lines: string[] = [];
	lines.push('Dein vorheriger Output war kein gültiges Section-Headered Prose-Format.');
	lines.push('');
	lines.push(`Stufe: ${failure.stage}`);
	lines.push(`Fehler: ${failure.error.slice(0, 500)}`);

	if (failure.stage === 'header-scan') {
		lines.push('');
		lines.push('Es wurden keine erkennbaren `## SECTION_NAME` Header gefunden.');
	} else if (failure.stage === 'zod' && failure.partial) {
		const keys = Object.keys(failure.partial);
		lines.push('');
		lines.push(`Vorhandene Sektionen: ${keys.join(', ') || '(keine)'}`);
	}

	lines.push('');
	lines.push('Erforderliches Format (verbindlich):');
	for (const [name, kind] of Object.entries(spec.singletons)) {
		lines.push(`  ## ${name}`);
		if (kind === 'multiline') lines.push(`  <mehrzeiliger Text>`);
		else lines.push(`  <einzeilige Antwort>`);
	}
	for (const [name, listSpec] of Object.entries(spec.lists)) {
		lines.push(`  ## ${name} 1`);
		for (const [field, kind] of Object.entries(listSpec.fields)) {
			if (kind === 'multiline') {
				lines.push(`  ${field}:`);
				lines.push(`  <mehrzeiliger Text>`);
			} else {
				lines.push(`  ${field}: <einzeiliger Wert>`);
			}
		}
		lines.push(`  ## ${name} 2 ...  (sofern weitere Einträge)`);
	}

	lines.push('');
	lines.push('Erzeuge das vollständige Resultat JETZT erneut. Strikt:');
	lines.push('- Section-Header genau im Format `## SECTION_NAME` oder `## SECTION_NAME N` (N = 1, 2, ...)');
	lines.push('- Keine Code-Fences, kein JSON, keine Erklärungen außerhalb der Sektionen');
	lines.push('- Felder als `key: value` (oneline) oder `key:` + Folgezeilen (multiline)');
	lines.push('- Behebe den oben markierten Fehler');
	return lines.join('\n');
}

// ── Helper for callers: build the OUTPUT-Format prompt block ──────
//
// Convenience for module prompts. Returns a verbatim instruction block that
// matches what parseStructuredProse expects. Callers typically append this
// to their system prompt's OUTPUT-FORMAT section.

export function describeProseFormat(spec: SectionSpec): string {
	const lines: string[] = [];
	lines.push('Antworte ausschließlich im folgenden Section-Headered Prose-Format.');
	lines.push('Keine Code-Fences, kein JSON, keine Erklärungen außerhalb der Sektionen.');
	lines.push('');

	for (const [name, kind] of Object.entries(spec.singletons)) {
		lines.push(`## ${name}`);
		if (kind === 'multiline') {
			lines.push('<mehrzeiliger Text — beliebig viele Absätze, bis zum nächsten ## Marker>');
		} else {
			lines.push('<einzeilige Antwort>');
		}
		lines.push('');
	}

	for (const [name, listSpec] of Object.entries(spec.lists)) {
		lines.push(`## ${name} 1`);
		for (const [field, kind] of Object.entries(listSpec.fields)) {
			if (kind === 'multiline') {
				lines.push(`${field}:`);
				lines.push('<mehrzeiliger Wert — bis zum nächsten `key:` oder `##` Marker>');
			} else {
				lines.push(`${field}: <einzeiliger Wert>`);
			}
		}
		lines.push('');
		lines.push(`## ${name} 2`);
		lines.push('... (gleiche Felder, fortlaufend nummeriert)');
		lines.push('');
		lines.push(`(Wenn keine ${name}-Einträge: lasse alle ${name}-Sektionen weg.)`);
		lines.push('');
	}

	return lines.join('\n');
}
