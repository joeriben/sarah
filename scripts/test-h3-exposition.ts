// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase-3-Smoke-Test für H3:EXPOSITION.
// Aufruf: npx tsx scripts/test-h3-exposition.ts <caseId>

import { runExpositionPass } from '../src/lib/server/ai/h3/exposition.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-exposition.ts <caseId>');
		process.exit(1);
	}

	const start = Date.now();
	console.log(`> H3:EXPOSITION für Case ${caseId}…`);
	const result = await runExpositionPass(caseId);
	const elapsedMs = Date.now() - start;

	console.log('\n--- Ergebnis ---');
	console.log(`Container-¶ insgesamt:    ${result.containerParagraphCount}`);
	console.log(`Parser-Treffer:           ${result.parserHit}`);
	console.log(`LLM-Fallback verwendet:   ${result.usedFallback}`);

	console.log(`\nFRAGESTELLUNG-Konstrukt:  ${result.fragestellungConstructId ?? '(keines)'}`);
	if (result.fragestellungText) {
		console.log(`  Text:    ${result.fragestellungText}`);
		console.log(`  Anchors: ${result.fragestellungAnchorParagraphIds.length} ¶ (${result.fragestellungAnchorParagraphIds.join(', ')})`);
	}

	console.log(`\nMOTIVATION-Konstrukt:     ${result.motivationConstructId ?? '(keines)'}`);
	if (result.motivationText) {
		console.log(`  Text:    ${result.motivationText}`);
		console.log(`  Anchors: ${result.motivationAnchorParagraphIds.length} ¶ (${result.motivationAnchorParagraphIds.join(', ')})`);
	}

	console.log(`\nLLM-Calls:                ${result.llmCalls}`);
	console.log(`Tokens:                   in=${result.tokens.input} out=${result.tokens.output}`);
	console.log(`Modell:                   ${result.provider}/${result.model}`);
	console.log(`Laufzeit:                 ${elapsedMs}ms`);

	console.log('\n--- function_constructs (Case) ---');
	const constructs = (await query<{
		id: string;
		construct_kind: string;
		anchor_count: number;
		content: unknown;
	}>(
		`SELECT id, construct_kind,
		        cardinality(anchor_element_ids)::int AS anchor_count,
		        content
		 FROM function_constructs
		 WHERE case_id = $1
		 ORDER BY created_at DESC`,
		[caseId]
	)).rows;
	for (const c of constructs) {
		console.log(`  [${c.construct_kind}] ${c.id} anchors=${c.anchor_count}`);
		console.log(`    content: ${JSON.stringify(c.content)}`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
