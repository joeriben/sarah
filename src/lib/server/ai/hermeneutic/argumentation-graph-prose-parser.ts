// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tolerant prose-with-conventions parser for Argumentations-Graph output.
//
// Replaces the strict-JSON pipeline. The LLM emits a line-based prose
// format (see PROSE_FORMAT_SPEC below); this parser converts it into the
// same internal shape (ArgumentationGraphResult) the rest of the pipeline
// already consumes — so storage code stays unchanged.
//
// Tolerance principles:
//   - Sections (ARGUMENT/EDGES/SCAFFOLDING) are detected greedily; junk
//     between sections is ignored with a warning, not a throw.
//   - Within a section, missing optional fields default to empty.
//   - A malformed argument/scaffolding is skipped (warning), not fatal —
//     other sections of the paragraph still produce data.
//   - An argument without a claim is dropped. A scaffolding without an
//     anchor is dropped (matches existing storeResult behaviour).
//   - Edges that don't pattern-match the strict arrow form are skipped
//     with a warning, not fatal.
//
// The downstream Zod validation in argumentation-graph.ts treats the
// parser output as already-typed and runs schema only as a sanity check.

import type { ArgumentationGraphResult } from './argumentation-graph.js';

export const PROSE_FORMAT_SPEC = `
ARGUMENT A1
claim: <self-contained Aussage, 1–2 Sätze>
premises:
- stated: <Voraussetzung, im Absatz wörtlich oder paraphrasiert>
- carried §<N>: <Voraussetzung aus früherem Absatz N des Unterkapitels>
- background: <fachübliche Hintergrundannahme>
anchor: <wörtliche Wortgruppe ≤ 8 Wörter, oder leer>

ARGUMENT A2
claim: ...
(weitere Argumente analog)

EDGES
A2 -supports-> A1
A1 -refines-> §2:A3
A1 -presupposes-> §1:A2
(Pfeil-Format strikt: <id> -<kind>-> <id-oder-§N:Aid>; \
 inter_argument-Kanten: supports | refines | contradicts; \
 prior_paragraph-Kanten zusätzlich: presupposes)

SCAFFOLDING S1
function: <textorganisatorisch | didaktisch | kontextualisierend | rhetorisch>
anchored_to: A1, §2:A3
excerpt: <Textfragment, ≤ 500 Zeichen>
description: <spezifische Funktion in Bezug auf Argumente>
assessment: <Bewertung aus argumentationslogischer Sicht>
anchor: <Wortgruppe ≤ 8 Wörter, oder leer>

SCAFFOLDING S2
...
`;

export interface ProseParseResult {
	result: ArgumentationGraphResult;
	warnings: string[];
	/** Sections the parser couldn't classify — useful for 2B-fallback recovery. */
	junkSections: string[];
}

interface RawArg {
	id: string;
	claim: string;
	premises: { type: string; text: string; from_paragraph?: number }[];
	anchor_phrase: string;
}
interface RawEdge {
	from: string;
	to: string;
	kind: string;
	scope: 'inter_argument' | 'prior_paragraph';
}
interface RawScaff {
	id: string;
	excerpt: string;
	function_type: string;
	function_description: string;
	assessment: string;
	anchored_to: string[];
	anchor_phrase: string;
}

const ARG_HEADER = /^\s*ARGUMENT\s+(A\d+)\s*$/i;
const EDGES_HEADER = /^\s*EDGES\s*$/i;
const SCAFF_HEADER = /^\s*SCAFFOLDING\s+(S\d+)\s*$/i;
const ANY_HEADER = /^\s*(ARGUMENT\s+A\d+|EDGES|SCAFFOLDING\s+S\d+)\s*$/i;
const EDGE_LINE = /^\s*(A\d+)\s*-\s*(supports|refines|contradicts|presupposes)\s*->\s*(A\d+|§\d+:A\d+)\s*$/i;

export function parseProseAG(rawText: string): ProseParseResult {
	const warnings: string[] = [];
	const junkSections: string[] = [];

	// 1. Slice into sections by greedy header detection.
	const lines = rawText.split(/\r?\n/);
	type Section = { kind: 'argument'; id: string; body: string[] }
		| { kind: 'edges'; body: string[] }
		| { kind: 'scaffolding'; id: string; body: string[] }
		| { kind: 'junk'; body: string[] };

	const sections: Section[] = [];
	let cur: Section | null = null;
	for (const line of lines) {
		const argM = line.match(ARG_HEADER);
		const edgesM = line.match(EDGES_HEADER);
		const scaffM = line.match(SCAFF_HEADER);

		if (argM) {
			if (cur) sections.push(cur);
			cur = { kind: 'argument', id: argM[1].toUpperCase(), body: [] };
		} else if (edgesM) {
			if (cur) sections.push(cur);
			cur = { kind: 'edges', body: [] };
		} else if (scaffM) {
			if (cur) sections.push(cur);
			cur = { kind: 'scaffolding', id: scaffM[1].toUpperCase(), body: [] };
		} else {
			if (!cur) {
				// Pre-section preamble (model intro text, markdown wrappers, etc.).
				cur = { kind: 'junk', body: [] };
			}
			cur.body.push(line);
		}
	}
	if (cur) sections.push(cur);

	// 2. Parse each section.
	const args: RawArg[] = [];
	const edges: RawEdge[] = [];
	const scaffs: RawScaff[] = [];
	const seenArgIds = new Set<string>();
	const seenScaffIds = new Set<string>();

	for (const sec of sections) {
		if (sec.kind === 'junk') {
			const txt = sec.body.join('\n').trim();
			if (txt.length > 0) junkSections.push(txt);
			continue;
		}
		if (sec.kind === 'argument') {
			if (seenArgIds.has(sec.id)) {
				warnings.push(`duplicate ARGUMENT ${sec.id} skipped`);
				continue;
			}
			const arg = parseArgumentBody(sec.id, sec.body, warnings);
			if (arg) {
				args.push(arg);
				seenArgIds.add(sec.id);
			}
		} else if (sec.kind === 'edges') {
			edges.push(...parseEdgesBody(sec.body, warnings));
		} else if (sec.kind === 'scaffolding') {
			if (seenScaffIds.has(sec.id)) {
				warnings.push(`duplicate SCAFFOLDING ${sec.id} skipped`);
				continue;
			}
			const sc = parseScaffoldingBody(sec.id, sec.body, warnings);
			if (sc) {
				scaffs.push(sc);
				seenScaffIds.add(sec.id);
			}
		}
	}

	// 3. Coerce to ArgumentationGraphResult shape.
	// Note: PremiseSchema in argumentation-graph.ts performs final type-coercion
	// (carried→background-demotion etc.). We just emit the raw structures.
	const result = {
		arguments: args.map(a => ({
			id: a.id,
			claim: a.claim,
			premises: a.premises.map(p => {
				const out: { type: string; text: string; from_paragraph?: number } = {
					type: p.type,
					text: p.text,
				};
				if (typeof p.from_paragraph === 'number') out.from_paragraph = p.from_paragraph;
				return out;
			}),
			anchor_phrase: a.anchor_phrase,
		})),
		edges: edges.map(e => ({
			from: e.from,
			to: e.to,
			kind: e.kind,
			scope: e.scope,
		})),
		scaffolding: scaffs.map(s => ({
			id: s.id,
			excerpt: s.excerpt,
			function_type: s.function_type,
			function_description: s.function_description,
			assessment: s.assessment,
			anchored_to: s.anchored_to,
			anchor_phrase: s.anchor_phrase,
		})),
	} as unknown as ArgumentationGraphResult;

	return { result, warnings, junkSections };
}

// ── Per-section parsers ───────────────────────────────────────────

interface FieldMap { [key: string]: string }

/**
 * Body lines → field map. Field syntax:
 *   `key: value` starts a field; subsequent indented or non-`key:` lines
 *   continue the value until next `key:` or section header.
 * Returns map with lowercase field-names. Unknown fields are kept (caller
 * decides which fields to read).
 */
function parseFields(body: string[]): { fields: FieldMap; premiseLines: string[] } {
	const fields: FieldMap = {};
	const premiseLines: string[] = [];
	let curKey: string | null = null;
	let inPremises = false;

	for (const rawLine of body) {
		const line = rawLine;

		// premise list bullet
		if (inPremises && /^\s*-\s/.test(line)) {
			premiseLines.push(line.replace(/^\s*-\s+/, '').trimEnd());
			continue;
		}

		// new field?
		const fm = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/);
		if (fm) {
			const key = fm[1].toLowerCase();
			const value = fm[2];
			if (key === 'premises') {
				inPremises = true;
				curKey = null;
				if (value.trim().length > 0) {
					// inline premise on same line: `premises: stated: foo` is unusual,
					// but tolerate.
					premiseLines.push(value.trim());
				}
				continue;
			}
			inPremises = false;
			curKey = key;
			fields[key] = value;
			continue;
		}

		// continuation of current field
		if (curKey !== null && line.trim().length > 0) {
			fields[curKey] = (fields[curKey] + '\n' + line).trim();
		}
	}

	for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
	return { fields, premiseLines };
}

const PREMISE_LINE = /^\s*(stated|carried|background)\b(?:\s*§\s*(\d+))?\s*:\s*(.+)$/i;

function parseArgumentBody(id: string, body: string[], warnings: string[]): RawArg | null {
	const { fields, premiseLines } = parseFields(body);
	const claim = fields.claim ?? '';
	if (claim.length === 0) {
		warnings.push(`ARGUMENT ${id} has no claim — dropped`);
		return null;
	}
	const anchor = fields.anchor ?? fields.anchor_phrase ?? '';
	const premises: RawArg['premises'] = [];
	for (const pl of premiseLines) {
		const m = pl.match(PREMISE_LINE);
		if (!m) {
			// Not in canonical form. Treat the whole bullet as a "stated" premise
			// rather than dropping (model occasionally drops the type prefix).
			if (pl.trim().length > 0) {
				premises.push({ type: 'stated', text: pl.trim() });
			}
			continue;
		}
		const type = m[1].toLowerCase();
		const fromN = m[2] ? parseInt(m[2], 10) : undefined;
		const text = m[3].trim();
		if (text.length === 0) continue;
		const p: RawArg['premises'][number] = { type, text };
		if (typeof fromN === 'number') p.from_paragraph = fromN;
		premises.push(p);
	}
	return { id, claim, premises, anchor_phrase: anchor };
}

function parseEdgesBody(body: string[], warnings: string[]): RawEdge[] {
	const out: RawEdge[] = [];
	for (const rawLine of body) {
		let trimmed = rawLine.trim();
		if (trimmed.length === 0) continue;
		// Tolerate trailing parenthesized comment, e.g.
		// "A2 -supports-> A1  (A2 begründet die Prozesshaftigkeit als …)"
		trimmed = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
		if (trimmed.length === 0) continue;
		// Tolerate alt-arrow forms: --> or →
		const normalized = trimmed
			.replace(/-{1,3}>/, '->')
			.replace(/[→]/g, '->');
		// Tolerate multi-target form, e.g. "A3 -presupposes-> A1, A2".
		// Split into individual edges and process each.
		const headTail = normalized.match(
			/^(\s*A\d+\s*-\s*(?:supports|refines|contradicts|presupposes)\s*->\s*)(.+)$/i
		);
		if (headTail && /,/.test(headTail[2])) {
			const head = headTail[1];
			const targets = headTail[2].split(/\s*,\s*/).filter(t => t.length > 0);
			for (const t of targets) processSingleEdge(`${head}${t}`, out, warnings);
			continue;
		}
		processSingleEdge(normalized, out, warnings);
	}
	return out;
}

function processSingleEdge(normalized: string, out: RawEdge[], warnings: string[]) {
	const trimmedForReport = normalized.trim();
	const m = normalized.match(EDGE_LINE);
	if (!m) {
		warnings.push(`unparseable edge line: "${trimmedForReport.slice(0, 80)}"`);
		return;
	}
	const from = m[1].toUpperCase();
	const kind = m[2].toLowerCase();
	const to = m[3].toUpperCase().startsWith('§') ? m[3] : m[3].toUpperCase();
	// §0 is a model hallucination — there is no "paragraph zero". Drop.
	if (/^§0:/i.test(to)) {
		warnings.push(`dropped edge with non-existent §0 reference: ${from} -> ${to}`);
		return;
	}
	const scope: 'inter_argument' | 'prior_paragraph' = to.startsWith('§') ? 'prior_paragraph' : 'inter_argument';
	if (scope === 'inter_argument' && kind === 'presupposes') {
		warnings.push(`presupposes is prior_paragraph-only; demoted to "supports" on inter_argument edge ${from}->${to}`);
		out.push({ from, to, kind: 'supports', scope });
		return;
	}
	out.push({ from, to, kind, scope });
}

const VALID_FUNCTION_TYPES = new Set([
	'textorganisatorisch', 'didaktisch', 'kontextualisierend', 'rhetorisch',
]);

function parseScaffoldingBody(id: string, body: string[], warnings: string[]): RawScaff | null {
	const { fields } = parseFields(body);
	let function_type = (fields.function ?? fields.function_type ?? '').toLowerCase().trim();
	const function_description = fields.description ?? fields.function_description ?? '';
	const assessment = fields.assessment ?? '';
	const excerpt = stripQuotes(fields.excerpt ?? '');
	const anchor_phrase = fields.anchor ?? fields.anchor_phrase ?? '';
	const anchoredRaw = fields.anchored_to ?? '';
	const anchored_to = anchoredRaw.split(/[,;]/)
		.map(s => s.trim())
		.filter(s => s.length > 0)
		.map(s => s.toUpperCase().startsWith('§') ? s : s.toUpperCase())
		.filter(s => /^(A\d+|§\d+:A\d+)$/.test(s));
	if (excerpt.length === 0) {
		warnings.push(`SCAFFOLDING ${id} has no excerpt — dropped`);
		return null;
	}
	if (function_description.length === 0) {
		warnings.push(`SCAFFOLDING ${id} has no description — dropped`);
		return null;
	}
	if (assessment.length === 0) {
		warnings.push(`SCAFFOLDING ${id} has no assessment — dropped`);
		return null;
	}
	if (anchored_to.length === 0) {
		warnings.push(`SCAFFOLDING ${id} has no resolvable anchored_to — dropped`);
		return null;
	}
	if (!VALID_FUNCTION_TYPES.has(function_type)) {
		warnings.push(`SCAFFOLDING ${id} has unknown function_type="${function_type}" — defaulting to "kontextualisierend"`);
		function_type = 'kontextualisierend';
	}
	return {
		id,
		excerpt: excerpt.slice(0, 1000),  // schema cap
		function_type,
		function_description,
		assessment,
		anchored_to,
		anchor_phrase,
	};
}

function stripQuotes(s: string): string {
	const t = s.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('„') && (t.endsWith('"') || t.endsWith('"')))) {
		return t.slice(1, -1).trim();
	}
	return t;
}
