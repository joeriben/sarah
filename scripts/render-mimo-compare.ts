// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Renders side-by-side qualitative comparison of xiaomi/mimo-v2.5-pro
// against the existing Sonnet/Opus/DeepSeek baselines for the four pipeline
// load points tested in scripts/test-mimo-quality.ts.
//
// Reads:
//   docs/experiments/mimo-quality-{synthese,ag,chapter-collapse,exposition}.json
//   docs/experiments/model-compare-1.1.1-{sonnet-4-6,opus-4.7,deepseek-v4-pro}.json
//   docs/experiments/chapter1-{opus-collapse,compare-deepseek-v4-pro}.json
//   docs/experiments/sonnet-baseline-exposition.json
//
// Writes:
//   docs/experiments/mimo-compare-SIDE-BY-SIDE.md

import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/experiments';

const mimoSynth   = JSON.parse(readFileSync(`${DIR}/mimo-quality-synthese.json`, 'utf8'));
const mimoAg      = JSON.parse(readFileSync(`${DIR}/mimo-quality-ag.json`, 'utf8'));
const mimoChap    = JSON.parse(readFileSync(`${DIR}/mimo-quality-chapter-collapse.json`, 'utf8'));
const mimoExp     = JSON.parse(readFileSync(`${DIR}/mimo-quality-exposition.json`, 'utf8'));

const sonnetParaCmp = JSON.parse(readFileSync(`${DIR}/model-compare-1.1.1-sonnet-4-6.json`, 'utf8'));
const opusParaCmp   = JSON.parse(readFileSync(`${DIR}/model-compare-1.1.1-opus-4.7.json`, 'utf8'));
const ds4ParaCmp    = JSON.parse(readFileSync(`${DIR}/model-compare-1.1.1-deepseek-v4-pro.json`, 'utf8'));

const opusChap = JSON.parse(readFileSync(`${DIR}/chapter1-opus-collapse.json`, 'utf8'));
const ds4Chap  = JSON.parse(readFileSync(`${DIR}/chapter1-compare-deepseek-v4-pro.json`, 'utf8'));

const sonnetExp = JSON.parse(readFileSync(`${DIR}/sonnet-baseline-exposition.json`, 'utf8'));

// ── Pricing rough estimates ($/M tokens) ──────────────────────────
// (per OpenRouter / vendor list; approximate for cost orientation only)
const PRICE = {
	'mimo-v2.5-pro':    { in: 1,    out: 3    },
	'sonnet-4-6':       { in: 3,    out: 15   },
	'opus-4.7':         { in: 15,   out: 75   },
	'deepseek-v4-pro':  { in: 0.40, out: 1.60 },
} as const;

function dollars(model: keyof typeof PRICE, inTok: number, outTok: number): string {
	const p = PRICE[model];
	const usd = (inTok * p.in + outTok * p.out) / 1_000_000;
	return `$${usd.toFixed(4)}`;
}

const lines: string[] = [];

// ── Header ────────────────────────────────────────────────────────

lines.push(`# xiaomi/mimo-v2.5-pro — qualitative content comparison`);
lines.push('');
lines.push(`Test date: ${new Date().toISOString().slice(0, 10)}`);
lines.push(`Test scope: 4 load-bearing pipeline calls. Same prompts, same input data,`);
lines.push(`only the model swapped. JSON adherence is incidental — the reading is`);
lines.push(`whether mimo's content holds up against Sonnet/Opus/DeepSeek on academic`);
lines.push(`German prose.`);
lines.push('');
lines.push(`Test driver: scripts/test-mimo-quality.ts.`);
lines.push('');

// ── Headline numbers ──────────────────────────────────────────────

lines.push(`## Headline cost / latency`);
lines.push('');
lines.push(`### Per-paragraph synthese (5 ¶ on subchapter 1.1.1)`);
lines.push('');
lines.push(`| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Successful ¶ |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);

function totalSynth(records: Array<{ wall_seconds: number; tokens: { input: number; output: number } | null }>) {
	const wall = records.reduce((s, r) => s + (r.wall_seconds ?? 0), 0);
	const inTok = records.reduce((s, r) => s + (r.tokens?.input ?? 0), 0);
	const outTok = records.reduce((s, r) => s + (r.tokens?.output ?? 0), 0);
	const ok = records.filter(r => r.tokens !== null).length;
	return { wall, inTok, outTok, ok };
}

const sonnetSynthTotal = totalSynth(sonnetParaCmp.runs.map((r: { synthetic: { wall_seconds: number; tokens: { input: number; output: number } | null } }) => ({ wall_seconds: r.synthetic.wall_seconds, tokens: r.synthetic.tokens })));
const opusSynthTotal   = totalSynth(opusParaCmp.runs.map((r: { synthetic: { wall_seconds: number; tokens: { input: number; output: number } | null } }) => ({ wall_seconds: r.synthetic.wall_seconds, tokens: r.synthetic.tokens })));
const ds4SynthTotal    = totalSynth(ds4ParaCmp.runs.map((r: { synthetic: { wall_seconds: number; tokens: { input: number; output: number } | null } }) => ({ wall_seconds: r.synthetic.wall_seconds, tokens: r.synthetic.tokens })));
const mimoSynthTotal   = totalSynth(mimoSynth.records);

lines.push(`| **mimo-v2.5-pro** | ${mimoSynthTotal.wall.toFixed(1)} | ${mimoSynthTotal.inTok} | ${mimoSynthTotal.outTok} | ${dollars('mimo-v2.5-pro', mimoSynthTotal.inTok, mimoSynthTotal.outTok)} | ${mimoSynthTotal.ok}/5 |`);
lines.push(`| sonnet-4-6 | ${sonnetSynthTotal.wall.toFixed(1)} | ${sonnetSynthTotal.inTok} | ${sonnetSynthTotal.outTok} | ${dollars('sonnet-4-6', sonnetSynthTotal.inTok, sonnetSynthTotal.outTok)} | ${sonnetSynthTotal.ok}/5 |`);
lines.push(`| opus-4.7 | ${opusSynthTotal.wall.toFixed(1)} | ${opusSynthTotal.inTok} | ${opusSynthTotal.outTok} | ${dollars('opus-4.7', opusSynthTotal.inTok, opusSynthTotal.outTok)} | ${opusSynthTotal.ok}/5 |`);
lines.push(`| deepseek-v4-pro | ${ds4SynthTotal.wall.toFixed(1)} | ${ds4SynthTotal.inTok} | ${ds4SynthTotal.outTok} | ${dollars('deepseek-v4-pro', ds4SynthTotal.inTok, ds4SynthTotal.outTok)} | ${ds4SynthTotal.ok}/5 |`);
lines.push('');

// ── AG numbers ────────────────────────────────────────────────────

lines.push(`### Argumentation graph (5 ¶ on subchapter 1.1.1)`);
lines.push('');
lines.push(`| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Successful ¶ |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);

function totalAG(records: Array<{ wall_seconds: number; tokens: { input: number; output: number } | null }>) {
	return totalSynth(records);
}

const sonnetAgTotal = totalAG(sonnetParaCmp.runs
	.filter((r: { argumentation_graph: unknown }) => r.argumentation_graph && typeof r.argumentation_graph === 'object' && 'tokens' in (r.argumentation_graph as object))
	.map((r: { argumentation_graph: { wall_seconds: number; tokens: { input: number; output: number } } }) => ({ wall_seconds: r.argumentation_graph.wall_seconds, tokens: r.argumentation_graph.tokens })));
const opusAgTotal = totalAG(opusParaCmp.runs
	.filter((r: { argumentation_graph: unknown }) => r.argumentation_graph && typeof r.argumentation_graph === 'object' && 'tokens' in (r.argumentation_graph as object))
	.map((r: { argumentation_graph: { wall_seconds: number; tokens: { input: number; output: number } } }) => ({ wall_seconds: r.argumentation_graph.wall_seconds, tokens: r.argumentation_graph.tokens })));
const mimoAgTotal = totalAG(mimoAg.records);

lines.push(`| **mimo-v2.5-pro** | ${mimoAgTotal.wall.toFixed(1)} | ${mimoAgTotal.inTok} | ${mimoAgTotal.outTok} | ${dollars('mimo-v2.5-pro', mimoAgTotal.inTok, mimoAgTotal.outTok)} | ${mimoAgTotal.ok}/5 |`);
lines.push(`| sonnet-4-6 | ${sonnetAgTotal.wall.toFixed(1)} | ${sonnetAgTotal.inTok} | ${sonnetAgTotal.outTok} | ${dollars('sonnet-4-6', sonnetAgTotal.inTok, sonnetAgTotal.outTok)} | ${sonnetAgTotal.ok}/5 |`);
lines.push(`| opus-4.7 | ${opusAgTotal.wall.toFixed(1)} | ${opusAgTotal.inTok} | ${opusAgTotal.outTok} | ${dollars('opus-4.7', opusAgTotal.inTok, opusAgTotal.outTok)} | ${opusAgTotal.ok}/5 |`);
lines.push(`| deepseek-v4-pro | (failed AG schema, see baseline file) | | | | 0/5 |`);
lines.push('');

// ── Chapter collapse ────────────────────────────────────────────────

lines.push(`### Chapter 1 collapse (single call, 7 L3 inputs)`);
lines.push('');
lines.push(`| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Auffälligkeiten |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);

const opusChapWall   = opusChap.wall ?? 0;
const opusChapTok    = opusChap.tokens;
const opusChapAuff   = (opusChap.result.auffaelligkeiten as unknown[]).length;
const ds4ChapTok     = ds4Chap.tokens;
const ds4ChapAuff    = (ds4Chap.result.auffaelligkeiten as unknown[]).length;
const mimoChapTok    = mimoChap.tokens;
const mimoChapAuff   = (mimoChap.parsed.auffaelligkeiten as unknown[]).length;

lines.push(`| **mimo-v2.5-pro** | ${mimoChap.wall_seconds.toFixed(1)} | ${mimoChapTok.input} | ${mimoChapTok.output} | ${dollars('mimo-v2.5-pro', mimoChapTok.input, mimoChapTok.output)} | ${mimoChapAuff} |`);
lines.push(`| opus-4.7 | ${opusChapWall.toFixed(1)} | ${opusChapTok.input} | ${opusChapTok.output} | ${dollars('opus-4.7', opusChapTok.input, opusChapTok.output)} | ${opusChapAuff} |`);
lines.push(`| deepseek-v4-pro | ${ds4Chap.wall_seconds.toFixed(1)} | ${ds4ChapTok.input} | ${ds4ChapTok.output} | ${dollars('deepseek-v4-pro', ds4ChapTok.input, ds4ChapTok.output)} | ${ds4ChapAuff} |`);
lines.push('');

// ── EXPOSITION ────────────────────────────────────────────────────

lines.push(`### H3 EXPOSITION fallback (BA H3 dev, single call)`);
lines.push('');
lines.push(`| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | JSON ok |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);
lines.push(`| **mimo-v2.5-pro** | ${mimoExp.wall_seconds.toFixed(1)} | ${mimoExp.tokens.input} | ${mimoExp.tokens.output} | ${dollars('mimo-v2.5-pro', mimoExp.tokens.input, mimoExp.tokens.output)} | ${mimoExp.parse_ok ? 'YES' : 'no'} |`);
lines.push(`| sonnet-4-6 | ${sonnetExp.wall_seconds.toFixed(1)} | ${sonnetExp.tokens.input} | ${sonnetExp.tokens.output} | ${dollars('sonnet-4-6', sonnetExp.tokens.input, sonnetExp.tokens.output)} | ${sonnetExp.parsed_json ? 'YES' : 'no'} |`);
lines.push('');

// ── Section 1: per-paragraph synthese §1 ──────────────────────────

lines.push(`---`);
lines.push('');
lines.push(`## 1. Per-paragraph synthese — §1 of 1.1.1`);
lines.push('');
lines.push(`Subchapter 1.1.1: "Bedeutung kultureller Orientierungsangebote in Schule"`);
lines.push(`(Habil Timm). §1 introduces the praxeological cultural framing (Reckwitz)`);
lines.push(`and the doppelter Effekt of cultural routines.`);
lines.push('');

interface ParagraphRunSynth {
	paragraph_index: number;
	synthetic: { result: { interpretierend: string; codes: { label: string; rationale: string }[] } | null };
}

function renderSynthBlock(label: string, payload: { interpretierend: string; codes: { label: string; rationale: string }[] }): string[] {
	const out = [`**${label}**`, '', `> ${payload.interpretierend}`, '', '*Codes:*'];
	for (const c of payload.codes) {
		out.push(`- **${c.label}** — ${c.rationale}`);
	}
	out.push('');
	return out;
}

const sonnetSynth1 = (sonnetParaCmp.runs as ParagraphRunSynth[]).find(r => r.paragraph_index === 1)!;
const opusSynth1   = (opusParaCmp.runs   as ParagraphRunSynth[]).find(r => r.paragraph_index === 1)!;
const ds4Synth1    = (ds4ParaCmp.runs    as ParagraphRunSynth[]).find(r => r.paragraph_index === 1)!;
const mimoSynth1   = mimoSynth.records.find((r: { idx: number }) => r.idx === 1);

if (mimoSynth1?.parsed) lines.push(...renderSynthBlock('mimo-v2.5-pro', mimoSynth1.parsed));
if (sonnetSynth1?.synthetic.result) lines.push(...renderSynthBlock('sonnet-4-6', sonnetSynth1.synthetic.result));
if (opusSynth1?.synthetic.result)   lines.push(...renderSynthBlock('opus-4.7',   opusSynth1.synthetic.result));
if (ds4Synth1?.synthetic.result)    lines.push(...renderSynthBlock('deepseek-v4-pro', ds4Synth1.synthetic.result));

// ── Section 2: AG §1 ──────────────────────────────────────────────

lines.push(`---`);
lines.push('');
lines.push(`## 2. Argumentation graph — §1 of 1.1.1`);
lines.push('');

interface AGResult {
	arguments?: { id: string; claim: string; premises?: { type: string; text: string }[] }[];
	edges?: { from: string; to: string; kind: string }[];
	scaffolding?: { id: string; excerpt?: string; function_type?: string; function_description?: string; assessment?: string }[];
}

interface ParagraphRunAG {
	paragraph_index: number;
	argumentation_graph: { result: AGResult } | null | { failed: true; error: string };
}

function renderAGBlock(label: string, payload: AGResult): string[] {
	const out = [`**${label}** (${payload.arguments?.length ?? 0} args, ${payload.edges?.length ?? 0} edges, ${payload.scaffolding?.length ?? 0} scaffolding)`, ''];
	for (const a of payload.arguments ?? []) {
		const ptypes = (a.premises ?? []).map(p => p.type).join('+') || '—';
		out.push(`- **${a.id}** [${ptypes}] ${a.claim}`);
		for (const p of a.premises ?? []) {
			out.push(`  - _${p.type}:_ ${p.text}`);
		}
	}
	if ((payload.scaffolding ?? []).length > 0) {
		out.push('', '*Scaffolding:*');
		for (const s of payload.scaffolding ?? []) {
			out.push(`- **${s.id}** [${s.function_type}] ${s.function_description ?? ''}`);
			if (s.excerpt)  out.push(`  - excerpt: "${s.excerpt}"`);
			if (s.assessment) out.push(`  - assessment: ${s.assessment}`);
		}
	}
	out.push('');
	return out;
}

const mimoAg1 = mimoAg.records.find((r: { idx: number }) => r.idx === 1);
const sonnetAg1Run = (sonnetParaCmp.runs as ParagraphRunAG[]).find(r => r.paragraph_index === 1);
const sonnetAg1 = sonnetAg1Run?.argumentation_graph && 'result' in sonnetAg1Run.argumentation_graph ? sonnetAg1Run.argumentation_graph.result : null;
const opusAg1Run = (opusParaCmp.runs as ParagraphRunAG[]).find(r => r.paragraph_index === 1);
const opusAg1 = opusAg1Run?.argumentation_graph && 'result' in opusAg1Run.argumentation_graph ? opusAg1Run.argumentation_graph.result : null;

if (mimoAg1?.parsed) lines.push(...renderAGBlock('mimo-v2.5-pro', mimoAg1.parsed as AGResult));
else if (mimoAg1?.error) {
	lines.push(`**mimo-v2.5-pro** — PARSE-FAIL: ${mimoAg1.error}`, '');
	if (mimoAg1.raw_text) {
		lines.push(`<details><summary>Raw response (truncated)</summary>`, '', '```', mimoAg1.raw_text.slice(0, 2000), '```', '', '</details>', '');
	}
}
if (sonnetAg1) lines.push(...renderAGBlock('sonnet-4-6', sonnetAg1));
if (opusAg1)   lines.push(...renderAGBlock('opus-4.7',   opusAg1));

// ── Section 3: Chapter 1 collapse ──────────────────────────────────

lines.push(`---`);
lines.push('');
lines.push(`## 3. Chapter 1 collapse — full output`);
lines.push('');

interface ChapterCollapseResult {
	synthese: string;
	argumentationswiedergabe: string;
	auffaelligkeiten: { scope: string; observation: string }[];
}

function renderChapterBlock(label: string, payload: ChapterCollapseResult): string[] {
	const out = [`### ${label}`, '', `**Synthese (${payload.synthese.length} chars):**`, '', `> ${payload.synthese}`, ''];
	out.push(`**Argumentationswiedergabe (${payload.argumentationswiedergabe.length} chars):**`, '');
	out.push(`> ${payload.argumentationswiedergabe.replace(/\n\n/g, '\n>\n> ')}`);
	out.push('');
	out.push(`**Auffälligkeiten (${payload.auffaelligkeiten.length}):**`, '');
	for (const a of payload.auffaelligkeiten) {
		out.push(`- **\`${a.scope}\`** — ${a.observation}`);
	}
	out.push('');
	return out;
}

lines.push(...renderChapterBlock('mimo-v2.5-pro', mimoChap.parsed as ChapterCollapseResult));
lines.push(...renderChapterBlock('opus-4.7 (baseline)', opusChap.result as ChapterCollapseResult));
lines.push(...renderChapterBlock('deepseek-v4-pro (baseline)', ds4Chap.result as ChapterCollapseResult));

// ── Section 4: EXPOSITION ──────────────────────────────────────────

lines.push(`---`);
lines.push('');
lines.push(`## 4. H3 EXPOSITION fallback`);
lines.push('');
lines.push(`Container: "${mimoExp.container_label}" (BA H3 dev, ${mimoExp.paragraph_count} ¶).`);
lines.push(`The fallback prompt asks the model to identify the actual fragestellung,`);
lines.push(`separating it from method, and to summarise the motivation in 1–3 sentences.`);
lines.push('');

interface ExpositionParse {
	fragestellung: string;
	motivation: string;
	fragestellung_paragraph_indices?: number[];
	motivation_paragraph_indices?: number[];
}

function renderExpBlock(label: string, payload: ExpositionParse): string[] {
	return [
		`**${label}**`,
		'',
		`*Fragestellung* (¶ ${payload.fragestellung_paragraph_indices?.join(',') ?? '?'}):`,
		`> ${payload.fragestellung}`,
		'',
		`*Motivation* (¶ ${payload.motivation_paragraph_indices?.join(',') ?? '?'}):`,
		`> ${payload.motivation}`,
		'',
	];
}

if (mimoExp.parsed_json) lines.push(...renderExpBlock('mimo-v2.5-pro', mimoExp.parsed_json as ExpositionParse));
if (sonnetExp.parsed_json) lines.push(...renderExpBlock('sonnet-4-6', sonnetExp.parsed_json as ExpositionParse));

writeFileSync(`${DIR}/mimo-compare-SIDE-BY-SIDE.md`, lines.join('\n'));
console.log(`→ ${DIR}/mimo-compare-SIDE-BY-SIDE.md (${lines.length} lines)`);
