// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:WERK_GUTACHT — drei Stages a/b/c.
//
// Voraussetzungen:
//   - WERK_BESCHREIBUNG-Konstrukt (h3_werk_deskription muss vorab gelaufen sein)
//   - FRAGESTELLUNG-Konstrukt (h3_exposition)
//   - mind. 1 nicht-excluded Top-Level-Heading (effectiveLevel=1)
//
// User-Setzung 2026-05-04: c-Gating ist heute deaktiviert (Test-Modus).
// content.gatingDisabled=true markiert das transparent.
//
// Aufruf:
//   npx tsx scripts/test-h3-werk-gutacht.ts <caseId>             # read-only
//   npx tsx scripts/test-h3-werk-gutacht.ts <caseId> --persist
//   npx tsx scripts/test-h3-werk-gutacht.ts <caseId> --persist --provider=openrouter --model=anthropic/claude-sonnet-4.6

import { runWerkGutachtPass } from '../src/lib/server/ai/h3/werk-gutacht.js';
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
			'Usage: npx tsx scripts/test-h3-werk-gutacht.ts <caseId> [--persist] [--provider=X --model=Y]'
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
			`> H3:WERK_GUTACHT für Case ${caseId}${persist ? '' : ' (read-only)'}…`
		);
		const start = Date.now();
		const result = await runWerkGutachtPass(caseId, {
			persistConstructs: persist,
			modelOverride,
		});
		const elapsedMs = Date.now() - start;

		console.log(`\n--- Lauf-Setup ---`);
		console.log(
			`  Modell:                 ${result.provider || '(no LLM call)'}/${result.model || '(no LLM call)'}`
		);
		console.log(`  LLM-Calls gesamt:       ${result.llmCalls} (a + b + c)`);
		console.log(
			`  LLM-Zeit:               total=${result.llmTimingMs.total}ms (a=${result.llmTimingMs.stageA}, b=${result.llmTimingMs.stageB}, c=${result.llmTimingMs.stageC})`
		);
		console.log(`  Tokens:                 in=${result.tokens.input}  out=${result.tokens.output}`);
		console.log(`  Gating deaktiviert:     ${result.gatingDisabled ? 'ja (Test-Modus)' : 'nein'}`);

		console.log(`\n--- Werk-Material ---`);
		console.log(`  Top-Level-Headings (Anker): ${result.headingCount}`);
		console.log(`  H1/H2-Memos vorhanden:      ${result.hadMemos ? `ja (${result.memoCount})` : 'nein'}`);

		if (result.diagnostics.warnings.length > 0) {
			console.log(`\n--- Warnings ---`);
			for (const w of result.diagnostics.warnings) {
				console.log(`  WARN: ${w}`);
			}
		}

		console.log(`\n--- Stage a — Werk-im-Lichte-der-Fragestellung ---`);
		for (const l of result.aText.split(/\n+/)) console.log(`  ${l}`);

		console.log(`\n--- Stage b — Hotspot-Würdigung pro Achse ---`);
		for (const axis of result.bAxes) {
			const ind = axis.indicator ? `[${axis.indicator}]` : '[--]';
			console.log(`  ${ind} ${axis.axisName}`);
			for (const l of axis.rationale.split(/\n+/)) console.log(`         ${l}`);
		}

		console.log(`\n--- Stage c — Aggregiertes Gesamtbild (Test-Modus, ohne review_draft) ---`);
		for (const l of result.cText.split(/\n+/)) console.log(`  ${l}`);

		if (persist) {
			console.log(`\n--- Persistenz ---`);
			console.log(`  WERK_GUTACHT-Konstrukt: ${result.constructId ?? '(nicht persistiert)'}`);
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
