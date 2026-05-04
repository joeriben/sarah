// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:WERK_DESKRIPTION — werk-aggregierte deskriptive Inhaltszusammenfassung.
//
// Voraussetzungen:
//   - Outline confirmed
//   - mind. 1 nicht-excluded Top-Level-Heading (effectiveLevel=1)
//   - idealerweise H3-Phasen vorab gelaufen, sonst nur Outline als Input
//   - optional: H1- oder H2-Run vorab → memo_content (chapter/subchapter) wird mit eingelesen
//
// Aufruf:
//   npx tsx scripts/test-h3-werk-deskription.ts <caseId>             # read-only
//   npx tsx scripts/test-h3-werk-deskription.ts <caseId> --persist
//   npx tsx scripts/test-h3-werk-deskription.ts <caseId> --persist --provider=openrouter --model=anthropic/claude-sonnet-4.6

import { runWerkDeskriptionPass } from '../src/lib/server/ai/h3/werk-deskription.js';
import type { Provider } from '../src/lib/server/ai/client.js';
import { pool } from '../src/lib/server/db/index.js';

function parseFlag(name: string): string | null {
	const prefix = `--${name}=`;
	const hit = process.argv.find((a) => a.startsWith(prefix));
	return hit ? hit.slice(prefix.length) : null;
}

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error(
			'Usage: npx tsx scripts/test-h3-werk-deskription.ts <caseId> [--persist] [--provider=X --model=Y]'
		);
		process.exit(1);
	}
	const persist = process.argv.includes('--persist');
	const providerArg = parseFlag('provider');
	const modelArg = parseFlag('model');
	const modelOverride =
		providerArg && modelArg
			? { provider: providerArg as Provider, model: modelArg }
			: undefined;

	let exitCode = 0;
	try {
		console.log(
			`> H3:WERK_DESKRIPTION für Case ${caseId}${persist ? '' : ' (read-only)'}…`
		);
		const start = Date.now();
		const result = await runWerkDeskriptionPass(caseId, {
			persistConstructs: persist,
			modelOverride,
		});
		const elapsedMs = Date.now() - start;

		console.log(`\n--- Lauf-Setup ---`);
		console.log(
			`  Modell:                 ${result.provider || '(no LLM call)'}/${result.model || '(no LLM call)'}`
		);
		console.log(`  LLM-Calls gesamt:       ${result.llmCalls}`);
		console.log(`  LLM-Zeit:               ${result.llmTimingMs}ms`);
		console.log(`  Tokens:                 in=${result.tokens.input}  out=${result.tokens.output}`);

		console.log(`\n--- Werk-Material ---`);
		console.log(`  Top-Level-Headings (Anker): ${result.headingCount}`);
		console.log(`  H1/H2-Memos integriert:     ${result.hadMemos ? `ja (${result.memoCount})` : 'nein'}`);
		console.log(`  Konstrukt-Counts pro Funktionstyp:`);
		const counts = result.constructCountsByType;
		const keys = Object.keys(counts).sort();
		if (keys.length === 0) {
			console.log(`    (keine — Werk-Beschreibung wird nur auf Outline-Struktur basieren)`);
		} else {
			for (const k of keys) {
				console.log(`    ${k}: ${counts[k]}`);
			}
		}
		if (result.diagnostics.warnings.length > 0) {
			console.log(`\n--- Warnings ---`);
			for (const w of result.diagnostics.warnings) {
				console.log(`  WARN: ${w}`);
			}
		}

		if (result.werkBeschreibungText) {
			console.log(`\n--- WERK_BESCHREIBUNG ---`);
			for (const l of result.werkBeschreibungText.split(/\n+/)) console.log(`  ${l}`);
		}

		if (persist) {
			console.log(`\n--- Persistenz ---`);
			console.log(`  WERK_BESCHREIBUNG-Konstrukt: ${result.constructId ?? '(nicht persistiert)'}`);
			if (result.deletedPriorCount > 0) {
				console.log(`  (${result.deletedPriorCount} prior Konstrukt(e) ersetzt — idempotent)`);
			}
		}

		console.log(`\nLaufzeit gesamt:          ${elapsedMs}ms`);
	} catch (e) {
		console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
		exitCode = 1;
	} finally {
		await pool.end();
		process.exit(exitCode);
	}
}

main();
