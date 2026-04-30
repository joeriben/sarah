// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Run the EXPERIMENTAL document-graph-fed Werk-Collapse.
// Requires that runChapterCollapse has been executed for ALL L1-Hauptkapitel
// of the case's central document. Aggregates all chapter-graph memos to
// one work-level memo (Forschungsbeitrag, Gesamtkohärenz, Niveau).
//
// Run from repo root:   npx tsx scripts/run-document-collapse.ts

import { writeFile } from 'node:fs/promises';
import { runDocumentCollapse } from '../src/lib/server/ai/hermeneutic/document-collapse.ts';
import { pool } from '../src/lib/server/db/index.ts';

// Frische Validierungs-Case (no_annot_test2 Re-Import von 2026-05-01).
const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

const t0 = Date.now();
const run = await runDocumentCollapse(CASE_ID, USER_ID);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Document Collapse: case=${CASE_ID} ===`);

if (run.skipped) {
	console.log(`SKIPPED (existing memo ${run.existingMemoId}; DELETE FROM namings WHERE id = '${run.existingMemoId}' to re-run)`);
	await pool.end();
	process.exit(0);
}

const t = run.tokens!;
const cost = (t.input * 3 + t.cacheCreation * 3.75 + t.cacheRead * 0.30 + t.output * 15) / 1_000_000;

console.log(`${dt}s   in=${t.input} cache_r=${t.cacheRead} out=${t.output}  ~$${cost.toFixed(4)}`);
console.log(`chapters_aggregated=${run.chapterCount}`);
console.log(`memo: ${run.stored!.memoId}`);

console.log(`\n--- SYNTHESE ---\n`);
console.log(run.result!.synthese);

if (run.result!.auffaelligkeiten.length > 0) {
	console.log(`\n--- AUFFÄLLIGKEITEN ---`);
	for (const a of run.result!.auffaelligkeiten) {
		console.log(`  ${a.scope}: ${a.observation}`);
	}
} else {
	console.log(`\n(Keine Auffälligkeiten gemeldet.)`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dumpPath = `docs/experiments/document-collapse-${CASE_ID.slice(0, 8)}-${stamp}.md`;
const dump = `# Document Collapse — case=${CASE_ID}

- chapters_aggregated: ${run.chapterCount}
- model: ${run.model} (${run.provider})
- tokens: in=${t.input} cache_r=${t.cacheRead} cache_c=${t.cacheCreation} out=${t.output} total=${t.total}
- cost: ~$${cost.toFixed(4)}
- duration: ${dt}s
- memo_id: ${run.stored!.memoId}

## Synthese

${run.result!.synthese}

## Auffälligkeiten

${run.result!.auffaelligkeiten.length === 0
	? '(keine)'
	: run.result!.auffaelligkeiten.map(a => `- **${a.scope}**: ${a.observation}`).join('\n')}
`;
await writeFile(dumpPath, dump, 'utf8');
console.log(`\ndump: ${dumpPath}`);

await pool.end();
