// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// End-to-end test: run per-paragraph pass on every paragraph in a subchapter
// that doesn't yet have a (formulierend, interpretierend) memo pair, then
// collapse the subchapter into its kontextualisierende memo.
//
// Run from repo root:   npx tsx scripts/test-subchapter-flow.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runSubchapterCollapse } from '../src/lib/server/ai/hermeneutic/section-collapse.ts';
import { pool, query } from '../src/lib/server/db/index.ts';

const CASE_ID = '0abe0588-badb-4e72-b3c4-1edd4a376cb6';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
// "Kultur und Kulturalität" heading
const SUBCHAPTER_HEADING_ID = '021c6c01-a982-4670-9456-6f1c2c5bc34a';

function fmt(n: number) { return n.toString().padStart(6, ' '); }

// ── Phase 1: run per-paragraph pass on any paragraph still missing memos ──

const docId = (await query<{ central_document_id: string }>(
	`SELECT central_document_id FROM cases WHERE id=$1`, [CASE_ID]
)).rows[0].central_document_id;

const heading = (await query<{ char_start: number }>(
	`SELECT char_start FROM document_elements WHERE id=$1`, [SUBCHAPTER_HEADING_ID]
)).rows[0];

const nextHeading = (await query<{ char_start: number }>(
	`SELECT char_start FROM document_elements
	 WHERE document_id=$1 AND element_type='heading' AND section_kind='main' AND char_start > $2
	 ORDER BY char_start LIMIT 1`,
	[docId, heading.char_start]
)).rows[0];

const subEnd = nextHeading?.char_start ?? Number.MAX_SAFE_INTEGER;

const paragraphs = (await query<{ id: string; pos: string; has_memos: boolean }>(
	`SELECT
	   de.id,
	   ROW_NUMBER() OVER (ORDER BY de.char_start) AS pos,
	   COUNT(DISTINCT mc.memo_type) FILTER (
	     WHERE mc.memo_type IN ('formulierend','interpretierend') AND mc.scope_level='paragraph'
	   ) >= 2 AS has_memos
	 FROM document_elements de
	 LEFT JOIN memo_content mc ON mc.scope_element_id = de.id
	 WHERE de.document_id=$1 AND de.element_type='paragraph' AND de.section_kind='main'
	   AND de.char_start >= $2 AND de.char_start < $3
	 GROUP BY de.id, de.char_start
	 ORDER BY de.char_start`,
	[docId, heading.char_start, subEnd]
)).rows;

const todo = paragraphs.filter(p => !p.has_memos);
console.log(`Subchapter has ${paragraphs.length} paragraphs; ${todo.length} need per-paragraph pass.\n`);

let totalCost = 0; // rough Mammouth Sonnet 4.6 estimate
function estimateCost(input: number, cacheR: number, cacheC: number, output: number) {
	// Sonnet 4.6 rough listprice: $3/MT in, $15/MT out, $0.30 cache-read, $3.75 cache-write
	return (input * 3 + cacheC * 3.75 + cacheR * 0.30 + output * 15) / 1_000_000;
}

for (let i = 0; i < todo.length; i++) {
	const p = todo[i];
	const pos = parseInt(p.pos, 10);
	process.stdout.write(`[para ${pos}/${paragraphs.length}] `);
	const t0 = Date.now();
	try {
		const run = await runParagraphPass(CASE_ID, p.id, USER_ID);
		const dt = ((Date.now() - t0) / 1000).toFixed(1);
		const c = estimateCost(run.tokens.input, run.tokens.cacheRead, run.tokens.cacheCreation, run.tokens.output);
		totalCost += c;
		console.log(
			`${dt}s   in=${fmt(run.tokens.input)}  cache-r=${fmt(run.tokens.cacheRead)}  cache-c=${fmt(run.tokens.cacheCreation)}  out=${fmt(run.tokens.output)}  ~$${c.toFixed(4)}  codes=${run.result.codes.length}`
		);
	} catch (e) {
		console.error(`FAILED:`, (e as Error).message);
		break;
	}
}

console.log(`\nPer-paragraph phase done. Estimated cost: ~$${totalCost.toFixed(3)}\n`);

// ── Phase 2: subchapter collapse ──

console.log(`Running subchapter collapse on heading ${SUBCHAPTER_HEADING_ID} ...`);
const t0 = Date.now();
const collapse = await runSubchapterCollapse(CASE_ID, SUBCHAPTER_HEADING_ID, USER_ID);
const dt = ((Date.now() - t0) / 1000).toFixed(1);
const cc = estimateCost(collapse.tokens.input, collapse.tokens.cacheRead, collapse.tokens.cacheCreation, collapse.tokens.output);
totalCost += cc;

console.log(`\n=== COLLAPSE RESULT ===`);
console.log(`${dt}s   provider=${collapse.provider} model=${collapse.model}`);
console.log(`tokens: in=${collapse.tokens.input}  cache-r=${collapse.tokens.cacheRead}  cache-c=${collapse.tokens.cacheCreation}  out=${collapse.tokens.output}  ~$${cc.toFixed(4)}`);
console.log(`paragraphs synthesized: ${collapse.paragraphsSynthesized}`);
console.log(`memo id: ${collapse.stored.memoId}`);
console.log('\n--- kontextualisierend ---');
console.log(collapse.result.kontextualisierend);

console.log(`\n=== TOTAL ~$${totalCost.toFixed(3)} ===`);
await pool.end();
