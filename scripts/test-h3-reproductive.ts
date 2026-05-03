// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:GRUNDLAGENTHEORIE-Schritt 3 reproduktiv
// (BLOCK_WUERDIGUNG + ECKPUNKT_CHECK auf reproduktiv-Blöcken).
//
// Voraussetzung: BLOCK_ROUTING-Konstrukt für den Case ist persistiert
// (vorher: scripts/test-h3-routing.ts <caseId> --persist).
//
// Aufruf:
//   npx tsx scripts/test-h3-reproductive.ts <caseId>                    # read-only
//   npx tsx scripts/test-h3-reproductive.ts <caseId> --persist          # mit Persistenz
//   npx tsx scripts/test-h3-reproductive.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runReproductiveBlockPass } from '../src/lib/server/ai/h3/grundlagentheorie_reproductive.js';
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
			'Usage: npx tsx scripts/test-h3-reproductive.ts <caseId> [--persist] [--provider=X --model=Y]'
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
		`> H3:GRUNDLAGENTHEORIE Schritt 3 reproduktiv für Case ${caseId}${persist ? '' : ' (read-only)'}…`
	);
	const start = Date.now();
	const result = await runReproductiveBlockPass(caseId, {
		persistConstructs: persist,
		modelOverride,
	});
	const elapsedMs = Date.now() - start;

	console.log(`\n--- Lauf-Setup ---`);
	console.log(`  Modell:                 ${result.provider}/${result.model}`);
	console.log(`  LLM-Calls gesamt:       ${result.totalLlmCalls}`);
	console.log(`  LLM-Zeit kumuliert:     ${result.totalTimingMs}ms`);
	console.log(
		`  Tokens:                 in=${result.totalTokens.input}  out=${result.totalTokens.output}`
	);

	console.log(`\n--- GRUNDLAGENTHEORIE-Container (${result.containers.length}) ---`);
	for (const c of result.containers) {
		console.log(`\n  [${c.headingText}]  (${c.paragraphCount} ¶)`);
		console.log(`    reproduktiv-Blöcke aus Routing: ${c.reproductiveBlockCount}`);
		if (c.reproductiveBlockCount === 0) {
			console.log(`    (keine reproduktiv-Blöcke — nichts zu tun)`);
			continue;
		}
		for (const b of c.blocks) {
			const range = `¶${b.paragraphIndexRange[0]}–${b.paragraphIndexRange[1]}`;
			const span = b.paragraphIndexRange[1] - b.paragraphIndexRange[0] + 1;
			const author = b.dominantAuthor ? `  dom=${b.dominantAuthor}` : '';
			console.log(
				`\n      Block #${b.blockIndex}  ${b.type.padEnd(14)} ${range.padEnd(10)} (${String(span).padStart(2)} ¶)${author}`
			);
			const sumShort = b.summary.replace(/\s+/g, ' ').slice(0, 100);
			console.log(
				`        H2 summary [${b.summaryTimingMs}ms, in=${b.summaryTokens.input}/out=${b.summaryTokens.output}]:`
			);
			console.log(`          »${sumShort}${b.summary.length > 100 ? '…' : ''}«`);
			console.log(
				`        ECKPUNKT_CHECK [${b.eckpunktTimingMs}ms, in=${b.eckpunktTokens.input}/out=${b.eckpunktTokens.output}]:`
			);
			for (const axisName of ['kernbegriff', 'kontamination', 'provenienz'] as const) {
				const axis = b.axes[axisName];
				const ratShort = axis.rationale.replace(/\s+/g, ' ').slice(0, 60);
				const anchors =
					axis.paragraphIds && axis.paragraphIds.length > 0
						? `  anchors=${axis.paragraphIds.length}`
						: '';
				console.log(
					`          ${axisName.padEnd(13)} ${axis.signal.padEnd(6)} ${anchors}`
				);
				console.log(`            »${ratShort}${axis.rationale.length > 60 ? '…' : ''}«`);
			}
		}
		if (persist) {
			console.log(
				`\n    BLOCK_WUERDIGUNG-Construct: ${c.blockWuerdigungConstructId ?? '(nicht persistiert)'}`
			);
			console.log(
				`    ECKPUNKT_BEFUND-Construct:  ${c.eckpunktBefundConstructId ?? '(nicht persistiert)'}`
			);
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
