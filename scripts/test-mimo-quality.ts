// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Qualitative content-quality probe for xiaomi/mimo-v2.5-pro across the four
// load-bearing pipeline calls. Goal is NOT JSON-pass/fail, but: does mimo
// produce content that holds up against Sonnet/Opus/Mistral on actual
// academic German prose? Anything that can be JSON-packed in a separate call
// later is fine.
//
// Battery (all on existing benchmark cases, with cleanup):
//   1. Per-paragraph synthese on §1-§5 of 1.1.1 (Habil Timm aa23d66e).
//      Baselines: opus-4.7, sonnet-4-6, ds4 in docs/experiments/.
//   2. Argumentation-graph on the same §1-§5. Prose-parser is permissive.
//   3. Chapter-1 collapse (L1=9c3e2dac). Baselines: opus, deepseek-v4-pro.
//   4. H3 EXPOSITION on BA H3 dev (c42e2d8f). Direct chat() — no DB write,
//      because runExpositionPass has no modelOverride parameter (we don't
//      add one just for a probe; we replay the prompts inline).
//
// Raw text recovery: per-paragraph and chapter-collapse dump raw responses
// to /tmp/*-failure-*.txt on parse failure. The runner reads those back in
// so the produced text is captured even when the structured pipeline rejects.
//
// Output: docs/experiments/mimo-quality-<task>.json with raw + parsed where
// available. Side-by-side rendering is a follow-up step.
//
// Run from repo root:   npx tsx scripts/test-mimo-quality.ts

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { runArgumentationGraphPass } from '../src/lib/server/ai/hermeneutic/argumentation-graph.ts';
import { runChapterCollapse } from '../src/lib/server/ai/hermeneutic/chapter-collapse.ts';
import { chat } from '../src/lib/server/ai/client.ts';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';
import type { Provider } from '../src/lib/server/ai/client.ts';

// ── Test target ───────────────────────────────────────────────────

const MIMO = { provider: 'openrouter' as Provider, model: 'xiaomi/mimo-v2.5-pro' };
const MIMO_KEY = 'mimo-v2.5-pro';

// Habil Timm benchmark
const HABIL_CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const HABIL_USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';
const HABIL_DOC_ID  = '54073d08-f577-453b-9a72-73a7654e1598';

// 1.1.1 paragraphs (forward order — synth chain depends on prior memos)
const PARAGRAPH_IDS_111 = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	'72919e94-79bb-4a0e-b507-e78aacc1fd5b', // §5
];

// Chapter 1 L1 (74 ¶, 7 L3) — Opus baseline at chapter1-opus-collapse.json
const CHAPTER1_L1_HEADING_ID = '9c3e2dac-a9bb-4cb5-8a6d-19a87c086341';

// BA H3 dev — has EXPOSITION classified
const BA_H3_DEV_CASE_ID  = 'c42e2d8f-1771-43bb-97c8-f57d7d10530a';
const BA_H3_DEV_DOC_ID   = 'd1993e8a-f25b-479c-9526-d527215969c6';
const BA_EXPOSITION_HEAD = '081aafdc-6c70-4558-8b5c-e5f4f8f5fb23';

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

// ── Retry on transient upstream errors (CF 524, gateway, rate-limit) ─

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

// ── Cleanup helpers ───────────────────────────────────────────────

async function cleanupParagraphs(ids: string[]) {
	await query(`DELETE FROM scaffolding_elements WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(`DELETE FROM argument_nodes WHERE paragraph_element_id = ANY($1::uuid[])`, [ids]);
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT naming_id FROM memo_content
		    WHERE scope_element_id = ANY($1::uuid[]) AND scope_level = 'paragraph')`,
		[ids]
	);
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT DISTINCT code_naming_id FROM code_anchors WHERE element_id = ANY($1::uuid[]))`,
		[ids]
	);
}

async function deleteChapterMemo(l1HeadingId: string) {
	await query(
		`DELETE FROM namings WHERE id IN (
		   SELECT n.id FROM namings n
		   JOIN memo_content mc ON mc.naming_id = n.id
		   WHERE n.inscription LIKE '[kontextualisierend/chapter/graph]%'
		     AND mc.scope_element_id = $1
		     AND mc.scope_level = 'chapter')`,
		[l1HeadingId]
	);
}

function readDumpIfExists(path: string): string | null {
	try {
		if (!existsSync(path)) return null;
		return readFileSync(path, 'utf8');
	} catch { return null; }
}

// ── Phase 1: per-paragraph synthese §1-§5 ─────────────────────────

interface SynthRecord {
	idx: number;
	pid: string;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	model: string | null;
	parsed: unknown | null;
	raw_text: string | null;
	error: string | null;
}

async function runSyntheseBattery(): Promise<SynthRecord[]> {
	console.log(`\n========== [1/4] Per-paragraph synthese §1-§5 of 1.1.1 ==========`);
	await cleanupParagraphs(PARAGRAPH_IDS_111);
	const records: SynthRecord[] = [];

	for (let i = 0; i < PARAGRAPH_IDS_111.length; i++) {
		const pid = PARAGRAPH_IDS_111[i];
		const tag = `§${i + 1}`;
		const t0 = Date.now();
		const dumpPath = `/tmp/per-paragraph-failure-${pid}.txt`;
		// Pre-clear dump so we can detect a fresh one
		try { if (existsSync(dumpPath)) await (await import('node:fs/promises')).unlink(dumpPath); } catch {}

		try {
			const r = await withRetry(`synth ${tag}`, () =>
				runParagraphPass(HABIL_CASE_ID, pid, HABIL_USER_ID, { modelOverride: MIMO })
			);
			const dt = (Date.now() - t0) / 1000;
			const codeLabels = r.result.codes.map(c => `"${c.label}"`).join(', ') || '(none)';
			console.log(`  ${tag}: ${dt.toFixed(1)}s in=${r.tokens.input} out=${r.tokens.output} codes: ${codeLabels}`);
			records.push({
				idx: i + 1, pid,
				wall_seconds: dt,
				tokens: r.tokens, model: r.model,
				parsed: r.result, raw_text: null, error: null,
			});
		} catch (err) {
			const dt = (Date.now() - t0) / 1000;
			const msg = err instanceof Error ? err.message : String(err);
			const raw = readDumpIfExists(dumpPath);
			console.log(`  ${tag}: PARSE-FAIL ${dt.toFixed(1)}s — raw_dumped=${raw ? 'yes' : 'no'}`);
			records.push({
				idx: i + 1, pid,
				wall_seconds: dt,
				tokens: null, model: null,
				parsed: null, raw_text: raw, error: msg.slice(0, 500),
			});
		}
	}

	await cleanupParagraphs(PARAGRAPH_IDS_111);
	const outPath = `${OUT_DIR}/mimo-quality-synthese.json`;
	writeFileSync(outPath, JSON.stringify({ model: MIMO, records }, null, 2));
	console.log(`  → ${outPath}`);
	return records;
}

// ── Phase 2: argumentation-graph §1-§5 ────────────────────────────

interface AGRecord {
	idx: number;
	pid: string;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	model: string | null;
	parsed: unknown | null;
	raw_text: string | null;
	error: string | null;
}

async function runAGBattery(): Promise<AGRecord[]> {
	console.log(`\n========== [2/4] Argumentation-graph §1-§5 of 1.1.1 ==========`);
	// Note: AG depends on per-paragraph synth being absent or present; runAGPass
	// itself doesn't read prior synth memos, but it reads PRIOR-paragraph args.
	// Since we just ran synth and cleaned up, AG runs cold here too.
	await cleanupParagraphs(PARAGRAPH_IDS_111);
	const records: AGRecord[] = [];

	for (let i = 0; i < PARAGRAPH_IDS_111.length; i++) {
		const pid = PARAGRAPH_IDS_111[i];
		const tag = `§${i + 1}`;
		const t0 = Date.now();
		const dumpPath = `/tmp/argumentation-graph-failure-${pid}.txt`;
		try { if (existsSync(dumpPath)) await (await import('node:fs/promises')).unlink(dumpPath); } catch {}

		try {
			const r = await withRetry(`ag ${tag}`, () =>
				runArgumentationGraphPass(HABIL_CASE_ID, pid, { modelOverride: MIMO })
			);
			const dt = (Date.now() - t0) / 1000;
			if (r.skipped) {
				console.log(`  ${tag}: SKIP (existing nodes — race?)`);
				records.push({ idx: i + 1, pid, wall_seconds: dt, tokens: null, model: null, parsed: null, raw_text: null, error: 'skipped' });
				continue;
			}
			console.log(`  ${tag}: ${dt.toFixed(1)}s in=${r.tokens!.input} out=${r.tokens!.output} args=${r.result!.arguments.length}/edges=${r.result!.edges.length}/scaff=${r.result!.scaffolding.length}`);
			records.push({
				idx: i + 1, pid,
				wall_seconds: dt,
				tokens: r.tokens, model: r.model,
				parsed: r.result, raw_text: null, error: null,
			});
		} catch (err) {
			const dt = (Date.now() - t0) / 1000;
			const msg = err instanceof Error ? err.message : String(err);
			const raw = readDumpIfExists(dumpPath);
			console.log(`  ${tag}: PARSE-FAIL ${dt.toFixed(1)}s — raw_dumped=${raw ? 'yes' : 'no'}`);
			records.push({
				idx: i + 1, pid,
				wall_seconds: dt,
				tokens: null, model: null,
				parsed: null, raw_text: raw, error: msg.slice(0, 500),
			});
		}
	}

	await cleanupParagraphs(PARAGRAPH_IDS_111);
	const outPath = `${OUT_DIR}/mimo-quality-ag.json`;
	writeFileSync(outPath, JSON.stringify({ model: MIMO, records }, null, 2));
	console.log(`  → ${outPath}`);
	return records;
}

// ── Phase 3: chapter-1 collapse ───────────────────────────────────

interface ChapterRecord {
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	model: string | null;
	aggregation_level: 1 | 2 | 3 | null;
	input_mode: 'paragraphs' | 'subchapter-memos' | null;
	input_count: number | null;
	parsed: unknown | null;
	raw_text: string | null;
	error: string | null;
}

async function runChapter1Collapse(): Promise<ChapterRecord> {
	console.log(`\n========== [3/4] Chapter-1 collapse ==========`);
	await deleteChapterMemo(CHAPTER1_L1_HEADING_ID);
	const dumpPath = `/tmp/chapter-collapse-failure-${CHAPTER1_L1_HEADING_ID}.txt`;
	try { if (existsSync(dumpPath)) await (await import('node:fs/promises')).unlink(dumpPath); } catch {}

	const t0 = Date.now();
	let record: ChapterRecord;
	try {
		const r = await withRetry('chapter-collapse', () =>
			runChapterCollapse(HABIL_CASE_ID, CHAPTER1_L1_HEADING_ID, HABIL_USER_ID, { modelOverride: MIMO })
		);
		const dt = (Date.now() - t0) / 1000;
		if (r.skipped) {
			console.log(`  SKIPPED (existing memo despite delete): ${r.existingMemoId}`);
			record = {
				wall_seconds: dt, tokens: null, model: null,
				aggregation_level: null, input_mode: null, input_count: null,
				parsed: null, raw_text: null, error: 'skipped — existing memo not deleted',
			};
		} else {
			console.log(`  ${dt.toFixed(1)}s in=${r.tokens!.input} out=${r.tokens!.output} L${r.aggregationLevel} mode=${r.inputMode} units=${r.inputCount}`);
			console.log(`  synthese=${(r.result!.synthese as string).length}c argum.=${(r.result!.argumentationswiedergabe as string).length}c auff=${(r.result!.auffaelligkeiten as unknown[]).length}`);
			record = {
				wall_seconds: dt, tokens: r.tokens, model: r.model,
				aggregation_level: r.aggregationLevel, input_mode: r.inputMode, input_count: r.inputCount,
				parsed: r.result, raw_text: null, error: null,
			};
		}
	} catch (err) {
		const dt = (Date.now() - t0) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		const raw = readDumpIfExists(dumpPath);
		console.log(`  PARSE-FAIL ${dt.toFixed(1)}s — raw_dumped=${raw ? 'yes' : 'no'}`);
		record = {
			wall_seconds: dt, tokens: null, model: null,
			aggregation_level: null, input_mode: null, input_count: null,
			parsed: null, raw_text: raw, error: msg.slice(0, 800),
		};
	}

	await deleteChapterMemo(CHAPTER1_L1_HEADING_ID);
	const outPath = `${OUT_DIR}/mimo-quality-chapter-collapse.json`;
	writeFileSync(outPath, JSON.stringify({ model: MIMO, l1_heading_id: CHAPTER1_L1_HEADING_ID, ...record }, null, 2));
	console.log(`  → ${outPath}`);
	return record;
}

// ── Phase 4: H3 EXPOSITION direct chat call ───────────────────────
//
// Replays the three EXPOSITION prompts (Rekonstruktion, Beurteilung,
// Motivation) as direct chat() calls — no DB writes, no monkey-patching.
// Uses the parser-fallback shape: feeds the WHOLE EXPOSITION container as a
// numbered list and asks for found+frage+motivation in one call. This is
// the fallback path (`llmFallbackVollerContainer`) — chosen because it
// gives mimo a single coherent task to answer, instead of three round-trips
// over the same material.

interface ExpositionParagraph {
	paragraphId: string;
	text: string;
	indexInContainer: number;
}

async function loadExpositionParagraphs(documentId: string, expositionHeadingId: string): Promise<{ container_label: string; paragraphs: ExpositionParagraph[] }> {
	const heading = await queryOne<{ heading_text: string; char_start: number; char_end: number }>(
		`SELECT SUBSTRING(dc.full_text FROM de.char_start + 1 FOR de.char_end - de.char_start) AS heading_text,
		        de.char_start, de.char_end
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.id = $1`,
		[expositionHeadingId]
	);
	if (!heading) throw new Error(`Heading not found: ${expositionHeadingId}`);

	// Find the next sibling heading (or end of doc) to bound the container
	const nextHeading = await queryOne<{ char_start: number }>(
		`SELECT char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'heading' AND section_kind = 'main'
		   AND char_start > $2
		 ORDER BY char_start LIMIT 1`,
		[documentId, heading.char_end]
	);
	const upperBound = nextHeading?.char_start
		?? (await queryOne<{ end: number }>(`SELECT length(full_text) AS end FROM document_content WHERE naming_id = $1`, [documentId]))!.end;

	const rows = (await query<{ paragraph_id: string; text: string }>(
		`SELECT p.id AS paragraph_id,
		        SUBSTRING(dc.full_text FROM p.char_start + 1 FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		   AND p.char_start > $2 AND p.char_start < $3
		 ORDER BY p.char_start`,
		[documentId, heading.char_end, upperBound]
	)).rows;

	return {
		container_label: heading.heading_text.trim(),
		paragraphs: rows.map((r, i) => ({ paragraphId: r.paragraph_id, text: r.text.trim(), indexInContainer: i })),
	};
}

interface ExpositionRecord {
	wall_seconds: number;
	tokens: { input: number; output: number } | null;
	model: string | null;
	provider: string | null;
	raw_text: string | null;
	parsed_json: unknown | null;
	parse_ok: boolean;
	error: string | null;
}

async function runExpositionDirect(): Promise<ExpositionRecord> {
	console.log(`\n========== [4/4] H3 EXPOSITION (BA H3 dev, direct chat) ==========`);
	const { container_label, paragraphs } = await loadExpositionParagraphs(BA_H3_DEV_DOC_ID, BA_EXPOSITION_HEAD);
	console.log(`  Container "${container_label}": ${paragraphs.length} ¶`);

	// Reproduce the production `llmFallbackVollerContainer` prompt verbatim
	// (lifted from src/lib/server/ai/h3/exposition.ts:357-385). User said
	// "no slop in prompts" — keep this byte-identical to production.
	const system = [
		'Du bist ein analytisches Werkzeug. Eine deterministische Vorprüfung hat im Einleitungs-Container kein Frage-Marker-Muster gefunden; jetzt sollst du den ganzen Container prüfen.',
		'',
		'Aufgaben:',
		'  1. Identifiziere, in welchen Absätzen die FORSCHUNGSFRAGESTELLUNG steckt (Indizes der nummerierten Liste).',
		'  2. Rekonstruiere die Frage als kompakte, lesbare Frage (Frage trennen von Methodenrahmen).',
		'  3. Identifiziere die MOTIVATIONS-Absätze (Begründungen, was die Frage motiviert) — typischerweise davor.',
		'  4. Fasse die Motivation in 1–3 Sätzen zusammen.',
		'',
		'Wenn keine Forschungsfrage identifizierbar ist, antworte mit found=false und alle anderen Felder null.',
		'',
		'JSON-Schema:',
		'{',
		'  "found": true | false,',
		'  "fragestellung": "<rekonstruierte Frage>" | null,',
		'  "fragestellung_paragraph_indices": [<int>, ...] | null,',
		'  "motivation": "<1–3 Sätze>" | null,',
		'  "motivation_paragraph_indices": [<int>, ...] | null',
		'}',
	].join('\n');

	const userMessage = [
		`Container (Heading): ${container_label}`,
		'',
		'Nummerierte Absatzliste:',
		...paragraphs.map((p, i) => `[${i}] ${p.text}`),
	].join('\n\n');

	const t0 = Date.now();
	let record: ExpositionRecord;
	try {
		const r = await withRetry('exposition', () =>
			chat({
				system,
				messages: [{ role: 'user', content: userMessage }],
				maxTokens: 1500,
				responseFormat: 'json',
				modelOverride: MIMO,
				documentIds: [BA_H3_DEV_DOC_ID],
			})
		);
		const dt = (Date.now() - t0) / 1000;
		console.log(`  ${dt.toFixed(1)}s  in=${r.inputTokens} out=${r.outputTokens}`);

		// Lenient JSON extract — find the first {...} block, try to parse.
		// Don't fail the test if the JSON is broken; we want the raw content.
		let parsed: unknown | null = null;
		let parse_ok = false;
		try {
			const start = r.text.indexOf('{');
			const end = r.text.lastIndexOf('}');
			if (start !== -1 && end !== -1) {
				parsed = JSON.parse(r.text.slice(start, end + 1));
				parse_ok = true;
			}
		} catch { /* keep raw_text */ }

		record = {
			wall_seconds: dt,
			tokens: { input: r.inputTokens, output: r.outputTokens },
			model: r.model, provider: r.provider,
			raw_text: r.text,
			parsed_json: parsed,
			parse_ok,
			error: null,
		};
	} catch (err) {
		const dt = (Date.now() - t0) / 1000;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`  FAILED ${dt.toFixed(1)}s — ${msg.slice(0, 120)}`);
		record = {
			wall_seconds: dt, tokens: null, model: null, provider: null,
			raw_text: null, parsed_json: null, parse_ok: false,
			error: msg.slice(0, 800),
		};
	}

	const outPath = `${OUT_DIR}/mimo-quality-exposition.json`;
	writeFileSync(outPath, JSON.stringify({
		model: MIMO,
		case_id: BA_H3_DEV_CASE_ID,
		document_id: BA_H3_DEV_DOC_ID,
		container_heading_id: BA_EXPOSITION_HEAD,
		container_label,
		paragraph_count: paragraphs.length,
		input_paragraphs: paragraphs,
		...record,
	}, null, 2));
	console.log(`  → ${outPath}`);
	return record;
}

// ── Driver ────────────────────────────────────────────────────────

const phaseArg = process.argv[2];
const RUN_ALL = !phaseArg || phaseArg === 'all';

console.log(`xiaomi/mimo-v2.5-pro qualitative test battery`);
console.log(`Phase filter: ${phaseArg ?? 'all'}\n`);

const overall: Record<string, unknown> = { model: MIMO_KEY, started_at: new Date().toISOString() };

if (RUN_ALL || phaseArg === 'synth') {
	overall.synthese = await runSyntheseBattery();
}
if (RUN_ALL || phaseArg === 'ag') {
	overall.ag = await runAGBattery();
}
if (RUN_ALL || phaseArg === 'collapse') {
	overall.collapse = await runChapter1Collapse();
}
if (RUN_ALL || phaseArg === 'exposition') {
	overall.exposition = await runExpositionDirect();
}

overall.completed_at = new Date().toISOString();
const summaryPath = `${OUT_DIR}/mimo-quality-summary.json`;
writeFileSync(summaryPath, JSON.stringify(overall, null, 2));
console.log(`\n→ summary: ${summaryPath}`);

await pool.end();
