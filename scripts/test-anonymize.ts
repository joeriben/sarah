// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Smoke-test der Anonymisierungs-Pipeline (NER-basiert, lokal via spaCy).
// Run: npx tsx scripts/test-anonymize.ts

import { buildSeeds, extractTitleHint } from '../src/lib/server/documents/anonymize/seeds.ts';
import { findEdits, applyEdits, recomputeElementSlice } from '../src/lib/server/documents/anonymize/apply.ts';
import { isAuthorAlreadyRedacted } from '../src/lib/server/documents/anonymize/already-redacted.ts';
import { buildSyntheticFilename } from '../src/lib/server/documents/anonymize/filename.ts';
import { scanForPiiHits } from '../src/lib/server/ai/failsafe.ts';

async function runCase(label: string, frontpage: string): Promise<void> {
	console.log(`\n========== ${label} ==========`);
	console.log('--- input ---');
	console.log(frontpage.slice(0, 400) + (frontpage.length > 400 ? '…' : ''));

	const seeds = await buildSeeds(frontpage);
	console.log(`\n--- ${seeds.length} seeds ---`);
	for (const s of seeds) {
		console.log(`  [${s.category}/${s.role ?? '-'}] "${s.value}" → ${s.replacement}`);
		if (s.variants.length > 1) console.log(`    variants: ${JSON.stringify(s.variants)}`);
	}

	const edits = findEdits(frontpage, seeds);
	const out = applyEdits(frontpage, edits);
	console.log(`\n--- after apply (${edits.length} edits) ---`);
	console.log(out);

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
	const leak = scanForPiiHits(out, seedsForFailsafe);
	console.log(`\n--- failsafe-scan on anonymized: ${leak.length} hits ---`);
	for (const h of leak) console.log(`    LEAK: "${h.matchedString}" — ${h.context}`);

	const titleHint = await extractTitleHint(frontpage);
	const fname = buildSyntheticFilename({ title: titleHint, ext: 'docx' });
	console.log(`\n--- title hint: "${titleHint ?? '(none)'}" → filename: ${fname} ---`);
}

// Case 1 — strukturierte Habil-Frontpage (Multi-Line)
await runCase(
	'Habil structured',
	`Friedrich-Alexander-Universität Erlangen-Nürnberg
Philosophische Fakultät und Fachbereich Theologie

Habilitationsschrift

Bildungsphilosophie als Reflexion. Untersuchung zu einem unzeitgemäßen Begriff im Spannungsfeld digitaler Transformationen.

vorgelegt von Dr. phil. Maria Mustermann
Matrikelnummer: 12345678
E-Mail: maria.mustermann@fau.de

Betreuer: Prof. Dr. Hans Müller
Zweitgutachter: Prof. Dr. Sabine Beispiel

Erlangen, im Frühjahr 2026

1. Einleitung

Die vorliegende Arbeit unternimmt den Versuch, mit Maria Mustermann
und Hans Müller in einen Dialog zu treten. Mustermann argumentiert ...
`
);

// Case 2 — DOCX-konkatenierte Single-Paragraph-Frontpage (Timm-Pattern)
await runCase(
	'Habil concatenated (Timm pattern)',
	`Kultur professionell lehren lernen Elemente einer Theorie der Lehrkräftebildung in der globalen Welt Habilitationsschrift in der Erziehungswissenschaft Vorgelegt von Dr. phil. Susanne Timm Otto-Friedrich-Universität Bamberg Fakultät für Humanwissenschaften Mentorat Prof. Dr. Dr. h.c. Dr. h.c. Annette Scheunpflug (Vorsitz) Prof. Dr. Julia Franz Prof. Dr. Claudia Jahnel`
);

// Case 3 — BA-Cover ohne Vorgelegt-von-Label (Gabbari-Pattern)
const gabbari = `Bachelorarbeit Institut für Pädagogik mit dem Schwerpunkt Kultur und ästhetische Bildung und UNESCO Chair in Digital Culture and Arts in Education Titel: Global Citizenship Education aus pädagogischer Perspektive. Eine kritische Analyse. Fidan Gabbari Am Zehentstadel 3 91166 Georgensgmünd Matrikelnummer: 21925501 Fidan.gabbari@gmail.com Tel.: 0176/82077902 Betreuer: Prof. Dr. Benjamin Jörissen Datum Einreichung: 26.08.2025 Inhaltsverzeichnis Abkürzungsverzeichnis Einleitung Kapitel 1`;
await runCase('BA Gabbari (real DOCX shape)', gabbari);

// Case 4 — already-redacted skip-checks
console.log('\n========== Already-redacted check ==========');
const clean = `vorgelegt von Dr. phil. Maria Mustermann
Matrikelnummer: 12345678`;
console.log('  clean:    ', isAuthorAlreadyRedacted(clean));
console.log('  bracket:  ', isAuthorAlreadyRedacted(clean.replace('Dr. phil. Maria Mustermann', 'Dr. phil. [ANONYMISIERT]')));
console.log('  block-box:', isAuthorAlreadyRedacted(clean.replace('Dr. phil. Maria Mustermann', 'Dr. phil. ████████████████')));

// Case 5 — element-offset shift
console.log('\n========== Element-offset shift ==========');
const seeds = await buildSeeds(gabbari);
const edits = findEdits(gabbari, seeds);
const newText = applyEdits(gabbari, edits);
const fidanPos = gabbari.indexOf('Fidan Gabbari');
if (fidanPos >= 0) {
	const elStart = fidanPos;
	const elEnd = fidanPos + 'Fidan Gabbari'.length;
	const e = recomputeElementSlice(gabbari, elStart, elEnd, edits);
	const oldSlice = gabbari.slice(elStart, elEnd);
	const newSlice = newText.slice(e.newStart, e.newEnd);
	console.log(`  old [${elStart}..${elEnd}]: "${oldSlice}"`);
	console.log(`  new [${e.newStart}..${e.newEnd}]: "${newSlice}"`);
	console.log(`  recomputed content: "${e.newContent}"`);
	console.log(`  match: ${e.newContent === newSlice ? '✓' : '✗'}`);
}
