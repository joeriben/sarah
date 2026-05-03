// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase-3-Smoke-Test für H3:FORSCHUNGSDESIGN.
// Aufruf: npx tsx scripts/test-h3-forschungsdesign.ts <caseId>

import { runForschungsdesignPass } from '../src/lib/server/ai/h3/forschungsdesign.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-forschungsdesign.ts <caseId>');
		process.exit(1);
	}

	const start = Date.now();
	console.log(`> H3:FORSCHUNGSDESIGN für Case ${caseId}…`);
	const result = await runForschungsdesignPass(caseId);
	const elapsedMs = Date.now() - start;

	console.log('\n--- Sammlung ---');
	console.log(`Strategie:                ${result.strategy ?? '(keine — nichts gefunden)'}`);
	console.log(`Container-Heading:        ${result.containerLabel ?? '(n/a)'}`);
	console.log(`Gesammelte ¶:             ${result.collectedParagraphCount}`);
	console.log(`Virtueller Container:     ${result.virtualContainerId ?? '(keiner)'}`);

	console.log('\n--- Bezugsrahmen ---');
	console.log(`FRAGESTELLUNG vorhanden:        ${result.hadFragestellung}`);
	console.log(`FORSCHUNGSGEGENSTAND vorhanden: ${result.hadForschungsgegenstand}`);
	console.log(`Bezugsrahmen vollständig:       ${result.bezugsrahmenComplete}`);

	console.log('\n--- METHODOLOGIE ---');
	if (result.methodologie) {
		console.log(`  Konstrukt: ${result.methodologie.constructId}`);
		console.log(`  Text:      ${result.methodologie.text}`);
	} else {
		console.log('  (kein Konstrukt persistiert)');
	}

	console.log('\n--- METHODEN ---');
	if (result.methoden) {
		console.log(`  Konstrukt: ${result.methoden.constructId}`);
		console.log(`  Text:      ${result.methoden.text}`);
	} else {
		console.log('  (kein Konstrukt persistiert)');
	}

	console.log('\n--- BASIS ---');
	if (result.basis) {
		console.log(`  Konstrukt: ${result.basis.constructId}`);
		console.log(`  Text:      ${result.basis.text}`);
	} else {
		console.log('  (kein Konstrukt persistiert)');
	}

	console.log('\n--- Lauf-Metadaten ---');
	console.log(`LLM-Calls:    ${result.llmCalls}`);
	console.log(`Tokens:       in=${result.tokens.input} out=${result.tokens.output}`);
	console.log(`Modell:       ${result.provider}/${result.model}`);
	console.log(`Laufzeit:     ${elapsedMs}ms`);

	console.log('\n--- function_constructs für FORSCHUNGSDESIGN (Case) ---');
	const constructs = (await query<{
		id: string;
		construct_kind: string;
		anchor_count: number;
		virtual_container_id: string | null;
		content: unknown;
	}>(
		`SELECT id, construct_kind,
		        cardinality(anchor_element_ids)::int AS anchor_count,
		        virtual_container_id,
		        content
		 FROM function_constructs
		 WHERE case_id = $1
		   AND outline_function_type = 'FORSCHUNGSDESIGN'
		 ORDER BY created_at DESC`,
		[caseId]
	)).rows;
	for (const c of constructs) {
		console.log(`  [${c.construct_kind}] ${c.id}`);
		console.log(`    anchors: ${c.anchor_count}, container: ${c.virtual_container_id ?? '(none)'}`);
		console.log(`    content: ${JSON.stringify(c.content)}`);
	}

	console.log('\n--- virtual_function_containers für FORSCHUNGSDESIGN (Case) ---');
	const containers = (await query<{
		id: string;
		label: string | null;
		range_count: number;
		provenance_summary: string;
	}>(
		`SELECT id, label,
		        jsonb_array_length(source_anchor_ranges)::int AS range_count,
		        (SELECT string_agg(DISTINCT (r->>'provenance')::text, ', ')
		         FROM jsonb_array_elements(source_anchor_ranges) r) AS provenance_summary
		 FROM virtual_function_containers
		 WHERE case_id = $1
		   AND outline_function_type = 'FORSCHUNGSDESIGN'
		 ORDER BY created_at DESC`,
		[caseId]
	)).rows;
	for (const c of containers) {
		console.log(`  [${c.id}] label=${c.label ?? '(none)'}, ranges=${c.range_count}, provenance=${c.provenance_summary}`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
