// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end orchestrator for Chapter 1 of doc 54073d08 with Opus as gold-
// standard model (set via ai-settings.json — no per-call override).
//
// Three phases:
//   1. Basal pipeline (synth + AG) for all 74 ¶ in document order. Within-
//      subchapter forward order is preserved naturally. Skips ¶s where the
//      pass output already exists (resume-friendly after partial failures).
//   2. Section-collapse for each L3 subchapter (algorithm in
//      heading-hierarchy.ts → chooseSubchapterLevel; we just iterate).
//   3. Chapter-collapse for L1 chapter 1.
//
// Idempotency:
//   - synth pass: appends a new memo each call → SKIP if existing memo on ¶
//   - AG pass: built-in skip if existing argument_nodes
//   - section-collapse: built-in skip if existing memo for subchapter
//   - chapter-collapse: built-in skip if existing memo for chapter
//
// Cost estimate (Opus 4.7 via OpenRouter, $5/M in, $25/M out):
//   - Phase 1: 74 × ~$0.17 = ~$12.6
//   - Phase 2: ~7 sections × ~$0.30 = ~$2
//   - Phase 3: 1 × ~$0.50
//   - Total: ~$15
//
// Run from repo root:   npx tsx scripts/run-chapter1-pipeline.ts

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { runGraphCollapse } from '../src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts';
import { runChapterCollapse } from '../src/lib/server/ai/hermeneutic/chapter-collapse.ts';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const DOC_ID = '54073d08-f577-453b-9a72-73a7654e1598';
const CHAPTER1_HEADING_ID = '9c3e2dac-a9bb-4cb5-8a6d-19a87c086341';
const CHAPTER2_HEADING_ID = '6f025aa0-e394-4f2c-9e59-bdfee8e6a09b';

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
interface Heading { id: string; numbering: string; text_preview: string; }

async function loadChapter1Paragraphs(): Promise<Paragraph[]> {
	const ch1Start = (await queryOne<{ char_start: number }>(`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER1_HEADING_ID]))!.char_start;
	const ch2Start = (await queryOne<{ char_start: number }>(`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER2_HEADING_ID]))!.char_start;
	const r = await query<Paragraph>(
		`SELECT id, char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'paragraph'
		   AND char_start > $2 AND char_start < $3
		 ORDER BY char_start`,
		[DOC_ID, ch1Start, ch2Start]
	);
	return r.rows;
}

async function loadChapter1L3Headings(): Promise<Heading[]> {
	const ch1Start = (await queryOne<{ char_start: number }>(`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER1_HEADING_ID]))!.char_start;
	const ch2Start = (await queryOne<{ char_start: number }>(`SELECT char_start FROM document_elements WHERE id = $1`, [CHAPTER2_HEADING_ID]))!.char_start;
	const r = await query<{ id: string; numbering: string; text_preview: string }>(
		`SELECT de.id,
		        de.properties->>'numbering' AS numbering,
		        SUBSTRING(dc.full_text FROM de.char_start+1 FOR 60) AS text_preview
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.document_id = $1 AND de.element_type = 'heading'
		   AND (de.properties->>'level')::int = 3
		   AND de.char_start > $2 AND de.char_start < $3
		 ORDER BY de.char_start`,
		[DOC_ID, ch1Start, ch2Start]
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

const tStart = Date.now();
const phase1Stats = { ok: 0, skipped: 0, failed: 0 };
const phase2Stats = { ok: 0, skipped: 0, failed: 0 };

mkdirSync('docs/experiments', { recursive: true });

// ── Phase 1: basal (synth + AG) for all 74 ¶ ──────────────────────────────
console.log(`\n========= PHASE 1: BASAL =========`);
const paragraphs = await loadChapter1Paragraphs();
console.log(`Loaded ${paragraphs.length} paragraphs in chapter 1.`);

for (let i = 0; i < paragraphs.length; i++) {
	const pid = paragraphs[i].id;
	const tag = `[${i + 1}/${paragraphs.length}] ${pid.slice(0, 8)}…`;

	if (await paragraphHasSynthMemo(pid)) {
		console.log(`${tag} synth: SKIP (existing memo)`);
		phase1Stats.skipped++;
	} else {
		const t0 = Date.now();
		try {
			const r = await withRetry(`${tag} synth`, () => runParagraphPass(CASE_ID, pid, USER_ID));
			const dt = ((Date.now() - t0) / 1000).toFixed(1);
			console.log(`${tag} synth: ${dt}s  in=${r.tokens.input} out=${r.tokens.output}  cache_r=${r.tokens.cacheRead}`);
			phase1Stats.ok++;
		} catch (err) {
			console.log(`${tag} synth: FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`);
			phase1Stats.failed++;
		}
	}

	const t1 = Date.now();
	try {
		const r = await withRetry(`${tag} ag`, () => runArgumentationGraphPass(CASE_ID, pid));
		const dt = ((Date.now() - t1) / 1000).toFixed(1);
		if (r.skipped) {
			console.log(`${tag} ag:    SKIP (existing nodes)`);
		} else {
			console.log(`${tag} ag:    ${dt}s  in=${r.tokens!.input} out=${r.tokens!.output}  args=${r.result!.arguments.length} scaff=${r.result!.scaffolding.length}`);
		}
	} catch (err) {
		console.log(`${tag} ag:    FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`);
	}
}

console.log(`\nPhase 1 done. ok=${phase1Stats.ok} skip=${phase1Stats.skipped} fail=${phase1Stats.failed}.`);

// ── Phase 2: section-collapse for each L3 subchapter ──────────────────────
console.log(`\n========= PHASE 2: SECTION-COLLAPSE =========`);
const subchapters = await loadChapter1L3Headings();
console.log(`Found ${subchapters.length} L3 subchapters in chapter 1.`);

for (let i = 0; i < subchapters.length; i++) {
	const h = subchapters[i];
	const tag = `[${i + 1}/${subchapters.length}] ${h.numbering} "${h.text_preview.replace(/\s+/g, ' ').trim().slice(0, 40)}…"`;
	const t0 = Date.now();
	try {
		const r = await withRetry(tag, () => runGraphCollapse(CASE_ID, h.id, USER_ID));
		const dt = ((Date.now() - t0) / 1000).toFixed(1);
		if (r.skipped) {
			console.log(`${tag}: SKIP (existing memo ${r.existingMemoId})`);
			phase2Stats.skipped++;
		} else {
			console.log(`${tag}: ${dt}s  ¶=${r.paragraphsSynthesized} args=${r.totalArguments} scaff=${r.totalScaffolding}  in=${r.tokens!.input} out=${r.tokens!.output}`);
			phase2Stats.ok++;
		}
	} catch (err) {
		console.log(`${tag}: FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`);
		phase2Stats.failed++;
	}
}

console.log(`\nPhase 2 done. ok=${phase2Stats.ok} skip=${phase2Stats.skipped} fail=${phase2Stats.failed}.`);

// ── Phase 3: chapter-collapse ────────────────────────────────────────────
console.log(`\n========= PHASE 3: CHAPTER-COLLAPSE =========`);
const t3 = Date.now();
let chapterMemoDump: unknown = null;
try {
	const r = await withRetry('chapter-collapse', () => runChapterCollapse(CASE_ID, CHAPTER1_HEADING_ID, USER_ID));
	const dt = ((Date.now() - t3) / 1000).toFixed(1);
	if (r.skipped) {
		console.log(`Chapter-collapse: SKIP (existing memo ${r.existingMemoId})`);
	} else {
		console.log(`Chapter-collapse: ${dt}s  in=${r.tokens!.input} out=${r.tokens!.output}  level=${r.aggregationLevel}`);
		console.log(`\n--- SYNTHESE ---\n${r.result!.synthese}\n`);
		console.log(`--- ARGUMENTATIONSWIEDERGABE ---\n${r.result!.argumentationswiedergabe ?? '(none)'}\n`);
		console.log(`--- AUFFÄLLIGKEITEN (${r.result!.auffaelligkeiten.length}) ---`);
		for (const a of r.result!.auffaelligkeiten) console.log(`  ${a.scope}: ${a.observation}`);
		chapterMemoDump = { result: r.result, tokens: r.tokens, aggregation_level: r.aggregationLevel, wall: parseFloat(dt) };
	}
} catch (err) {
	console.log(`Chapter-collapse: FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
}

if (chapterMemoDump) {
	const outPath = `docs/experiments/chapter1-opus-collapse.json`;
	writeFileSync(outPath, JSON.stringify(chapterMemoDump, null, 2));
	console.log(`\n→ ${outPath}`);
}

const totalMin = ((Date.now() - tStart) / 60000).toFixed(1);
console.log(`\nTOTAL WALL: ${totalMin} min`);
await pool.end();
