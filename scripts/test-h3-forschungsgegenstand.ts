// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:GRUNDLAGENTHEORIE-Schritt 4 (FORSCHUNGSGEGENSTAND_REKONSTRUIEREN).
//
// Voraussetzungen:
//   - VERWEIS_PROFIL pro GTH-Container persistiert
//     (vorher: scripts/test-h3-grundlagentheorie.ts <caseId>).
//   - FRAGESTELLUNG-Konstrukt aus EXPOSITION persistiert
//     (vorher: scripts/test-h3-exposition.ts <caseId>).
//   - Optional: BLOCK_ROUTING/BLOCK_WUERDIGUNG/ECKPUNKT_BEFUND/
//     DISKURSIV_BEZUG_BEFUND aus Schritten 2/3 (werden, wenn vorhanden,
//     im LLM-Prompt mitgeliefert).
//
// Aufruf:
//   npx tsx scripts/test-h3-forschungsgegenstand.ts <caseId>                     # read-only
//   npx tsx scripts/test-h3-forschungsgegenstand.ts <caseId> --persist           # mit Persistenz
//   npx tsx scripts/test-h3-forschungsgegenstand.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runForschungsgegenstandPass } from '../src/lib/server/ai/h3/grundlagentheorie_forschungsgegenstand.js';
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
			'Usage: npx tsx scripts/test-h3-forschungsgegenstand.ts <caseId> [--persist] [--provider=X --model=Y]'
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

	console.log(
		`> H3:GRUNDLAGENTHEORIE Schritt 4 für Case ${caseId}${persist ? '' : ' (read-only)'}…`
	);
	const start = Date.now();
	const result = await runForschungsgegenstandPass(caseId, {
		persistConstructs: persist,
		modelOverride,
	});
	const elapsedMs = Date.now() - start;

	console.log(`\n--- Lauf-Setup ---`);
	console.log(`  Modell:                 ${result.provider}/${result.model}`);
	console.log(`  LLM-Calls gesamt:       ${result.llmCalls}`);
	console.log(`  LLM-Zeit:               ${result.llmTimingMs}ms`);
	console.log(`  Tokens:                 in=${result.tokens.input}  out=${result.tokens.output}`);

	const fsShort = result.fragestellungSnippet.replace(/\s+/g, ' ');
	console.log(`\n--- FRAGESTELLUNG (Snippet aus EXPOSITION) ---`);
	console.log(`  »${fsShort}…«`);

	console.log(`\n--- GRUNDLAGENTHEORIE-Container (${result.containers.length}) ---`);
	for (const c of result.containers) {
		const flags = [
			c.hasVerweisProfil ? 'profile' : '-',
			c.hasReproductive ? 'reprod' : '-',
			c.hasDiscursive ? 'diskurs' : '-',
		].join('|');
		console.log(`  [${c.headingText}]  (${c.paragraphCount} ¶)  [${flags}]`);
	}

	if (result.forschungsgegenstand) {
		console.log(`\n--- FORSCHUNGSGEGENSTAND (rekonstruiert) ---`);
		console.log(`  Text:`);
		const lines = result.forschungsgegenstand.text.split(/\n+/);
		for (const l of lines) console.log(`    ${l}`);
		console.log(`  Subject-Keywords:`);
		console.log(`    ${result.forschungsgegenstand.subjectKeywords.join(', ')}`);
		if (result.forschungsgegenstand.salientContainerIndices.length > 0) {
			console.log(
				`  Salient-Container-Indices: ${result.forschungsgegenstand.salientContainerIndices.join(', ')}`
			);
		}
	}

	if (persist) {
		console.log(
			`\nFORSCHUNGSGEGENSTAND-Construct: ${result.constructId ?? '(nicht persistiert)'}`
		);
	}

	console.log(`\nLaufzeit gesamt:          ${elapsedMs}ms`);

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
