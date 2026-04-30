// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// One-shot dev driver for the per-paragraph hermeneutic pass.
// Runs N paragraphs sequentially and prints per-call cache stats.
// First call is expected to write the cache; subsequent calls within the
// 5-min Anthropic ephemeral TTL should show cache_read > 0 on the shared
// prefix (persona, criteria, work header, completed sections).
//
// Run from repo root:   npx tsx scripts/test-paragraph-pass.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

// Paragraphs in "Kultur und Kulturalität" (Subkapitel), in document order.
// First paragraph already has memos from an earlier (pre-cache-wiring) run.
const PARAGRAPHS = [
	{ id: '43132b82-f964-4ff2-ae32-6d704f916558', label: '§2 (DGfE-Kongress 2008)' },
	{ id: '1d33cfd2-2379-4334-95ee-8d8687535d31', label: '§3 (Kulturelle Bildung Förderpolitik)' },
];

function fmt(n: number) { return n.toString().padStart(6, ' '); }

for (let i = 0; i < PARAGRAPHS.length; i++) {
	const p = PARAGRAPHS[i];
	console.log(`\n[Call ${i + 1}/${PARAGRAPHS.length}] ${p.label} (id=${p.id})`);
	const t0 = Date.now();
	const run = await runParagraphPass(CASE_ID, p.id, USER_ID);
	const dt = ((Date.now() - t0) / 1000).toFixed(1);

	const promptTotal = run.tokens.input + run.tokens.cacheCreation + run.tokens.cacheRead;
	const cacheRatio = promptTotal > 0
		? ((run.tokens.cacheRead / promptTotal) * 100).toFixed(1) + '%'
		: 'n/a';

	console.log(`  ${dt}s   provider=${run.provider} model=${run.model}`);
	console.log(`  tokens: fresh-in=${fmt(run.tokens.input)}  cache-create=${fmt(run.tokens.cacheCreation)}  cache-read=${fmt(run.tokens.cacheRead)}  out=${fmt(run.tokens.output)}`);
	console.log(`  cache-read ratio of input: ${cacheRatio}`);
	console.log(`  codes: ${run.result.codes.length}, anchored: ${run.stored.codeIds.length - run.stored.unanchoredCodes.length}`);
	if (run.stored.unanchoredCodes.length) {
		console.log(`  ⚠ unanchored: ${run.stored.unanchoredCodes.join(', ')}`);
	}
	console.log(`  formulierend: ${run.result.formulierend.slice(0, 140)}…`);
	console.log(`  interpretierend: ${run.result.interpretierend.slice(0, 140)}…`);
}

await pool.end();
