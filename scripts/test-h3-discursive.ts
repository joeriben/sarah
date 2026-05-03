// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:GRUNDLAGENTHEORIE-Schritt 3 diskursiv
// (DISKURSIV_BEZUG_PRÜFEN auf diskursiven Blöcken).
//
// Voraussetzungen:
//   - BLOCK_ROUTING-Konstrukt für den Case ist persistiert
//     (vorher: scripts/test-h3-routing.ts <caseId> --persist).
//   - FRAGESTELLUNG-Konstrukt aus EXPOSITION-Pass ist persistiert
//     (vorher: scripts/test-h3-exposition.ts <caseId> --persist).
//
// Aufruf:
//   npx tsx scripts/test-h3-discursive.ts <caseId>                     # read-only
//   npx tsx scripts/test-h3-discursive.ts <caseId> --persist           # mit Persistenz
//   npx tsx scripts/test-h3-discursive.ts <caseId> --min-stretch=2     # Standard-Strecken min 2 ¶
//   npx tsx scripts/test-h3-discursive.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runDiskursivBezugPass } from '../src/lib/server/ai/h3/grundlagentheorie_discursive.js';
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
			'Usage: npx tsx scripts/test-h3-discursive.ts <caseId> [--persist] [--min-stretch=N] [--provider=X --model=Y]'
		);
		process.exit(1);
	}
	const persist = process.argv.includes('--persist');
	const providerArg = parseFlag('provider');
	const modelArg = parseFlag('model');
	const minStretchArg = parseFlag('min-stretch');

	const modelOverride =
		providerArg && modelArg
			? { provider: providerArg as Provider, model: modelArg }
			: undefined;

	const minStandardStretchLen = minStretchArg ? Number.parseInt(minStretchArg, 10) : undefined;
	if (minStretchArg && (!Number.isFinite(minStandardStretchLen) || minStandardStretchLen! < 1)) {
		console.error(`--min-stretch must be a positive integer (got: ${minStretchArg})`);
		process.exit(1);
	}

	console.log(
		`> H3:GRUNDLAGENTHEORIE Schritt 3 diskursiv für Case ${caseId}${persist ? '' : ' (read-only)'}…`
	);
	const start = Date.now();
	const result = await runDiskursivBezugPass(caseId, {
		persistConstructs: persist,
		modelOverride,
		minStandardStretchLen,
	});
	const elapsedMs = Date.now() - start;

	console.log(`\n--- Lauf-Setup ---`);
	console.log(`  Modell:                 ${result.provider}/${result.model}`);
	console.log(`  minStandardStretchLen:  ${result.thresholds.minStandardStretchLen}`);
	console.log(`  maxTokens:              ${result.maxTokens}`);
	console.log(`  LLM-Calls gesamt:       ${result.totalLlmCalls}`);
	console.log(`  LLM-Zeit kumuliert:     ${result.totalTimingMs}ms`);
	console.log(
		`  Tokens:                 in=${result.totalTokens.input}  out=${result.totalTokens.output}`
	);

	const fsShort = result.fragestellung.replace(/\s+/g, ' ').slice(0, 200);
	console.log(`\n--- FRAGESTELLUNG (aus EXPOSITION) ---`);
	console.log(`  »${fsShort}${result.fragestellung.length > 200 ? '…' : ''}«`);

	console.log(`\n--- GRUNDLAGENTHEORIE-Container (${result.containers.length}) ---`);
	for (const c of result.containers) {
		const routingDiscussionCount = c.blocks.filter((b) => b.source === 'routing_diskussion').length;
		const standardStretchCount = c.blocks.filter((b) => b.source === 'standard_stretch').length;
		console.log(`\n  [${c.headingText}]  (${c.paragraphCount} ¶)`);
		console.log(
			`    diskursive Blöcke gesamt: ${c.discursiveBlockCount}` +
				`  (routing_diskussion=${routingDiscussionCount}, standard_stretch=${standardStretchCount})`
		);
		if (c.discursiveBlockCount === 0) {
			console.log(`    (keine diskursiven Blöcke — nichts zu tun)`);
			continue;
		}
		for (const b of c.blocks) {
			const range = `¶${b.paragraphIndexRange[0]}–${b.paragraphIndexRange[1]}`;
			const span = b.paragraphIndexRange[1] - b.paragraphIndexRange[0] + 1;
			const author = b.dominantAuthor ? `  dom=${b.dominantAuthor}` : '';
			console.log(
				`\n      Block #${b.blockIndex}  ${b.source.padEnd(20)} ${range.padEnd(10)} (${String(span).padStart(2)} ¶)${author}`
			);
			console.log(
				`        DISKURSIV_BEZUG [${b.llmTimingMs}ms, in=${b.tokens.input}/out=${b.tokens.output}]:`
			);
			const ratShort = b.rationale.replace(/\s+/g, ' ').slice(0, 80);
			const anchors =
				b.anchorParagraphIds && b.anchorParagraphIds.length > 0
					? `  anchors=${b.anchorParagraphIds.length}`
					: '';
			console.log(
				`          bezug=${b.bezug.padEnd(10)} signal=${b.signal.padEnd(7)}${anchors}`
			);
			console.log(`          »${ratShort}${b.rationale.length > 80 ? '…' : ''}«`);
		}
		if (persist) {
			console.log(
				`\n    DISKURSIV_BEZUG_BEFUND-Construct: ${c.diskursivBezugBefundConstructId ?? '(nicht persistiert)'}`
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
