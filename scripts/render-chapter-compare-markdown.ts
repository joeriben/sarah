// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Render side-by-side markdown for the chapter-collapse model comparison
// on Chapter 1. Reads the Opus goldstandard from chapter1-opus-collapse.json
// (legacy schema) and any chapter1-compare-<key>.json (comparison schema).
//
// Run from repo root:   npx tsx scripts/render-chapter-compare-markdown.ts

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

interface ResultBlock {
	synthese: string;
	argumentationswiedergabe: string;
	auffaelligkeiten: { scope: string; observation: string }[];
}

interface NormalizedRecord {
	key: string;
	provider: string;
	model: string;
	wall_seconds: number | null;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } | null;
	aggregation_level: number | null;
	input_mode: string | null;
	input_count: number | null;
	result: ResultBlock | null;
	error: string | null;
}

const records: NormalizedRecord[] = [];

// 1. Opus baseline (legacy schema from run-chapter1-pipeline.ts).
const opusPath = 'docs/experiments/chapter1-opus-collapse.json';
if (existsSync(opusPath)) {
	const raw = JSON.parse(readFileSync(opusPath, 'utf8'));
	records.push({
		key: 'opus-4.7',
		provider: 'openrouter',
		model: 'anthropic/claude-opus-4.7',
		wall_seconds: raw.wall ?? null,
		tokens: raw.tokens ?? null,
		aggregation_level: raw.aggregation_level ?? null,
		input_mode: raw.input_mode ?? null,
		input_count: raw.input_count ?? null,
		result: raw.result ?? null,
		error: null,
	});
}

// 2. Any chapter1-compare-<key>.json (driver-output schema).
const dir = 'docs/experiments';
for (const file of readdirSync(dir)) {
	const m = file.match(/^chapter1-compare-(.+)\.json$/);
	if (!m) continue;
	const raw = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
	records.push({
		key: m[1],
		provider: raw.model?.provider ?? '',
		model: raw.model?.model ?? '',
		wall_seconds: raw.wall_seconds ?? null,
		tokens: raw.tokens ?? null,
		aggregation_level: raw.aggregation_level ?? null,
		input_mode: raw.input_mode ?? null,
		input_count: raw.input_count ?? null,
		result: raw.result ?? null,
		error: raw.error ?? null,
	});
}

if (records.length === 0) {
	console.error('No records found. Expected docs/experiments/chapter1-opus-collapse.json or chapter1-compare-*.json');
	process.exit(1);
}

// Sort: opus baseline first, then alphabetically by key.
records.sort((a, b) => {
	if (a.key === 'opus-4.7') return -1;
	if (b.key === 'opus-4.7') return 1;
	return a.key.localeCompare(b.key);
});

const out: string[] = [];
out.push(`# Chapter-Collapse Model-Comparison: Chapter 1 (74 ¶, 7 L3 subchapters)`);
out.push('');
out.push(`Hauptkapitel: "Schule – Kultur – Globalität – Lehrkräftebildung"`);
out.push(`Doc \`54073d08\` (Timm 2025).`);
out.push(`Aufgabe: chapter-collapse mit aggregation_level=L3 (7 subchapter-memos als Input).`);
out.push(`Subchapter-Memos (Input) sind Opus-generiert; chapter-collapse-Modell variiert.`);
out.push('');

out.push(`## Headline-Zahlen`);
out.push('');
out.push(`| Modell | Wall (s) | Tokens (in / cache_r / out / total) | Synth chars | Wiedergabe chars | Auff. |`);
out.push(`|---|---:|---|---:|---:|---:|`);
for (const r of records) {
	if (r.error) { out.push(`| \`${r.key}\` | _failed_ | ${r.error.slice(0, 50)} | – | – | – |`); continue; }
	const t = r.tokens;
	const tokensCol = t ? `${t.input} / ${t.cacheRead} / ${t.output} / ${t.total}` : '–';
	const wall = r.wall_seconds !== null ? r.wall_seconds.toFixed(1) : '–';
	const synLen = r.result?.synthese.length ?? 0;
	const wiedLen = r.result?.argumentationswiedergabe.length ?? 0;
	const auffN = r.result?.auffaelligkeiten.length ?? 0;
	out.push(`| \`${r.key}\` | ${wall} | ${tokensCol} | ${synLen} | ${wiedLen} | ${auffN} |`);
}
out.push('');

// Cost estimate (rough, using OpenRouter passthrough rates from the handover):
// Opus: $3/M in, $15/M out, $0.30/M cache_r
// DS4-pro: rough estimate from handover ~$0.02/¶ basal → assume similar in:out ratio
out.push(`## Synthese (vier Pflichtbestandteile)`);
out.push('');
for (const r of records) {
	out.push(`### \`${r.key}\``);
	out.push('');
	if (r.error) { out.push(`_FAILED: ${r.error}_`); out.push(''); continue; }
	if (!r.result) { out.push(`_(no result)_`); out.push(''); continue; }
	const text = r.result.synthese;
	out.push(`(${text.length} chars, ${countSentences(text)} Sätze)`);
	out.push('');
	out.push(`> ${text.replace(/\n/g, '\n> ')}`);
	out.push('');
}

out.push(`---`);
out.push('');
out.push(`## Argumentationswiedergabe (Gutachten-Vorlage)`);
out.push('');
for (const r of records) {
	out.push(`### \`${r.key}\``);
	out.push('');
	if (r.error) { out.push(`_failed_`); out.push(''); continue; }
	if (!r.result) { out.push(`_(no result)_`); out.push(''); continue; }
	const text = r.result.argumentationswiedergabe;
	out.push(`(${text.length} chars, ${countSentences(text)} Sätze)`);
	out.push('');
	out.push(`> ${text.replace(/\n/g, '\n> ')}`);
	out.push('');
}

out.push(`---`);
out.push('');
out.push(`## Auffälligkeiten`);
out.push('');
for (const r of records) {
	out.push(`### \`${r.key}\``);
	out.push('');
	if (r.error) { out.push(`_failed_`); out.push(''); continue; }
	const items = r.result?.auffaelligkeiten ?? [];
	if (items.length === 0) { out.push(`_(keine)_`); out.push(''); continue; }
	for (const a of items) {
		out.push(`- **${a.scope}** — ${a.observation}`);
	}
	out.push('');
}

function countSentences(s: string): number {
	return (s.match(/[.!?]+\s+|[.!?]+$/g) || []).length;
}

const outPath = 'docs/experiments/chapter1-compare-SIDE-BY-SIDE.md';
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`Wrote ${outPath}  (${records.length} records: ${records.map(r => r.key).join(', ')})`);
