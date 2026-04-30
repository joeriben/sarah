// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Run the EXPERIMENTAL chapter-graph-fed Hauptkapitel-Collapse.
// Requires that runArgumentationGraphPass has been executed for all
// paragraphs of this chapter AND, for L2/L3 aggregation modes, that
// runGraphCollapse has been executed for the relevant Subkapitel.
// Helper picks the aggregation level (L1/L2/L3) per Median-paragraphs and
// persists it to heading_classifications.aggregation_subchapter_level.
//
// Run from repo root:   npx tsx scripts/run-chapter-collapse.ts

import { writeFile } from 'node:fs/promises';
import { runChapterCollapse } from '../src/lib/server/ai/hermeneutic/chapter-collapse.ts';
import { pool } from '../src/lib/server/db/index.ts';

// Frische Validierungs-Case (no_annot_test2 Re-Import von 2026-05-01).
// Brief: f8fc8a30-404f-4378-bd8d-c1fb92799246 (geklont, argumentation_graph=true).
const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
// L1-Heading des Theorie-Hauptkapitels "1" "Schule – Kultur – Globalität –
// Lehrkräftebildung" (74 Absätze, enthält Globalität, Schule und Globalität,
// Anforderungen an Professionalität).
// Weitere L1-Headings im neuen Dokument (54073d08):
//   num=2 "Orientierungen von Lehramtsstudierenden..."         6f025aa0-e394-4f2c-9e59-bdfee8e6a09b  (139 ¶)
//   num=3 "Reflexionen der kulturbezogenen Orientierungen..."  18dcfa8c-9daf-4393-bf43-f599414c5fb7  (64 ¶, parser-num leer)
//   num=4 "Ansätze einer Theorie kultureller Lehrkräftebildung" 62fed1d2-d3b0-4b74-abad-dde3fadaf86e  (50 ¶, kleinstes — günstigste Validierung)
const L1_HEADING_ID = '9c3e2dac-a9bb-4cb5-8a6d-19a87c086341';

const t0 = Date.now();
const run = await runChapterCollapse(CASE_ID, L1_HEADING_ID, USER_ID);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Chapter Collapse: L1=${L1_HEADING_ID} ===`);

if (run.skipped) {
	console.log(`SKIPPED (existing memo ${run.existingMemoId}; DELETE FROM namings WHERE id = '${run.existingMemoId}' to re-run)`);
	await pool.end();
	process.exit(0);
}

const t = run.tokens!;
const cost = (t.input * 3 + t.cacheCreation * 3.75 + t.cacheRead * 0.30 + t.output * 15) / 1_000_000;

console.log(`${dt}s   in=${t.input} cache_r=${t.cacheRead} out=${t.output}  ~$${cost.toFixed(4)}`);
console.log(`level=L${run.aggregationLevel} mode=${run.inputMode} input=${run.inputCount} units`);
console.log(`memo: ${run.stored!.memoId}`);

console.log(`\n--- SYNTHESE ---\n`);
console.log(run.result!.synthese);

console.log(`\n--- ARGUMENTATIONSWIEDERGABE ---\n`);
console.log(run.result!.argumentationswiedergabe);

if (run.result!.auffaelligkeiten.length > 0) {
	console.log(`\n--- AUFFÄLLIGKEITEN ---`);
	for (const a of run.result!.auffaelligkeiten) {
		console.log(`  ${a.scope}: ${a.observation}`);
	}
} else {
	console.log(`\n(Keine Auffälligkeiten gemeldet.)`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dumpPath = `docs/experiments/chapter-collapse-${L1_HEADING_ID.slice(0, 8)}-${stamp}.md`;
const dump = `# Chapter Collapse — L1=${L1_HEADING_ID}

- case: ${CASE_ID}
- aggregation_level: L${run.aggregationLevel}
- input_mode: ${run.inputMode}
- input_count: ${run.inputCount}
- model: ${run.model} (${run.provider})
- tokens: in=${t.input} cache_r=${t.cacheRead} cache_c=${t.cacheCreation} out=${t.output} total=${t.total}
- cost: ~$${cost.toFixed(4)}
- duration: ${dt}s
- memo_id: ${run.stored!.memoId}

## Synthese

${run.result!.synthese}

## Argumentationswiedergabe

${run.result!.argumentationswiedergabe}

## Auffälligkeiten

${run.result!.auffaelligkeiten.length === 0
	? '(keine)'
	: run.result!.auffaelligkeiten.map(a => `- **${a.scope}**: ${a.observation}`).join('\n')}
`;
await writeFile(dumpPath, dump, 'utf8');
console.log(`\ndump: ${dumpPath}`);

await pool.end();
