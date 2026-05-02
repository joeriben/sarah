// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Smoke-test the anonymization pipeline end-to-end (without DB):
//   1. seed extraction from a realistic frontmatter
//   2. already-redacted skip-check on three frontmatter variants
//   3. edit + apply round-trip
//   4. element-offset shift correctness
//   5. synthetic filename
//
// Run:  npx tsx scripts/test-anonymize.ts

import {
	buildSeeds,
	looksLikePersonName,
	extractFrontmatter
} from '../src/lib/server/documents/anonymize/seeds.ts';
import {
	findEdits,
	applyEdits,
	recomputeElementSlice
} from '../src/lib/server/documents/anonymize/apply.ts';
import { isAuthorAlreadyRedacted } from '../src/lib/server/documents/anonymize/already-redacted.ts';
import { buildSyntheticFilename } from '../src/lib/server/documents/anonymize/filename.ts';
import { scanForPiiHits } from '../src/lib/server/ai/failsafe.ts';

const sample = `Friedrich-Alexander-Universität Erlangen-Nürnberg
Philosophische Fakultät und Fachbereich Theologie
Lehrstuhl für Pädagogik II

Habilitationsschrift

Bildungsphilosophie als Reflexion. Untersuchung zu einem unzeitgemäßen
Begriff im Spannungsfeld digitaler Transformationen.

vorgelegt von Dr. phil. Maria Mustermann
Matrikelnummer: 12345678
E-Mail: maria.mustermann@fau.de

Betreuer: Prof. Dr. Hans Müller
Zweitgutachter: Prof. Dr. Sabine Beispiel

Erlangen, im Frühjahr 2026

1. Einleitung

Die vorliegende Arbeit unternimmt den Versuch, mit Maria Mustermann
und Hans Müller in einen Dialog zu treten. Mustermann argumentiert ...
`;

console.log('=== looksLikePersonName probes ===');
const probes = [
	['Maria Mustermann', true],
	['Universität', false],
	['Prof. Dr. Hans Müller', true],
	['M', false],
	['Erlangen-Nürnberg', false],
	['Mustermann, Maria', true],
	['Lehrstuhl', false]
];
for (const [probe, expected] of probes) {
	const got = looksLikePersonName(probe as string);
	const mark = got === expected ? '✓' : '✗';
	console.log(`  ${mark} ${(probe as string).padEnd(30)} → ${got} (expected ${expected})`);
}

console.log('\n=== Seeds ===');
const seeds = buildSeeds(sample);
for (const s of seeds) {
	console.log(`  [${s.category}/${s.role}] "${s.value}" → ${s.replacement}`);
	console.log(`    variants: ${JSON.stringify(s.variants)}`);
}

console.log('\n=== Edit application ===');
const edits = findEdits(sample, seeds);
console.log(`  edits: ${edits.length}`);
const newText = applyEdits(sample, edits);
console.log('--- result ---');
console.log(newText);

console.log('\n=== Failsafe scan after substitution ===');
const seedsForFailsafe = seeds.map((s) => ({
	id: 'fake',
	documentId: 'fake',
	category: s.category,
	role: s.role,
	value: s.value,
	variants: s.variants,
	replacement: s.replacement,
	source: s.source as string
}));
const hitsAfter = scanForPiiHits(newText, seedsForFailsafe);
console.log(`  hits in anonymized text: ${hitsAfter.length} (expected 0)`);
if (hitsAfter.length > 0) {
	for (const h of hitsAfter) {
		console.log(`    LEAK: "${h.matchedString}" at ${h.matchedAt} — context: ${h.context}`);
	}
}

const hitsBefore = scanForPiiHits(sample, seedsForFailsafe);
console.log(`  hits in original: ${hitsBefore.length} (expected ≥ ${seeds.length})`);

console.log('\n=== Already-redacted check (clean) ===');
console.log(' ', isAuthorAlreadyRedacted(sample));

const bracketRedacted = sample.replace('Maria Mustermann', '[ANONYMISIERT]');
console.log('\n=== Already-redacted check (bracket) ===');
console.log(' ', isAuthorAlreadyRedacted(bracketRedacted));

const blockBoxRedacted = sample.replace('Maria Mustermann', '████████████████');
console.log('\n=== Already-redacted check (block box) ===');
console.log(' ', isAuthorAlreadyRedacted(blockBoxRedacted));

console.log('\n=== Synthetic filename ===');
console.log(
	' ',
	buildSyntheticFilename({
		title: 'Bildungsphilosophie als Reflexion. Untersuchung zu einem unzeitgemäßen Begriff',
		ext: 'docx'
	})
);
console.log(' ', buildSyntheticFilename({ title: '', ext: 'docx' }));
console.log(' ', buildSyntheticFilename({ docType: 'Habilitation', title: 'Education', ext: 'docx' }));

console.log('\n=== Element-offset shift ===');
// Pick a synthetic element range that overlaps a substitution.
// Find "Maria Mustermann" position in sample → simulate an element wrapping it.
const mariaPos = sample.indexOf('Maria Mustermann');
const elStart = sample.lastIndexOf('\n', mariaPos) + 1;
const elEnd = sample.indexOf('\n', mariaPos);
console.log(`  Element [${elStart}..${elEnd}]: "${sample.slice(elStart, elEnd)}"`);
const e = recomputeElementSlice(sample, elStart, elEnd, edits);
console.log(`  → New [${e.newStart}..${e.newEnd}]: "${newText.slice(e.newStart, e.newEnd)}"`);
console.log(`  → recomputed content: "${e.newContent}"`);
console.log(`  match: ${e.newContent === newText.slice(e.newStart, e.newEnd) ? '✓' : '✗'}`);
