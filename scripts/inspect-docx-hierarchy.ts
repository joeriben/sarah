// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// In-memory verification of the DOCX parser's heading-level + numbering
// extraction. Reads a DOCX file, runs extractDocxAcademic, prints the
// resulting heading elements with their level + numbering. No DB writes.
//
// Run from repo root:
//   npx tsx scripts/inspect-docx-hierarchy.ts <path-to-docx>
//
// Or with the default Habilitation-Timm test document:
//   npx tsx scripts/inspect-docx-hierarchy.ts

import { readFile } from 'node:fs/promises';
import { extractDocxAcademic } from '../src/lib/server/documents/parsers/docx-academic.ts';

const DEFAULT_PATH =
	'/Users/joerissen/ai/sarah/projekte/habilitation-timm/files/f0a8bf77-6926-45b4-b474-0a1709ae21fb.docx';

const path = process.argv[2] ?? DEFAULT_PATH;
console.log(`Parsing: ${path}\n`);

const buf = await readFile(path);
const { result, fullText } = await extractDocxAcademic(buf);

const headings = result.elements.filter((e) => e.type === 'heading');
const tocEntries = result.elements.filter((e) => e.type === 'toc_entry');

console.log(`=== TOC entries (${tocEntries.length}) ===\n`);
for (const t of tocEntries) {
	const numbering = (t.properties as any)?.numbering ?? '–';
	const level = (t.properties as any)?.toc_level ?? '?';
	console.log(`  [L${level}, num=${numbering}]  ${t.content?.slice(0, 80) ?? ''}`);
}

console.log(`\n=== Headings (${headings.length}) ===\n`);
const levelCounts: Record<number, number> = {};
let mismatchCount = 0;
for (const h of headings) {
	const props = h.properties as any;
	const level = props.level ?? null;
	levelCounts[level] = (levelCounts[level] ?? 0) + 1;
	const numbering = props.numbering ?? '–';
	const source = props.heading_source ?? '?';
	const mismatch = props.numbering_mismatch
		? `  ⚠ author=${props.numbering_mismatch.author} synth=${props.numbering_mismatch.synthetic}`
		: '';
	if (props.numbering_mismatch) mismatchCount++;
	const text = (h.content ?? fullText.substring(h.charStart, h.charEnd))
		.trim()
		.slice(0, 80);
	console.log(`  [L${level}, num=${numbering}, src=${source}]  ${text}${mismatch}`);
}

console.log(`\n=== Heading level distribution ===`);
for (const [lvl, count] of Object.entries(levelCounts).sort()) {
	console.log(`  L${lvl}: ${count}`);
}
if (mismatchCount > 0) {
	console.log(`\n=== ${mismatchCount} numbering mismatches detected (synthetic vs. author) ===`);
}
