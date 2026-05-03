# H3:SCHLUSSREFLEXION — Status

Eigenständige Status-Doku (parallel zu `h3_grundlagentheorie_status.md`, `h3_exkurs_status.md`, `h3_synthese_status.md`).

Letztes Update: 2026-05-04 (Erstimplementation, gegen BA H3 dev funktional verifiziert).

---

## Architektur-Setzung (User-Bestätigung 2026-05-04, "ok")

Mother (`project_three_heuristics_architecture.md`): Konstrukte GELTUNGSANSPRUCH, GRENZEN, ANSCHLUSSFORSCHUNG. Tools "gleichnamige Extraktoren auf Schlüsselwort-Vorauswahl". Cross-Typ: liest GESAMTERGEBNIS + FRAGESTELLUNG.

Konkretisierung 2026-05-04 (analog SYNTHESE):

1. **Ein Konstrukt** mit drei Feldern: `construct_kind='GELTUNGSANSPRUCH'` (Mother's primary, da der Geltungsanspruch das zentrale Werk-Reflexionskonstrukt ist), content = `{geltungsanspruchText, grenzenText, anschlussforschungText, ...}`.

2. **Werk-Aggregat**: anchor = alle ¶ aller SCHLUSSREFLEXION-Container.

3. **Cross-Typ-Reads über Mother-Minimum hinaus erweitert** (Mother-Lücke geschlossen):
   - FRAGESTELLUNG (EXPOSITION) — Pflicht
   - FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE, ggf. EXKURS-modifiziert) — Pflicht
   - GESAMTERGEBNIS + FRAGESTELLUNGS-ANTWORT (SYNTHESE) — Pflicht
   - METHODEN + BASIS (FORSCHUNGSDESIGN) — optional, für Methoden-/Sample-Grenzen-Reflektion

4. **Idempotenz**: `delete-before-insert` auf (case_id, document_id, outline_function_type='SCHLUSSREFLEXION', construct_kind='GELTUNGSANSPRUCH'). SR ist die letzte Werk-Heuristik vor WERK_*; kein version_stack-Wachstum jenseits origin.

5. **Schlüsselwort-Vorauswahl** (Mother): heute NICHT als Pre-Filter implementiert. Pragmatisch: ganzer SR-Container an LLM, der erkennt die drei Komponenten selbst aus dem Kontext (analog wie SYNTHESE den ganzen Kontext bekommt). Pre-Filter könnte als Optimierung folgen, falls Container sehr groß werden.

6. **Critical-Friend-Identität**: Texte sind deskriptiv. Bei nicht-explizit-formulierten Komponenten (z.B. Werk benennt keine Grenzen) wird das transparent benannt ("Werk reflektiert keine Methoden-Grenzen explizit"), nicht weggeschoben — als deskriptive Beobachtung, nicht als Wertung.

---

## Pipeline (eine Stufe pro Werk)

```
1 LLM-Call mit Input:
  - FRAGESTELLUNG (EXPOSITION)
  - FORSCHUNGSGEGENSTAND (GTH, ggf. EXKURS-modifiziert)
  - GESAMTERGEBNIS + FRAGESTELLUNGS-ANTWORT (SYNTHESE)
  - METHODEN + BASIS (FORSCHUNGSDESIGN, optional)
  - alle SCHLUSSREFLEXION-Container ¶ (global indexiert)
→ JSON-Output:
  - geltungsanspruchText (1–4 Sätze deskriptiv)
  - grenzenText (1–4 Sätze deskriptiv)
  - anschlussforschungText (1–4 Sätze deskriptiv)
Persistenz:
  - delete prior GELTUNGSANSPRUCH für (case_id, document_id)
  - INSERT new GELTUNGSANSPRUCH-Konstrukt mit:
    * outline_function_type='SCHLUSSREFLEXION'
    * construct_kind='GELTUNGSANSPRUCH'
    * anchor_element_ids = alle ¶ aller SR-Container
    * content = {geltungsanspruchText, grenzenText, anschlussforschungText,
                 containerOverview, hadMethoden, hadBasis, llmModel, llmTimingMs}
    * version_stack = [{kind:'origin', ...}]
```

Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`. Max-Tokens 1500.

---

## Implementation

| Datei | Inhalt |
|---|---|
| `src/lib/server/ai/h3/schlussreflexion.ts` | `loadSchlussreflexionContainers`, Cross-Typ-Loaders mit Diagnostics, `loadMethodenAndBasis`, `extractSchlussreflexion` (LLM mit drei-teiliger Aufgabe), `clearExistingSchlussreflexion`, `persistSchlussreflexion`, `runSchlussreflexionPass` |
| `scripts/test-h3-schlussreflexion.ts` | CLI-Test mit `--persist`, `--provider=…/--model=…` |

---

## Verifikation 2026-05-04

### Persistierter Lauf gegen BA H3 dev (Case `c42e2d8f-…`)

- 1 SR-Container "Kritische Reflexion" (2 ¶)
- Alle Cross-Typ-Reads vorhanden: FRAGESTELLUNG, FORSCHUNGSGEGENSTAND, GESAMTERGEBNIS, METHODEN, BASIS
- 1 LLM-Call (Sonnet 4.6 via OpenRouter), 16.7s, 4.054 in / 688 out Tokens

**GELTUNGSANSPRUCH** (3 Sätze, deskriptiv): *"Die Arbeit beansprucht, durch den bildungstheoretischen Vergleich zwischen Klafkis kritisch-konstruktiver Didaktik und den GCED-Programmen kritische Differenzen zwischen beiden Ansätzen offengelegt und damit die GCED-Programmatik normativ vermessen zu haben. Implizit erhebt sie den Anspruch, gezeigt zu haben, wo die GCED didaktisch unterdeterminiert bleibt … Ein darüber hinausgehender Anspruch auf systematisch abgesicherte Reichweite (etwa durch Vollständigkeit des Korpus oder Intersubjektivität der Analyse) wird nicht artikuliert."* — Critical-Friend-Diagnose des Geltungs-Limits sauber benannt.

**GRENZEN** (3 Sätze, Critical-Friend-präzise): *"Das Werk benennt keine methodischen oder korpusbezogenen Grenzen … explizit; Fragen nach der Auswahl der herangezogenen UNESCO-Dokumente und Klafki-Schriften sowie nach der Intersubjektivität des Vergleichsverfahrens bleiben unreflektiert. Thematisch deutet die Reflexion eine Grenze an, indem postkoloniale und machtkritische Perspektiven … als Desiderat benannt werden, das die Arbeit selbst nicht systematisch eingelöst hat. Die auf einem deklarierten, aber methodisch nicht weiter ausgearbeiteten Vergleich basierende Anlage … lässt offen, inwieweit die identifizierten Differenzen analytisch gesichert oder interpretativ gesetzt sind."* — sehr präzise Diagnose der Methoden-Reflexions-Lücke.

**ANSCHLUSSFORSCHUNG** (3 Sätze): *"Die Schlussreflexion formuliert als produktiven Ausblick das Spannungsfeld zwischen Klafkis Didaktik und der GCED als Ausgangspunkt … ohne konkrete Forschungsfragen oder -designs zu benennen. Implizit werden als Anschlussrichtungen erkennbar: die stärkere didaktische Fundierung von GCED-Programmen, deren Dialog mit postkolonialen und machtkritischen Bildungsansätzen sowie eine Überprüfung der Standardisierungslogik in GCED-Kompetenzkatalogen. Explizite Praxis-Empfehlungen oder Vorschläge für empirische Folgestudien werden nicht ausgeführt."*

### Idempotenz-Verifikation

Zweiter `--persist`-Lauf: `(1 prior Konstrukt(e) ersetzt — idempotent)`. DB-Bestand bleibt 1 GELTUNGSANSPRUCH pro Werk.

---

## Offene Punkte

1. **Schlüsselwort-Vorauswahl** als Pre-Filter (Mother-Idee): heute nicht implementiert. Pragmatischer Vollkontext-Pass läuft auf BA H3 dev ohne Probleme; bei sehr langen SR-Kapiteln (>30 ¶) könnte Pre-Filter als Optimierung sinnvoll werden.

2. **Container-Orchestrator**: SR in die Master-Pipeline. Reihenfolge: NACH SYNTHESE (Pflicht-Read), nach FORSCHUNGSDESIGN (METHODEN/BASIS optional), als letzter werk-strukturierter Pass vor WERK_DESKRIPTION/WERK_GUTACHT. Spec offen.

3. **Test gegen Habil + BA TM**: BA H3 dev ist mono-thematisch (1 SR-Container, keine echte methodologische Reflexion). Habil mit umfangreicherer SCHLUSSREFLEXION wäre der bessere Stress-Test, sobald deren SYNTHESE-Pass gelaufen ist.

4. **TS-Type-Issue im JSON-Extract-Pattern**: `'in'`-Guard-Workaround wie in synthese.ts (Project-weit deferred).

---

## Pflicht-Lektüre

- `docs/h3_synthese_status.md` — GESAMTERGEBNIS-Schema, das SR liest
- `docs/h3_grundlagentheorie_status.md` — FORSCHUNGSGEGENSTAND
- `docs/h3_implementation_status.md` — METHODEN/BASIS-Schema
- `docs/h3_exkurs_status.md` — EXKURS-Modifikation des FG ist transparent für SR (lesbar via SELECT)
- Memory `project_three_heuristics_architecture.md` — Mother-Setzung
- Memory `project_critical_friend_identity.md` — deskriptiver Stil + Critical-Friend-Hinweise als deskriptive Beobachtungen
- `docs/architecture/05-pipeline-h3.md` Abschnitt 4.7
