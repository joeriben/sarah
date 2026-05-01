// Isolated cache-pass-through test: 2 chat() calls with identical
// cacheableSystemPrefix. Second call should report cache_read > 0.
//
// Run from repo root:  npx tsx scripts/test-cache-prefix.ts

import { chat } from '../src/lib/server/ai/client.ts';

const STABLE_PREFIX = `[PERSONA]
Du bist eine erfahrene Sozialwissenschaftlerin. Du bist methodisch streng — alle Urteile in dem von dir produzierten Material müssen dir vor jemand kompetentem rechtfertigen lassen. Schöne Sätze ohne Hintergrund sind tabu.

Hypothesen über die Werkrichtung dürfen formuliert werden, aber als Hypothesen markiert.

[KRITERIEN ALS LESEFOLIE]
1. Argumentation: ist das Argumentationsmuster konsistent? Werden Voraussetzungen und Ableitungen explizit?
2. Forschungsstand: ist die Auseinandersetzung mit relevanten Positionen umfassend?
3. Methodische Reflexion: wird Methodisches transparent gemacht?
4. Theoretische Eigenleistung: liegt eine eigenständige theoretische Position vor?

Diese vier Dimensionen sind die Lesefolie für die hermeneutische Interpretation.

[WERK]
Titel: Test-Werk Caching-Prefix
Werktyp: Habilitationsschrift
Umfang Hauptteil: 4 Hauptkapitel-Überschriften, 327 Hauptabsätze.

[OUTPUT-FORMAT]
Antworte mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst:
{ "interpretierend": "<2 Sätze>" }

Lange Caching-Test-Buffer-Text-Erweiterung um die 1024-Token-Mindestgrenze für Anthropic prompt caching zu überschreiten. Padding folgt: ${'lorem ipsum dolor sit amet '.repeat(200)}`;

const VARIABLE_SUFFIX_1 = `[OUTLINE & POSITION]
- 1. Schule – Kultur – Globalität           ← AKTUELL HIER
- 2. Orientierungen
- 3. Reflexionen
- 4. Theorie

[INTERPRETIERENDE KETTE IM AKTUELLEN UNTERKAPITEL "1.1.1 Test"]
(Noch keine vorherigen Memos.)`;

const VARIABLE_SUFFIX_2 = `[OUTLINE & POSITION]
- 1. Schule – Kultur – Globalität           ← AKTUELL HIER
- 2. Orientierungen
- 3. Reflexionen
- 4. Theorie

[INTERPRETIERENDE KETTE IM AKTUELLEN UNTERKAPITEL "1.1.1 Test"]
### Absatz 1
Erster interpretierender Memo-Inhalt zum Test.`;

const USER_MSG = `Analysiere den folgenden kurzen Beispielabsatz:

"Kultur kommt als Reservoir von Werthorizonten in den Blick. Damit verweist sie auf einen gesellschaftlichen Problemzusammenhang."

Antworte im JSON-Format wie spezifiziert.`;

const PROVIDER = 'openrouter' as const;
const MODEL = 'anthropic/claude-sonnet-4.6';

console.log(`=== Cache-Prefix Test (${PROVIDER}/${MODEL}) ===\n`);

console.log('Call 1 (cold cache expected) ...');
const t1 = Date.now();
const r1 = await chat({
	cacheableSystemPrefix: STABLE_PREFIX,
	system: VARIABLE_SUFFIX_1,
	messages: [{ role: 'user', content: USER_MSG }],
	maxTokens: 200,
	modelOverride: { provider: PROVIDER, model: MODEL },
});
const dt1 = (Date.now() - t1) / 1000;
console.log(`  ${dt1.toFixed(1)}s  in=${r1.inputTokens} cache_c=${r1.cacheCreationTokens} cache_r=${r1.cacheReadTokens} out=${r1.outputTokens}`);

console.log('\nCall 2 (warm cache expected — same prefix, different suffix) ...');
const t2 = Date.now();
const r2 = await chat({
	cacheableSystemPrefix: STABLE_PREFIX,
	system: VARIABLE_SUFFIX_2,
	messages: [{ role: 'user', content: USER_MSG }],
	maxTokens: 200,
	modelOverride: { provider: PROVIDER, model: MODEL },
});
const dt2 = (Date.now() - t2) / 1000;
console.log(`  ${dt2.toFixed(1)}s  in=${r2.inputTokens} cache_c=${r2.cacheCreationTokens} cache_r=${r2.cacheReadTokens} out=${r2.outputTokens}`);

console.log('\n=== Verdict ===');
if (r2.cacheReadTokens > 0) {
	console.log(`✓ Cache works: call 2 read ${r2.cacheReadTokens} cached tokens (${(r2.cacheReadTokens / (r2.inputTokens + r2.cacheReadTokens) * 100).toFixed(1)}% of input).`);
} else {
	console.log(`✗ Cache did NOT work: call 2 reported 0 cache reads.`);
	console.log(`  Possible reasons:`);
	console.log(`   - System prompt below provider's cache minimum (Anthropic: 1024 tokens)`);
	console.log(`   - Provider doesn't implement cache_control pass-through`);
	console.log(`   - Cache TTL (5 min) lapsed between calls (unlikely here)`);
}
