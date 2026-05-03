// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression-Check für Phase 1: H1/H2-Pipeline-Pfade müssen nach den
// additiven Migrationen 043-047 + Service/UI-Änderungen unverändert
// arbeiten. Smoke-Test auf einem existierenden zentralen Dokument:
//
//   * computePreflight() — die Pre-Flight-Counts für die analytische
//     Hauptlinie + optionales synthetisches Addendum.
//   * loadEffectiveOutline() — Outline-Lese-Pfad (jetzt mit neuen
//     Feldern, aber ohne Verhaltensänderung für die Konsumenten).
//
// Aufruf: npx tsx scripts/test-h3-regression.ts <docId>

import { computePreflight } from '../src/lib/server/pipeline/orchestrator.js';
import { loadEffectiveOutline } from '../src/lib/server/documents/outline.js';
import { pool } from '../src/lib/server/db/index.js';

async function main() {
	const docId = process.argv[2];
	if (!docId) {
		console.error('Usage: npx tsx scripts/test-h3-regression.ts <docId>');
		process.exit(1);
	}

	console.log('--- Outline (selected fields) ---');
	const outline = await loadEffectiveOutline(docId);
	if (!outline) {
		console.error('Document not found.');
		process.exit(1);
	}
	console.log(`  outlineStatus: ${outline.outlineStatus}`);
	console.log(`  headings: ${outline.headings.length}`);
	const ftCount = outline.headings.filter((h) => h.outlineFunctionType !== null).length;
	console.log(`  with outline_function_type: ${ftCount}`);
	console.log(`  with granularity_level: ${outline.headings.filter((h) => h.granularityLevel !== null).length}`);

	console.log('\n--- Preflight H1 (analytical only) ---');
	const h1 = await computePreflight(docId, { includeSynthetic: false, includeValidity: false });
	for (const p of h1) {
		console.log(`  ${p.phase}: ${p.done}/${p.total} done, ${p.pending} pending`);
	}

	console.log('\n--- Preflight H1+H2 (analytical + synthetic) ---');
	const h12 = await computePreflight(docId, { includeSynthetic: true, includeValidity: false });
	for (const p of h12) {
		console.log(`  ${p.phase}: ${p.done}/${p.total} done, ${p.pending} pending`);
	}

	await pool.end();
	console.log('\nRegression smoke OK — no runtime errors.');
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
