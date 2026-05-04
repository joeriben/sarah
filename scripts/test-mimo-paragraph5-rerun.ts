// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Re-runs mimo on §5 of 1.1.1 with enlarged maxTokens budgets so that
// invisible reasoning tokens don't crowd out the actual response. The
// goal is to capture mimo's CONTENT for §5, not to measure JSON adherence.
//
// First run used production budgets (synth=2000, AG=8000); §5 hit both.
// We give it 6000 / 16000 here.

import { writeFileSync } from 'node:fs';
import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool, query } from '../src/lib/server/db/index.ts';

const MIMO = { provider: 'openrouter' as const, model: 'xiaomi/mimo-v2.5-pro' };

const HABIL_CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const HABIL_USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const PARAGRAPH_5_ID = '72919e94-79bb-4a0e-b507-e78aacc1fd5b';

// We need §1-§4 synth memos AND AG nodes in the DB so that §5's chain /
// prior-args queries see real predecessors (not empty). Easiest: re-run
// §1-§5 synth and §1-§5 AG, with the higher budget for §5.
const PARAGRAPH_IDS_111 = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	PARAGRAPH_5_ID,                          // §5
];

async function cleanupParagraphs(ids: string[]) {
	await query(`DELETE FROM scaffolding_elements WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(`DELETE FROM argument_nodes WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT naming_id FROM memo_content
		    WHERE scope_element_id = ANY($1::uuid[]) AND scope_level = 'paragraph')`,
		[ids]
	);
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT DISTINCT code_naming_id FROM code_anchors WHERE element_id = ANY($1::uuid[]))`,
		[ids]
	);
}

await cleanupParagraphs(PARAGRAPH_IDS_111);

console.log('=== Synth pass §1-§5 (mimo, generous maxTokens for §5) ===');
const synthResults: { idx: number; pid: string; ok: boolean; result?: unknown; error?: string; tokens?: unknown }[] = [];
for (let i = 0; i < PARAGRAPH_IDS_111.length; i++) {
	const pid = PARAGRAPH_IDS_111[i];
	// §5 gets a large budget; §1-§4 get production default — they are just
	// chain-priming for §5's interpretive context.
	const budget = pid === PARAGRAPH_5_ID ? 6000 : 2000;
	const t0 = Date.now();
	try {
		const r = await runParagraphPass(HABIL_CASE_ID, pid, HABIL_USER_ID, { modelOverride: MIMO, maxTokens: budget });
		const dt = (Date.now() - t0) / 1000;
		console.log(`  §${i + 1} (max=${budget}): ${dt.toFixed(1)}s in=${r.tokens.input} out=${r.tokens.output}  codes: ${r.result.codes.map(c => `"${c.label}"`).join(', ') || '(none)'}`);
		synthResults.push({ idx: i + 1, pid, ok: true, result: r.result, tokens: r.tokens });
	} catch (err) {
		const dt = (Date.now() - t0) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`  §${i + 1} (max=${budget}): FAIL ${dt.toFixed(1)}s — ${msg.slice(0, 120)}`);
		synthResults.push({ idx: i + 1, pid, ok: false, error: msg });
	}
}

console.log('\n=== AG pass §1-§5 (mimo, generous maxTokens for §5) ===');
const agResults: { idx: number; pid: string; ok: boolean; result?: unknown; error?: string; tokens?: unknown }[] = [];
for (let i = 0; i < PARAGRAPH_IDS_111.length; i++) {
	const pid = PARAGRAPH_IDS_111[i];
	const budget = pid === PARAGRAPH_5_ID ? 16000 : 8000;
	const t0 = Date.now();
	try {
		const r = await runArgumentationGraphPass(HABIL_CASE_ID, pid, { modelOverride: MIMO, maxTokens: budget });
		const dt = (Date.now() - t0) / 1000;
		if (r.skipped) {
			console.log(`  §${i + 1}: SKIP (existing)`);
			agResults.push({ idx: i + 1, pid, ok: false, error: 'skipped' });
			continue;
		}
		console.log(`  §${i + 1} (max=${budget}): ${dt.toFixed(1)}s in=${r.tokens!.input} out=${r.tokens!.output} args=${r.result!.arguments.length}/edges=${r.result!.edges.length}/scaff=${r.result!.scaffolding.length}`);
		agResults.push({ idx: i + 1, pid, ok: true, result: r.result, tokens: r.tokens });
	} catch (err) {
		const dt = (Date.now() - t0) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`  §${i + 1} (max=${budget}): FAIL ${dt.toFixed(1)}s — ${msg.slice(0, 200)}`);
		agResults.push({ idx: i + 1, pid, ok: false, error: msg });
	}
}

await cleanupParagraphs(PARAGRAPH_IDS_111);

writeFileSync('docs/experiments/mimo-quality-paragraph5-rerun.json', JSON.stringify({
	model: MIMO,
	synth_results: synthResults,
	ag_results: agResults,
}, null, 2));
console.log('\n→ docs/experiments/mimo-quality-paragraph5-rerun.json');

await pool.end();
