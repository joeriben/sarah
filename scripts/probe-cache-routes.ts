// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Multi-Route-Cache-Probe. Ruft `chat()` zweimal pro Route mit identischem
// `cacheableSystemPrefix` und unterschiedlichem `system`-Suffix auf. Liest
// `cacheCreationTokens` / `cacheReadTokens` aus dem Response.
//
// Ziel: empirisch klären, welche Route Prompt-Caching tatsächlich liefert.
// Antwort auf "Was ist mit Mimo?" — nicht spekuliert, gemessen.
//
// Run:  npx tsx scripts/probe-cache-routes.ts

import { chat, type Provider } from '../src/lib/server/ai/client.ts';

// ~2KB stabiler Prefix-Block, weit über Anthropic-1024-Token-Mindestschwelle.
const STABLE_PREFIX = `[PERSONA]
Du bist eine erfahrene Sozialwissenschaftlerin, methodisch streng und an einem hermeneutischen Lese-Verfahren geschult. Alle Urteile, die du formulierst, müssen vor einer fachkundigen Leserin verteidigt werden können — Rhetorik ohne Substanz ist tabu.

Du arbeitest im Modus einer kritischen Freundin: du analysierst, du schlägst Lese-Hypothesen vor, du markierst Unschärfen — du sprichst aber nie das Endurteil über die Qualität der Arbeit aus. Das gehört der Forscherin.

[KRITERIEN ALS LESEFOLIE]
1. Argumentation: Ist das Argumentationsmuster konsistent? Werden Voraussetzungen und Ableitungen explizit gemacht?
2. Forschungsstand: Ist die Auseinandersetzung mit relevanten Positionen umfassend und substanziell?
3. Methodische Reflexion: Wird das methodische Vorgehen transparent gemacht und auf seine Reichweite hin reflektiert?
4. Theoretische Eigenleistung: Liegt eine eigenständige theoretische Position vor — oder bewegt sich der Text vorrangig im referierenden Modus?

Diese vier Dimensionen sind die Lesefolie für die hermeneutische Interpretation des vorliegenden Materials.

[WERK]
Titel: Test-Werk Cache-Routing-Probe
Werktyp: Habilitationsschrift
Umfang Hauptteil: 4 Hauptkapitel-Überschriften, 327 Hauptabsätze.

[OUTPUT-FORMAT]
Antworte ausschließlich mit einem einzelnen JSON-Objekt der folgenden Struktur und nichts sonst:
{ "interpretierend": "<2 prägnante Sätze, die den Absatz hermeneutisch öffnen>" }

[CACHING-PADDING]
Der folgende Block dient ausschließlich dazu, die 1024-Token-Mindestgrenze für Anthropic-Prompt-Caching zu überschreiten. Er enthält keine semantisch relevante Information für die nachfolgende Aufgabe.

${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '.repeat(40)}`;

const SUFFIX_A = `[OUTLINE & POSITION]
- 1. Schule – Kultur – Globalität           ← AKTUELL HIER
- 2. Orientierungen
- 3. Reflexionen

[INTERPRETIERENDE KETTE IM AKTUELLEN UNTERKAPITEL]
(Noch keine vorherigen Memos.)`;

const SUFFIX_B = `[OUTLINE & POSITION]
- 1. Schule – Kultur – Globalität           ← AKTUELL HIER
- 2. Orientierungen
- 3. Reflexionen

[INTERPRETIERENDE KETTE IM AKTUELLEN UNTERKAPITEL]
### Absatz 1
Erster interpretierender Memo-Inhalt zum Test, geringfügig variabel im Suffix.`;

const USER_MSG = `Analysiere den folgenden kurzen Beispielabsatz:

"Kultur kommt als Reservoir von Werthorizonten in den Blick. Damit verweist sie auf einen gesellschaftlichen Problemzusammenhang, der nicht aus der Pädagogik allein heraus zu beantworten ist."

Antworte im JSON-Format wie spezifiziert.`;

interface Route {
	id: string;
	provider: Provider;
	model: string;
	note: string;
}

const ROUTES: Route[] = [
	{ id: 'mimo-via-OR',          provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro',          note: 'Mimo nur über OpenRouter verfügbar' },
	{ id: 'kimi-via-Mammouth',    provider: 'mammouth',   model: 'kimi-k2.5',                     note: 'Kimi via Mammouth (EU-vermittelt) — bevorzugte Route' },
	{ id: 'kimi-via-OR',          provider: 'openrouter', model: 'moonshotai/kimi-k2.5',          note: 'Kimi via OpenRouter (US) — Fallback' },
	{ id: 'sonnet-via-Mammouth',  provider: 'mammouth',   model: 'claude-sonnet-4-6',             note: 'Validierte Sonnet-Route' },
	{ id: 'mistral-nativ',        provider: 'mistral',    model: 'mistral-large-latest',          note: 'Mistral nativ — implizites Server-Caching' }
];

interface Probe {
	dt: number;
	in: number;
	out: number;
	cacheC: number;
	cacheR: number;
	error?: string;
}

async function probeRoute(route: Route, suffix: string): Promise<Probe> {
	const t = Date.now();
	try {
		const r = await chat({
			cacheableSystemPrefix: STABLE_PREFIX,
			system: suffix,
			messages: [{ role: 'user', content: USER_MSG }],
			maxTokens: 200,
			modelOverride: { provider: route.provider, model: route.model }
		});
		return {
			dt: (Date.now() - t) / 1000,
			in: r.inputTokens,
			out: r.outputTokens,
			cacheC: r.cacheCreationTokens,
			cacheR: r.cacheReadTokens
		};
	} catch (e) {
		return {
			dt: (Date.now() - t) / 1000,
			in: 0, out: 0, cacheC: 0, cacheR: 0,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

console.log('=== Multi-Route Cache-Probe ===\n');
console.log(`Stable prefix length: ~${STABLE_PREFIX.length} chars (~${Math.round(STABLE_PREFIX.length / 4)} tokens grob)\n`);

const results: { route: Route; call1: Probe; call2: Probe }[] = [];

for (const route of ROUTES) {
	console.log(`--- ${route.id}  (${route.provider}/${route.model}) ---`);
	console.log(`    ${route.note}`);
	const c1 = await probeRoute(route, SUFFIX_A);
	if (c1.error) {
		console.log(`    Call 1 FEHLER: ${c1.error.slice(0, 200)}`);
		results.push({ route, call1: c1, call2: c1 });
		console.log();
		continue;
	}
	console.log(`    Call 1: ${c1.dt.toFixed(1)}s  in=${c1.in} cache_c=${c1.cacheC} cache_r=${c1.cacheR} out=${c1.out}`);

	const c2 = await probeRoute(route, SUFFIX_B);
	if (c2.error) {
		console.log(`    Call 2 FEHLER: ${c2.error.slice(0, 200)}`);
		results.push({ route, call1: c1, call2: c2 });
		console.log();
		continue;
	}
	console.log(`    Call 2: ${c2.dt.toFixed(1)}s  in=${c2.in} cache_c=${c2.cacheC} cache_r=${c2.cacheR} out=${c2.out}`);

	results.push({ route, call1: c1, call2: c2 });
	console.log();
}

console.log('\n=== Verdikt pro Route ===');
for (const { route, call1, call2 } of results) {
	if (call1.error || call2.error) {
		console.log(`✗ ${route.id}: FEHLER  (${(call1.error || call2.error || '').slice(0, 120)})`);
		continue;
	}
	const totalPrompt = call2.in + call2.cacheC + call2.cacheR;
	const hitRatio = totalPrompt > 0 ? (call2.cacheR / totalPrompt * 100) : 0;
	if (call2.cacheR > 0) {
		console.log(`✓ ${route.id}: cache_read=${call2.cacheR}/${totalPrompt} (${hitRatio.toFixed(0)}%) auf 2. Call`);
	} else if (call1.cacheC > 0 && call2.cacheR === 0) {
		console.log(`✗ ${route.id}: Cache wird zwar geschrieben (cache_c=${call1.cacheC}), aber 2. Call liest 0 → kein effektiver Hit`);
	} else {
		console.log(`✗ ${route.id}: kein Caching beobachtet (cache_c=0, cache_r=0)`);
	}
}
