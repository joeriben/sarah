// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mini-smoketest: ONE arg-graph call per candidate model, all in parallel
// on the SAME paragraph (1.1.1 §1). Reports per-model: wall, tokens, schema-
// valid yes/no. No DB writes.
//
// The point is to triage models BEFORE committing to the full 5 ¶ × 2 passes
// pipeline. A model that can't produce valid JSON for ONE paragraph won't
// magically improve over five.

import { loadParagraphContext, loadCaseContext } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { chat } from '../src/lib/server/ai/client.ts';
import { pool } from '../src/lib/server/db/index.ts';
import type { Provider } from '../src/lib/server/ai/client.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const PARAGRAPH_ID = '60f9dfb1-5d9d-4c56-8288-1ef51f5eec63'; // §1

interface ModelCfg { key: string; provider: Provider; model: string; }
const MODELS: ModelCfg[] = [
	{ key: 'qwen3.6-max-preview', provider: 'openrouter', model: 'qwen/qwen3.6-max-preview' },
	{ key: 'gemini-pro-latest',   provider: 'openrouter', model: '~google/gemini-pro-latest' },
	{ key: 'mimo-v2.5-pro',       provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
	{ key: 'glm-5.1',             provider: 'openrouter', model: 'z-ai/glm-5.1' },
];

// For triage we use a minimal inline AG prompt and a permissive shape-check
// instead of importing the full Zod schema (which isn't exported). The
// question we want answered is purely: "does this model produce a JSON
// object that has arguments[] (with id+claim) and scaffolding[]?"

const ctx = await loadCaseContext(CASE_ID);
const para = await loadParagraphContext(ctx, PARAGRAPH_ID);

const SYSTEM = `Du bist ein argumentationsanalytischer Reader für ein Habilitationsmanuskript.

Aufgabe: extrahiere aus dem aktuellen Absatz die Argument-Struktur als JSON.

Schema (strikt):
{
  "arguments": [
    { "id": "A1", "claim": "<...>", "premises": [{"type":"stated"|"carried"|"background", "text":"<...>"}], "anchor_phrase": "<≤ 8 Wörter, in-vivo>" }
  ],
  "edges": [
    { "from": "A1", "to": "A2", "kind": "supports"|"refines"|"contradicts", "scope": "inter_argument" }
  ],
  "scaffolding": [
    { "id": "S1", "excerpt": "<wörtl. Auszug, 1 Satz>", "function_type": "textorganisatorisch"|"didaktisch"|"kontextualisierend"|"rhetorisch", "function_description": "<1 Satz>", "assessment": "<1 Satz>", "anchored_to": ["A1"], "anchor_phrase": "<≤ 8 Wörter>" }
  ]
}

Antworte NUR mit dem JSON-Objekt, kein Markdown, kein Vor-/Nachtext.`;

const USER = `Aktueller Absatz (Subkapitel "${para.subchapterLabel}", §1):

"${para.text}"`;

interface SmokeResult {
	key: string;
	wall_seconds: number;
	tokens_input: number;
	tokens_output: number;
	json_valid: boolean;
	schema_valid: boolean;
	args_count: number;
	scaff_count: number;
	error: string | null;
	preview: string;
}

async function testOne(m: ModelCfg): Promise<SmokeResult> {
	const t0 = Date.now();
	try {
		const r = await chat({
			system: SYSTEM,
			messages: [{ role: 'user', content: USER }],
			maxTokens: 4000,
			modelOverride: { provider: m.provider, model: m.model },
		});
		const dt = (Date.now() - t0) / 1000;
		const text = r.text;

		// Try to extract first JSON object
		const start = text.indexOf('{');
		const end = text.lastIndexOf('}');
		if (start === -1 || end === -1) {
			return { key: m.key, wall_seconds: dt, tokens_input: r.inputTokens, tokens_output: r.outputTokens, json_valid: false, schema_valid: false, args_count: 0, scaff_count: 0, error: 'no { } in response', preview: text.slice(0, 120) };
		}
		const json = text.slice(start, end + 1);
		let parsed: unknown;
		try { parsed = JSON.parse(json); }
		catch (e) { return { key: m.key, wall_seconds: dt, tokens_input: r.inputTokens, tokens_output: r.outputTokens, json_valid: false, schema_valid: false, args_count: 0, scaff_count: 0, error: `JSON.parse: ${(e as Error).message.slice(0,60)}`, preview: text.slice(0, 120) }; }

		// Permissive shape check
		const data = parsed as { arguments?: { id?: string; claim?: string }[]; scaffolding?: unknown[]; edges?: unknown[] };
		const args = Array.isArray(data.arguments) ? data.arguments : [];
		const scaff = Array.isArray(data.scaffolding) ? data.scaffolding : [];
		const edges = Array.isArray(data.edges) ? data.edges : [];
		const shapeOk = args.length > 0 && args.every(a => typeof a?.id === 'string' && typeof a?.claim === 'string');
		return {
			key: m.key, wall_seconds: dt,
			tokens_input: r.inputTokens, tokens_output: r.outputTokens,
			json_valid: true, schema_valid: shapeOk,
			args_count: args.length, scaff_count: scaff.length,
			error: shapeOk ? null : `bad shape: args=${args.length} scaff=${scaff.length} edges=${edges.length}`, preview: ''
		};
	} catch (err) {
		return { key: m.key, wall_seconds: (Date.now() - t0) / 1000, tokens_input: 0, tokens_output: 0, json_valid: false, schema_valid: false, args_count: 0, scaff_count: 0, error: (err as Error).message.slice(0, 100), preview: '' };
	}
}

console.log(`Smoketest: ${MODELS.length} models in parallel on §1 (AG)\n`);
const t0 = Date.now();
const results = await Promise.all(MODELS.map(testOne));
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Results (wall ${dt}s for the slowest) ===`);
console.log(`model                 wall    in    out   json  schema  args  scaff  error`);
for (const r of results) {
	const json = r.json_valid ? 'YES' : 'no ';
	const schema = r.schema_valid ? 'YES' : 'no ';
	console.log(
		`${r.key.padEnd(20)}  ${r.wall_seconds.toFixed(1).padStart(5)}s  ${String(r.tokens_input).padStart(4)}  ${String(r.tokens_output).padStart(5)}  ${json}    ${schema}     ${String(r.args_count).padStart(2)}    ${String(r.scaff_count).padStart(2)}    ${r.error ?? ''}`
	);
}

await pool.end();
