// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase-3-Smoke-Test für H3:DURCHFÜHRUNG Schritt 1 (deterministisch).
// Aufruf: npx tsx scripts/test-h3-durchfuehrung.ts <caseId>

import { runDurchfuehrungPassStep1 } from '../src/lib/server/ai/h3/durchfuehrung.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-durchfuehrung.ts <caseId>');
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

	console.log(`\nLaufzeit: ${elapsedMs}ms (kein LLM in Schritt 1)`);

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
