// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Probe: testet den überarbeiteten REFLEKTIEREND-Hint (User-Modell-Prompt
// 2026-05-06: 2-Achsen-Bedeutungsfrage, rekonstruktiv-hermeneutische Haltung)
// auf einem Absatz aus BA H3 dev. Pristine case ohne Vorgänger-Memos —
// reflective chain leer, keine completedKontextualisierungen.
//
// Test-Setup:
//   Case      = BA H3 dev (Standard-BA-Brief, include_formulierend=false)
//   Document  = d1993e8a (BA-Arbeit zu Klafki + Globalität)
//   Paragraph = 5d6550f9 (549 chars, Friedensfrage-Absatz)
//
// Schreibt einen reflektierend-Memo. Wenn der Output unbrauchbar ist:
// löschen via DELETE FROM namings WHERE inscription = '[reflektierend] …'.

import { runParagraphPass } from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { pool } from '../src/lib/server/db/index.ts';

const CASE_ID = 'c42e2d8f-1771-43bb-97c8-f57d7d10530a';      // BA H3 dev
const USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';      // sarah@example.com
const PARAGRAPH_ID = '5d6550f9-bcf1-47d0-af94-acb303784262'; // Friedensfrage-Auseinandersetzung

const t0 = Date.now();
const run = await runParagraphPass(CASE_ID, PARAGRAPH_ID, USER_ID, {
	modelOverride: { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
});
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`${dt}s   provider=${run.provider} model=${run.model}`);
console.log(`tokens: in=${run.tokens.input} out=${run.tokens.output} cache-r=${run.tokens.cacheRead} cache-c=${run.tokens.cacheCreation}`);
console.log(`\n--- REFLEKTIEREND ---\n${run.result.reflektierend}`);
console.log(`\nstored: reflektierend=${run.stored.reflektierendMemoId} formulierend=${run.stored.formulierendMemoId ?? '(none)'}`);

await pool.end();
