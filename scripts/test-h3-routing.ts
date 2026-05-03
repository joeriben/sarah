// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:GRUNDLAGENTHEORIE-Schritt 2 (Routing per WIEDERGABE_PRÜFEN).
//
// Aufruf:
//   npx tsx scripts/test-h3-routing.ts <caseId>                    # read-only
//   npx tsx scripts/test-h3-routing.ts <caseId> --persist          # mit Persistenz
//   npx tsx scripts/test-h3-routing.ts <caseId> --cluster=4 --gap=5
//   npx tsx scripts/test-h3-routing.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runRoutingPass } from '../src/lib/server/ai/h3/grundlagentheorie_routing.js';
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
			'Usage: npx tsx scripts/test-h3-routing.ts <caseId> [--persist] [--cluster=N] [--gap=M] [--provider=X --model=Y]'
		);
		process.exit(1);
	}
	const persist = process.argv.includes('--persist');
	const clusterArg = parseFlag('cluster');
	const gapArg = parseFlag('gap');
	const providerArg = parseFlag('provider');
	const modelArg = parseFlag('model');

	const minClusterLen = clusterArg ? parseInt(clusterArg, 10) : undefined;
	const minCitationGapLen = gapArg ? parseInt(gapArg, 10) : undefined;
	const modelOverride =
		providerArg && modelArg
			? { provider: providerArg as Provider, model: modelArg }
			: undefined;

	console.log(
		`> H3:GRUNDLAGENTHEORIE Routing für Case ${caseId}${persist ? '' : ' (read-only)'}…`
	);
	const start = Date.now();
	const result = await runRoutingPass(caseId, {
		persistConstructs: persist,
		minClusterLen,
		minCitationGapLen,
		modelOverride,
	});
	const elapsedMs = Date.now() - start;

	console.log(`\n--- Lauf-Setup ---`);
	console.log(`  Modell:                 ${result.provider}/${result.model}`);
	console.log(
		`  Schwellen:              minClusterLen=${result.thresholds.minClusterLen}  minCitationGapLen=${result.thresholds.minCitationGapLen}`
	);
	console.log(`  LLM-Calls gesamt:       ${result.totalLlmCalls}`);
	console.log(`  LLM-Zeit kumuliert:     ${result.totalTimingMs}ms`);
	console.log(
		`  Tokens:                 in=${result.totalTokens.input}  out=${result.totalTokens.output}`
	);

	console.log(`\n--- GRUNDLAGENTHEORIE-Container (${result.containers.length}) ---`);
	for (const c of result.containers) {
		console.log(`\n  [${c.headingText}]  (${c.paragraphCount} ¶)`);
		console.log(`    Verdachts-Blöcke: ${c.blocks.length}`);
		if (c.blocks.length === 0) {
			console.log(`    (keine Verdachts-Blöcke bei diesen Schwellen)`);
		}
		const cls = { wiedergabe: 0, diskussion: 0 };
		for (const b of c.blocks) cls[b.classification] += 1;
		console.log(
			`    Klassifikation: wiedergabe=${cls.wiedergabe}  diskussion=${cls.diskussion}`
		);
		for (const b of c.blocks) {
			const range = `¶${b.paragraphIndexRange[0]}–${b.paragraphIndexRange[1]}`;
			const span = b.paragraphIndexRange[1] - b.paragraphIndexRange[0] + 1;
			const author = b.dominantAuthor ? `  dom=${b.dominantAuthor}` : '';
			const conf = b.confidence ? `  conf=${b.confidence}` : '';
			const rat = b.rationale.replace(/\s+/g, ' ').slice(0, 80);
			console.log(
				`      ${b.type.padEnd(14)} ${range.padEnd(10)} (${String(span).padStart(2)} ¶)${author}  →  ${b.classification}${conf}  [${b.llmTimingMs}ms]`
			);
			console.log(`        »${rat}${b.rationale.length > 80 ? '…' : ''}«`);
		}
		if (persist) {
			console.log(`    Construct-ID:           ${c.blockRoutingConstructId ?? '(nicht persistiert)'}`);
		}
	}

	console.log(`\nLaufzeit gesamt:          ${elapsedMs}ms`);

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
