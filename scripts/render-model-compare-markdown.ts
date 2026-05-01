// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Render side-by-side markdown from the three model-compare JSON dumps.
// Reads docs/experiments/model-compare-1.1.1-{deepseek-v4-pro,sonnet-4-6,opus-4.7}.json
// Writes  docs/experiments/model-compare-1.1.1-SIDE-BY-SIDE.md

import { readFileSync, writeFileSync } from 'node:fs';

interface CodeOut { label: string; anchor_phrase?: string; rationale: string; }
interface SyntheticOut { interpretierend: string; codes: CodeOut[]; }
interface PremiseOut { type: string; text: string; from_paragraph?: number; }
interface ArgumentOut { id: number; claim: string; premises: PremiseOut[]; anchor_phrase?: string; }
interface EdgeOut { from: number; to: number; type: string; rationale?: string; }
interface ScaffoldingOut { id: number; function_type: string; function_description: string; anchored_to: number[]; excerpt?: string; }
interface AGResult { arguments: ArgumentOut[]; edges: EdgeOut[]; scaffolding: ScaffoldingOut[]; }
interface AGRecord {
	result: AGResult;
	stored_summary: { args: number; inter_edges: number; prior_edges: number; scaffolding: number; unanchored_args: string[] };
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
	model: string;
	wall_seconds: number;
}
interface SynthFailed { result: null; tokens: null; model: null; wall_seconds: number; error: string }
interface SynthOk     { result: SyntheticOut; tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number }; model: string; wall_seconds: number; error: null }
interface PerParagraph {
	paragraph_index: number;
	paragraph_id: string;
	synthetic: SynthOk | SynthFailed;
	argumentation_graph: AGRecord | { failed: true; error: string } | null;
}
interface ModelDump {
	model: { key: string; provider: string; model: string };
	total_wall_seconds: number;
	total_tokens: number;
	runs: PerParagraph[];
}

const KEYS = ['deepseek-v4-pro', 'sonnet-4-6', 'opus-4.7'];
const dumps: Record<string, ModelDump> = {};
for (const key of KEYS) {
	const path = `docs/experiments/model-compare-1.1.1-${key}.json`;
	dumps[key] = JSON.parse(readFileSync(path, 'utf8')) as ModelDump;
}

const out: string[] = [];
out.push(`# Model-Comparison: per-paragraph passes auf 1.1.1 "Bedeutung kultureller Orientierungsangebote in Schule"`);
out.push('');
out.push(`Subkapitel: 5 ¶ aus Doc \`54073d08\` (Timm 2025, frische Validierung).`);
out.push(`Pässe pro Modell: synthetic per-paragraph + argumentation-graph (Layer 1 + 2).`);
out.push('');
out.push(`## Headline-Zahlen`);
out.push('');
out.push(`| Modell | Wall (s) | Total tokens | $/M-input (≈) | $/M-output (≈) |`);
out.push(`|---|---:|---:|---|---|`);
const PRICING: Record<string, [string, string]> = {
	'deepseek-v4-pro': ['~$0.40', '~$1.60'],
	'sonnet-4-6':      ['~$3',    '~$15'],
	'opus-4.7':        ['~$15',   '~$75'],
};
for (const key of KEYS) {
	const d = dumps[key];
	const [ip, op] = PRICING[key] ?? ['?', '?'];
	out.push(`| \`${key}\` | ${d.total_wall_seconds.toFixed(1)} | ${d.total_tokens.toLocaleString()} | ${ip} | ${op} |`);
}
out.push('');

// Per-paragraph sections
for (let i = 0; i < 5; i++) {
	const idx = i + 1;
	out.push(`---`);
	out.push('');
	out.push(`## §${idx}`);
	out.push('');

	// Synthetic interpretierend memo
	out.push(`### Synthese (interpretierend)`);
	out.push('');
	for (const key of KEYS) {
		const d = dumps[key];
		const r = d.runs[i];
		if (!r || r.synthetic.error) {
			out.push(`**\`${key}\`** — FAILED: ${r?.synthetic.error ?? 'missing'}`);
			out.push('');
			continue;
		}
		const txt = r.synthetic.result?.interpretierend ?? '_(missing)_';
		const tk = r.synthetic.tokens!;
		out.push(`**\`${key}\`** (in=${tk.input} out=${tk.output}, ${r.synthetic.wall_seconds.toFixed(1)}s)`);
		out.push('');
		out.push(`> ${txt.replace(/\n/g, '\n> ')}`);
		out.push('');
	}

	// Codes
	out.push(`### Codes (max 2)`);
	out.push('');
	out.push(`| Modell | label | anchor_phrase | rationale |`);
	out.push(`|---|---|---|---|`);
	for (const key of KEYS) {
		const d = dumps[key];
		const r = d.runs[i];
		if (!r || r.synthetic.error || !r.synthetic.result) {
			out.push(`| \`${key}\` | _(failed)_ |  |  |`);
			continue;
		}
		const codes = r.synthetic.result.codes ?? [];
		if (codes.length === 0) {
			out.push(`| \`${key}\` | _(none)_ |  |  |`);
		} else {
			for (const c of codes) {
				out.push(`| \`${key}\` | ${md(c.label)} | ${md(c.anchor_phrase || '_paraphrase_')} | ${md(c.rationale)} |`);
			}
		}
	}
	out.push('');

	// Arguments
	out.push(`### Arguments`);
	out.push('');
	for (const key of KEYS) {
		const d = dumps[key];
		const ag = d.runs[i]?.argumentation_graph;
		if (!ag) {
			out.push(`**\`${key}\`** _(skipped or missing)_`);
			out.push('');
			continue;
		}
		if ('failed' in ag) {
			out.push(`**\`${key}\`** — FAILED: ${ag.error}`);
			out.push('');
			continue;
		}
		out.push(`**\`${key}\`** — ${ag.stored_summary.args} arg(s), edges: inter=${ag.stored_summary.inter_edges} prior=${ag.stored_summary.prior_edges}, ${ag.stored_summary.scaffolding} scaffolding (in=${ag.tokens.input} out=${ag.tokens.output}, ${ag.wall_seconds.toFixed(1)}s)`);
		out.push('');
		for (const a of ag.result.arguments) {
			const pSummary = a.premises.length === 0 ? 'no premises' : a.premises.map(p => p.type).join('+');
			out.push(`- **arg${a.id}** [${pSummary}] ${md(a.claim)}`);
			for (const p of a.premises) {
				const fromHint = p.from_paragraph !== undefined ? ` _(from §${p.from_paragraph})_` : '';
				out.push(`  - _${p.type}${fromHint}:_ ${md(p.text)}`);
			}
		}
		out.push('');
	}

	// Edges
	out.push(`### Edges`);
	out.push('');
	out.push(`| Modell | edges (from→to: type) |`);
	out.push(`|---|---|`);
	for (const key of KEYS) {
		const d = dumps[key];
		const ag = d.runs[i]?.argumentation_graph;
		if (!ag || 'failed' in ag) {
			out.push(`| \`${key}\` | _(skipped/failed)_ |`);
		} else {
			const eDescr = ag.result.edges.map(e => `${e.from}→${e.to}: ${e.type}`).join('; ') || '_(none)_';
			out.push(`| \`${key}\` | ${md(eDescr)} |`);
		}
	}
	out.push('');

	// Scaffolding
	out.push(`### Scaffolding`);
	out.push('');
	for (const key of KEYS) {
		const d = dumps[key];
		const ag = d.runs[i]?.argumentation_graph;
		out.push(`**\`${key}\`**`);
		out.push('');
		if (!ag || 'failed' in ag || ag.result.scaffolding.length === 0) {
			out.push(`_(none/failed)_`);
			out.push('');
			continue;
		}
		for (const sc of ag.result.scaffolding) {
			out.push(`- [${sc.function_type}] ${md(sc.function_description)} → args ${sc.anchored_to.join(',')}`);
		}
		out.push('');
	}
}

function md(s: string): string {
	return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const outPath = 'docs/experiments/model-compare-1.1.1-SIDE-BY-SIDE.md';
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`Wrote ${outPath}`);
