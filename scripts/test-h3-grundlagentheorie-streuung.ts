// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Read-only Streuungs-Test für H3:GRUNDLAGENTHEORIE-Schritt 1.
// Anwendung: prüft Regex-Coverage auf Werken, deren GRUNDLAGENTHEORIE-
// Container noch NICHT via FUNKTIONSTYP_ZUWEISEN gesetzt ist (z.B. Habils).
// Geht über das ganze Werk (alle section_kind='main' Paragraphen) und
// produziert die zentralen Indikatoren ohne Persistenz — Benchmark-safe.
//
// Aufruf:
//   npx tsx scripts/test-h3-grundlagentheorie-streuung.ts <caseId>
//   npx tsx scripts/test-h3-grundlagentheorie-streuung.ts <caseId> --container "<heading-substring>"
//
// --container: schränkt die Citation-Auszählung auf alle ¶ ab dem ersten
// Heading mit dem genannten Substring bis zum nächsten Heading mit gleichem
// oder höherem hierarchischem Level (properties.level) ein. Damit kann ohne
// FUNKTIONSTYP_ZUWEISEN-Setzung ein Theorie-Container fokussiert vermessen
// werden. Bibliografie wird unverändert über das ganze Werk gelesen.

import {
	loadBibliographyParagraphs,
	extractAuthorYearFromEntry,
	extractInlineCitations,
} from '../src/lib/server/ai/h3/grundlagentheorie.js';
import { pool, query, queryOne } from '../src/lib/server/db/index.js';

interface MainParagraph {
	paragraphId: string;
	charStart: number;
	charEnd: number;
	text: string;
	indexInContainer: number;
}

async function main() {
	const caseId = process.argv[2];
	const containerArgIdx = process.argv.indexOf('--container');
	const containerSubstring =
		containerArgIdx >= 0 && process.argv[containerArgIdx + 1]
			? process.argv[containerArgIdx + 1]
			: null;
	if (!caseId) {
		console.error('Usage: npx tsx scripts/test-h3-grundlagentheorie-streuung.ts <caseId> [--container "<heading-substring>"]');
		process.exit(1);
	}

	const c = await queryOne<{ name: string; central_document_id: string | null }>(
		`SELECT name, central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!c?.central_document_id) {
		console.error(`Case ${caseId} not found / no central document`);
		process.exit(1);
	}
	const documentId = c.central_document_id;

	console.log(`> Streuungs-Test (read-only) für "${c.name}"`);
	console.log(`  Case: ${caseId}`);
	console.log(`  Document: ${documentId}\n`);

	// Bibliografie (in-memory, keine Persistenz)
	const bibParagraphs = await loadBibliographyParagraphs(documentId);
	const bibEntries = bibParagraphs
		.filter((p) => p.text.length >= 5)
		.map((p) => {
			const ay = extractAuthorYearFromEntry(p.text);
			return { ...p, ...ay };
		});
	const bibParsed = bibEntries.filter((e) => e.firstAuthorLastname && e.year);
	console.log('--- Bibliografie ---');
	console.log(`  Einträge gesamt:         ${bibEntries.length}`);
	console.log(`  davon Author+Jahr ok:    ${bibParsed.length}`);
	console.log(`  davon nur Rohtext:       ${bibEntries.length - bibParsed.length}`);

	// Bib-Index für Cross-Reference
	const bibIndex = bibParsed.map((e) => ({
		key: `${e.firstAuthorLastname}|${e.year}|${e.yearSuffix ?? ''}`,
		firstAuthorLastname: e.firstAuthorLastname!,
		year: e.year!,
		yearSuffix: e.yearSuffix,
	}));

	// Container-Range bestimmen, falls --container gesetzt.
	let charLowerBound = 0;
	let charUpperBound = 2147483647;
	let containerHeadingText: string | null = null;
	if (containerSubstring) {
		const headings = (await query<{
			char_start: number;
			char_end: number;
			level: number | null;
			text: string;
		}>(
			`SELECT de.char_start,
			        de.char_end,
			        (de.properties->>'level')::int AS level,
			        SUBSTRING(dc.full_text FROM de.char_start + 1
			                              FOR de.char_end - de.char_start) AS text
			 FROM document_elements de
			 JOIN document_content dc ON dc.naming_id = de.document_id
			 WHERE de.document_id = $1
			   AND de.element_type = 'heading'
			   AND de.section_kind = 'main'
			 ORDER BY de.char_start`,
			[documentId]
		)).rows;
		const matchIdx = headings.findIndex((h) =>
			h.text.toLowerCase().includes(containerSubstring.toLowerCase())
		);
		if (matchIdx < 0) {
			console.error(`Heading mit Substring "${containerSubstring}" nicht gefunden.`);
			process.exit(1);
		}
		const matchHeading = headings[matchIdx];
		const matchLevel = matchHeading.level ?? 1;
		containerHeadingText = matchHeading.text.trim();
		charLowerBound = matchHeading.char_end;
		const next = headings
			.slice(matchIdx + 1)
			.find((h) => (h.level ?? 99) <= matchLevel);
		charUpperBound = next?.char_start ?? 2147483647;
		console.log(`  Container:               "${containerHeadingText}" (level ${matchLevel})`);
		console.log(`  char-Range:              ${charLowerBound}–${charUpperBound}`);
	}

	const mainRows = (await query<{
		paragraph_id: string;
		char_start: number;
		char_end: number;
		text: string;
	}>(
		`SELECT p.id AS paragraph_id,
		        p.char_start,
		        p.char_end,
		        SUBSTRING(dc.full_text FROM p.char_start + 1
		                              FOR p.char_end - p.char_start) AS text
		 FROM document_elements p
		 JOIN document_content dc ON dc.naming_id = p.document_id
		 WHERE p.document_id = $1
		   AND p.element_type = 'paragraph'
		   AND p.section_kind = 'main'
		   AND p.char_start >= $2
		   AND p.char_start < $3
		 ORDER BY p.char_start`,
		[documentId, charLowerBound, charUpperBound]
	)).rows;
	const paragraphs: MainParagraph[] = mainRows.map((r, i) => ({
		paragraphId: r.paragraph_id,
		charStart: r.char_start,
		charEnd: r.char_end,
		text: r.text.trim(),
		indexInContainer: i,
	}));

	console.log(`\n--- ${containerHeadingText ? `Container "${containerHeadingText}"` : "Werk gesamt (section_kind='main')"} ---`);
	console.log(`  Paragraphen:             ${paragraphs.length}`);

	// Citations extrahieren
	const allCitations = paragraphs.flatMap((p) => extractInlineCitations(p));

	// Cross-Reference: Author + Year + (Suffix oder leer)
	const matchedKeys = new Set(bibIndex.map((b) => b.key));
	const matchedNoSuffix = new Set(bibIndex.map((b) => `${b.firstAuthorLastname}|${b.year}`));
	let resolved = 0;
	for (const c of allCitations) {
		const author = c.authorsCanonical[0];
		if (!author) continue;
		const exact = `${author}|${c.year}|${c.yearSuffix ?? ''}`;
		const looser = `${author}|${c.year}`;
		if (matchedKeys.has(exact) || matchedNoSuffix.has(looser)) resolved += 1;
	}

	// Author-Aggregation
	const authorMentions = new Map<string, number>();
	for (const c of allCitations) {
		for (const a of c.authorsCanonical) {
			authorMentions.set(a, (authorMentions.get(a) ?? 0) + 1);
		}
	}
	const totalMentions = Array.from(authorMentions.values()).reduce((a, b) => a + b, 0);
	const sorted = Array.from(authorMentions.entries()).sort((a, b) => b[1] - a[1]);
	const hhi =
		totalMentions > 0
			? sorted.reduce((acc, [, n]) => acc + Math.pow(n / totalMentions, 2), 0)
			: 0;
	const top1 = sorted[0]?.[1] ?? 0;
	const top3 = sorted.slice(0, 3).reduce((acc, [, n]) => acc + n, 0);

	// ¶-Distribution
	const paragraphsWithCit = new Set<string>();
	for (const c of allCitations) paragraphsWithCit.add(c.paragraphId);

	console.log(`  Inline-Citations:        ${allCitations.length}`);
	console.log(`  davon resolved (bib):    ${resolved}  (orphan: ${allCitations.length - resolved})`);
	console.log(`  Unique Autoren:          ${authorMentions.size}`);
	console.log(`  ¶ mit Citation:          ${paragraphsWithCit.size}  (${((paragraphsWithCit.size / paragraphs.length) * 100).toFixed(1)}% des Werks)`);
	console.log(`  Mean Cit / ¶ (nur cit-¶):${(allCitations.length / Math.max(1, paragraphsWithCit.size)).toFixed(2)}`);
	console.log(`  HHI:                     ${hhi.toFixed(4)}`);
	console.log(`  Top-1-Share:             ${(top1 / Math.max(1, totalMentions)).toFixed(4)}`);
	console.log(`  Top-3-Share:             ${(top3 / Math.max(1, totalMentions)).toFixed(4)}`);

	console.log(`\n  Top-15 Autoren:`);
	for (const [a, n] of sorted.slice(0, 15)) {
		console.log(`    ${a.padEnd(28)} ${String(n).padStart(4)} mentions`);
	}

	// Bibliografie-Coverage: welche Autoren aus der Bibliografie tauchen im Text auf?
	const bibAuthors = new Set(bibIndex.map((b) => b.firstAuthorLastname));
	const inTextAuthors = new Set(authorMentions.keys());
	const bibButNotCited = Array.from(bibAuthors).filter((a) => !inTextAuthors.has(a));
	const citedButNotInBib = Array.from(inTextAuthors).filter((a) => !bibAuthors.has(a));
	console.log(`\n  Coverage Bibliografie ↔ Text:`);
	console.log(`    in Bib gelistet, aber nirgends inline zitiert:  ${bibButNotCited.length}`);
	console.log(`    inline zitiert, aber nicht in Bib:              ${citedButNotInBib.length}  (${citedButNotInBib.slice(0, 8).join(', ')}${citedButNotInBib.length > 8 ? ', …' : ''})`);

	if (containerHeadingText) {
		console.log(`\n  Per-¶-Signatur:`);
		for (const p of paragraphs) {
			const cs = allCitations.filter((c) => c.paragraphId === p.paragraphId);
			const authorCount = new Map<string, number>();
			for (const c of cs) for (const a of c.authorsCanonical) authorCount.set(a, (authorCount.get(a) ?? 0) + 1);
			let dominant: string | null = null;
			let dominantCount = 0;
			for (const [a, n] of authorCount) {
				if (n > dominantCount) { dominant = a; dominantCount = n; }
			}
			console.log(`    ¶${String(p.indexInContainer).padStart(2)}  cit=${String(cs.length).padStart(2)}  dom=${(dominant ?? '-').padEnd(15)}`);
		}
	}

	await pool.end();
	process.exit(0);
}

main().catch((e) => {
	console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
	pool.end().finally(() => process.exit(1));
});
