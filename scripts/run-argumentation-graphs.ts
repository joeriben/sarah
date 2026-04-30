// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Process a subchapter's paragraphs through the EXPERIMENTAL Argumentations-
// Graph pass. Runs in FORWARD order so that the prior_paragraph edge scope
// can reference earlier paragraphs.
//
// Run from repo root:   npx tsx scripts/run-argumentation-graphs.ts
//
// Idempotent: skips paragraphs that already have argument_nodes. To re-run
// for a paragraph: DELETE FROM argument_nodes WHERE paragraph_element_id = '...'
// (cascades to argument_edges).

import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';

// Schule und Globalität §1..§9 — Heading 7dee784c-4097-4f7e-80b0-85f3bf7e6f85.
// Validation step 2: applied/Empirie-context that USES the Globalität concept.
const PARAGRAPH_IDS = [
	'5b48ba63-af53-43cb-b074-899e3a4807c2', // §1
	'111e055f-2ede-4158-8919-c03533aa4845', // §2
	'a9e3f043-951e-445c-9eb7-905a7e7bb4f3', // §3
	'47b24503-817f-424c-be15-78696ba990be', // §4
	'3e7e5b66-acb5-4523-a291-6c8edefe9298', // §5
	'931e3c66-4929-4066-86db-7f81751ee89c', // §6
	'50496db2-7eaa-41ea-be8f-9fb9d71fc834', // §7
	'053acc5f-28a3-43ab-b3ea-2f22a0ab7b9b', // §8
	'854d6dd1-3219-448e-8562-a04e22c808c9', // §9
];

let total = 0;
for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
	const id = PARAGRAPH_IDS[i];
	process.stdout.write(`[${i + 1}/${PARAGRAPH_IDS.length}] §${i + 1}  `);
	const t0 = Date.now();
	const run = await runArgumentationGraphPass(CASE_ID, id);
	const dt = ((Date.now() - t0) / 1000).toFixed(1);

	if (run.skipped) {
		console.log(`SKIPPED (argument_nodes already exist; DELETE to re-run)`);
		continue;
	}

	const t = run.tokens!;
	const cost = (t.input * 3 + t.cacheCreation * 3.75 + t.cacheRead * 0.30 + t.output * 15) / 1_000_000;
	total += cost;

	const r = run.result!;
	const s = run.stored!;
	console.log(`${dt}s   in=${t.input} cache_r=${t.cacheRead} out=${t.output}  ~$${cost.toFixed(4)}`);
	console.log(`   args=${r.arguments.length}, edges: inter=${s.interEdgeCount} prior=${s.priorEdgeCount}` +
		`,  scaffolding=${s.scaffoldingIds.length} (anchors=${s.scaffoldingAnchorCount})` +
		(s.skippedEdges.length ? `  skipped_edges=${s.skippedEdges.length}` : '') +
		(s.skippedScaffolding.length ? `  dropped_scaff=${s.skippedScaffolding.length}` : '') +
		(s.unanchoredArguments.length ? `  unanchored_args=${s.unanchoredArguments.join(',')}` : '') +
		(s.unanchoredScaffolding.length ? `  unanchored_scaff=${s.unanchoredScaffolding.join(',')}` : '')
	);
	for (const e of s.skippedEdges) {
		console.log(`     skip edge ${e.from}→${e.to}: ${e.reason}`);
	}
	for (const x of s.skippedScaffolding) {
		console.log(`     drop scaffolding ${x.element}: ${x.reason}`);
	}
	for (const x of s.skippedScaffoldingAnchors) {
		console.log(`     drop anchor ${x.element}→${x.ref}: ${x.reason}`);
	}
	for (const a of r.arguments) {
		const premiseSummary = a.premises.length === 0
			? 'no premises'
			: a.premises.map(p => p.type).join(',');
		console.log(`   ${a.id}: ${a.claim.slice(0, 80)}${a.claim.length > 80 ? '…' : ''}  [${premiseSummary}]`);
	}
	for (const sc of r.scaffolding) {
		console.log(`   ${sc.id} [${sc.function_type}] ${sc.function_description.slice(0, 60)}${sc.function_description.length > 60 ? '…' : ''}  → ${sc.anchored_to.join(',')}`);
	}
}

console.log(`\nTotal ~$${total.toFixed(3)}`);
await pool.end();
