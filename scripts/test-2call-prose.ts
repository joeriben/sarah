// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 2-call prose-friendly variant of the basal per-paragraph pass.
//
// Replaces the single JSON call (`{interpretierend, codes[]}`) with two
// simpler calls:
//   1. Interpretation as plain prose (2–4 Sätze, no structured output).
//   2. Code-extraction from the produced interpretation, max 2 codes,
//      one per line, format `<label> | <anchor_phrase|->`.
//
// Tests the 4 models that failed JSON-strong AG smoketest (and qwen for
// reference). Runs all 4 in parallel.
//
// Run from repo root:   npx tsx scripts/test-2call-prose.ts

import { loadCaseContext, loadParagraphContext, type CaseContext, type ParagraphContext } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { chat } from '../src/lib/server/ai/client.ts';
import { pool } from '../src/lib/server/db/index.ts';
import type { Provider } from '../src/lib/server/ai/client.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const PARAGRAPH_ID = '60f9dfb1-5d9d-4c56-8288-1ef51f5eec63'; // §1

interface ModelCfg { key: string; provider: Provider; model: string; }

const MODELS: ModelCfg[] = [
	{ key: 'qwen3.6-max-preview', provider: 'openrouter', model: 'qwen/qwen3.6-max-preview' },
	{ key: 'gemini-pro-latest',   provider: 'openrouter', model: '~google/gemini-pro-latest' },
	{ key: 'mimo-v2.5-pro',       provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
	{ key: 'glm-5.1',             provider: 'openrouter', model: 'z-ai/glm-5.1' },
];

function buildInterpretationPrompts(caseCtx: CaseContext, paraCtx: ParagraphContext) {
	// Stripped-down version of buildSystemPrompt: persona + criteria + paragraph,
	// asking for prose only (no JSON).
	const system = `[PERSONA]
${caseCtx.brief.persona}

[KRITERIEN ALS LESEFOLIE]
${caseCtx.brief.criteria}

[WERK]
Titel: ${caseCtx.documentTitle} (${caseCtx.brief.work_type}, ${caseCtx.mainParagraphCount} Hauptabsätze)
Aktuelles Subkapitel: "${paraCtx.subchapterLabel}", Absatz ${paraCtx.positionInSubchapter} von ${paraCtx.subchapterTotalParagraphs}.

[AUFGABE]
Schreibe eine reflektierende Interpretation des Absatzes in 2–4 Sätzen Prosa.
Erste 1–2 Sätze: was wird zum Thema gemacht, welche Position bezogen.
Folgende 1–2 Sätze: welche argumentative Bewegung / Funktion vollzieht der Absatz.

NUR die Prosa. Kein "Hier ist die Interpretation:", kein JSON, keine Aufzählung, keine Codes.`;

	const user = `Absatz:

"${paraCtx.text}"`;

	return { system, user };
}

function buildCodesPrompts(caseCtx: CaseContext, paraCtx: ParagraphContext, interpretation: string) {
	const system = `[PERSONA]
${caseCtx.brief.persona}

[AUFGABE]
Verdichte die untenstehende Interpretation zu höchstens 2 GTA-Codes (Grounded-Theory-Codes für ein Retrieval-System).

Anforderungen:
- Pro Code 3–5 Wörter, self-contained (auch isoliert verständlich).
- Wenn möglich: ein wörtliches Zitat aus dem Absatz als anchor_phrase (≤ 4 Wörter), sonst "-".
- Codes sind die argumentativen Kerne des Absatzes, NICHT beliebige markante Begriffe.

[OUTPUT-FORMAT]
Eine Zeile pro Code, Format:
LABEL | ANCHOR_PHRASE_oder_-

Maximal 2 Zeilen. Keine Nummerierung, keine Erklärung, kein Vor-/Nachtext.`;

	const user = `Absatz:

"${paraCtx.text}"

Interpretation (vorhin generiert):

${interpretation}`;

	return { system, user };
}

function parseCodes(text: string): { label: string; anchor: string }[] {
	const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l.includes('|'));
	const codes: { label: string; anchor: string }[] = [];
	for (const line of lines.slice(0, 2)) {
		const [labelRaw, anchorRaw] = line.split('|').map(s => s.trim());
		if (labelRaw) codes.push({ label: labelRaw, anchor: (anchorRaw && anchorRaw !== '-') ? anchorRaw : '' });
	}
	return codes;
}

interface Result {
	key: string;
	wall_total_seconds: number;
	call1: { wall: number; tokens_input: number; tokens_output: number; text: string; error: string | null };
	call2: { wall: number; tokens_input: number; tokens_output: number; text: string; codes: { label: string; anchor: string }[]; error: string | null };
}

async function runOne(m: ModelCfg, caseCtx: CaseContext, paraCtx: ParagraphContext): Promise<Result> {
	const tStart = Date.now();
	const c1 = buildInterpretationPrompts(caseCtx, paraCtx);

	let interpretation = '';
	let call1: Result['call1'] = { wall: 0, tokens_input: 0, tokens_output: 0, text: '', error: null };
	const t1 = Date.now();
	try {
		const r1 = await chat({
			system: c1.system,
			messages: [{ role: 'user', content: c1.user }],
			maxTokens: 600,
			modelOverride: { provider: m.provider, model: m.model },
		});
		call1 = { wall: (Date.now() - t1) / 1000, tokens_input: r1.inputTokens, tokens_output: r1.outputTokens, text: r1.text, error: null };
		interpretation = r1.text.trim();
	} catch (err) {
		call1 = { wall: (Date.now() - t1) / 1000, tokens_input: 0, tokens_output: 0, text: '', error: (err as Error).message.slice(0, 100) };
		return { key: m.key, wall_total_seconds: (Date.now() - tStart) / 1000, call1, call2: { wall: 0, tokens_input: 0, tokens_output: 0, text: '', codes: [], error: 'skipped (call1 failed)' } };
	}

	const c2 = buildCodesPrompts(caseCtx, paraCtx, interpretation);
	const t2 = Date.now();
	let call2: Result['call2'] = { wall: 0, tokens_input: 0, tokens_output: 0, text: '', codes: [], error: null };
	try {
		const r2 = await chat({
			system: c2.system,
			messages: [{ role: 'user', content: c2.user }],
			maxTokens: 200,
			modelOverride: { provider: m.provider, model: m.model },
		});
		const codes = parseCodes(r2.text);
		call2 = { wall: (Date.now() - t2) / 1000, tokens_input: r2.inputTokens, tokens_output: r2.outputTokens, text: r2.text, codes, error: codes.length === 0 ? 'no parseable codes' : null };
	} catch (err) {
		call2 = { wall: (Date.now() - t2) / 1000, tokens_input: 0, tokens_output: 0, text: '', codes: [], error: (err as Error).message.slice(0, 100) };
	}

	return { key: m.key, wall_total_seconds: (Date.now() - tStart) / 1000, call1, call2 };
}

const ctx = await loadCaseContext(CASE_ID);
const para = await loadParagraphContext(ctx, PARAGRAPH_ID);

console.log(`2-call prose test: ${MODELS.length} models in parallel on §1\n`);
const t0 = Date.now();
const results = await Promise.all(MODELS.map(m => runOne(m, ctx, para)));
console.log(`\n=== Results (slowest ${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);

mkdirSync('docs/experiments', { recursive: true });
writeFileSync('docs/experiments/2call-prose-test-1.1.1-§1.json', JSON.stringify(results, null, 2));

for (const r of results) {
	console.log(`\n--- ${r.key} (total ${r.wall_total_seconds.toFixed(1)}s) ---`);
	if (r.call1.error) {
		console.log(`  call1 FAILED: ${r.call1.error}`);
	} else {
		console.log(`  call1: ${r.call1.wall.toFixed(1)}s  in=${r.call1.tokens_input} out=${r.call1.tokens_output}`);
		console.log(`  → "${r.call1.text.slice(0, 200).replace(/\s+/g, ' ')}…"`);
	}
	if (r.call2.error) {
		console.log(`  call2 FAILED: ${r.call2.error}`);
		console.log(`  raw: "${r.call2.text.slice(0, 200)}"`);
	} else {
		console.log(`  call2: ${r.call2.wall.toFixed(1)}s  in=${r.call2.tokens_input} out=${r.call2.tokens_output}`);
		for (const c of r.call2.codes) console.log(`    code: "${c.label}" | "${c.anchor}"`);
	}
}

await pool.end();
