# H3:SYNTHESE — Status

Eigenständige Status-Doku der SYNTHESE-Heuristik (parallel zu `h3_grundlagentheorie_status.md`, `h3_exkurs_status.md`, `h3_implementation_status.md`).

Letztes Update: 2026-05-04 (Erstimplementation, gegen BA H3 dev funktional verifiziert; persistierter Lauf liefert substantiellen Critical-Friend-Befund).

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

5. **Cross-Typ-Reads (Pflicht)**:
   - FRAGESTELLUNG (EXPOSITION)
   - FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE) — automatisch EXKURS-modifiziert via SELECT, kein Aggregator-Read nötig
   - alle BEFUND-Konstrukte (DURCHFÜHRUNG) mit text!=null (text=null sind Audit-Trail-Einträge ohne Befund)

6. **Critical-Friend-Identität**: GESAMTERGEBNIS-Text und FRAGESTELLUNGS-ANTWORT-Text sind deskriptiv. Bei nicht-integrierten BEFUNDEN ist der hinweis als Lese-Hinweis erlaubt ("Befund X bleibt unerwähnt"), nicht als Wertung der SYNTHESE selbst.

---

## Pipeline (eine Stufe pro Werk)

```
1 LLM-Call mit Input:
  - FRAGESTELLUNG (aus EXPOSITION)
  - FORSCHUNGSGEGENSTAND + subjectKeywords (aus GRUNDLAGENTHEORIE,
                                            ggf. EXKURS-modifiziert)
  - alle BEFUND-Konstrukte (1-indexiert) mit content.text
  - alle SYNTHESE-Container (¶ mit globalem 1-basiertem indexInWerk)
→ JSON-Output:
  - gesamtergebnisText: 3–5 Sätze deskriptiv
  - fragestellungsAntwortText: 1–3 Sätze deskriptiv
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
                 befundCount, llmModel, llmTimingMs}
    * version_stack = [{kind:'origin', at, by_user_id:null,
                        source_run_id:null, content_snapshot}]
```

Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`. Max-Tokens 2000. Konfigurierbar via `modelOverride`.

---

## Implementation

| Datei | Inhalt |
|---|---|
| `src/lib/server/ai/h3/synthese.ts` | `loadSyntheseContainers` (mit globalem `indexInWerk`), `loadFragestellungWithDiagnostics`, `loadForschungsgegenstandWithDiagnostics`, `loadBefundsWithText`, `extractGesamtergebnis` (LLM mit drei-teiliger Aufgabe), `clearExistingGesamtergebnis`, `persistGesamtergebnis`, `runSynthesePass` |
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

### Open: Test gegen Werk mit größerer DURCHFÜHRUNG-BEFUND-Menge

BA H3 dev hat 1 BEFUND. Coverage-Map zeigt sich erst aussagekräftig bei 5–20 BEFUNDEN. Validierung gegen Habil/Bachelorarbeit-TM-Cases steht aus, sobald deren DURCHFÜHRUNG-Pässe BEFUNDE persistiert haben.

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
