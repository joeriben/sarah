# H3:SYNTHESE — Status

Eigenständige Status-Doku der SYNTHESE-Heuristik (parallel zu `h3_grundlagentheorie_status.md`, `h3_exkurs_status.md`, `h3_implementation_status.md`).

Letztes Update: 2026-05-05 (Cross-Typ-Substrat-Erweiterung: VERWEIS_PROFIL/ECKPUNKT/DISKURSIV/EXKURS-Stack/AUDIT-Hotspots flowen mit; gemeinsames `werk-substrate.ts` mit SR; Token-Budget 2000→6000; gegen BA H3 dev verifiziert — Synthese benennt Top-Autor-Konzentration und Theorie-Profil-Lücken konkret).

---

## Architektur-Setzung (User-Bestätigung 2026-05-04)

Mother-Kurzform aus `project_three_heuristics_architecture.md`: *"Eine SYNTHESE positioniert und systematisiert die ERKENNTNISSE im Hinblick auf die FORSCHUNGSFRAGE. Das ist das GESAMTERGEBNIS der Arbeit."* Konstrukte: GESAMTERGEBNIS, FRAGESTELLUNGS_ANTWORT.

Konkretisierung 2026-05-04:

1. **Ein Konstrukt** mit reichem content (Mother-Plural ist Felder-Plural, nicht Konstrukt-Plural). `construct_kind='GESAMTERGEBNIS'`, content = `{gesamtergebnisText, fragestellungsAntwortText, erkenntnisIntegration[], coverageRatio, ...}`. Zwei Konstrukte am gleichen Anker mit überlappendem Text wären redundant.

2. **Werk-Aggregat** (analog FORSCHUNGSGEGENSTAND): ein GESAMTERGEBNIS-Konstrukt pro Werk, anchor_element_ids = alle ¶ aller SYNTHESE-Container des Werks. "Gesamtergebnis der Arbeit" ist Werk-Ebene; mehrere SYNTHESE-Container werden im LLM-Prompt getrennt benannt, aber zu einer GESAMTERGEBNIS-Lesart aggregiert.

3. **ERKENNTNIS_INTEGRATION-Output**: pro DURCHFÜHRUNGS-BEFUND mit text!=null:
   - `befundIndex` (1-basiert) → wird auf `befundId` (UUID) gemappt
   - `integriert: bool`
   - `synthesisAnchorParagraphIndex` (1-basiert über alle SYNTHESE-Container) → gemappt auf `synthesisAnchorParagraphId` (UUID), null wenn nicht integriert
   - `hinweis: string|null` — Critical-Friend-Bemerkung, primär bei nicht-integrierten BEFUNDEN
   - `coverageRatio = count(integriert=true) / count(BEFUNDE)` — null wenn keine BEFUNDE vorhanden

4. **Idempotenz**: `delete-before-insert` auf (case_id, document_id, outline_function_type='SYNTHESE', construct_kind='GESAMTERGEBNIS'). SYNTHESE wird nicht von späteren Heuristiken re-spezifiziert — kein version_stack jenseits des origin-Eintrags.

5. **Cross-Typ-Reads (Erweiterung 2026-05-05)** — gemeinsam mit SR über `src/lib/server/ai/h3/werk-substrate.ts`:
   - **EXPOSITION**: FRAGESTELLUNG (Pflicht) + optional FRAGESTELLUNG-Beurteilung (sobald Qualifizierung gemerged) + optional MOTIVATION (negative-Signal-fähig)
   - **FORSCHUNGSDESIGN**: METHODOLOGIE + METHODEN + BASIS (Triple, automatisch geladen — vorher nur via SR optional)
   - **GRUNDLAGENTHEORIE**:
     - FORSCHUNGSGEGENSTAND (automatisch EXKURS-modifiziert via SELECT — kein Aggregator-Read nötig, der current state ist nach allen `re_spec`-Anwendungen)
     - VERWEIS_PROFIL aggregiert auf Werk-Ebene: Top-Autoren-Liste, HHI (Konzentrations-Hinweis), Top-1-Share, Anzahl konsekutiver Cluster — als deskriptive Signale, nicht als Wertung
     - GTH-Reflexionsschicht (defensive — funktioniert auch wenn Konstrukte fehlen): BLOCK_WUERDIGUNG-Snippets, ECKPUNKT_BEFUND-Signal-Verteilung (kernbegriff/kontamination/provenienz × green/yellow/red), DISKURSIV_BEZUG_BEFUND-Verteilung (explizit/implizit/bezugslos)
   - **DURCHFÜHRUNG**:
     - alle BEFUND-Konstrukte mit text!=null (Pflicht)
     - **Audit-only-Hotspots** (text=null) als negative Signale — der LLM erkennt: Hotspot wurde geprüft, ohne dass ein Befund extrahierbar war
     - argument_substrate-counts (Werk-Total + DURCHFÜHRUNG-Subset) als quantitatives Größen-Signal
   - **EXKURS**: re_spec-history pro EXKURS aus dem `version_stack` des FORSCHUNGSGEGENSTAND — `imported_concepts`, `affected_concepts`, `re_spec_text` chronologisch (Werk-Wendungen werden nachvollziehbar)

6. **Critical-Friend-Identität**: GESAMTERGEBNIS-Text und FRAGESTELLUNGS-ANTWORT-Text sind deskriptiv. Bei nicht-integrierten BEFUNDEN ist der hinweis als Lese-Hinweis erlaubt ("Befund X bleibt unerwähnt"), nicht als Wertung der SYNTHESE selbst. Stil-Klausel im Prompt verbietet Skalen-Adjektive ("stark", "schwach", "lückenhaft", "kohärent", "tragfähig") — nur deskriptive Verben. HHI ≥ 0.5 ist im Helper als "stark konzentriert"-Hinweis vorbereitet, der LLM sieht den deskriptiven Befund, nicht die Zahl.

---

## Pipeline (eine Stufe pro Werk)

```
Cross-Typ-Substrat-Loading via werk-substrate.ts (Promise.all, parallel):
  - FRAGESTELLUNG + FRAGESTELLUNG-Beurteilung (optional) + MOTIVATION (optional)
  - FORSCHUNGSDESIGN-Triple: METHODOLOGIE + METHODEN + BASIS
  - FORSCHUNGSGEGENSTAND (post-EXKURS) + subjectKeywords
  - VERWEIS_PROFIL Werk-Aggregat: Top-Autoren, HHI, Top-1-Share, consecutive cluster count
  - GTH-Reflexion: BLOCK_WUERDIGUNG-Snippets + ECKPUNKT-Verteilung + DISKURSIV-Verteilung
  - alle BEFUND-Konstrukte mit text!=null (1-indexiert)
  - Audit-only-Hotspots: BEFUNDE mit text=null (negatives Signal)
  - argument_substrate-counts: Werk-Total + DURCHFÜHRUNG-Subset
  - re_spec-history aus FG.version_stack (EXKURS-Wendungen chronologisch)
  - alle SYNTHESE-Container (¶ mit globalem 1-basiertem indexInWerk)

1 LLM-Call mit Input (sectioned prompt):
  === KONTEXT === FRAGESTELLUNG + Beurteilung + MOTIVATION
  === METHODISCHES SETUP === METHODOLOGIE/METHODEN/BASIS
  === THEORIEBASIS-PROFIL === VERWEIS_PROFIL + GTH-Reflexion + EXKURS-Re-Spec
  === EMPIRIE-SUBSTRAT === BEFUNDE + Audit-Hotspots + argument-counts
  === BEFUNDE-LISTE === text!=null BEFUNDE 1..N
  === SYNTHESE-MATERIAL === alle ¶ aller SYNTHESE-Container

→ JSON-Output:
  - gesamtergebnisText: 5–8 Sätze deskriptiv (TEIL A)
  - fragestellungsAntwortText: 2–4 Sätze deskriptiv (TEIL B)
  - erkenntnisIntegration[]: pro BEFUND {befundIndex, integriert,
                              synthesisAnchorParagraphIndex|null, hinweis|null}

Persistenz:
  - delete prior GESAMTERGEBNIS für (case_id, document_id)
  - INSERT new GESAMTERGEBNIS-Konstrukt mit:
    * outline_function_type='SYNTHESE'
    * construct_kind='GESAMTERGEBNIS'
    * anchor_element_ids = alle ¶ aller SYNTHESE-Container
    * content = {gesamtergebnisText, fragestellungsAntwortText,
                 erkenntnisIntegration[], coverageRatio, containerOverview,
                 befundCount, crossTypeReads (snapshot der geladenen
                 Substrate-Diagnostik), llmModel, llmTimingMs}
    * version_stack = [{kind:'origin', at, by_user_id:null,
                        source_run_id:null, content_snapshot}]
```

Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`. Max-Tokens 6000 (vorher 2000 — Reasoning + längerer Output durch Cross-Typ-Erweiterung). Konfigurierbar via `modelOverride`.

---

## Implementation

| Datei | Inhalt |
|---|---|
| `src/lib/server/ai/h3/werk-substrate.ts` | **Gemeinsame Cross-Typ-Loaders SYNTHESE+SR** (2026-05-05): `loadFragestellungBeurteilung`, `loadMotivation`, `loadForschungsdesignTriple` (METHODOLOGIE/METHODEN/BASIS), `loadVerweisProfilAggregate` (Werk-aggregierte Top-Autoren/HHI/cluster-counts), `loadGthReflexionAggregate` (BLOCK_WUERDIGUNG/ECKPUNKT/DISKURSIV-Verteilung), `loadAuditOnlyHotspots`, `loadArgumentSubstrateCounts`, `loadFgRespecHistory`. Jeder Loader defensiv (gibt null/empty zurück, wenn Konstrukte fehlen). Plus `format*`-Helpers (`formatTheoriebasisBlock`, `formatMethodischesSetupBlock`, `formatAuditOnlyAndArgumentBlock`, `formatFragestellungBeurteilungBlock`, `formatMotivationBlock`) für deskriptive Prompt-Strings (HHI → "stark konzentriert"-Hinweis, Cluster-Verteilung → Liste). |
| `src/lib/server/ai/h3/synthese.ts` | `loadSyntheseContainers` (mit globalem `indexInWerk`), `loadFragestellungWithDiagnostics`, `loadForschungsgegenstandWithDiagnostics`, `loadBefundsWithText`, `extractGesamtergebnis` (LLM mit drei-teiliger Aufgabe, sectioned prompt), `clearExistingGesamtergebnis`, `persistGesamtergebnis`, `runSynthesePass` (Promise.all-Parallelladung der 8 cross-typ-Substrate vor LLM-Call) |
| `scripts/test-h3-synthese.ts` | CLI-Test mit `--persist`, `--provider=…/--model=…`. Kein temp-marking nötig — SYNTHESE-Container sind im Bestand. |

### Index-Mapping

Der LLM kennt UUIDs nicht. Im Prompt werden BEFUNDE als `[Befund 1]…[Befund N]` und SYNTHESE-¶ als `[¶1]…[¶M]` (global indexiert über alle SYNTHESE-Container) ausgeliefert. Im Server-Code werden die LLM-Indices auf `befundId` und `synthesisAnchorParagraphId` (UUIDs) zurückgemappt.

### Coverage-Berechnung

Server-seitig: `count(integriert=true) / count(BEFUNDE)`. `null` wenn keine BEFUNDE vorhanden (LLM bekommt dann `(keine BEFUND-Konstrukte aus DURCHFÜHRUNG mit text!=null vorhanden)` als Hinweis und kann erkenntnisIntegration leer lassen).

---

## Verifikation 2026-05-04

### Read-only-Lauf gegen BA H3 dev (Case `c42e2d8f-…`)

- 2 SYNTHESE-Container: "Gegenüberstellung mit Klafkis epochaltypischen Schlüssel-problemen…" (1 ¶) + "Fazit" (8 ¶) = 9 ¶
- 1 BEFUND mit text!=null aus DURCHFÜHRUNG
- 1 LLM-Call (Sonnet 4.6 via OpenRouter), 18.3s, 4.817 in / 843 out Tokens
- coverage=0% (1 BEFUND, nicht integriert)

### Persistierter Lauf — Output-Substanz

**GESAMTERGEBNIS** (5 Sätze, deskriptiv): integrative Linie zwischen Klafki und GCED, gemeinsames Bildungsverständnis (Mündigkeit, Solidarität, kritische Urteilsfähigkeit), explizite Schlüsselprobleme-Übernahme, Klafkis kritisch-konstruktive Didaktik als didaktisches Gerüst.

**FRAGESTELLUNGS-ANTWORT** (Critical-Friend-getönt, deskriptiv): *"grundsätzlich bejahender Befund: Die GCED-Programme werden als inhaltlich und bildungstheoretisch weitgehend kompatibel mit Klafkis Ansprüchen … eingestuft, wobei auf praktische Umsetzungsdefizite hingewiesen wird. Eine differenzierte Prüfung, ob die GCED die Dimensionen von Selbst-, Mitbestimmungs- und Solidaritätsfähigkeit strukturell verankert oder bildungstheoretisch unterdeterminiert bleibt, wird in der Synthese nur ansatzweise geleistet; die Antwort fällt eher affirmativ-harmonisierend als kritisch-differenzierend aus."*

**ERKENNTNIS-INTEGRATION** (Coverage 0%): der spezifische BEFUND zur frühkindlichen Bildung (strukturelle Zugangsbarrieren, Menschenrechtsbildung) wird in der SYNTHESE nicht adressiert — Critical-Friend-Hinweis: *"die dort erwähnten Herausforderungen der strukturellen Ausstattung bleiben zu allgemein, um diesen spezifischen Befund zu integrieren."*

### Idempotenz-Verifikation

Zweiter `--persist`-Lauf: `(1 prior GESAMTERGEBNIS-Konstrukt(e) ersetzt — idempotent)`. DB-Bestand bleibt bei 1 GESAMTERGEBNIS-Konstrukt pro Werk.

### Stichprobe gegen Habil 2026-05-04

Habil-Case `2635e73c-…`, 2 SYNTHESE-Container ("Reflexionen der kulturbezogenen Orientierungen" 64 ¶ + "Ansätze einer Theorie kultureller Lehrkräftebildung" 48 ¶ = 112 ¶ insgesamt), 0 BEFUNDE (DURCHFÜHRUNG-Pass auf Habil noch nicht gelaufen).

- 1 LLM-Call (Sonnet 4.6), 16.3s, 45.021 in / 605 out Tokens
- coverage=null (keine BEFUNDE — sauberer no-op-Pfad in ERKENNTNIS-INTEGRATION)
- GESAMTERGEBNIS substantiell: integriert empirisch rekonstruierte Orientierungsmuster (Grenzsetzung, technokratisch, Defizit, Kulturessentialismus, Gemeinschaft) in bildungs-/professionstheoretische Rahmung; entwickelt drei didaktische Prinzipien (Variabilität, Anerkennung sozialer Effekte, Balance Normbefolgung-Autonomie) plus konkrete hochschuldidaktische Ansätze; Leitkonzept "kulturbezogene Reflexivität"; Habitustransformation in der ersten Ausbildungsphase
- FRAGESTELLUNGS-ANTWORT mit präziser Critical-Friend-Diagnose: *"der Aspekt einer vollständigen Ausformulierung des Theoriegerüsts bleibt partiell programmatisch"* — entspricht der Selbsteinschätzung der Habil

Cost-Hochrechnung Habil-SYNTHESE: ~46k Tokens / 1 Call / ~45 ct OpenRouter — bezahlbar trotz 112 ¶ Container-Größe.

### Open: Test gegen Werk mit großer DURCHFÜHRUNG-BEFUND-Menge

Coverage-Map zeigt sich erst aussagekräftig bei 5–20 BEFUNDEN. Habil hat noch keine BEFUNDE; BA TM hat keine FRAGESTELLUNG. Validierung gegen umfangreiche BEFUND-Mengen steht aus, sobald DURCHFÜHRUNG-Pässe weiter gelaufen sind.

---

## Verifikation 2026-05-05 (Cross-Typ-Substrat-Erweiterung)

### Diagnose

H3-SYNTHESE sah vorher nur einen Bruchteil des verfügbaren H3-Substrats: FRAGESTELLUNG, FORSCHUNGSGEGENSTAND, BEFUNDE — **nicht aber** das VERWEIS_PROFIL-Aggregat (Top-Autoren/HHI), die GTH-Reflexionsschicht (BLOCK_WUERDIGUNG/ECKPUNKT/DISKURSIV), die EXKURS-Re-Spec-Geschichte oder den AUDIT-Hotspot-Audit-Trail. Output war oberflächlich-affirmativ ("integrative Linie zwischen Klafki und GCED…"), ohne die im VERWEIS_PROFIL bereits sichtbaren Konzentrationen aufzugreifen.

### Output-Vergleich BA H3 dev (Case `c42e2d8f-…`)

**SYNTHESE alt (2026-05-04, max 2000 tokens, 4 cross-typ-reads)**:
> "integrative Linie zwischen Klafki und GCED, gemeinsames Bildungsverständnis (Mündigkeit, Solidarität, kritische Urteilsfähigkeit), explizite Schlüsselprobleme-Übernahme, Klafkis kritisch-konstruktive Didaktik als didaktisches Gerüst."

**SYNTHESE neu (2026-05-05, max 6000 tokens, 8 cross-typ-reads, sectioned prompt)**: 6 Sätze, benennt jetzt explizit
> "stark konzentrierten Rückgriff auf Wolfgang Klafki; Chu und Hermes aus dem Theoriebasis-Profil werden in der Synthese nicht erwähnt"

— die Top-1-Share/HHI-Konzentration (Klafki dominiert das VERWEIS_PROFIL) und die im Theoriebasis-Profil gelisteten Sekundär-Autoren tragen jetzt am Material durch. Der LLM benennt dies deskriptiv ("stark konzentrierten Rückgriff", "werden nicht erwähnt"), nicht skalen-wertend — die Stil-Klausel im Prompt verbietet "stark/schwach/lückenhaft" als Wertung; "stark konzentriert" beschreibt den Rückgriff, nicht den Wert.

### Cost-Beobachtung

BA H3 dev (1 BEFUND, 9 SYNTHESE-¶, 1 GTH-Container): ~7.8k input / ~1.1k output Tokens, 22s mit Sonnet 4.6. Token-Aufschlag durch Cross-Typ-Substrat ~+60% gegenüber alter Variante; Output-Substanz Faktor ~2 reicher.

### Defensive Erweiterung

Substrate-Loaders haben hard verifications für Werke, in denen GTH-Reflexion fehlt (BA H3 dev hat noch keinen vollständigen GTH-Reflexions-Pass). Loader gibt dann null/empty zurück, Prompt fällt auf reduzierten Kontext zurück, kein Fail. Memory `feedback_missing_is_finding_not_block` — fehlendes Substrat ist Befund, nicht Blocker.

---

## Offene Punkte

1. **Container-Heading-Verknüpfung BEFUND → DURCHFÜHRUNG-Container**: aktuell wird der DURCHFÜHRUNGS-Container des BEFUNDes nicht im LLM-Prompt mitgeliefert. Bei vielen BEFUNDEN aus mehreren Containern könnte das die Disambiguierung erschweren. Erweiterung: `virtual_container_id`-Lookup mit container_heading-Anzeige.

2. **Multi-SYNTHESE-Granularität**: BA H3 dev hat 2 SYNTHESE-Container. Werk-Aggregat ist konzeptionell richtig, aber bei Werken mit z.B. einem "Zwischenfazit" und einem "Schlussfazit" könnte container-getrennte Auswertung Information bewahren. Heute aggregiert, Sub-Container-Auswertung deferred.

3. **Container-Orchestrator**: SYNTHESE in die Master-Pipeline eingliedern. Reihenfolge: nach DURCHFÜHRUNG (BEFUNDE müssen vorliegen), nach EXKURS (FORSCHUNGSGEGENSTAND ggf. re-spezifiziert), vor SCHLUSSREFLEXION (die GESAMTERGEBNIS lesen wird). Spec offen.

4. **TS-Type-Issue im JSON-Extract-Pattern**: `'in'`-Guard-Workaround wie in exkurs.ts (Project-weit deferred).

---

## Pflicht-Lektüre

- `docs/h3_grundlagentheorie_status.md` — FORSCHUNGSGEGENSTAND-Schema, das SYNTHESE liest
- `docs/h3_exkurs_status.md` — EXKURS-Modifikation des FORSCHUNGSGEGENSTAND ist transparent für SYNTHESE
- Memory `project_three_heuristics_architecture.md` — Mother-Setzung
- Memory `project_critical_friend_identity.md` — deskriptiver Stil + Critical-Friend-Hinweise
- `docs/architecture/05-pipeline-h3.md` Abschnitt 4.6
