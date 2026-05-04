// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Section-collapse model comparison for subchapter 1.1.1 across mimo,
// Sonnet 4.6 and Opus 4.7. DS4 baseline already exists at
// docs/experiments/collapse-compare-1.1.1-deepseek-v4-pro.json.
//
// Setup expectation:
//   - basal pipeline (synth + AG) for 1.1.1 has been seeded
//     (see scripts/seed-basal-1.1.1-sonnet.ts).
//
// Per model:
//   1. delete existing [kontextualisierend/subchapter/graph] memo for 1.1.1
//   2. runGraphCollapse with modelOverride; mimo gets maxTokens=8000
//      (Reasoning-Klasse, 4000 default zu eng für invisible reasoning tokens)
//   3. dump JSON to docs/experiments/section-compare-1.1.1-<key>.json
//
// Final cleanup: delete the last model's memo so the basal data stays the
// only thing in DB.
//
// Run from repo root:   npx tsx scripts/test-mimo-section-collapse.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { runGraphCollapse } from '../src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts';
import { pool, query } from '../src/lib/server/db/index.ts';
import type { Provider } from '../src/lib/server/ai/client.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const SUBCHAPTER_HEADING_ID = '46f6a156-6e6a-44b5-ac7b-7b790bc62c42'; // 1.1.1

interface ModelCfg {
	key: string;
	provider: Provider;
	model: string;
	maxTokens?: number; // override the production default for reasoning models
}

const MODELS: ModelCfg[] = [
	{ key: 'mimo-v2.5-pro', provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro', maxTokens: 8000 },
	{ key: 'sonnet-4-6',    provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
	{ key: 'opus-4.7',      provider: 'openrouter', model: 'anthropic/claude-opus-4.7' },
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
			console.log(`  ↻ ${label}: ${status} on attempt ${i}/${attempts}, retry in ${wait/1000}s`);
			await new Promise(r => setTimeout(r, wait));
		}
	}
	throw lastErr;
}

async function deleteCollapseMemo(subchapterHeadingId: string) {
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT n.id FROM namings n
		   JOIN memo_content mc ON mc.naming_id = n.id
		   WHERE n.inscription LIKE '[kontextualisierend/subchapter/graph]%'
		     AND mc.scope_element_id = $1
		     AND mc.scope_level = 'subchapter')`,
		[subchapterHeadingId]
	);
}

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

interface CollapseRecord {
	model: ModelCfg;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
	paragraphs_synthesized: number;
	total_arguments: number;
	total_scaffolding: number;
	result: unknown;
}

const summary: { model: ModelCfg; wall: number; tokens: number; out_path: string }[] = [];

for (const m of MODELS) {
	console.log(`\n=== ${m.key}  (${m.provider}/${m.model})${m.maxTokens ? `  maxTokens=${m.maxTokens}` : ''} ===`);
	await deleteCollapseMemo(SUBCHAPTER_HEADING_ID);

	const t0 = Date.now();
	let run;
	try {
		run = await withRetry(`section-collapse ${m.key}`, () =>
			runGraphCollapse(CASE_ID, SUBCHAPTER_HEADING_ID, USER_ID, {
				modelOverride: { provider: m.provider, model: m.model },
				maxTokens: m.maxTokens,
			})
		);
	} catch (err) {
		console.log(`FAILED (${err instanceof Error ? err.message.slice(0, 200) : String(err)}) — continuing`);
		const out = { model: m, error: err instanceof Error ? err.message : String(err), wall_seconds: (Date.now()-t0)/1000 };
		const outPath = `${OUT_DIR}/section-compare-1.1.1-${m.key}.json`;
		writeFileSync(outPath, JSON.stringify(out, null, 2));
		console.log(`  → ${outPath}  (FAILED)`);
		continue;
	}
	const dt = (Date.now() - t0) / 1000;

	if (run.skipped) {
		console.log(`  SKIPPED (existing memo ${run.existingMemoId} — should not happen after delete)`);
		continue;
	}

	const t = run.tokens!;
	console.log(`  ${dt.toFixed(1)}s  in=${t.input} cache_r=${t.cacheRead} out=${t.output}  total=${t.total}`);
	console.log(`  paragraphs=${run.paragraphsSynthesized}  args=${run.totalArguments}  scaffolding=${run.totalScaffolding}`);
	console.log(`  synthese len: ${run.result!.synthese.length} chars  auffaelligkeiten: ${run.result!.auffaelligkeiten.length}`);

	const record: CollapseRecord = {
		model: m,
		wall_seconds: dt,
		tokens: t,
		paragraphs_synthesized: run.paragraphsSynthesized!,
		total_arguments: run.totalArguments!,
		total_scaffolding: run.totalScaffolding!,
		result: run.result,
	};
	const outPath = `${OUT_DIR}/section-compare-1.1.1-${m.key}.json`;
	writeFileSync(outPath, JSON.stringify(record, null, 2));
	console.log(`  → ${outPath}`);
	summary.push({ model: m, wall: dt, tokens: t.total, out_path: outPath });
}

await deleteCollapseMemo(SUBCHAPTER_HEADING_ID);

console.log('\n=== Summary ===');
for (const s of summary) {
	console.log(`  ${s.model.key.padEnd(20)}  wall ${s.wall.toFixed(1).padStart(6)}s   tokens ${String(s.tokens).padStart(7)}`);
}
console.log('\nFinal collapse memo cleaned up. Basal pipeline data for 1.1.1 still in DB.');

await pool.end();
