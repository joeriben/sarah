// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase-1-Smoke-Test für FUNKTIONSTYP_ZUWEISEN.
// Aufruf: npx tsx scripts/test-h3-suggest.ts <docId>

import { suggestFunctionTypesForDocument } from '../src/lib/server/pipeline/function-type-assignment.js';
import { pool } from '../src/lib/server/db/index.js';

async function main() {
	const docId = process.argv[2];
	if (!docId) {
		console.error('Usage: npx tsx scripts/test-h3-suggest.ts <docId>');
		process.exit(1);
	}

	const result = await suggestFunctionTypesForDocument(docId);
	console.log('--- documentBrief ---');
	console.log(JSON.stringify(result.documentBrief, null, 2));
	console.log('--- persistResult ---');
	console.log(JSON.stringify(result.persistResult, null, 2));
	console.log('--- suggestions ---');
	for (const s of result.suggestions) {
		const head = `  [L${s.level}] "${s.text.slice(0, 60)}"`;
		const setting = s.excluded
			? '(excluded)'
			: s.suggestedFunctionType
				? `→ ${s.suggestedFunctionType} (gran ${s.suggestedGranularityLevel ?? '—'}, conf ${s.confidence}, ${s.reason})`
				: `(${s.reason})`;
		console.log(`${head} ${setting}`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
