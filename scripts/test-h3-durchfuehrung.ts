// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase-3-Smoke-Test für H3:DURCHFÜHRUNG.
// Aufruf:
//   npx tsx scripts/test-h3-durchfuehrung.ts <caseId>                 # Step 1 (deterministisch)
//   npx tsx scripts/test-h3-durchfuehrung.ts <caseId> --step2         # + Step 2 (H1 selektiv)
//   npx tsx scripts/test-h3-durchfuehrung.ts <caseId> --step3         # + Step 3 (Grounding-Lookup, deterministisch)
//   npx tsx scripts/test-h3-durchfuehrung.ts <caseId> --step2 --step3 # alle drei

import {
	runDurchfuehrungPassStep1,
	runDurchfuehrungPassStep2,
	runDurchfuehrungPassStep3,
} from '../src/lib/server/ai/h3/durchfuehrung.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	const runStep2 = process.argv.includes('--step2');
	const runStep3 = process.argv.includes('--step3');
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-durchfuehrung.ts <caseId> [--step2] [--step3]');
		process.exit(1);
	}

	const start = Date.now();
	console.log(`> H3:DURCHFÜHRUNG Step 1 für Case ${caseId}…`);
	const result = await runDurchfuehrungPassStep1(caseId);
	const elapsedMs = Date.now() - start;

	console.log('\n--- Aggregat ---');
	console.log(`Container (DURCHFUEHRUNG):  ${result.containers.length}`);
	console.log(`¶ insgesamt:                ${result.totalParagraphs}`);
	console.log(`Hot-Spots:                  ${result.totalHotspots}`);
	console.log(
		`Hot-Spot-Quote:             ${(result.hotspotRatio * 100).toFixed(1)}%`
		+ `  (Mother-Ziel: 10–20% für H1-Folgepass)`
	);

	for (const c of result.containers) {
		console.log(`\n--- Container "${c.headingText}" ---`);
		console.log(`Heading-ID:                ${c.headingId}`);
		console.log(`¶ im Container:            ${c.totalParagraphs}`);
		console.log(`Hot-Spots:                 ${c.hotspots.length}`);
		console.log(`Virtueller Container:      ${c.virtualContainerId ?? '(keiner — keine Hot-Spots)'}`);
		for (const h of c.hotspots.slice(0, 5)) {
			const markerNames = h.markers.map((m) => `${m.name}:"${m.matchedText}"`).join(', ');
			const preview = h.text.length > 140 ? h.text.slice(0, 140) + '…' : h.text;
			console.log(`  · ¶${h.indexInContainer} [${markerNames}]`);
			console.log(`    ${preview}`);
		}
		if (c.hotspots.length > 5) {
			console.log(`  … (${c.hotspots.length - 5} weitere)`);
		}
	}

	console.log('\n--- virtual_function_containers für DURCHFUEHRUNG (Case) ---');
	const containers = (await query<{
		id: string;
		label: string | null;
		range_count: number;
		marker_summary: string;
	}>(
		`SELECT id, label,
		        jsonb_array_length(source_anchor_ranges)::int AS range_count,
		        (SELECT string_agg(DISTINCT m, ', ')
		         FROM jsonb_array_elements(source_anchor_ranges) r,
		              jsonb_array_elements_text(r->'marker_names') m) AS marker_summary
		 FROM virtual_function_containers
		 WHERE case_id = $1
		   AND outline_function_type = 'DURCHFUEHRUNG'
		 ORDER BY created_at DESC`,
		[caseId]
	)).rows;
	for (const c of containers) {
		console.log(`  [${c.id}] label="${c.label ?? '(none)'}", ranges=${c.range_count}`);
		console.log(`    marker: ${c.marker_summary}`);
	}

	console.log(`\nLaufzeit Step 1: ${elapsedMs}ms (kein LLM)`);

	if (runStep2) {
		console.log(`\n> H3:DURCHFÜHRUNG Step 2 (selektive H1) für Case ${caseId}…`);
		const start2 = Date.now();
		const r2 = await runDurchfuehrungPassStep2(caseId);
		const elapsed2 = Date.now() - start2;

		console.log('\n--- Step-2-Aggregat ---');
		console.log(`Hot-Spots:                ${r2.hotspotCount}`);
		console.log(`Verarbeitet:              ${r2.processed}`);
		console.log(`AG-Skips (idempotent):    ${r2.skippedAg}`);
		console.log(`Validity-Skips:           ${r2.skippedValidity}`);
		console.log(`Argumente neu gespeichert:${r2.totalArgumentsStored}`);
		console.log(`Scaffolding gespeichert:  ${r2.totalScaffoldingStored}`);
		console.log(`Argumente bewertet:       ${r2.totalArgumentsAssessed}`);
		console.log(
			`Tokens:                   in=${r2.tokens.input} out=${r2.tokens.output}` +
			` cacheCreate=${r2.tokens.cacheCreation} cacheRead=${r2.tokens.cacheRead}` +
			` total=${r2.tokens.total}`
		);
		console.log(`Fehler:                   ${r2.errors.length}`);
		for (const e of r2.errors.slice(0, 5)) {
			console.log(`  · [${e.stage}] ${e.paragraphId}: ${e.message.slice(0, 200)}`);
		}

		console.log('\n--- pro Hot-Spot ---');
		for (const h of r2.hotspots) {
			const agTag = h.ag.ranSkipped
				? 'AG=skip'
				: `AG=${h.ag.argumentsStored}args+${h.ag.scaffoldingStored}scaff`;
			const vTag = h.validity.ranSkipped
				? 'V=skip'
				: `V=${h.validity.argumentsAssessed}assessed`;
			const errTag = h.error ? `  ERR[${h.error.stage}]: ${h.error.message.slice(0, 80)}` : '';
			console.log(`  · ${h.paragraphId.slice(0, 8)} [${h.markerNames.join('|')}]  ${agTag}  ${vTag}${errTag}`);
		}

		console.log(`\nLaufzeit Step 2: ${elapsed2}ms (selektive H1 auf ${r2.processed} ¶)`);
	}

	if (runStep3) {
		console.log(`\n> H3:DURCHFÜHRUNG Step 3 (Grounding-Lookup, deterministisch) für Case ${caseId}…`);
		const start3 = Date.now();
		const r3 = await runDurchfuehrungPassStep3(caseId);
		const elapsed3 = Date.now() - start3;

		console.log('\n--- Step-3-Aggregat ---');
		console.log(`Hot-Spots:                       ${r3.hotspotCount}`);
		console.log(`Tokens insgesamt:                ${r3.totalExtractedTokens}`);
		console.log(`davon im Vorlauf gematcht:       ${r3.totalMatched}`);
		console.log(`davon unmatched:                 ${r3.totalUnmatched}`);
		const matchQuote =
			r3.totalExtractedTokens > 0
				? ((r3.totalMatched / r3.totalExtractedTokens) * 100).toFixed(1)
				: '0.0';
		console.log(`Match-Quote:                     ${matchQuote}%`);

		console.log('\n--- pro Hot-Spot ---');
		for (const h of r3.hotspots.slice(0, 6)) {
			console.log(
				`  · ${h.hotspotParagraphId.slice(0, 8)}` +
					`  tokens=${h.extractedTokens}` +
					`  matched=${h.matchedTokens}` +
					`  unmatched=${h.unmatchedTokens}`
			);
			for (const m of h.lookup.matches.slice(0, 4)) {
				console.log(
					`      [${m.kind}] ${m.token}: ` +
						`first=${m.firstParagraphId?.slice(0, 8)}, nearest=${m.nearestParagraphId?.slice(0, 8)} ` +
						`(${m.matchedParagraphIds.length} hits)`
				);
			}
			if (h.lookup.matches.length > 4) {
				console.log(`      … (${h.lookup.matches.length - 4} weitere)`);
			}
			if (h.lookup.unmatched.length > 0) {
				const sample = h.lookup.unmatched.slice(0, 6).map((u) => `${u.token}[${u.kind[0]}]`).join(', ');
				console.log(
					`      unmatched: ${sample}` +
						(h.lookup.unmatched.length > 6 ? ` … (+${h.lookup.unmatched.length - 6})` : '')
				);
			}
		}
		if (r3.hotspots.length > 6) {
			console.log(`  … (${r3.hotspots.length - 6} weitere Hot-Spots)`);
		}

		console.log(`\nLaufzeit Step 3: ${elapsed3}ms (kein LLM)`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
