// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Render side-by-side markdown for the section-collapse model comparison
// on subchapter 1.1.1.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEYS = ['deepseek-v4-pro', 'sonnet-4-6', 'opus-4.7'];

interface CollapseDump {
	model: { key: string; provider: string; model: string };
	wall_seconds?: number;
	tokens?: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
	paragraphs_synthesized?: number;
	total_arguments?: number;
	total_scaffolding?: number;
	result?: {
		synthese: string;
		argumentationswiedergabe?: string;
		auffaelligkeiten: { scope: string; observation: string }[];
	};
	error?: string;
}

const dumps: Record<string, CollapseDump> = {};
for (const key of KEYS) {
	const path = `docs/experiments/collapse-compare-1.1.1-${key}.json`;
	if (!existsSync(path)) {
		console.error(`Missing ${path}`);
		process.exit(1);
	}
	dumps[key] = JSON.parse(readFileSync(path, 'utf8'));
}

const out: string[] = [];
out.push(`# Section-Collapse Model-Comparison: 1.1.1 "Bedeutung kultureller Orientierungsangebote in Schule"`);
out.push('');
out.push(`Subkapitel: 5 ¶ aus Doc \`54073d08\` (Timm 2025).`);
out.push(`Aufgabe: section-collapse-from-graph (Args + Scaffolding → kontextualisierende Synthese, vier Pflichtbestandteile inkl. Tragweite/Tragfähigkeit).`);
out.push(`Basal-Daten von Sonnet seediert; Collapse-Modell variiert.`);
out.push('');

out.push(`## Headline-Zahlen`);
out.push('');
out.push(`| Modell | Wall (s) | Tokens (in / cache_r / out) | ¶ syn | args | scaff |`);
out.push(`|---|---:|---|---:|---:|---:|`);
for (const key of KEYS) {
	const d = dumps[key];
	if (d.error) { out.push(`| \`${key}\` | _failed_ | ${d.error.slice(0, 50)} | – | – | – |`); continue; }
	const t = d.tokens!;
	out.push(`| \`${key}\` | ${d.wall_seconds!.toFixed(1)} | ${t.input} / ${t.cacheRead} / ${t.output} | ${d.paragraphs_synthesized} | ${d.total_arguments} | ${d.total_scaffolding} |`);
}
out.push('');

out.push(`---`);
out.push('');
out.push(`## Synthese`);
out.push('');
for (const key of KEYS) {
	const d = dumps[key];
	out.push(`### \`${key}\``);
	out.push('');
	if (d.error) { out.push(`_FAILED: ${d.error}_`); out.push(''); continue; }
	const text = d.result!.synthese;
	out.push(`(${text.length} chars, ${countSentences(text)} Sätze)`);
	out.push('');
	out.push(`> ${text.replace(/\n/g, '\n> ')}`);
	out.push('');
}

out.push(`---`);
out.push('');
out.push(`## Auffälligkeiten`);
out.push('');
for (const key of KEYS) {
	const d = dumps[key];
	out.push(`### \`${key}\``);
	out.push('');
	if (d.error) { out.push(`_failed_`); out.push(''); continue; }
	const items = d.result!.auffaelligkeiten;
	if (items.length === 0) { out.push(`_(keine)_`); out.push(''); continue; }
	for (const a of items) {
		out.push(`- **${a.scope}** — ${a.observation}`);
	}
	out.push('');
}

function countSentences(s: string): number {
	return (s.match(/[.!?]+\s+|[.!?]+$/g) || []).length;
}

const outPath = 'docs/experiments/collapse-compare-1.1.1-SIDE-BY-SIDE.md';
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`Wrote ${outPath}`);
