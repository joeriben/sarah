// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Probe: validates the simplified per-paragraph schema (single interpretierend
// memo + 0-2 Kernthesen-Codes) on the first paragraph of "Globalität" — a
// pristine subchapter with no prior memos.

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const PARAGRAPH_ID = '693f4a08-df4c-4f83-8add-e2a1d220d3a5'; // Globalität §1

const t0 = Date.now();
const run = await runParagraphPass(CASE_ID, PARAGRAPH_ID, USER_ID);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`${dt}s   provider=${run.provider} model=${run.model}`);
console.log(`tokens: in=${run.tokens.input} out=${run.tokens.output} cache-r=${run.tokens.cacheRead} cache-c=${run.tokens.cacheCreation}`);
console.log(`\n--- interpretierend ---\n${run.result.interpretierend}`);
console.log(`\n--- codes (${run.result.codes.length}) ---`);
for (const c of run.result.codes) {
	const wordCount = c.phrase.trim().split(/\s+/).length;
	console.log(`  • "${c.phrase}" (${wordCount} Wörter)`);
	console.log(`    ${c.rationale}`);
}
console.log(`\nstored: interpretierend=${run.stored.interpretierendMemoId}`);
console.log(`codes anchored: ${run.stored.codeIds.length - run.stored.unanchoredCodes.length}/${run.stored.codeIds.length}`);
if (run.stored.unanchoredCodes.length) {
	console.log(`UNANCHORED: ${run.stored.unanchoredCodes.join(' | ')}`);
}

await pool.end();
