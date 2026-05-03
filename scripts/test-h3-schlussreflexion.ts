// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:SCHLUSSREFLEXION — GELTUNGSANSPRUCH + GRENZEN + ANSCHLUSSFORSCHUNG.
//
// Voraussetzungen:
//   - FRAGESTELLUNG (EXPOSITION)
//   - FORSCHUNGSGEGENSTAND (GTH-Schritt-4)
//   - GESAMTERGEBNIS (SYNTHESE)
//   - METHODEN/BASIS (FORSCHUNGSDESIGN, optional — sonst leerer Block im Prompt)
//   - mindestens ein Heading mit outline_function_type='SCHLUSSREFLEXION'
//
// Aufruf:
//   npx tsx scripts/test-h3-schlussreflexion.ts <caseId>             # read-only
//   npx tsx scripts/test-h3-schlussreflexion.ts <caseId> --persist
//   npx tsx scripts/test-h3-schlussreflexion.ts <caseId> --provider=openrouter --model=...

import { runSchlussreflexionPass } from '../src/lib/server/ai/h3/schlussreflexion.js';
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
			'Usage: npx tsx scripts/test-h3-schlussreflexion.ts <caseId> [--persist] [--provider=X --model=Y]'
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
			`> H3:SCHLUSSREFLEXION für Case ${caseId}${persist ? '' : ' (read-only)'}…`
		);
		const start = Date.now();
		const result = await runSchlussreflexionPass(caseId, {
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
		console.log(`  GESAMTERGEBNIS-Konstrukte:       ${result.diagnostics.gesamtergebnisCount}`);
		console.log(`  METHODEN-Konstrukt vorhanden:    ${result.hadMethoden ? 'ja' : 'nein'}`);
		console.log(`  BASIS-Konstrukt vorhanden:       ${result.hadBasis ? 'ja' : 'nein'}`);
		if (result.diagnostics.warnings.length > 0) {
			for (const w of result.diagnostics.warnings) {
				console.log(`  WARN: ${w}`);
			}
		}

		if (result.fragestellungSnippet) {
			console.log(`\n--- FRAGESTELLUNG (Snippet) ---`);
			console.log(`  »${result.fragestellungSnippet.replace(/\s+/g, ' ')}…«`);
		}
		if (result.gesamtergebnisSnippet) {
			console.log(`\n--- GESAMTERGEBNIS (Snippet) ---`);
			console.log(`  »${result.gesamtergebnisSnippet.replace(/\s+/g, ' ')}…«`);
		}

		console.log(`\n--- SCHLUSSREFLEXION-Container (${result.srContainers.length}) ---`);
		if (result.srContainers.length === 0) {
			console.log(`  (keine — Pass war no-op)`);
		} else {
			for (const c of result.srContainers) {
				console.log(`  [${c.headingText}]  (${c.paragraphCount} ¶)`);
			}
		}

		if (result.geltungsanspruchText) {
			console.log(`\n--- GELTUNGSANSPRUCH ---`);
			for (const l of result.geltungsanspruchText.split(/\n+/)) console.log(`  ${l}`);
		}
		if (result.grenzenText) {
			console.log(`\n--- GRENZEN ---`);
			for (const l of result.grenzenText.split(/\n+/)) console.log(`  ${l}`);
		}
		if (result.anschlussforschungText) {
			console.log(`\n--- ANSCHLUSSFORSCHUNG ---`);
			for (const l of result.anschlussforschungText.split(/\n+/)) console.log(`  ${l}`);
		}

		if (persist) {
			console.log(`\n--- Persistenz ---`);
			console.log(`  GELTUNGSANSPRUCH-Konstrukt: ${result.constructId ?? '(nicht persistiert)'}`);
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
