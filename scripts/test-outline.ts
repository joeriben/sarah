// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Verifikation der loadEffectiveOutline / upsertClassification / confirmOutline-
// Logik gegen die Habilitation-Timm. Fährt einen vollständigen Workflow-
// Roundtrip ab: lade Outline → korrigiere die 3 Edge-Cases → bestätige
// Outline → räume Korrekturen wieder auf (damit der Test idempotent ist).

import { pool, query } from '../src/lib/server/db/index.ts';
import {
	loadEffectiveOutline,
	upsertClassification,
	confirmOutline
} from '../src/lib/server/documents/outline.ts';

const DOCUMENT_ID = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc';
const SARAH_USER_ID = 'dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b';

async function main() {
	console.log('=== 1. Outline laden (vor jeder Korrektur) ===\n');
	const before = await loadEffectiveOutline(DOCUMENT_ID);
	if (!before) throw new Error('Outline not loadable');

	console.log(`outline_status: ${before.outlineStatus}`);
	console.log(`headings: ${before.headings.length}\n`);

	const noNum = before.headings.filter((h) => h.hasNoNumberingFromParser);
	console.log(`Headings ohne Parser-Numerierung: ${noNum.length}`);
	for (const h of noNum) {
		console.log(`  L${h.effectiveLevel}  ${h.effectiveText}  (id ${h.elementId})`);
	}

	console.log('\n=== 2. Edge-Case-Korrekturen anwenden ===\n');

	// (a) "Verzeichnis der Transkriptausschnitte" → ausschließen
	const verzeichnis = before.headings.find((h) =>
		h.effectiveText.startsWith('Verzeichnis der Transkriptausschnitte')
	);
	if (verzeichnis) {
		await upsertClassification(DOCUMENT_ID, verzeichnis.elementId, {
			excluded: true
		});
		console.log(`exclude: "${verzeichnis.effectiveText}"`);
	}

	// (b) "Vergleichshorizonte..." → Level 2 → 3
	const vergleich = before.headings.find((h) =>
		h.effectiveText.startsWith('Vergleichshorizonte')
	);
	if (vergleich) {
		await upsertClassification(DOCUMENT_ID, vergleich.elementId, {
			user_level: 3
		});
		console.log(`level 2→3: "${vergleich.effectiveText}"`);
	}

	// (c) "Reflexionen..." → Level bleibt 1 (kein Patch nötig, numbering wird automatisch berechnet)
	//      Wir setzen trotzdem user_level=1 explizit, damit eine classification entsteht
	//      und sichtbar wird, dass der User das Heading "berührt" hat.
	const reflexionen = before.headings.find((h) =>
		h.effectiveText.startsWith('Reflexionen der kulturbezogenen')
	);
	if (reflexionen) {
		await upsertClassification(DOCUMENT_ID, reflexionen.elementId, {
			user_level: 1
		});
		console.log(`mark L1: "${reflexionen.effectiveText}"`);
	}

	console.log('\n=== 3. Outline laden (nach Korrekturen) ===\n');
	const after = await loadEffectiveOutline(DOCUMENT_ID);
	if (!after) throw new Error('Outline missing');

	console.log(`outline_status: ${after.outlineStatus}\n`);

	// Numerierung soll für Hauptkapitel jetzt 1, 2, 3, 4 sein.
	const l1 = after.headings.filter((h) => h.effectiveLevel === 1 && !h.excluded);
	console.log(`L1-Hauptkapitel nach Korrektur: ${l1.length}`);
	for (const h of l1) {
		console.log(`  num=${h.effectiveNumbering}  ${h.effectiveText}`);
	}

	const noNumAfter = after.headings.filter(
		(h) => !h.excluded && !h.effectiveNumbering
	);
	console.log(`\nNicht-excluded ohne Numerierung: ${noNumAfter.length}`);

	console.log('\n=== 4. Outline bestätigen ===');
	await confirmOutline(DOCUMENT_ID, SARAH_USER_ID);
	const confirmed = await loadEffectiveOutline(DOCUMENT_ID);
	console.log(`outline_status: ${confirmed?.outlineStatus}`);
	console.log(`outline_confirmed_at: ${confirmed?.outlineConfirmedAt}`);

	console.log('\n=== 5. Pipeline-Block Test ===');
	// Probe: ist outline_status="confirmed" auf document_content sichtbar?
	const r = await query<{ outline_status: string }>(
		`SELECT outline_status FROM document_content WHERE naming_id = $1`,
		[DOCUMENT_ID]
	);
	console.log(`document_content.outline_status: ${r.rows[0]?.outline_status}`);

	// Test: eine Classification editieren → outline_status muss zurück auf pending
	if (vergleich) {
		await upsertClassification(DOCUMENT_ID, vergleich.elementId, {
			user_level: 3
		});
		const back = await query<{ outline_status: string }>(
			`SELECT outline_status FROM document_content WHERE naming_id = $1`,
			[DOCUMENT_ID]
		);
		console.log(
			`Nach Edit: outline_status=${back.rows[0]?.outline_status} (erwartet: pending)`
		);
	}

	console.log('\n=== 6. Aufräumen (alle Test-Klassifikationen löschen) ===');
	const del = await query(
		`DELETE FROM heading_classifications WHERE document_id = $1`,
		[DOCUMENT_ID]
	);
	console.log(`gelöscht: ${del.rowCount} classifications`);

	await query(
		`UPDATE document_content
		 SET outline_status = 'pending',
		     outline_confirmed_at = NULL,
		     outline_confirmed_by = NULL
		 WHERE naming_id = $1`,
		[DOCUMENT_ID]
	);
	console.log(`outline_status zurückgesetzt auf 'pending'`);

	await pool.end();
}

main().catch((e) => {
	console.error(e);
	pool.end();
	process.exit(1);
});
