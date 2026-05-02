// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// End-to-end DB test of the anonymization orchestrator.
// Creates a throw-away document in a throw-away project, runs
// `anonymizeDocumentDeterministic`, verifies the DB state, then cleans up.
//
// Run:  npx tsx scripts/test-anonymize-db.ts

import { pool, query, transaction } from '../src/lib/server/db/index.ts';
import { anonymizeDocumentDeterministic } from '../src/lib/server/documents/anonymize/index.ts';
import { loadActiveSeeds, scanForPiiHits } from '../src/lib/server/ai/failsafe.ts';

const sample = `Friedrich-Alexander-Universität Erlangen-Nürnberg
Philosophische Fakultät und Fachbereich Theologie

Habilitationsschrift

Bildungsphilosophie als Reflexion.

vorgelegt von Dr. phil. Maria Mustermann
Matrikelnummer: 12345678
E-Mail: maria.mustermann@fau.de

Betreuer: Prof. Dr. Hans Müller

Erlangen, im Frühjahr 2026

1. Einleitung

Die vorliegende Arbeit unternimmt den Versuch, mit Maria Mustermann
und Hans Müller in einen Dialog zu treten. Mustermann argumentiert ...
`;

const TEST_USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b'; // sarah@example.com

async function main(): Promise<void> {
	console.log('Creating throw-away project + document …');

	const { projectId, docId } = await transaction(async (client) => {
		const projRes = await client.query(
			`INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id`,
			[`__test_anonymize_${Date.now()}`, TEST_USER_ID]
		);
		const pid: string = projRes.rows[0].id;

		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[pid, 'Habilitation_Mustermann_2026.docx', TEST_USER_ID]
		);
		const did: string = namingRes.rows[0].id;

		await client.query(
			`INSERT INTO document_content (naming_id, full_text, mime_type, file_size)
			 VALUES ($1, $2, $3, $4)`,
			[did, sample, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sample.length]
		);

		// Synthetic element: covers the "vorgelegt von Dr. phil. Maria Mustermann" line.
		const lineStart = sample.indexOf('vorgelegt von');
		const lineEnd = sample.indexOf('\n', lineStart);
		await client.query(
			`INSERT INTO document_elements (document_id, element_type, seq, char_start, char_end, properties)
			 VALUES ($1, 'paragraph', 0, $2, $3, '{}'::jsonb)`,
			[did, lineStart, lineEnd]
		);
		await client.query(
			`INSERT INTO document_elements (document_id, element_type, seq, char_start, char_end, properties)
			 VALUES ($1, 'sentence', 1, $2, $3, '{}'::jsonb)`,
			[did, lineStart, lineEnd]
		);
		await client.query(
			`INSERT INTO document_elements (document_id, element_type, seq, char_start, char_end, properties)
			 VALUES ($1, 'heading', 2, $2, $3, '{"level": 1}'::jsonb)`,
			[did, sample.indexOf('1. Einleitung'), sample.indexOf('1. Einleitung') + '1. Einleitung'.length]
		);

		return { projectId: pid, docId: did };
	});

	console.log(`  project: ${projectId}`);
	console.log(`  doc:     ${docId}`);

	console.log('\nRunning anonymizeDocumentDeterministic …');
	const result = await anonymizeDocumentDeterministic(docId);
	console.log('  result:', result);

	console.log('\nReading post-state from DB …');
	const stateRes = await query(
		`SELECT n.inscription, dc.full_text, dc.anonymization_status,
		        dc.anonymized_at, dc.original_filename
		   FROM document_content dc
		   JOIN namings n ON n.id = dc.naming_id
		  WHERE dc.naming_id = $1`,
		[docId]
	);
	const state = stateRes.rows[0];
	console.log(`  inscription:     ${state.inscription}`);
	console.log(`  status:          ${state.anonymization_status}`);
	console.log(`  original_fname:  ${state.original_filename}`);
	console.log(`  anonymized_at:   ${state.anonymized_at}`);
	console.log('\n  full_text after:');
	console.log(state.full_text.split('\n').map((l: string) => '    ' + l).join('\n'));

	const elemRes = await query(
		`SELECT element_type, char_start, char_end FROM document_elements
		  WHERE document_id = $1 ORDER BY char_start, seq`,
		[docId]
	);
	console.log('\n  elements (after shift):');
	for (const e of elemRes.rows) {
		const slice = state.full_text.slice(e.char_start, e.char_end);
		console.log(`    ${e.element_type.padEnd(10)} [${e.char_start}..${e.char_end}] "${slice}"`);
	}

	const seeds = await loadActiveSeeds([docId]);
	console.log(`\n  persisted seeds: ${seeds.length}`);
	for (const s of seeds) {
		console.log(`    [${s.category}/${s.role ?? '-'}] "${s.value}" → ${s.replacement}`);
	}

	const leakHits = scanForPiiHits(state.full_text, seeds);
	console.log(`\n  failsafe scan against new full_text: ${leakHits.length} hits (expected 0)`);

	console.log('\nCleanup …');
	await query(`DELETE FROM projects WHERE id = $1`, [projectId]);

	console.log('\n✓ Done.');
	await pool.end();
}

main().catch((err) => {
	console.error('TEST FAILED:', err);
	process.exit(1);
});
