// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:SYNTHESE — Forward-Integration der DURCHFÜHRUNGS-BEFUNDE.
//
// Architektur (siehe docs/h3_synthese_status.md):
//   Werk-Aggregat: ein GESAMTERGEBNIS-Konstrukt pro Werk, anchor = alle ¶
//   aller SYNTHESE-Container. content = {gesamtergebnisText,
//   fragestellungsAntwortText, erkenntnisIntegration[], coverageRatio}.
//   Idempotent (delete-before-insert).
//
// Voraussetzungen:
//   - FRAGESTELLUNG aus EXPOSITION
//     (vorher: scripts/test-h3-exposition.ts <caseId>)
//   - FORSCHUNGSGEGENSTAND aus GTH-Schritt-4
//     (vorher: scripts/test-h3-forschungsgegenstand.ts <caseId> --persist)
//   - BEFUND-Konstrukte aus DURCHFÜHRUNG (ggf. ohne — dann läuft SYNTHESE
//     mit leerer ERKENNTNIS_INTEGRATION-Liste, was funktional gültig ist;
//     coverageRatio=null)
//   - Mindestens ein Heading mit outline_function_type='SYNTHESE'.
//
// Aufruf:
//   npx tsx scripts/test-h3-synthese.ts <caseId>                  # read-only
//   npx tsx scripts/test-h3-synthese.ts <caseId> --persist        # mit Persistenz
//   npx tsx scripts/test-h3-synthese.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runSynthesePass } from '../src/lib/server/ai/h3/synthese.js';
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
			'Usage: npx tsx scripts/test-h3-synthese.ts <caseId> [--persist] ' +
				'[--provider=X --model=Y]'
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
			`> H3:SYNTHESE für Case ${caseId}${persist ? '' : ' (read-only)'}…`
		);
		const start = Date.now();
		const result = await runSynthesePass(caseId, {
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

		console.log(`\n--- Diagnose ---`);
		console.log(`  FRAGESTELLUNG-Konstrukte:        ${result.diagnostics.fragestellungCount}`);
		console.log(`  FORSCHUNGSGEGENSTAND-Konstrukte: ${result.diagnostics.forschungsgegenstandCount}`);
		console.log(`  BEFUND-Konstrukte (text!=null):  ${result.befundCount}`);
		if (result.diagnostics.warnings.length > 0) {
			for (const w of result.diagnostics.warnings) {
				console.log(`  WARN: ${w}`);
			}
		}

		if (result.fragestellungSnippet) {
			const fsShort = result.fragestellungSnippet.replace(/\s+/g, ' ');
			console.log(`\n--- FRAGESTELLUNG (Snippet) ---`);
			console.log(`  »${fsShort}…«`);
		}
		if (result.forschungsgegenstandSnippet) {
			const fgShort = result.forschungsgegenstandSnippet.replace(/\s+/g, ' ');
			console.log(`\n--- FORSCHUNGSGEGENSTAND (Snippet) ---`);
			console.log(`  »${fgShort}…«`);
		}

		console.log(`\n--- SYNTHESE-Container (${result.syntheseContainers.length}) ---`);
		if (result.syntheseContainers.length === 0) {
			console.log(`  (keine — Pass war no-op)`);
		} else {
			for (const c of result.syntheseContainers) {
				console.log(`  [${c.headingText}]  (${c.paragraphCount} ¶)`);
			}
		}

		if (result.gesamtergebnis) {
			console.log(`\n--- GESAMTERGEBNIS ---`);
			const lines = result.gesamtergebnis.text.split(/\n+/);
			for (const l of lines) console.log(`  ${l}`);

			console.log(`\n--- FRAGESTELLUNGS-ANTWORT ---`);
			const aLines = result.gesamtergebnis.fragestellungsAntwort.split(/\n+/);
			for (const l of aLines) console.log(`  ${l}`);

			console.log(
				`\n--- ERKENNTNIS-INTEGRATION (${result.gesamtergebnis.erkenntnisIntegration.length} BEFUNDE` +
					`${result.gesamtergebnis.coverageRatio !== null ? `, coverage=${(result.gesamtergebnis.coverageRatio * 100).toFixed(0)}%` : ''}) ---`
			);
			if (result.gesamtergebnis.erkenntnisIntegration.length === 0) {
				console.log(`  (keine BEFUNDE — DURCHFÜHRUNG hat keine ERKENNTNISSE produziert)`);
			} else {
				for (const e of result.gesamtergebnis.erkenntnisIntegration) {
					const flag = e.integriert ? '✓' : '✗';
					const anchor = e.synthesisAnchorParagraphId
						? ` → SYNTHESE-¶ ${e.synthesisAnchorParagraphId.slice(0, 8)}…`
						: '';
					console.log(`  ${flag} ${e.befundSnippet.slice(0, 120)}${anchor}`);
					if (e.hinweis) {
						console.log(`     Hinweis: ${e.hinweis}`);
					}
				}
			}
		}

		if (persist) {
			console.log(`\n--- Persistenz ---`);
			console.log(`  GESAMTERGEBNIS-Konstrukt: ${result.constructId ?? '(nicht persistiert)'}`);
			if (result.deletedPriorCount > 0) {
				console.log(`  (${result.deletedPriorCount} prior GESAMTERGEBNIS-Konstrukt(e) ersetzt — idempotent)`);
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
