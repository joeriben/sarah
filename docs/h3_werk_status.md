# H3:WERK_DESKRIPTION + WERK_GUTACHT — Status

Eigenständige Status-Doku (parallel zu `h3_synthese_status.md`, `h3_schlussreflexion_status.md`, `h3_exkurs_status.md`).

Letztes Update: 2026-05-04 (Erstimplementation; Smoke-Test gegen BA H3 dev / Habil ausstehend).

---

## Architektur-Setzung (Mother + User 2026-05-04)

Mother (`project_three_heuristics_architecture.md`):
- **WERK_DESKRIPTION** — Werk-Ebene, immer aktiv. Konstrukt `WERK_BESCHREIBUNG` (neutrale, zusammenhängende Inhaltszusammenfassung). Aggregation aus persistierten Konstrukten + Outline. **Kein neuer Wert, keine Bewertung.**
- **WERK_GUTACHT** — Werk-Ebene, läuft *nach* WERK_DESKRIPTION, wiederholt sie nicht. Drei Sub-Stufen plus dialogischer Block:
  - **a** Werk-im-Lichte-der-Fragestellung — längerer Absatz, immer aktiv
  - **b** Hotspot-Würdigung nach funktionstyp-strukturiertem Raster der Bewertungsachsen, strukturierend nicht erschöpfend, indikator-getrieben (gelb/rot)
  - **c** Fazit aus a+b — gated durch Upload eines `review_draft`
  - **d/e/f** dialogischer Block, zwingend nach c (Blind-Position, Differenz, Reflexive Position) — gated

Critical-Friend-Identität (`project_critical_friend_identity.md`):
- SARAH automatisiert das Beurteilen NICHT
- Sprache: "analysiert", "Indikator", "Critical-Friend-Hinweis" — niemals "bewertet/beurteilt"
- Indikatoren codieren Wertung (gelb=Ambivalenz, rot=Problem); grün ist bewusst ausgespart
- d vor e/f mit Prompt-Isolation gegen Gutachten-Leak (technisch erzwungen, sobald implementiert)

User-Setzung 2026-05-04:
- Inputs Option B: `function_constructs` aller H3-Phasen + optional `memo_content` (chapter/subchapter), wenn ein H1- oder H2-Run zuvor lief
- WERK_GUTACHT-c heute mit **deaktiviertem Gating** für Testung (`content.gatingDisabled=true` markiert das transparent); d/e/f bleibt deferred
- Begründung Option B: Reviewer-Notes-Integration (anstehend) wird über denselben optional-erweiterbaren Input-Pfad laufen

---

## Implementation

| Datei | Inhalt |
|---|---|
| `migrations/050_function_constructs_werk_types.sql` | CHECK-Liste-Erweiterung um WERK_DESKRIPTION + WERK_GUTACHT |
| `src/lib/server/ai/h3/werk-shared.ts` | Geteilte Loader: `loadAllConstructs`, `loadCollapseMemos`, `buildOutlineSummary`, `buildConstructsBlock`, `buildMemosBlock`, `stripHtml` |
| `src/lib/server/ai/h3/werk-deskription.ts` | `runWerkDeskriptionPass` — 1 LLM-Call, deskriptive Werk-Beschreibung |
| `src/lib/server/ai/h3/werk-gutacht.ts` | `runWerkGutachtPass` — 3 LLM-Calls (Stage a, b, c), ein Konstrukt mit allen drei Texten persistiert |
| `src/lib/server/pipeline/h3-phases.ts` | `h3_werk_deskription` + `h3_werk_gutacht` aus Stub durch echte Aufrufe ersetzt; Done-Check + Validation-Check über Standard-Path |

Persistenz:
- `outline_function_type='WERK_DESKRIPTION'`, `construct_kind='WERK_BESCHREIBUNG'`, `anchor_element_ids = nicht-excluded Top-Level-Heading-IDs`
- `outline_function_type='WERK_GUTACHT'`, `construct_kind='WERK_GUTACHT'`, gleicher Anchor-Set; `content = {aText, bAxes, cText, gatingDisabled, gatingNote, ...}`

Idempotenz: clean-vor-insert (delete prior, insert new); kein version_stack-Wachstum jenseits origin (analog SR).

---

## LLM-Schemas

**WERK_BESCHREIBUNG** (1 Call):
```json
{ "werkBeschreibungText": "<8–18 Sätze deskriptive Werk-Beschreibung>" }
```

**WERK_GUTACHT-a** (1 Call):
```json
{ "aText": "<6–12 Sätze Werk-im-Lichte-der-Fragestellung>" }
```

**WERK_GUTACHT-b** (1 Call):
```json
{
  "axes": [
    { "axisName": "FRAGESTELLUNG-Qualität",            "indicator": "yellow"|"red"|null, "rationale": "..." },
    { "axisName": "GRUNDLAGENTHEORIE-Fundiertheit",    "indicator": "yellow"|"red"|null, "rationale": "..." },
    { "axisName": "FORSCHUNGSDESIGN-Angemessenheit",   "indicator": "yellow"|"red"|null, "rationale": "..." },
    { "axisName": "DURCHFUEHRUNG-Qualität",            "indicator": "yellow"|"red"|null, "rationale": "..." },
    { "axisName": "SYNTHESE-Systematisierungsleistung","indicator": "yellow"|"red"|null, "rationale": "..." },
    { "axisName": "SCHLUSSREFLEXION-Legitimiertheit",  "indicator": "yellow"|"red"|null, "rationale": "..." }
  ]
}
```

Achsen-Reihenfolge wird beim Parse geprüft; LLM-Umsortierung wirft einen Fehler.

**WERK_GUTACHT-c** (1 Call, Test-Modus):
```json
{ "cText": "<5–10 Sätze aggregierendes Gesamtbild>" }
```

Stage c bekommt im System-Prompt einen expliziten Test-Modus-Hinweis: das Gating ist ohne `review_draft` deaktiviert, der Output darf nicht den Eindruck eines abschließenden Gutachtens erwecken — c bleibt aggregierend-deskriptiv aus a + b.

---

## Default-Modell + Token-Budget

`openrouter/anthropic/claude-sonnet-4.6`. `maxTokens` per Stage:
- WERK_DESKRIPTION: 2500
- WERK_GUTACHT-a: 1500
- WERK_GUTACHT-b: 2500
- WERK_GUTACHT-c: 1500

---

## Vorbedingungen

`runWerkDeskriptionPass` wirft `PreconditionFailedError`, wenn:
- `loadEffectiveOutline` null liefert (Werk hat keine ladbare Outline)
- Werk hat keine nicht-excluded Top-Level-Headings (`anchor_element_ids`-Constraint verlangt mind. 1 Element)

`runWerkGutachtPass` wirft `PreconditionFailedError`, wenn:
- Outline / Top-Level-Headings fehlen (s.o.)
- `WERK_BESCHREIBUNG`-Konstrukt fehlt (h3_werk_deskription muss vorab gelaufen sein)
- `FRAGESTELLUNG`-Konstrukt fehlt (h3_exposition muss vorab gelaufen sein)

Keine plain `Error`s für Vor-Heuristik-Pflichten — der Orchestrator-Loop fängt `PreconditionFailedError` und persistiert die Run-State-Transition `failed` mit Reviewer-Recovery-Diagnose.

---

## Offene Punkte

1. **Smoke-Test gegen BA H3 dev / Habil**: Erstimplementation ist nur typgeprüft (vite/svelte-check sauber, keine Errors auf den Files). End-to-end-Lauf gegen einen vollständig durchgelaufenen H3-Case (alle Phasen done, alle Konstrukte persistiert) steht aus. Erwartete Schritte: H3-Run auf einem Case mit `h3_enabled=true`, dann `h3_werk_deskription` + `h3_werk_gutacht` als zwei letzte Phasen.

2. **Gating-Reaktivierung mit Roadmap-Stufe 4**: sobald `case.review_draft_document_id`-Upload-UI existiert, wird `gatingDisabled` per Default `false` und prüft auf `case.review_draft_document_id !== null`. Heute ist `gatingDisabled` hartkodiert auf `true` im `runWerkGutachtPass`-Body.

3. **Dialogischer Block d/e/f**: deferred. Implementation braucht:
   - Stage d (Blind-Position): LLM-Aufruf mit `review_draft`-Inhalt EXPLIZIT NICHT in den Inputs (Prompt-Isolation), produziert eine LLM-eigene Position über das Werk
   - Stage e (Differenz): zweiter LLM-Call mit Stage-d-Output + `review_draft` → benennt Unterschiede
   - Stage f (Reflexive Position): LLM revidiert oder verteidigt die Stage-d-Position am Material
   - Reihenfolge-Constraint d → e → f technisch erzwingen
   - Eigene Phase `h3_werk_dialog` im Orchestrator? Oder Sub-Stages innerhalb `h3_werk_gutacht`? — offen

4. **Reviewer-Notes-Integration**: anstehend. Voraussichtliche Quelle: `heading_classifications.notes` (User-Notizen pro Heading) + ggf. ein neues `case_review_notes`-Schema. Werk-Heuristiken werden Notes als zusätzlichen Input nehmen (Option B-Pfad ist offen für solche Erweiterungen).

5. **Achsen-Reihenfolge-Validierung**: heute throw bei LLM-Umsortierung. Robuster wäre Re-Sortierung im Code (LLM darf umsortieren, wir sortieren um). Pragmatisch: heute strict, weil JSON-Schema bei Sonnet 4.6 in der Regel die Reihenfolge respektiert.

---

## Pflicht-Lektüre

- `project_three_heuristics_architecture.md` — Mother-Setzung Assessment-Achsen + a/b/c/d/e/f-Aufschlüsselung
- `project_critical_friend_identity.md` — Gating-Logik + Sprachregeln
- `docs/h3_orchestrator_spec.md` — Vorbedingungs-Tabelle, Konsequenz-Abschnitt für WERK
- `migrations/050_function_constructs_werk_types.sql` — CHECK-Liste-Erweiterung
- `src/lib/server/ai/h3/werk-shared.ts` — geteilte Loader, ggf. Erweiterung um Reviewer-Notes-Loader später
