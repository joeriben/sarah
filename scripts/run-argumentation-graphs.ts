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

// Methodologische Grundlegung §1..§5 — Heading 0a13d404-20d7-4422-9e67-72181cf98fa5.
// Validation probe (cheapest first) for whether the S3 prompt sharpening
// generalises beyond Globalität.
const PARAGRAPH_IDS = [
	'aea14a0f-e04e-4ce6-8600-df26fcdccbe2', // §1
	'185c05d7-d890-48c2-8656-b822e04e1830', // §2
	'654738a0-c506-4ad7-825f-b0f5dfb08823', // §3
	'0594cfca-18d2-4c6c-b6e7-ee07bdab7d59', // §4
	'e82fa4f8-6ea0-4c4b-be82-de97e71ea4fc', // §5
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
