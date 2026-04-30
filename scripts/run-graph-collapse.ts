// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Run the EXPERIMENTAL graph-fed kontextualisierende Subkapitel-Collapse.
// Requires that runArgumentationGraphPass has already been executed for all
// paragraphs of this subchapter.
//
// Run from repo root:   npx tsx scripts/run-graph-collapse.ts

import { runGraphCollapse } from '../src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const SUBCHAPTER_HEADING_ID = '6e0a1737-8996-49ad-830e-7e2290c3d838'; // Anforderungen an die Professionalität von Lehrkräften

const t0 = Date.now();
const run = await runGraphCollapse(CASE_ID, SUBCHAPTER_HEADING_ID, USER_ID);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

const t = run.tokens;
const cost = (t.input * 3 + t.cacheCreation * 3.75 + t.cacheRead * 0.30 + t.output * 15) / 1_000_000;

console.log(`\n=== Graph-fed Collapse: "Anforderungen an Professionalität" ===`);
console.log(`${dt}s   in=${t.input} cache_r=${t.cacheRead} out=${t.output}  ~$${cost.toFixed(4)}`);
console.log(`paragraphs=${run.paragraphsSynthesized} arguments=${run.totalArguments} scaffolding=${run.totalScaffolding}`);
console.log(`memo: ${run.stored.memoId}`);

console.log(`\n--- SYNTHESE ---\n`);
console.log(run.result.synthese);

if (run.result.auffaelligkeiten.length > 0) {
	console.log(`\n--- AUFFÄLLIGKEITEN ---`);
	for (const a of run.result.auffaelligkeiten) {
		console.log(`  ${a.scope}: ${a.observation}`);
	}
} else {
	console.log(`\n(Keine Auffälligkeiten gemeldet.)`);
}

await pool.end();
