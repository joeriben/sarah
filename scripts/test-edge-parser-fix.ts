import { parseProseAG } from '../src/lib/server/ai/hermeneutic/argumentation-graph-prose-parser.ts';

const sample = `ARGUMENT A1
claim: dummy claim 1
anchor: dummy anchor 1

ARGUMENT A2
claim: dummy claim 2
anchor: dummy anchor 2

ARGUMENT A3
claim: dummy claim 3
anchor: dummy anchor 3

EDGES
A1 -refines-> §0:A2  (A2 spezifiziert die Dynamik der in A1 beschriebenen Reproduktion)
A2 -supports-> A1    (A2 begründet die Prozesshaftigkeit als notwendige Ergänzung)
A3 -presupposes-> A1, A2  (A3 setzt die in A1 und A2 entfaltete Spannung voraus)
`;

const r = parseProseAG(sample);
console.log(`Edges parsed: ${r.result.edges.length}`);
for (const e of r.result.edges) {
	console.log(`  - ${JSON.stringify(e)}`);
}
console.log(`Warnings (${r.warnings.length}):`);
for (const w of r.warnings) console.log(`  ⚠ ${w}`);
