// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Process Globalität §1..§5 through the EXPERIMENTAL Argumentations-Graph
// pass. Runs in subchapter order (forward: §1 first, then §2, ...) so that
// the prior_paragraph edge scope can reference earlier paragraphs.
//
// Run from repo root:   npx tsx scripts/run-argumentation-graphs.ts
//
// Idempotent: skips paragraphs that already have argument_nodes. To re-run
// for a paragraph: DELETE FROM argument_nodes WHERE paragraph_element_id = '...'
// (cascades to argument_edges).

import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';

// Globalität §1..§5 in FORWARD order — opposite of run-paragraphs.ts.
// The analytical pass needs prior arguments persisted before later paragraphs
// can reference them.
const PARAGRAPH_IDS = [
	'693f4a08-df4c-4f83-8add-e2a1d220d3a5', // §1
	'3e6aa3f3-7e32-4b0a-a573-1ed578f3f32b', // §2
	'30d9d218-9d4e-4839-97d2-e935ce83455e', // §3
	'e126d3f9-f257-4628-8eda-be5a366fe372', // §4
	'ef350dab-3ffb-48f7-9e42-d3455212eb6b', // §5
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
