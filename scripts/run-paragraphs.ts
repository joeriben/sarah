// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Process a fixed set of paragraph IDs through the per-paragraph pass.
// Run from repo root:   npx tsx scripts/run-paragraphs.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

// Globalität §2..§5 (§1 was already done in the schema probe)
const PARAGRAPH_IDS = [
	'3e6aa3f3-7e32-4b0a-a573-1ed578f3f32b', // §2
	'30d9d218-9d4e-4839-97d2-e935ce83455e', // §3
	'e126d3f9-f257-4628-8eda-be5a366fe372', // §4
	'ef350dab-3ffb-48f7-9e42-d3455212eb6b', // §5
];

let total = 0;
for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
	const id = PARAGRAPH_IDS[i];
	process.stdout.write(`[${i + 1}/${PARAGRAPH_IDS.length}] `);
	const t0 = Date.now();
	const run = await runParagraphPass(CASE_ID, id, USER_ID);
	const dt = ((Date.now() - t0) / 1000).toFixed(1);
	const cost = (run.tokens.input * 3 + run.tokens.cacheCreation * 3.75 + run.tokens.cacheRead * 0.30 + run.tokens.output * 15) / 1_000_000;
	total += cost;
	const codes = run.result.codes.map(c => `"${c.phrase}"`).join(', ');
	console.log(`${dt}s   in=${run.tokens.input} out=${run.tokens.output}  ~$${cost.toFixed(4)}`);
	console.log(`   codes: ${codes || '(none)'}`);
}

console.log(`\nTotal ~$${total.toFixed(3)}`);
await pool.end();
