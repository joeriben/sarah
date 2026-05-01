// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mistral-Large-3 variant of smoketest-prose-ag.ts. Same paragraphs, same
// cleanup pattern, distinct output filename. Runs in parallel to the DS4
// smoketest; DB race is tolerated because JSON dumps are authoritative
// (full result is captured in memory before each writeFileSync).

import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool, query } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Provider } from '../src/lib/server/ai/client.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';

const PARAGRAPH_IDS = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4  ← HAMMER
];

interface ModelCfg { key: string; provider: Provider; model: string; }

const MODELS: ModelCfg[] = [
	{ key: 'mistral-large-3-via-mammouth', provider: 'mammouth', model: 'mistral-large-3' },
];

const RETRYABLE_STATUS = new Set([429, 502, 503, 504, 524, 408]);

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
	let lastErr: unknown;
	for (let i = 1; i <= attempts; i++) {
		try { return await fn(); }
		catch (err) {
			lastErr = err;
			const status = (err as { status?: number })?.status;
			const retryable = status !== undefined && RETRYABLE_STATUS.has(status);
			if (!retryable || i === attempts) throw err;
			const wait = 5000 * i ** 2;
			console.log(`     ↻ ${label}: ${status} on attempt ${i}/${attempts}, retry in ${wait/1000}s`);
			await new Promise(r => setTimeout(r, wait));
		}
	}
	throw lastErr;
}

async function cleanupAG(ids: string[]) {
	await query(`DELETE FROM scaffolding_elements WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(`DELETE FROM argument_nodes WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
}

interface PerParagraphRecord {
	pid: string;
	position: string;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	success: boolean;
	args_count: number;
	edges_count: number;
	scaffolding_count: number;
	error: string | null;
	result: unknown;
}

interface ModelRecord {
	model: ModelCfg;
	paragraphs: PerParagraphRecord[];
	total_wall_seconds: number;
	total_tokens: number;
	success_count: number;
	failed_count: number;
}

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

const summary: ModelRecord[] = [];

for (const m of MODELS) {
	console.log(`\n=== ${m.key}  (${m.provider}/${m.model}) ===`);
	await cleanupAG(PARAGRAPH_IDS);

	const record: ModelRecord = {
		model: m,
		paragraphs: [],
		total_wall_seconds: 0,
		total_tokens: 0,
		success_count: 0,
		failed_count: 0,
	};

	for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
		const pid = PARAGRAPH_IDS[i];
		const pos = `§${i + 1}`;
		const t0 = Date.now();
		try {
			const run = await withRetry(`AG ${pos}`, () =>
				runArgumentationGraphPass(CASE_ID, pid, { modelOverride: { provider: m.provider, model: m.model } })
			);
			const dt = (Date.now() - t0) / 1000;
			if (run.skipped) {
				console.log(`  ${pos}: SKIPPED (existing data — race with parallel run)`);
				continue;
			}
			const t = run.tokens!;
			const r = run.result!;
			const argsN = r.arguments.length;
			const edgesN = r.edges.length;
			const scaffN = r.scaffolding.length;
			console.log(`  ${pos}: ${dt.toFixed(1)}s  in=${t.input} out=${t.output}  args=${argsN}/edges=${edgesN}/scaff=${scaffN}`);
			record.paragraphs.push({
				pid, position: pos, wall_seconds: dt,
				tokens: t,
				success: true,
				args_count: argsN, edges_count: edgesN, scaffolding_count: scaffN,
				error: null,
				result: r,
			});
			record.total_wall_seconds += dt;
			record.total_tokens += t.total;
			record.success_count++;
		} catch (err) {
			const dt = (Date.now() - t0) / 1000;
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`  ${pos}: FAILED (${dt.toFixed(1)}s) — ${msg.slice(0, 120)}`);
			record.paragraphs.push({
				pid, position: pos, wall_seconds: dt,
				tokens: null, success: false,
				args_count: 0, edges_count: 0, scaffolding_count: 0,
				error: msg.slice(0, 500),
				result: null,
			});
			record.failed_count++;
		}
	}

	summary.push(record);
	const outPath = `${OUT_DIR}/smoketest-prose-ag-${m.key}.json`;
	writeFileSync(outPath, JSON.stringify(record, null, 2));
	console.log(`  → ${outPath}`);
	console.log(`  total: ${record.total_wall_seconds.toFixed(1)}s, ${record.total_tokens} tokens, ${record.success_count}/${PARAGRAPH_IDS.length} success`);
}

// No final cleanup here; the DS4 sibling script handles it (or pipeline restore).

console.log('\n=== Mistral-Large-3 Summary ===');
for (const r of summary) {
	console.log(`${r.model.key.padEnd(35)}  ${r.total_wall_seconds.toFixed(1).padStart(5)}s  ${String(r.total_tokens).padStart(7)}  ${r.success_count}/${PARAGRAPH_IDS.length}`);
}

await pool.end();
