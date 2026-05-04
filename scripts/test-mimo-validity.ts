// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Argument-Validity-Pass model comparison on §1-§5 of subchapter 1.1.1
// across mimo, Sonnet 4.6 and Opus 4.7. Tests the Charity-First-Klassifikation
// (carries: true | false; inference_form; ggf. fallacy) — different cognitive
// shape than collapse: model READS structured arguments, EMITS structured
// per-argument assessments.
//
// Setup expectation:
//   - basal pipeline (synth + AG) for 1.1.1 has been seeded
//     (see scripts/seed-basal-1.1.1-sonnet.ts) — args are Sonnet-generated.
//
// Per model:
//   1. UPDATE argument_nodes SET validity_assessment = NULL for all 5 ¶
//   2. runArgumentValidityPass per ¶ with modelOverride; mimo gets
//      maxTokens=8000 (Reasoning-Klasse, 4000 default zu eng).
//   3. dump JSON to docs/experiments/validity-compare-1.1.1-<key>.json
//
// Final cleanup: leave validity_assessment from the LAST model in DB (so
// the basal+AG state stays intact; user can re-run to reset).
//
// Run from repo root:   npx tsx scripts/test-mimo-validity.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { runArgumentValidityPass } from '../src/lib/server/ai/hermeneutic/argument-validity.ts';
import { pool, query } from '../src/lib/server/db/index.ts';
import type { Provider } from '../src/lib/server/ai/client.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';

const PARAGRAPH_IDS = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	'72919e94-79bb-4a0e-b507-e78aacc1fd5b', // §5
];

interface ModelCfg {
	key: string;
	provider: Provider;
	model: string;
	maxTokens?: number;
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

async function resetValidity(paragraphIds: string[]) {
	await query(
		`UPDATE argument_nodes SET validity_assessment = NULL
		 WHERE paragraph_element_id = ANY($1::uuid[])`,
		[paragraphIds]
	);
}

interface ArgValidityRow {
	paragraph_element_id: string;
	arg_local_id: string;
	claim: string;
	validity_assessment: unknown;
}

async function loadValiditySnapshot(paragraphIds: string[]): Promise<ArgValidityRow[]> {
	return (await query<ArgValidityRow>(
		`SELECT paragraph_element_id, arg_local_id, claim, validity_assessment
		 FROM argument_nodes
		 WHERE paragraph_element_id = ANY($1::uuid[])
		 ORDER BY paragraph_element_id, position_in_paragraph`,
		[paragraphIds]
	)).rows;
}

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

interface ValidityRecord {
	idx: number;
	paragraph_id: string;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	model: string | null;
	provider: string | null;
	updated_count: number;
	skipped: boolean;
	error: string | null;
}

interface ModelResult {
	model: ModelCfg;
	per_paragraph: ValidityRecord[];
	assessments: ArgValidityRow[];
	wall_total: number;
	tokens_total: number;
}

const summary: { model: ModelCfg; wall: number; tokens: number; out_path: string }[] = [];

for (const m of MODELS) {
	console.log(`\n=== ${m.key}  (${m.provider}/${m.model})${m.maxTokens ? `  maxTokens=${m.maxTokens}` : ''} ===`);
	await resetValidity(PARAGRAPH_IDS);

	const records: ValidityRecord[] = [];
	const tStart = Date.now();
	let tokensTotal = 0;

	for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
		const pid = PARAGRAPH_IDS[i];
		const tag = `§${i + 1}`;
		const t0 = Date.now();
		try {
			const r = await withRetry(`validity ${tag}`, () =>
				runArgumentValidityPass(CASE_ID, pid, {
					modelOverride: { provider: m.provider, model: m.model },
					maxTokens: m.maxTokens,
				})
			);
			const dt = (Date.now() - t0) / 1000;
			if (r.skipped) {
				console.log(`  ${tag}: SKIP (no args or all assessed) — ${dt.toFixed(1)}s`);
				records.push({
					idx: i + 1, paragraph_id: pid,
					wall_seconds: dt, tokens: null, model: null, provider: null,
					updated_count: 0, skipped: true, error: null,
				});
				continue;
			}
			tokensTotal += r.tokens!.total;
			console.log(`  ${tag}: ${dt.toFixed(1)}s  in=${r.tokens!.input} out=${r.tokens!.output}  updated=${r.updatedCount}`);
			records.push({
				idx: i + 1, paragraph_id: pid,
				wall_seconds: dt, tokens: r.tokens, model: r.model, provider: r.provider,
				updated_count: r.updatedCount, skipped: false, error: null,
			});
		} catch (err) {
			const dt = (Date.now() - t0) / 1000;
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`  ${tag}: FAILED ${dt.toFixed(1)}s — ${msg.slice(0, 200)}`);
			records.push({
				idx: i + 1, paragraph_id: pid,
				wall_seconds: dt, tokens: null, model: null, provider: null,
				updated_count: 0, skipped: false, error: msg.slice(0, 800),
			});
		}
	}

	const assessments = await loadValiditySnapshot(PARAGRAPH_IDS);
	const wallTotal = (Date.now() - tStart) / 1000;

	const result: ModelResult = {
		model: m,
		per_paragraph: records,
		assessments,
		wall_total: wallTotal,
		tokens_total: tokensTotal,
	};

	const outPath = `${OUT_DIR}/validity-compare-1.1.1-${m.key}.json`;
	writeFileSync(outPath, JSON.stringify(result, null, 2));
	console.log(`  → ${outPath}  (wall ${wallTotal.toFixed(1)}s, total tokens ${tokensTotal})`);
	summary.push({ model: m, wall: wallTotal, tokens: tokensTotal, out_path: outPath });
}

console.log('\n=== Summary ===');
for (const s of summary) {
	console.log(`  ${s.model.key.padEnd(20)}  wall ${s.wall.toFixed(1).padStart(6)}s   tokens ${String(s.tokens).padStart(7)}`);
}
console.log('\nNOTE: Last model\'s validity_assessment remains in DB. Re-run to reset.');

await pool.end();
