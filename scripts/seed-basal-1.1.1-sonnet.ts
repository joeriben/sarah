// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Seed the basal pipeline (synthetic per-paragraph + argumentation-graph)
// for subchapter 1.1.1 of doc 54073d08 using Sonnet as Producer. Output
// stays in the DB as input for the section-collapse model comparison.
//
// Idempotent at the per-paragraph level: per-paragraph synth pass writes
// fresh memos each call (so this script will create duplicates if re-run
// without prior cleanup). Argumentation-graph pass has its own existing-
// data guard — it skips paragraphs that already have argument_nodes.
//
// Run from repo root:   npx tsx scripts/seed-basal-1.1.1-sonnet.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

const PARAGRAPH_IDS = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	'72919e94-79bb-4a0e-b507-e78aacc1fd5b', // §5
];

const OVERRIDE = { provider: 'openrouter' as const, model: 'anthropic/claude-sonnet-4.6' };

let agOk = 0, agFailed = 0;
const t0 = Date.now();

for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
	const pid = PARAGRAPH_IDS[i];

	process.stdout.write(`§${i + 1} synthetic ... `);
	const ts = Date.now();
	const synth = await runParagraphPass(CASE_ID, pid, USER_ID, { modelOverride: OVERRIDE });
	console.log(`${((Date.now() - ts) / 1000).toFixed(1)}s  in=${synth.tokens.input} out=${synth.tokens.output}`);

	process.stdout.write(`§${i + 1} arg-graph  ... `);
	const ta = Date.now();
	try {
		const ag = await runArgumentationGraphPass(CASE_ID, pid, { modelOverride: OVERRIDE });
		if (ag.skipped) {
			console.log(`SKIPPED (existing arg_nodes)`);
		} else {
			agOk++;
			console.log(`${((Date.now() - ta) / 1000).toFixed(1)}s  in=${ag.tokens!.input} out=${ag.tokens!.output}  args=${ag.result!.arguments.length}  scaff=${ag.result!.scaffolding.length}`);
		}
	} catch (err) {
		agFailed++;
		console.log(`FAILED (${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}) — continuing`);
	}
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. AG: ${agOk} ok, ${agFailed} failed.`);
await pool.end();
