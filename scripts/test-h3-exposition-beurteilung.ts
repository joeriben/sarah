// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Isolierter Smoke-Test für H3:EXPOSITION-Beurteilung.
// Triggert NUR den Beurteilungs-Schritt — FRAGESTELLUNG / MOTIVATION
// werden nicht angefasst.
// Aufruf: npx tsx scripts/test-h3-exposition-beurteilung.ts <caseId>

import { runBeurteilungOnly } from '../src/lib/server/ai/h3/exposition.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-exposition-beurteilung.ts <caseId>');
		process.exit(1);
	}

	const start = Date.now();
	console.log(`> H3:EXPOSITION-Beurteilung für Case ${caseId}…`);
	const result = await runBeurteilungOnly(caseId);
	const elapsedMs = Date.now() - start;

	console.log('\n--- Ergebnis ---');
	console.log(`Container-¶ insgesamt:    ${result.containerParagraphCount}`);
	console.log(`Parser-Treffer:           ${result.parserHit}`);
	console.log(`LLM-Fallback verwendet:   ${result.usedFallback}`);

	console.log(`\nBEURTEILUNG-Konstrukt:    ${result.beurteilungConstructId ?? '(keines)'}`);
	if (result.beurteilungText) {
		console.log(`  Beurteilung: ${result.beurteilungText}`);
		console.log(`  Anchors:     ${result.beurteilungAnchorParagraphIds.length} ¶ (${result.beurteilungAnchorParagraphIds.join(', ')})`);
	}

	console.log(`\nLLM-Calls:                ${result.llmCalls}`);
	console.log(`Tokens:                   in=${result.tokens.input} out=${result.tokens.output}`);
	console.log(`Modell:                   ${result.provider}/${result.model}`);
	console.log(`Laufzeit:                 ${elapsedMs}ms`);

	console.log('\n--- function_constructs (Case, EXPOSITION) ---');
	const constructs = (await query<{
		id: string;
		construct_kind: string;
		anchor_count: number;
		content: unknown;
		created_at: string;
	}>(
		`SELECT id, construct_kind,
		        cardinality(anchor_element_ids)::int AS anchor_count,
		        content, created_at
		 FROM function_constructs
		 WHERE case_id = $1
		   AND outline_function_type = 'EXPOSITION'
		 ORDER BY created_at DESC`,
		[caseId]
	)).rows;
	for (const c of constructs) {
		console.log(`  [${c.construct_kind}] ${c.id} anchors=${c.anchor_count} created=${c.created_at}`);
		console.log(`    content: ${JSON.stringify(c.content)}`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
