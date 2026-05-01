// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mistral-basal scalability probe on Chapter 4 (50 ¶, no Goldstand-conflict).
// Phase 1 only (synth + AG) with mistral-large-2512 via Mistral native API
// (EU-DSGVO direct, not Mammouth-proxy). Resume-friendly via the existing
// per-paragraph and AG idempotency guards.
//
// Cost target: ~$1.50, Wall ~10–25 min.
//
// Run from repo root:  npx tsx scripts/run-chapter4-basal-mistral.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const DOC_ID = '54073d08-f577-453b-9a72-73a7654e1598';
const CHAPTER4_HEADING_ID = '62fed1d2-d3b0-4b74-abad-dde3fadaf86e';

const MODEL_OVERRIDE = { provider: 'mistral' as const, model: 'mistral-large-2512' };

const RETRYABLE_STATUS = new Set([429, 502, 503, 504, 524, 408]);

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
	let lastErr: unknown;
	for (let i = 1; i <= attempts; i++) {
		try { return await fn(); }
		catch (err) {
			lastErr = err;
			const status = (err as { status?: number })?.status;
			const retryable = status !== undefined && RETRYABLE_STATUS.has(status);
			if (!retryable || i === attempts) throw err;
			const wait = 5000 * i ** 2;
			console.log(`  ↻ ${label}: ${status} on attempt ${i}/${attempts}, retry in ${wait/1000}s`);
			await new Promise(r => setTimeout(r, wait));
		}
	}
	throw lastErr;
}

interface Paragraph { id: string; char_start: number; }

async function loadChapter4Paragraphs(): Promise<Paragraph[]> {
	const ch4Start = (await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER4_HEADING_ID]
	))!.char_start;
	const r = await query<Paragraph>(
		`SELECT id, char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'paragraph'
		   AND char_start > $2
		 ORDER BY char_start`,
		[DOC_ID, ch4Start]
	);
	return r.rows;
}

async function paragraphHasSynthMemo(paragraphId: string): Promise<boolean> {
	const r = await queryOne<{ n: string }>(
		`SELECT COUNT(*)::text AS n FROM memo_content WHERE scope_element_id = $1 AND scope_level = 'paragraph'`,
		[paragraphId]
	);
	return parseInt(r?.n ?? '0', 10) > 0;
}

interface PerParagraphRecord {
	pid: string;
	idx: number;
	synth: { wall: number; in: number; out: number; cacheRead: number; ok: boolean; error: string | null };
	ag:    { wall: number; in: number; out: number; cacheRead: number; args: number; edges: number; scaff: number; ok: boolean; skipped: boolean; error: string | null };
}

const tStart = Date.now();
const records: PerParagraphRecord[] = [];

mkdirSync('docs/experiments', { recursive: true });

console.log(`\n========= MISTRAL-BASAL CHAPTER 4 (50 ¶) =========`);
console.log(`Provider: ${MODEL_OVERRIDE.provider}, Model: ${MODEL_OVERRIDE.model}`);

const paragraphs = await loadChapter4Paragraphs();
console.log(`Loaded ${paragraphs.length} paragraphs in chapter 4.`);

for (let i = 0; i < paragraphs.length; i++) {
	const pid = paragraphs[i].id;
	const tag = `[${i + 1}/${paragraphs.length}] ${pid.slice(0, 8)}…`;

	const rec: PerParagraphRecord = {
		pid, idx: i + 1,
		synth: { wall: 0, in: 0, out: 0, cacheRead: 0, ok: false, error: null },
		ag:    { wall: 0, in: 0, out: 0, cacheRead: 0, args: 0, edges: 0, scaff: 0, ok: false, skipped: false, error: null },
	};

	if (await paragraphHasSynthMemo(pid)) {
		console.log(`${tag} synth: SKIP (existing memo)`);
		rec.synth.ok = true;
	} else {
		const t0 = Date.now();
		try {
			const r = await withRetry(`${tag} synth`, () =>
				runParagraphPass(CASE_ID, pid, USER_ID, { modelOverride: MODEL_OVERRIDE })
			);
			const dt = (Date.now() - t0) / 1000;
			console.log(`${tag} synth: ${dt.toFixed(1)}s  in=${r.tokens.input} out=${r.tokens.output}  cache_r=${r.tokens.cacheRead}`);
			rec.synth = { wall: dt, in: r.tokens.input, out: r.tokens.output, cacheRead: r.tokens.cacheRead, ok: true, error: null };
		} catch (err) {
			const dt = (Date.now() - t0) / 1000;
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`${tag} synth: FAILED (${dt.toFixed(1)}s) ${msg.slice(0, 100)}`);
			rec.synth = { wall: dt, in: 0, out: 0, cacheRead: 0, ok: false, error: msg.slice(0, 300) };
		}
	}

	const t1 = Date.now();
	try {
		const r = await withRetry(`${tag} ag`, () =>
			runArgumentationGraphPass(CASE_ID, pid, { modelOverride: MODEL_OVERRIDE })
		);
		const dt = (Date.now() - t1) / 1000;
		if (r.skipped) {
			console.log(`${tag} ag:    SKIP (existing nodes)`);
			rec.ag = { wall: dt, in: 0, out: 0, cacheRead: 0, args: 0, edges: 0, scaff: 0, ok: true, skipped: true, error: null };
		} else {
			console.log(`${tag} ag:    ${dt.toFixed(1)}s  in=${r.tokens!.input} out=${r.tokens!.output}  args=${r.result!.arguments.length} edges=${r.result!.edges.length} scaff=${r.result!.scaffolding.length}`);
			rec.ag = {
				wall: dt, in: r.tokens!.input, out: r.tokens!.output, cacheRead: r.tokens!.cacheRead,
				args: r.result!.arguments.length, edges: r.result!.edges.length, scaff: r.result!.scaffolding.length,
				ok: true, skipped: false, error: null,
			};
		}
	} catch (err) {
		const dt = (Date.now() - t1) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`${tag} ag:    FAILED (${dt.toFixed(1)}s) ${msg.slice(0, 100)}`);
		rec.ag = { wall: dt, in: 0, out: 0, cacheRead: 0, args: 0, edges: 0, scaff: 0, ok: false, skipped: false, error: msg.slice(0, 300) };
	}

	records.push(rec);
}

const totalMin = ((Date.now() - tStart) / 60000).toFixed(1);
const synthOk = records.filter(r => r.synth.ok).length;
const agOk = records.filter(r => r.ag.ok && !r.ag.skipped).length;
const agSkip = records.filter(r => r.ag.skipped).length;
const agFail = records.filter(r => !r.ag.ok).length;
const totalIn = records.reduce((s, r) => s + r.synth.in + r.ag.in, 0);
const totalOut = records.reduce((s, r) => s + r.synth.out + r.ag.out, 0);
const totalCacheRead = records.reduce((s, r) => s + r.synth.cacheRead + r.ag.cacheRead, 0);

console.log(`\n========= SUMMARY =========`);
console.log(`Wall total: ${totalMin} min`);
console.log(`Synth: ${synthOk}/${records.length} ok`);
console.log(`AG:    ${agOk} ok / ${agSkip} skip / ${agFail} fail`);
console.log(`Tokens: in=${totalIn}, out=${totalOut}, cache_read=${totalCacheRead}`);

const dump = {
	model: MODEL_OVERRIDE,
	chapter_heading_id: CHAPTER4_HEADING_ID,
	wall_minutes: parseFloat(totalMin),
	stats: { synthOk, agOk, agSkip, agFail, total: records.length },
	tokens: { in: totalIn, out: totalOut, cacheRead: totalCacheRead },
	paragraphs: records,
};
const outPath = `docs/experiments/chapter4-basal-mistral.json`;
writeFileSync(outPath, JSON.stringify(dump, null, 2));
console.log(`→ ${outPath}`);

await pool.end();
