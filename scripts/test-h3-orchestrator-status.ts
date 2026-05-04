// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für den H3-Orchestrator-Anschluss (h3-phases.ts).
//
// Verifiziert für ein gegebenes Case:
//   - alle 9 H3-Phasen-Done-Checks laufen ohne Fehler
//   - Done-Status pro Phase auf Basis von function_constructs / version_stack
//   - Validierungs-Status pro Phase aus construct_validations (Mig 049)
//
// Aufruf: npx tsx scripts/test-h3-orchestrator-status.ts <caseId>
//
// Schreibt nichts, liest nur. Eignet sich gegen jede existierende Case-Id
// — typisch "BA H3 dev" (c42e2d8f-1771-43bb-97c8-f57d7d10530a).

import {
	isH3PhaseDone,
	isH3PhaseDoneForDocument,
	isH3PhaseValidated,
	type H3Phase,
} from '../src/lib/server/pipeline/h3-phases.js';
import { pool, queryOne } from '../src/lib/server/db/index.js';

const PHASES: H3Phase[] = [
	'h3_exposition',
	'h3_grundlagentheorie',
	'h3_forschungsdesign',
	'h3_durchfuehrung',
	'h3_synthese',
	'h3_schlussreflexion',
	'h3_exkurs',
	'h3_werk_deskription',
	'h3_werk_gutacht',
];

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-orchestrator-status.ts <caseId>');
		process.exit(1);
	}

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) {
		console.error(`Case ${caseId} not found.`);
		process.exit(1);
	}
	const documentId = caseRow.central_document_id;
	if (!documentId) {
		console.error(`Case ${caseId} has no central_document_id.`);
		process.exit(1);
	}

	console.log(`> H3-Orchestrator-Status für Case ${caseId}`);
	console.log(`  documentId: ${documentId}\n`);

	console.log('Phase                       | Done | Done(doc) | Validated');
	console.log('----------------------------+------+-----------+----------');
	for (const phase of PHASES) {
		const [done, doneDoc, validated] = await Promise.all([
			isH3PhaseDone(phase, caseId, documentId),
			isH3PhaseDoneForDocument(phase, documentId),
			isH3PhaseValidated(phase, caseId, documentId),
		]);
		const phaseLabel = phase.padEnd(27);
		const doneStr = (done ? '✓' : '·').padEnd(4);
		const doneDocStr = (doneDoc ? '✓' : '·').padEnd(9);
		const validatedStr = (validated ? '✓' : '·');
		console.log(`${phaseLabel} | ${doneStr} | ${doneDocStr} | ${validatedStr}`);
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
