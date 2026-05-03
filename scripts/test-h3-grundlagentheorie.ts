// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:GRUNDLAGENTHEORIE-Schritt 1 (deterministisch).
//
// Aufruf:
//   npx tsx scripts/test-h3-grundlagentheorie.ts <caseId>
//   npx tsx scripts/test-h3-grundlagentheorie.ts <caseId> --read-only
//
// --read-only: keine Persistenz von Bibliografie / VERWEIS_PROFIL —
// nur Berechnung + Print, für Vergleichsläufe gegen Benchmark-Cases.

import { runGrundlagentheoriePass } from '../src/lib/server/ai/h3/grundlagentheorie.js';
import { pool, query } from '../src/lib/server/db/index.js';

async function main() {
	const caseId = process.argv[2];
	const readOnly = process.argv.includes('--read-only');
	if (!caseId) {
		console.error(
			'Usage: npx tsx scripts/test-h3-grundlagentheorie.ts <caseId> [--read-only]'
		);
		process.exit(1);
	}

	const start = Date.now();
	console.log(`> H3:GRUNDLAGENTHEORIE für Case ${caseId}${readOnly ? ' (read-only)' : ''}…`);
	const result = await runGrundlagentheoriePass(caseId, {
		persistConstructs: !readOnly,
	});
	const elapsedMs = Date.now() - start;

	console.log('\n--- Bibliografie ---');
	console.log(`  Einträge gesamt:         ${result.bibliography.entryCount}`);
	console.log(`  davon Author+Jahr ok:    ${result.bibliography.parsedAuthorYear}`);
	console.log(`  davon nur Rohtext:       ${result.bibliography.unparsedRawOnly}`);

	console.log(`\n--- GRUNDLAGENTHEORIE-Container (${result.containers.length}) ---`);
	for (const c of result.containers) {
		const p = c.profile;
		console.log(`\n  [${c.headingText}]  (${c.paragraphCount} ¶)`);
		console.log(`    Citations gesamt:        ${p.citationCount}`);
		console.log(`    Unique Autoren:          ${p.uniqueAuthorCount}`);
		console.log(`    Coverage resolved:       ${p.coverage.resolvedCitations} / ${p.coverage.totalCitations} (orphan: ${p.coverage.orphanCitations})`);
		console.log(`    Density:`);
		console.log(`      ¶ mit Citation:        ${p.density.paragraphsWithCitation} / ${p.paragraphCount}`);
		console.log(`      ¶ ohne Citation:       ${p.density.paragraphsWithoutCitation}`);
		console.log(`      Max Cit / ¶:           ${p.density.maxCitationsInOneParagraph}`);
		console.log(`      Mean Cit / ¶:          ${p.density.meanCitationsPerParagraph}`);
		console.log(`    Konzentration:`);
		console.log(`      HHI:                   ${p.density.hhi}`);
		console.log(`      Top-1-Share:           ${p.density.topAuthorShare}`);
		console.log(`      Top-3-Share:           ${p.density.top3AuthorShare}`);
		console.log(`    Konsekutiv-Dominanz:`);
		console.log(`      Max-Strecke:           ${p.density.maxConsecutiveParagraphsDominatedByAuthor} ¶`);
		console.log(`      Autor:                 ${p.density.consecutiveDominanceAuthor ?? '(keiner)'}`);
		console.log(`    Top-5 Autoren:`);
		for (const a of p.byAuthor.slice(0, 5)) {
			console.log(`      ${a.author.padEnd(20)} mentions=${a.mentions}  in_¶=${a.paragraphIds.length}  first@¶${a.firstParagraphIndex}`);
		}
		console.log(`    First-Mention-Order: [${p.firstMentionOrder.join(', ')}]`);
		console.log(`    Per-¶-Signatur (¶: count, dominantAuthor, sub-heading, snippet):`);
		// Lookup heading-Pfad + Text-Snippet pro ¶ (UI-Workaround: ¶-Nummerierung
		// im Reader zählt unterkapitelweise neu, daher Stellen-Findung über
		// outline_path + Volltext-Anfang).
		const ids = p.byParagraph.map((s) => s.paragraphId);
		const detail = (await query<{
			id: string;
			outline_path: string[] | null;
			snippet: string;
		}>(
			`SELECT pe.id,
			        (SELECT h.properties->'outline_path'
			           FROM document_elements h
			           WHERE h.document_id = pe.document_id
			             AND h.element_type = 'heading'
			             AND h.section_kind = 'main'
			             AND h.char_start <= pe.char_start
			           ORDER BY h.char_start DESC
			           LIMIT 1)::jsonb AS outline_path,
			        SUBSTRING(dc.full_text FROM pe.char_start + 1 FOR 90) AS snippet
			 FROM document_elements pe
			 JOIN document_content dc ON dc.naming_id = pe.document_id
			 WHERE pe.id = ANY($1::uuid[])`,
			[ids]
		)).rows;
		const detailById = new Map(detail.map((d) => [d.id, d]));
		for (const sig of p.byParagraph) {
			const d = detailById.get(sig.paragraphId);
			const path = d?.outline_path?.slice(-1)?.[0] ?? '?';
			const snippet = (d?.snippet ?? '').replace(/\s+/g, ' ').slice(0, 70);
			console.log(`      ¶${String(sig.paragraphIndex).padStart(2)}  cit=${String(sig.citationCount).padStart(2)}  dom=${(sig.dominantAuthor ?? '-').padEnd(12)}  [${path.slice(0, 32).padEnd(32)}]  »${snippet}…«`);
		}
		if (!readOnly) {
			console.log(`    Construct-ID:            ${c.verweisProfileConstructId}`);
		}
	}

	console.log(`\nLaufzeit:                 ${elapsedMs}ms`);

	if (!readOnly) {
		console.log('\n--- bibliography_entries (sample) ---');
		const sample = (await query<{
			first_author_lastname: string | null;
			year: string | null;
			year_suffix: string | null;
			raw_text: string;
		}>(
			`SELECT first_author_lastname, year, year_suffix, raw_text
			 FROM bibliography_entries
			 WHERE document_id = $1
			 ORDER BY char_start
			 LIMIT 8`,
			[result.documentId]
		)).rows;
		for (const r of sample) {
			const head = `[${r.first_author_lastname ?? '?'} ${r.year ?? '?'}${r.year_suffix ?? ''}]`;
			console.log(`  ${head.padEnd(20)} ${r.raw_text.slice(0, 100)}…`);
		}
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
