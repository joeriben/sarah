# H3:EXPOSITION — Parsing-Strategie

Strategie für die Identifikation von Fragestellungs- und Motivations-¶ im EXPOSITION-Container und für die unabhängigen Lese-Pässe darauf.

Status: implementiert, validiert (BA H3 dev, 2026-05-03). Diese Doku schreibt den Stand fest, der bis zur Erstellung dieses Files nur als Code und als Mother-Session-Setzung existierte.

---

## Original-Setzung (Mother-Session 4ca02b6d, 2026-05-03 06:52)

User-Setzung wörtlich:

> Wir erwarten die FRAGESTELLUNG — zumindest in einer Vor-Form — in der Einleitung bzw. dem technisch ersten Inhaltskapitel. Wir finden die Fragestellung, indem wir das Kapitel **von hinten nach vorne** durchsuchen, denn sie wird zumeist erst motiviert und formt sich im Verlauf. Ggf. treffen wir zuerst auf Begründungen der Struktur/Vorgehensweise der Arbeit (FORSCHUNGSDESIGN) die uns hier nicht interessiert, dann eventually auf die FRAGESTELLUNG, dann auf Motivationen (die uns nicht wirklich interessieren, können fachlich, gegenwartsdiagnostisch, praktisch-problembezogen, persönlich etc. sein). Wir ermitteln regelbasiert (in dieser umgekehrten Suchreihenfolge) den Kandidaten, lösen LLM-Aktion aus (neuer Tool mit Prompt für Fragestellung), wenn positiv, sichtet LLM nach oben die MOTIVATIONEN: a) enthält der Absatz darüber auch Teile der Fragestellung? Dann Fragestellung im Kontext der beiden Absätze revalidieren. b) enthält der Absatz Motivationen? Dann den ganzen Block von Kapitelbeginn bis hier knapp als MOTIVATION inhaltlich zusammenfassen.

Architektonisches Bild:

```
EXPOSITION-Container (Heading-hierarchisch über outline_function_type='EXPOSITION'):
  ¶_0  ← Kapitelbeginn (typisch Motivation)
  ¶_1
  …
  ¶_k  ← Fragestellungs-Cluster (rückwärts gesucht)
  …
  ¶_n  ← Container-Ende (ggf. FORSCHUNGSDESIGN-Begründungen, übersprungen)
```

---

## Implementation in `src/lib/server/ai/h3/exposition.ts`

### Stufe 1 — deterministischer Parser (`parserIdentifyParagraphs`)

Iteriert die Container-¶ **rückwärts** (`for i = n-1 down to 0`) und sucht den letzten zusammenhängenden Cluster von ¶, in denen mindestens ein Marker matcht. Lücke nach Cluster-Anfang beendet die Suche.

**Marker-Set** (`FRAGESTELLUNG_MARKERS`):
- `?` (Fragezeichen)
- `forschungs|untersuchungs|leit|haupt frage(stellung)?`
- `lautet :|„|"`
- `(diese|vorliegende) (arbeit|studie|untersuchung|beitrag|aufsatz) (untersucht|fragt|prüft|zeigt|analysiert|geht|widmet|setzt|ist)`
- `(im|zu(m)?) (mittelpunkt|zentrum) (steht|stehen)`
- `(soll|sollen|wird|werden) … (untersucht|geprüft|gezeigt|gefragt|analysiert|beantwortet)` (Distanz bis 8 Tokens)
- `erkenntnisinteresse|forschungsinteresse|untersuchungsgegenstand`

Output: `{ fragestellungParagraphs, motivationParagraphs }` — Cluster + alles davor im Container. Falls kein Marker matcht: `null` → Fallback.

**Nicht implementiert in der Marker-Stufe**: explizite FORSCHUNGSDESIGN-Übersprung-Heuristik. Die Mother-Setzung sieht das vor („zuerst auf Begründungen der Struktur/Vorgehensweise … die uns hier nicht interessiert"). In der Praxis fängt der Marker-Set diese ¶ am Container-Ende meist nicht ein, weil sie die Frage-Marker nicht tragen — die Lücken-Logik bricht dann den Cluster-Aufbau ab. Wenn Werke mit FORSCHUNGSDESIGN-Schluss auftauchen, in denen der Marker-Set zu großzügig fängt, nachziehen.

### Stufe 2 — LLM-Rekonstruktion FRAGESTELLUNG (`rekonstruiereFragestellung`)

Bekommt **nur die Cluster-¶** (`fragestellungParagraphs`). Rekonstruiert die tatsächliche Fragestellung als Problemfeld + Perspektive (Memory `project_fragestellung_definition.md`). Methoden- und Motivations-Aussagen werden ausgeklammert.

Output: 2–4 Sätze. Persistierung als `function_constructs.construct_kind = 'FRAGESTELLUNG'`, `content = { text: … }`, Anker = Cluster-¶-IDs.

### Stufe 2b — LLM-Beurteilung FRAGESTELLUNG (`beurteileFragestellung`)

**Unabhängiger zweiter Lese-Pass auf demselben Material.** Bekommt **dieselben** Cluster-¶ wie Stufe 2, sieht die rekonstruierte FRAGESTELLUNG nicht.

Beurteilt die im Material formulierte Fragestellung in einem einzigen Satz, auf Basis einer selbst-gerankten Auswahl aus fünf Kriterien:
- sachliche Konsistenz
- logische Konsistenz
- sprachliche Präzision
- Vermögen, die Arbeit zu motivieren / Klärungsbeitrag zu erlauben
- Zusammenführen heterogener Elemente

Persistierung als `construct_kind = 'FRAGESTELLUNG_BEURTEILUNG'`, `content = { beurteilung: … }`, Anker identisch mit FRAGESTELLUNG.

Strikte Trennung zur Rekonstruktion ist Architektur-Setzung, kein Stil. Keine Skala, kein Ampelsystem, keine prosaische Achsen-Abklapperung. Wertungs-Achsen rot/gelb/grün leben separat in H3:WERK_GUTACHT-b.

### Stufe 3 — LLM-Zusammenfassung MOTIVATION (`fasseMotivationZusammen`)

Bekommt nur die Motivations-¶ (alle ¶ vor dem Cluster im Container). 1–3 Sätze. Persistierung als `construct_kind = 'MOTIVATION'`.

Hinweis: die Mother-Setzung beschreibt eine differenziertere Choreographie (KONTEXTPROBE pro ¶ rückwärts, bedingte Block-Bildung). Die aktuelle Implementation vereinfacht das zu „alles im Container vor dem Cluster ist Motivation". Wenn die Vereinfachung an Werken bricht (z.B. wenn Cluster mehrere disjunkte Stellen hat), die KONTEXTPROBE nachziehen.

### Fallback — `llmFallbackVollerContainer`

Wenn der Parser keinen Marker im Container findet, übernimmt ein einziger LLM-Call den ganzen Container und macht Identifikation der Fragestellungs-¶ + Rekonstruktion + Motivations-Zusammenfassung in einem Schwung. Output enthält `fragestellung_paragraph_indices`, die für nachgelagerte Schritte (z.B. Beurteilung) als Material verwendet werden können.

---

## Eintrittspunkte

`src/lib/server/ai/h3/exposition.ts` exportiert:

- `runExpositionPass(caseId)` — Haupt-Pass: Parser + Rekonstruktion + Motivation. Persistiert FRAGESTELLUNG und ggf. MOTIVATION. **Beurteilung ist NICHT enthalten** und muss separat getriggert werden.
- `runBeurteilungOnly(caseId)` — isolierter Pass: lässt Parser/Fallback laufen, ruft **nur** den Beurteilungs-Call auf, persistiert **nur** FRAGESTELLUNG_BEURTEILUNG. Lässt FRAGESTELLUNG / MOTIVATION unangetastet.

CLI-Trigger:
- `npx tsx scripts/test-h3-exposition.ts <caseId>` — Haupt-Pass
- `npx tsx scripts/test-h3-exposition-beurteilung.ts <caseId>` — Beurteilungs-Pass isoliert

Die Trennung in zwei Eintrittspunkte schützt validierte Stände, weil Re-Run-Idempotenz für H3:EXPOSITION noch nicht implementiert ist (siehe `docs/h3_implementation_status.md`, Phase-3-Sektion „Was offen ist", Punkt 2).

---

## Was diese Strategie nicht ist

- Kein generischer Sentence-Tagger / Topic-Classifier auf der ganzen Einleitung.
- Keine Mehrfach-Identifikation: pro Werk genau ein Fragestellungs-Cluster (oder keiner).
- Keine Wertungs-Skala in den Konstrukt-Inhalten — Wertungs-Achsen leben in einem späteren WERK_GUTACHT-Pass und konsumieren die hier persistierten Konstrukte.
- Keine Vermischung Beurteilung ↔ Rekonstruktion: zwei getrennte LLM-Calls auf demselben Material, beide blind für das Ergebnis des anderen.
