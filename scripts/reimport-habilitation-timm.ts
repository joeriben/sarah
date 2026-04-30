// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Re-Import des Habilitation-Timm DOCX nach dem Parser-Fix für Heading-
// Hierarchie + synthetische Numerierung. Ruft `reparseDocument` direkt im
// Pool-Client auf, weil der bestehende /api/admin/reparse-documents-Endpoint
// alle Dokumente reparsen würde — hier wollen wir genau eines.
//
// Voraussetzung: `scripts/benchmark-export-pre-parser-fix.ts` ist bereits
// gelaufen (CASCADE-Delete löscht argument_nodes/edges, scaffolding,
// memo_content).
//
// Lauf:   npx tsx scripts/reimport-habilitation-timm.ts

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool, query, queryOne } from '../src/lib/server/db/index.ts';
import { reparseDocument } from '../src/lib/server/documents/parsers/index.ts';

const DOCUMENT_ID = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc';
const DOCX_PATH = join(
	process.cwd(),
	'projekte/habilitation-timm/files/f0a8bf77-6926-45b4-b474-0a1709ae21fb.docx'
);

async function main() {
	const docRow = await queryOne<{
		full_text: string;
		mime_type: string;
		file_path: string;
	}>(
		`SELECT full_text, mime_type, file_path
		 FROM document_content WHERE naming_id = $1`,
		[DOCUMENT_ID]
	);
	if (!docRow) throw new Error(`No document_content for ${DOCUMENT_ID}`);
	console.log(
		`Document state: mime=${docRow.mime_type} text_len=${docRow.full_text.length} file_path=${docRow.file_path}`
	);

	const bytes = await readFile(DOCX_PATH);
	console.log(`Loaded DOCX bytes: ${bytes.length}`);

	const beforeStats = await query<{ level: string; count: string }>(
		`SELECT COALESCE(properties->>'level', 'NULL') AS level,
		        COUNT(*)::text AS count
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		 GROUP BY 1 ORDER BY 1`,
		[DOCUMENT_ID]
	);
	console.log(`\n=== Heading-Levels VORHER ===`);
	for (const r of beforeStats.rows)
		console.log(`  level=${r.level.padEnd(6)} count=${r.count}`);

	const t0 = Date.now();
	const client = await pool.connect();
	let canonicalFullText: string;
	try {
		await client.query('BEGIN');
		const result = await reparseDocument(
			client,
			DOCUMENT_ID,
			docRow.full_text,
			docRow.mime_type,
			bytes
		);
		canonicalFullText = result.canonicalFullText;

		if (canonicalFullText !== docRow.full_text) {
			await client.query(
				`UPDATE document_content SET full_text = $1 WHERE naming_id = $2`,
				[canonicalFullText, DOCUMENT_ID]
			);
			console.log(
				`  full_text aktualisiert: ${docRow.full_text.length} → ${canonicalFullText.length} chars`
			);
		} else {
			console.log(`  full_text unverändert (${canonicalFullText.length} chars)`);
		}

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	const dt = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(`\nRe-Import in ${dt}s.`);

	const afterStats = await query<{ level: string; count: string }>(
		`SELECT COALESCE(properties->>'level', 'NULL') AS level,
		        COUNT(*)::text AS count
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		 GROUP BY 1 ORDER BY 1`,
		[DOCUMENT_ID]
	);
	console.log(`\n=== Heading-Levels NACHHER ===`);
	for (const r of afterStats.rows)
		console.log(`  level=${r.level.padEnd(6)} count=${r.count}`);

	const numberingSample = await query<{
		level: string | null;
		num: string | null;
		mismatch: string | null;
		heading: string;
	}>(
		`SELECT properties->>'level' AS level,
		        properties->>'numbering' AS num,
		        properties->>'numbering_mismatch' AS mismatch,
		        substring((SELECT full_text FROM document_content
		                   WHERE naming_id = de.document_id)
		                  FROM char_start + 1
		                  FOR LEAST(char_end - char_start, 80)) AS heading
		 FROM document_elements de
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		 ORDER BY char_start`,
		[DOCUMENT_ID]
	);
	console.log(
		`\n=== Headings im main-Bereich (${numberingSample.rows.length}) ===`
	);
	for (const r of numberingSample.rows) {
		const lvl = r.level ?? '?';
		const num = r.num ?? '·';
		const mm = r.mismatch ? ' [MISMATCH]' : '';
		console.log(`  L${lvl}  ${num.padEnd(8)}  ${r.heading.trim()}${mm}`);
	}

	const noNumbering = await queryOne<{ count: string }>(
		`SELECT COUNT(*)::text AS count
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		   AND (properties->>'numbering') IS NULL`,
		[DOCUMENT_ID]
	);
	console.log(
		`\nMain-Headings ohne numbering: ${noNumbering?.count ?? 0} (erwartet: ~2 Edge-Cases ohne anchor)`
	);

	const mismatchCount = await queryOne<{ count: string }>(
		`SELECT COUNT(*)::text AS count
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND (properties->>'numbering_mismatch') IS NOT NULL`,
		[DOCUMENT_ID]
	);
	console.log(`Numbering-Mismatch-Warnungen: ${mismatchCount?.count ?? 0}`);

	await pool.end();
}

main().catch((e) => {
	console.error(e);
	pool.end();
	process.exit(1);
});
