// Smoke test for parseStructuredProse — validates the parser before we depend
// on it in 6 production modules.
import { z } from 'zod';
import { parseStructuredProse, describeProseFormat, type SectionSpec } from '../src/lib/server/ai/prose-extract.js';

const collapseSpec: SectionSpec = {
	singletons: { SYNTHESE: 'multiline' },
	lists: {
		AUFFAELLIGKEIT: {
			fields: { scope: 'oneline', observation: 'multiline' },
		},
	},
};

const collapseSchema = z.object({
	synthese: z.string(),
	auffaelligkeit: z.array(z.object({
		scope: z.string(),
		observation: z.string(),
	})),
});

// ── Test 1: well-formed output ────────────────────────────────────
const sample1 = `## SYNTHESE
Das Subkapitel entfaltet eine fünfschrittige argumentative Architektur.
Erste Bewegung: Reckwitz'sche Kulturperspektivierung verankert §1.
Zweite Bewegung: §2 überführt in Erziehungswissenschaft.

## AUFFAELLIGKEIT 1
scope: §2
observation: Die edges A4 (--contradicts--> A3) und A5 (--supports--> A3) erzeugen eine bemerkenswerte argumentative Spannung.
Diese wird nicht produktiv aufgelöst, sondern sequentiell abgearbeitet.

## AUFFAELLIGKEIT 2
scope: §4
observation: Die Überführung von Tenorths Mehrdimensionalitätskatalog wird argumentativ nicht vollzogen.
`;

const r1 = parseStructuredProse(sample1, collapseSpec);
console.log('--- Test 1: well-formed ---');
if (!r1.ok) {
	console.error('FAIL:', r1.stage, r1.error);
	process.exit(1);
}
const v1 = collapseSchema.safeParse(r1.value);
if (!v1.success) {
	console.error('zod FAIL:', v1.error.message);
	process.exit(1);
}
console.log('synthese chars:', v1.data.synthese.length);
console.log('auffaelligkeit count:', v1.data.auffaelligkeit.length);
console.log('  [0].scope:', v1.data.auffaelligkeit[0].scope);
console.log('  [0].observation chars:', v1.data.auffaelligkeit[0].observation.length);
console.log('  [1].scope:', v1.data.auffaelligkeit[1].scope);
console.log('PASS');

// ── Test 2: empty list (auffaelligkeit weglassen) ─────────────────
const sample2 = `## SYNTHESE
Das Subkapitel ist unauffällig glatt argumentativ.
`;

const r2 = parseStructuredProse(sample2, collapseSpec);
console.log('\n--- Test 2: empty list ---');
if (!r2.ok) { console.error('FAIL:', r2.stage); process.exit(1); }
const v2 = collapseSchema.safeParse(r2.value);
if (!v2.success) { console.error('zod FAIL:', v2.error.message); process.exit(1); }
console.log('synthese chars:', v2.data.synthese.length);
console.log('auffaelligkeit count:', v2.data.auffaelligkeit.length);
if (v2.data.auffaelligkeit.length !== 0) { console.error('expected 0 auffaelligkeit'); process.exit(1); }
console.log('PASS');

// ── Test 3: malformed — no headers (header-scan fail) ─────────────
const sample3 = `Ich hatte hier eine Synthese geplant aber bin abgebrochen.`;
const r3 = parseStructuredProse(sample3, collapseSpec);
console.log('\n--- Test 3: no headers ---');
if (r3.ok) { console.error('expected fail'); process.exit(1); }
console.log('expected fail at:', r3.stage, '-', r3.error);
console.log('PASS');

// ── Test 4: missing index in list (LLM jumps 1, 3) ────────────────
const sample4 = `## SYNTHESE
Test mit Lücke.

## AUFFAELLIGKEIT 1
scope: §1
observation: Erste.

## AUFFAELLIGKEIT 3
scope: §3
observation: Dritte.
`;
const r4 = parseStructuredProse(sample4, collapseSpec);
console.log('\n--- Test 4: list index gap ---');
if (!r4.ok) { console.error('FAIL:', r4.stage); process.exit(1); }
const v4 = collapseSchema.safeParse(r4.value);
if (!v4.success) { console.error('zod FAIL:', v4.error.message); process.exit(1); }
console.log('auffaelligkeit count:', v4.data.auffaelligkeit.length);
if (v4.data.auffaelligkeit.length !== 2) { console.error('expected 2'); process.exit(1); }
console.log('  ordered:', v4.data.auffaelligkeit.map(a => a.scope).join(', '));
console.log('PASS');

// ── Test 5: multiline value with embedded blank lines ─────────────
const sample5 = `## SYNTHESE
Erste Zeile.

Zweite Zeile nach Leerzeile.

Dritte Zeile.

## AUFFAELLIGKEIT 1
scope: §1
observation:
Multiline observation, erste Zeile.

Zweite Zeile mit Leerzeile davor.
Dritte Zeile.
`;
const r5 = parseStructuredProse(sample5, collapseSpec);
console.log('\n--- Test 5: multiline values ---');
if (!r5.ok) { console.error('FAIL:', r5.stage); process.exit(1); }
const v5 = collapseSchema.safeParse(r5.value);
if (!v5.success) { console.error('zod FAIL:', v5.error.message); process.exit(1); }
console.log('synthese:');
console.log(v5.data.synthese);
console.log('---');
console.log('observation:');
console.log(v5.data.auffaelligkeit[0].observation);
console.log('---');
console.log('PASS');

// ── Test 6: unknown Markdown headers are section boundaries ────────
const sample6 = `## SYNTHESE
Knappe Synthese.

## OUTLINE & POSITION
Outline aus dem Input, darf nicht in SYNTHESE landen.

## AUFFAELLIGKEIT 1
scope: §1
observation: Bekannte Listensektion nach unbekanntem Header bleibt parsebar.
`;
const r6 = parseStructuredProse(sample6, collapseSpec);
console.log('\n--- Test 6: unknown markdown boundary ---');
if (!r6.ok) { console.error('FAIL:', r6.stage); process.exit(1); }
const v6 = collapseSchema.safeParse(r6.value);
if (!v6.success) { console.error('zod FAIL:', v6.error.message); process.exit(1); }
if (v6.data.synthese.includes('OUTLINE') || v6.data.synthese.includes('Input')) {
	console.error('unknown header body leaked into singleton:', v6.data.synthese);
	process.exit(1);
}
if (v6.data.auffaelligkeit.length !== 1) {
	console.error('expected known list section after unknown header');
	process.exit(1);
}
console.log('synthese:', v6.data.synthese);
console.log('auffaelligkeit count:', v6.data.auffaelligkeit.length);
console.log('PASS');

// ── Test 7: describeProseFormat output is non-empty + well-formed ──
console.log('\n--- Test 7: describeProseFormat ---');
const desc = describeProseFormat(collapseSpec);
if (desc.length < 50) { console.error('describe too short'); process.exit(1); }
if (!desc.includes('## SYNTHESE')) { console.error('missing SYNTHESE'); process.exit(1); }
if (!desc.includes('## AUFFAELLIGKEIT 1')) { console.error('missing AUFFAELLIGKEIT 1'); process.exit(1); }
console.log(desc);
console.log('PASS');

console.log('\nAll tests passed.');
