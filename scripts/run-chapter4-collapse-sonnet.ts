// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 2 + 3 for Chapter 4 with Sonnet as collapse model.
// Reads Mistral-basal AG data from DB (chapter4-basal-mistral.json), produces
// section-collapse memos per L3 + chapter-collapse for L1.
//
// This is the Budget-Route end-to-end probe: Mistral basal + Sonnet collapse.
//
// Run from repo root:  npx tsx scripts/run-chapter4-collapse-sonnet.ts

import { runGraphCollapse } from '../src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts';
import { runChapterCollapse } from '../src/lib/server/ai/hermeneutic/chapter-collapse.ts';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const DOC_ID = '54073d08-f577-453b-9a72-73a7654e1598';
const CHAPTER4_HEADING_ID = '62fed1d2-d3b0-4b74-abad-dde3fadaf86e';

const MODEL_OVERRIDE = { provider: 'mammouth' as const, model: 'claude-sonnet-4-6' };

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

interface Heading { id: string; numbering: string | null; text_preview: string; }

async function loadChapter4L3Headings(): Promise<Heading[]> {
	const ch4Start = (await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER4_HEADING_ID]
	))!.char_start;
	const r = await query<Heading>(
		`SELECT de.id,
		        de.properties->>'numbering' AS numbering,
		        SUBSTRING(dc.full_text FROM de.char_start+1 FOR 60) AS text_preview
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.document_id = $1 AND de.element_type = 'heading'
		   AND (de.properties->>'level')::int = 3
		   AND de.char_start > $2
		 ORDER BY de.char_start`,
		[DOC_ID, ch4Start]
	);
	return r.rows;
}

const tStart = Date.now();
mkdirSync('docs/experiments', { recursive: true });

console.log(`\n========= PHASE 2: SECTION-COLLAPSE Chapter 4 (Sonnet) =========`);
const subchapters = await loadChapter4L3Headings();
console.log(`Found ${subchapters.length} L3 subchapters in chapter 4.`);

const phase2Stats = { ok: 0, skipped: 0, failed: 0 };
const phase2Records: Array<{ heading_id: string; numbering: string | null; wall: number; tokens: { input: number; output: number; cacheRead: number; cacheCreation: number } | null; ok: boolean; error: string | null }> = [];

for (let i = 0; i < subchapters.length; i++) {
	const h = subchapters[i];
	const tag = `[${i + 1}/${subchapters.length}] ${h.numbering ?? '(no num)'} "${h.text_preview.replace(/\s+/g, ' ').trim().slice(0, 40)}…"`;
	const t0 = Date.now();
	try {
		const r = await withRetry(tag, () =>
			runGraphCollapse(CASE_ID, h.id, USER_ID, { modelOverride: MODEL_OVERRIDE })
		);
		const dt = (Date.now() - t0) / 1000;
		if (r.skipped) {
			console.log(`${tag}: SKIP (existing memo ${r.existingMemoId})`);
			phase2Stats.skipped++;
			phase2Records.push({ heading_id: h.id, numbering: h.numbering, wall: dt, tokens: null, ok: true, error: null });
		} else {
			console.log(`${tag}: ${dt.toFixed(1)}s  ¶=${r.paragraphsSynthesized} args=${r.totalArguments} scaff=${r.totalScaffolding}  in=${r.tokens!.input} cache_r=${r.tokens!.cacheRead} out=${r.tokens!.output}`);
			phase2Stats.ok++;
			phase2Records.push({ heading_id: h.id, numbering: h.numbering, wall: dt, tokens: r.tokens, ok: true, error: null });
		}
	} catch (err) {
		const dt = (Date.now() - t0) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`${tag}: FAILED (${dt.toFixed(1)}s) ${msg.slice(0, 120)}`);
		phase2Stats.failed++;
		phase2Records.push({ heading_id: h.id, numbering: h.numbering, wall: dt, tokens: null, ok: false, error: msg.slice(0, 300) });
	}
}

console.log(`\nPhase 2 done. ok=${phase2Stats.ok} skip=${phase2Stats.skipped} fail=${phase2Stats.failed}.`);

console.log(`\n========= PHASE 3: CHAPTER-COLLAPSE Chapter 4 (Sonnet) =========`);
const t3 = Date.now();
let chapterMemoDump: unknown = null;
try {
	const r = await withRetry('chapter-collapse', () =>
		runChapterCollapse(CASE_ID, CHAPTER4_HEADING_ID, USER_ID, { modelOverride: MODEL_OVERRIDE })
	);
	const dt = (Date.now() - t3) / 1000;
	if (r.skipped) {
		console.log(`Chapter-collapse: SKIP (existing memo ${r.existingMemoId})`);
	} else {
		const t = r.tokens!;
		console.log(`Chapter-collapse: ${dt.toFixed(1)}s  in=${t.input} cache_r=${t.cacheRead} out=${t.output}  level=${r.aggregationLevel}`);
		console.log(`\n--- SYNTHESE ---\n${r.result!.synthese}\n`);
		console.log(`--- ARGUMENTATIONSWIEDERGABE ---\n${r.result!.argumentationswiedergabe ?? '(none)'}\n`);
		console.log(`--- AUFFÄLLIGKEITEN (${r.result!.auffaelligkeiten.length}) ---`);
		for (const a of r.result!.auffaelligkeiten) console.log(`  ${a.scope}: ${a.observation}`);
		chapterMemoDump = {
			model: MODEL_OVERRIDE,
			result: r.result,
			tokens: t,
			aggregation_level: r.aggregationLevel,
			input_mode: r.inputMode,
			input_count: r.inputCount,
			wall: parseFloat(dt.toFixed(1))
		};
	}
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err);
	console.log(`Chapter-collapse: FAILED ${msg.slice(0, 200)}`);
}

const totalMin = ((Date.now() - tStart) / 60000).toFixed(1);
console.log(`\nTOTAL WALL: ${totalMin} min`);

const dump = {
	model: MODEL_OVERRIDE,
	chapter_heading_id: CHAPTER4_HEADING_ID,
	wall_minutes: parseFloat(totalMin),
	phase2: phase2Stats,
	phase2_records: phase2Records,
	phase3: chapterMemoDump,
};
const outPath = `docs/experiments/chapter4-collapse-sonnet.json`;
writeFileSync(outPath, JSON.stringify(dump, null, 2));
console.log(`→ ${outPath}`);

await pool.end();
