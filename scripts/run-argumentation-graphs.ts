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

// Anforderungen an die Professionalität von Lehrkräften §1..§13 —
// Heading 6e0a1737-8996-49ad-830e-7e2290c3d838.
// Validation step 3: normativ-konzeptuelles Subkapitel, größter Lauf der Validierung.
const PARAGRAPH_IDS = [
	'332e0b28-80a4-4eaf-9197-fc30f4fba668', // §1
	'1a8b5a9b-8aeb-4e60-b474-bd7cbe10d4eb', // §2
	'afff0fc2-8b43-49cd-8d1c-9fd41049e373', // §3
	'3957674b-dfcc-4954-ba06-57db3bed9b15', // §4
	'd219b6bc-4e18-46f7-a537-428bac0c8bcb', // §5
	'1f7b16e7-0fd5-4d69-a9b9-a26d62c48bf4', // §6
	'b3077fac-4c1d-4fd0-a3d8-bafecce4698b', // §7
	'53ff6e03-9d7e-4b6a-aed3-7413e6059052', // §8
	'3851a9c4-b373-4c20-93b0-8d704f4b207b', // §9
	'6e56c72d-894b-4802-9fc1-3c0df3009161', // §10
	'ac0abb97-02ae-4961-87d4-c5244be60a3a', // §11
	'e766dff3-fa06-4908-b088-43d40916a2b5', // §12
	'8635d240-049f-48c2-9346-af4530dd3a53', // §13
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
