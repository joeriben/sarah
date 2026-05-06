// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test nemotron-3-super (local Ollama) on the BASAL synthesis task WITHOUT
// the JSON output requirement. Same persona/criteria/work/chain context as
// the JSON-mode passes — only the [OUTPUT-FORMAT] tail is replaced with a
// prose instruction.
//
// User reasoning: nemotron's structured-JSON adherence is poor (timeouts,
// unparseable JSON), but the synthesis itself may still be usable as prose.
// "Synthesen gehen ja auch ohne [JSON] zur Not."
//
// Per-paragraph synthese only, NO codes, NO arg-graph (those are inherently
// structured tasks).
//
// Run from repo root:   npx tsx scripts/test-nemotron-prose.ts

import { loadCaseContext, loadParagraphContext, buildSystemPrompt, buildUserMessage } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { chat } from '../src/lib/server/ai/client.ts';
import { pool } from '../src/lib/server/db/index.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const PARAGRAPH_IDS = [
	'60f9dfb1-5d9d-4c56-8288-1ef51f5eec63', // §1
	'7118aa10-b5d7-495a-9405-5b66116edb06', // §2
	'897ca890-e56a-4768-a078-fd5e59fda3d6', // §3
	'96556e05-9b69-482b-ace7-174252284536', // §4
	'72919e94-79bb-4a0e-b507-e78aacc1fd5b', // §5
];

const OVERRIDE = { provider: 'ollama' as const, model: 'nemotron-3-super:latest' };

// Replace the JSON-output instruction with a prose instruction. Locates the
// "[OUTPUT-FORMAT]" header and substitutes everything from there onwards.
function makeProseSystemPrompt(jsonSystem: string): string {
	const cut = jsonSystem.indexOf('[OUTPUT-FORMAT]');
	if (cut === -1) throw new Error('Could not find [OUTPUT-FORMAT] in system prompt — buildSystemPrompt structure changed?');
	const head = jsonSystem.slice(0, cut);
	return head + `[OUTPUT-FORMAT]
Antworte mit reinem deutschem Fließtext, KEIN JSON, KEIN Markdown-Codefence, KEINE Liste.
2–4 Sätze. Erste 1–2 Sätze: was wird zum Thema gemacht, welche Position bezogen — knapp, als Inhaltsanker. Folgende 1–2 Sätze: welche argumentative Bewegung / Funktion vollzieht der Absatz vor dem Hintergrund der bisherigen interpretierenden Kette des Subkapitels?

Keine zusätzlichen Codes, kein "Kernthese:", keine Aufzählungen. Nur die Synthese-Prose.`;
}

const OUT_DIR = 'docs/experiments';
mkdirSync(OUT_DIR, { recursive: true });

interface Run {
	paragraph_index: number;
	paragraph_id: string;
	wall_seconds: number;
	tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
	prose: string;
	error: string | null;
}

const runs: Run[] = [];
let totalWall = 0, totalTokens = 0;

const caseCtx = await loadCaseContext(CASE_ID);
console.log(`\n=== nemotron-3-super (Ollama, prose-only) ===`);

for (let i = 0; i < PARAGRAPH_IDS.length; i++) {
	const pid = PARAGRAPH_IDS[i];
	const paraCtx = await loadParagraphContext(caseCtx, pid);
	const jsonSystem = buildSystemPrompt(caseCtx, paraCtx);
	const proseSystem = makeProseSystemPrompt(jsonSystem);
	const user = buildUserMessage(paraCtx, caseCtx);

	process.stdout.write(`§${i + 1} prose ... `);
	const t0 = Date.now();
	let prose = '';
	let tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
	let error: string | null = null;

	try {
		const r = await chat({
			system: proseSystem,
			cacheSystem: false,  // Ollama doesn't honor cache_control
			messages: [{ role: 'user', content: user }],
			maxTokens: 800,
			modelOverride: OVERRIDE,
		});
		prose = r.text;
		tokens = { input: r.inputTokens, output: r.outputTokens, cacheCreation: r.cacheCreationTokens, cacheRead: r.cacheReadTokens, total: r.tokensUsed };
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	const dt = (Date.now() - t0) / 1000;
	totalWall += dt;
	totalTokens += tokens.total;

	if (error) {
		console.log(`FAILED in ${dt.toFixed(1)}s (${error.slice(0, 80)})`);
	} else {
		const preview = prose.replace(/\s+/g, ' ').slice(0, 90);
		console.log(`${dt.toFixed(1)}s  in=${tokens.input} out=${tokens.output}  "${preview}…"`);
	}

	runs.push({ paragraph_index: i + 1, paragraph_id: pid, wall_seconds: dt, tokens, prose, error });
}

const outPath = `${OUT_DIR}/nemotron-prose-1.1.1.json`;
writeFileSync(outPath, JSON.stringify({ model: OVERRIDE, total_wall_seconds: totalWall, total_tokens: totalTokens, runs }, null, 2));
console.log(`\n→ ${outPath}  (wall ${totalWall.toFixed(1)}s, tokens ${totalTokens})`);

await pool.end();
