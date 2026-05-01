// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Three-way model comparison for the BASAL per-paragraph passes
// (synthetic per-paragraph + argumentation-graph) on a single subchapter.
//
// Subchapter under test: 1.1.1 "Bedeutung kultureller Orientierungsangebote
// in Schule" of doc 54073d08 (Timm Habilitation, fresh case).
//
// Sequence per model:
//   1. cleanupParagraphs(test_pids)      ← DB blank for these paragraphs
//   2. for each pid in forward order:
//        runParagraphPass with modelOverride       (writes interpretierend memo + codes)
//        runArgumentationGraphPass with modelOverride  (writes args + scaffolding)
//      → within-model state is needed because the chain query (synthetic) and
//        prior-arguments index (graph) read EARLIER paragraphs' DB rows.
//   3. dump JSON to docs/experiments/model-compare-1.1.1-<key>.json
//
// After the third model: final cleanupParagraphs() so the DB is restored.
//
// Cost protection: prints the running per-call cost from token counts using
// generic Anthropic pricing for sonnet/opus. DeepSeek pricing in mammouth is
// roughly 10× cheaper than Sonnet and is reported as "input/output * 0.3 /
// 3.0" — we don't model it precisely; the wall-time + token counts are the
// reported numbers.
//
// Run from repo root:   npx tsx scripts/compare-models-paragraph.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool, query } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Provider } from '../src/lib/server/ai/client.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

// Subchapter 1.1.1 §1..§5 in forward order (the order matters: synthetic
// chain + prior arguments depend on earlier paragraphs being processed first).
const PARAGRAPH_IDS = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	'72919e94-79bb-4a0e-b507-e78aacc1fd5b', // §5
];

interface ModelCfg { key: string; provider: Provider; model: string; }

const MODELS: ModelCfg[] = [
	// Round 2 (remotes only). Nemotron-3-super tested separately via prose-only
	// driver — JSON-heavy AG pass timed out / produced unparseable JSON locally.
	{ key: 'qwen3.6-max-preview', provider: 'openrouter', model: 'qwen/qwen3.6-max-preview' },
	{ key: 'gemini-pro-latest',   provider: 'openrouter', model: '~google/gemini-pro-latest' },
	{ key: 'mimo-v2.5-pro',       provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
	{ key: 'glm-5.1',             provider: 'openrouter', model: 'z-ai/glm-5.1' },
];

// Retry transient upstream errors (Cloudflare 524, gateway 502/503, rate-limit
// 429). DeepSeek through Mammouth in particular hits 524 on the heavier
// argumentation-graph prompt — the upstream hasn't finished within Cloudflare's
// ~100s window. Backoff is conservative: 5s → 15s → 30s.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504, 524, 408]);

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
	let lastErr: unknown;
	for (let i = 1; i <= attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			const status = (err as { status?: number })?.status;
			const retryable = status !== undefined && RETRYABLE_STATUS.has(status);
			if (!retryable || i === attempts) {
				throw err;
			}
			const wait = 5000 * i ** 2;  // 5s, 20s, 45s
			console.log(`     ↻ ${label}: ${status} on attempt ${i}/${attempts}, retry in ${wait/1000}s`);
			await new Promise(r => setTimeout(r, wait));
		}
	}
	throw lastErr;
}

async function cleanupParagraphs(ids: string[]) {
	// argument_nodes cascades to argument_edges and scaffolding_anchors.
	await query(`DELETE FROM scaffolding_elements WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(`DELETE FROM argument_nodes WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	// memo namings: cascade to memo_content + appearances.
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT naming_id FROM memo_content
		    WHERE scope_element_id = ANY($1::uuid[]) AND scope_level = 'paragraph')`,
		[ids]
	);
	// code namings: cascade to code_anchors + appearances.
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT DISTINCT code_naming_id FROM code_anchors WHERE element_id = ANY($1::uuid[]))`,
		[ids]
	);
}

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

interface PerParagraphRecord {
	paragraph_index: number;
	paragraph_id: string;
	synthetic: {
		result: unknown;
		tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
		model: string | null;
		wall_seconds: number;
		error: string | null;
	};
	argumentation_graph:
		| null
		| { failed: true; error: string }
		| {
			result: unknown;
			stored_summary: { args: number; inter_edges: number; prior_edges: number; scaffolding: number; unanchored_args: string[] };
			tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
			model: string;
			wall_seconds: number;
		};
}

const overallSummary: { model: ModelCfg; total_wall_seconds: number; total_tokens: number; per_model_path: string }[] = [];

for (const m of MODELS) {
	console.log(`\n=== Model: ${m.key}  (provider=${m.provider} model=${m.model}) ===`);
	await cleanupParagraphs(PARAGRAPH_IDS);

	const runs: PerParagraphRecord[] = [];
	let modelWall = 0;
	let modelTokens = 0;

	for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
		const pid = PARAGRAPH_IDS[i];

		// SYNTHETIC PASS
		process.stdout.write(`  §${i + 1} synthetic ... `);
		const t0 = Date.now();
		let synthRun: Awaited<ReturnType<typeof runParagraphPass>> | null = null;
		let synthError: string | null = null;
		try {
			synthRun = await withRetry(`§${i + 1} synthetic`, () =>
				runParagraphPass(CASE_ID, pid, USER_ID, { modelOverride: { provider: m.provider, model: m.model } })
			);
		} catch (err) {
			synthError = err instanceof Error ? err.message : String(err);
			console.log(`FAILED (${synthError}) — continuing`);
		}
		const dt1 = (Date.now() - t0) / 1000;
		if (synthRun) {
			modelWall += dt1;
			modelTokens += synthRun.tokens.total;
			const codeLabels = synthRun.result.codes.map(c => `"${c.label}"`).join(', ') || '(none)';
			console.log(`${dt1.toFixed(1)}s  in=${synthRun.tokens.input} cache_r=${synthRun.tokens.cacheRead} out=${synthRun.tokens.output}  codes: ${codeLabels}`);
		}

		// ARGUMENTATION-GRAPH PASS
		process.stdout.write(`  §${i + 1} arg-graph  ... `);
		const t1 = Date.now();
		let agRun: Awaited<ReturnType<typeof runArgumentationGraphPass>> | null = null;
		let agError: string | null = null;
		try {
			agRun = await withRetry(`§${i + 1} arg-graph`, () =>
				runArgumentationGraphPass(CASE_ID, pid, { modelOverride: { provider: m.provider, model: m.model } })
			);
		} catch (err) {
			agError = err instanceof Error ? err.message : String(err);
			console.log(`FAILED (${agError}) — continuing`);
		}
		const dt2 = (Date.now() - t1) / 1000;

		let agRecord: PerParagraphRecord['argumentation_graph'];
		if (!agRun) {
			agRecord = null;
		} else if (agRun.skipped) {
			console.log(`SKIPPED (existing rows)`);
			agRecord = null;
		} else {
			modelWall += dt2;
			modelTokens += agRun.tokens!.total;
			console.log(
				`${dt2.toFixed(1)}s  in=${agRun.tokens!.input} cache_r=${agRun.tokens!.cacheRead} out=${agRun.tokens!.output}  ` +
				`args=${agRun.result!.arguments.length}  edges: inter=${agRun.stored!.interEdgeCount} prior=${agRun.stored!.priorEdgeCount}  ` +
				`scaff=${agRun.result!.scaffolding.length}` +
				(agRun.stored!.unanchoredArguments.length ? `  unanchored_args=${agRun.stored!.unanchoredArguments.join(',')}` : '')
			);
			agRecord = {
				result: agRun.result,
				stored_summary: {
					args: agRun.result!.arguments.length,
					inter_edges: agRun.stored!.interEdgeCount,
					prior_edges: agRun.stored!.priorEdgeCount,
					scaffolding: agRun.result!.scaffolding.length,
					unanchored_args: agRun.stored!.unanchoredArguments,
				},
				tokens: agRun.tokens!,
				model: agRun.model!,
				wall_seconds: dt2,
			};
		}

		runs.push({
			paragraph_index: i + 1,
			paragraph_id: pid,
			synthetic: synthRun
				? { result: synthRun.result, tokens: synthRun.tokens, model: synthRun.model, wall_seconds: dt1, error: null }
				: { result: null, tokens: null, model: null, wall_seconds: dt1, error: synthError },
			argumentation_graph: agError && !agRecord ? { failed: true as const, error: agError } : agRecord,
		});
	}

	const outPath = `${OUT_DIR}/model-compare-1.1.1-${m.key}.json`;
	writeFileSync(
		outPath,
		JSON.stringify({ model: m, total_wall_seconds: modelWall, total_tokens: modelTokens, runs }, null, 2)
	);
	console.log(`  → ${outPath}  (wall ${modelWall.toFixed(1)}s, tokens ${modelTokens})`);

	overallSummary.push({ model: m, total_wall_seconds: modelWall, total_tokens: modelTokens, per_model_path: outPath });
}

// Final cleanup so the DB stays as fresh as we found it
await cleanupParagraphs(PARAGRAPH_IDS);

console.log('\n=== Summary ===');
for (const s of overallSummary) {
	console.log(`  ${s.model.key.padEnd(20)}  wall ${s.total_wall_seconds.toFixed(1).padStart(6)}s   tokens ${String(s.total_tokens).padStart(7)}`);
}
console.log('\nDB rows for the 5 test paragraphs have been cleaned up.');

await pool.end();
