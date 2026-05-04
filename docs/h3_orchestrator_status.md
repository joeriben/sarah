# H3-Orchestrator-Status

Status der H3-Orchestrator-Integration — der Pipeline-Run-Anschluss von H3 an Mig 038 (`pipeline_runs`-Mechanik). Spec: [`h3_orchestrator_spec.md`](./h3_orchestrator_spec.md). Per-Heuristik-Status: [`h3_implementation_status.md`](./h3_implementation_status.md), [`h3_grundlagentheorie_status.md`](./h3_grundlagentheorie_status.md), [`h3_synthese_status.md`](./h3_synthese_status.md), [`h3_schlussreflexion_status.md`](./h3_schlussreflexion_status.md).

Letztes Update: 2026-05-04 — Interface-Session-Ergänzungen: SR-Recovery-Heuristik (User-Setzung — letztes Drittel des letzten Kapitels statt STOP bei fehlendem SR-Container) + Outline-Numbering-Counter-Fix. Vorher: End-to-end-Integration durch (Migration 049, h3-phases-Modul, Brief-Verkabelung, pipeline-status-Erweiterung, Smoke-Test). Frische Test-Case-Validierung steht aus.

---

## Stand

| Schritt | Status |
|---|---|
| FORSCHUNGSDESIGN-Heuristik bereinigt (harte Vorbedingungen) | ✓ Commit `59b3f10` |
| Migration 049 `construct_validations` | ✓ Commit `57637ed` |
| Phase-Type + RunOptions + phasesForRun() um H3 erweitert | ✓ in Commit `d122dae` (gemischt mit Docs der Parallel-Session) |
| `src/lib/server/pipeline/h3-phases.ts` (Dispatch-Modul) | ✓ in Commit `d122dae` |
| Brief→RunOptions-Verkabelung (`include_h3`) | ✓ Commit `87010d6` |
| `pipeline-status`-Endpoint um H3-Phase-Felder erweitert | ✓ Commit `87010d6` |
| Smoke-Test `scripts/test-h3-orchestrator-status.ts` | ✓ Commit `87010d6` |
| SR-Recovery-Heuristik (letztes Drittel statt STOP, `needsMoreContext`-Eskalation, Defizit-Befund-Persistierung) | ✓ Interface-Session 2026-05-04 |
| Outline-Numbering-Counter-as-Master (Server + Frontend, Parser-Mismatch via `hasNumberingMismatch`-Flag) | ✓ Interface-Session 2026-05-04 |
| WERK_DESKRIPTION-Heuristik (Mig 050, Aggregat aus allen H3-Konstrukten + optional H1/H2-memo_content) | ✓ Interface-Session 2026-05-04 |
| WERK_GUTACHT-Heuristik a/b/c (Stage-c-Gating für Testung deaktiviert; d/e/f bleibt deferred bis review_draft-Upload) | ✓ Interface-Session 2026-05-04 |
| Heuristik-Pfad-Wahl-Radio H1/H2/H3 + 'auto' (Brief-Default) im Doc-Page Run-Setup | ✓ Interface-Session 2026-05-04 |
| Pre-Run-Validation der H3-Pflicht-Funktionstypen (`H3_REQUIRED_FUNCTION_TYPES` in h3-vocabulary.ts gegen Outline-Coverage) — Block-Banner + disabled Run-Button | ✓ Interface-Session 2026-05-04 |
| Frischer End-to-end-Lauf (neuer Case mit `h3_enabled=true`) | offen |

---

## Was funktioniert (durch Smoke-Test verifiziert gegen BA H3 dev)

`npx tsx scripts/test-h3-orchestrator-status.ts c42e2d8f-1771-43bb-97c8-f57d7d10530a`:

| Phase | Done | Bemerkung |
|---|---|---|
| h3_exposition | ✓ | FRAGESTELLUNG aus `function_constructs` |
| h3_grundlagentheorie | ✓ | werk-aggregierter FORSCHUNGSGEGENSTAND |
| h3_forschungsdesign | ✓ | METHODOLOGIE/METHODEN/BASIS — eines reicht |
| h3_durchfuehrung | ✓ | BEFUND aus Step 4 der DURCHFÜHRUNG-Kette |
| h3_synthese | ✓ | GESAMTERGEBNIS |
| h3_schlussreflexion | ✓ | GELTUNGSANSPRUCH |
| h3_exkurs | · | korrekt — BA H3 dev hat keinen EXKURS-Container, keine `re_spec`-Stack-Einträge |
| h3_werk_deskription | (neu, Smoke-Test ausstehend) | echte Aufrufe statt Stub seit Interface-Session 2026-05-04 |
| h3_werk_gutacht | (neu, Smoke-Test ausstehend) | echte Aufrufe a/b/c, c-Gating deaktiviert für Testung |

Validierungs-Status für alle Phasen: leer (`construct_validations` ist neu, noch keine Marker gesetzt).

---

## Architektur (kurze Beschreibung)

H3 ist einer von **drei exklusiven Heuristik-Pfaden** (H1 / H2 / H3) — `phasesForRun()` (`src/lib/server/pipeline/orchestrator.ts`) liefert pro Run die Phasen-Liste GENAU EINES Pfads. Mig-038-Mechanik (SSE, Pause/Resume, Idempotenz, Token-Tracking, `cancel_requested`) bleibt unverändert. Pfad-Wahl über `RunOptions.heuristic: 'h1' | 'h2' | 'h3'` (Default `'h1'`); abgeleitet aus `assessment_briefs.h3_enabled` (Mig 047) → wenn true, Default `'h3'`. Body-Param überschreibt den Brief-Default.

> **Korrektur 2026-05-04:** vor dieser Korrektur war H3 als „zusätzliche Phasen" hinter H1 modelliert (`include_h3: boolean`-Flag). Das war falsch. H1/H2/H3 sind eigenständig und exklusiv pro Run-Trigger; wer mehrere Pfade laufen lassen will, triggert sequenziell mehrere Runs.

Die Heuristik-Aufrufe leben in [`src/lib/server/pipeline/h3-phases.ts`](../src/lib/server/pipeline/h3-phases.ts) — ein dünner Dispatch-Layer mit drei Funktionen:

- `runH3Phase(phase, caseId, documentId)` — prüft Validierungs-Status (Mig 049), ruft die zugehörige Heuristik (oder Heuristik-Kette für GTH 5-stufig / DURCHFÜHRUNG 4-stufig); aggregiert Tokens. `PreconditionFailedError` aus den Heuristiken (z.B. FORSCHUNGSDESIGN ohne FORSCHUNGSGEGENSTAND) fliegt **ungefangen** zum Orchestrator-Loop, der sie als `failed` mit Diagnose persistiert.
- `isH3PhaseDoneForDocument(phase, documentId)` — Done-Check für `listAtomsForPhase`, basiert auf primärem Output-Konstrukt (z.B. FRAGESTELLUNG für h3_exposition; FORSCHUNGSGEGENSTAND für h3_grundlagentheorie; FG mit `version_stack @> '[{"kind":"re_spec"}]'::jsonb` für h3_exkurs).
- `isH3PhaseValidated(phase, caseId, documentId)` — User-Schutz-Check via `construct_validations`.

H3-Phasen sind alle **werk-aggregiert** (Single-Atom = das Werk), Container-Iteration intern in der Heuristik (Spec #4).

---

## Konsequenz für FORSCHUNGSDESIGN-Heuristik (Schritt 1, abgeschlossen)

Die heutige `forschungsdesign.ts`-Heuristik mit ihrem "FORSCHUNGSGEGENSTAND optional, mahne LLM zur Zurückhaltung"-Pattern wurde bereinigt (Commit `59b3f10`):
- `runForschungsdesignPass` wirft `PreconditionFailedError` bei fehlender FRAGESTELLUNG / FORSCHUNGSGEGENSTAND
- methodikExtrahieren-Prompt verliert die "kann fehlen"-Klausel
- `ForschungsdesignPassResult` ohne `hadFragestellung` / `hadForschungsgegenstand` / `bezugsrahmenComplete` (Invarianten)
- Test-Skript propagiert `PreconditionFailedError` als Exit-Code 2

`PreconditionFailedError` lebt in [`src/lib/server/ai/h3/precondition.ts`](../src/lib/server/ai/h3/precondition.ts) und kann von den anderen Heuristiken übernommen werden, sobald sie einer harten Vorbedingungs-Prüfung bedürfen.

---

## Was offen ist

### Frischer End-to-end-Lauf

Smoke-Test verifiziert die Done-Check-Logik. Was noch fehlt: ein vollständiger Pipeline-Run mit `include_h3=true` über das HTTP-Endpoint, um die SSE-Events, Phase-Übergänge und Done-Skip-Verhalten unter realer Run-Lifecycle zu beobachten.

Optionen:
1. Frischer Test-Case (NICHT BA H3 dev / Benchmark-Cases, Memory `feedback_benchmark_cases_protected.md`): neues kleines Werk hochladen, Outline confirmen, Funktionstypen setzen, Brief mit `h3_enabled=true` zuordnen, Pipeline-Run starten.
2. Brief-Toggle auf BA H3 dev: temporär `h3_enabled=true` setzen, Run starten — alle Phasen sollten `skipped: false` melden, dann clean-vor-insert auslösen, dann neue Konstrukte schreiben (würde validierte Stände überschreiben — daher *vorher* construct_validations-Marker setzen, sonst Datenverlust-Risiko).

Empfehlung: (1) — sauberer, kein Risiko für validierte Stände.

### WERK-Heuristiken implementieren

`h3_werk_deskription` und `h3_werk_gutacht` sind im Orchestrator als Stubs (skipped, always-done). Sobald die zugehörigen Heuristiken kommen:
- Heuristik-Module unter `src/lib/server/ai/h3/werk-deskription.ts` und `werk-gutacht.ts` anlegen
- In `h3-phases.ts`: `PHASE_OUTLINE_TYPE` + `PHASE_PRIMARY_KINDS` Einträge setzen (statt `null`)
- `runH3Phase`-Switch: Stub-Cases durch echte Pass-Calls ersetzen
- Smoke-Test sollte dann auch für diese Phasen `done=true` melden (sobald gelaufen)

### Validierungs-UI

`construct_validations` ist die Backend-Tabelle; die UI für Validierungs-Marker (Reviewer markiert ein Konstrukt als "validiert") kommt mit der Interface-Phase. Bis dahin: Marker manuell via SQL.

### Falltyp-Routing

Diese Spec gilt nur für `qualification_review`. `peer_review` (H2-Abstract + H1-Rest, kein H3) und `cumulative_dissertation_review` (Hybrid mit Kollegialitäts-Respekt) brauchen ihre eigenen Routing-Entscheidungen, sobald das Falltyp-System (Stufe 3 der UI-Roadmap) am Case persistiert ist.

### Brief-Konfigurations-Erweiterungen

Spec hat das bewusst weggelassen: H3-Heuristiken haben heute hartcodierte Defaults (z.B. GTH-Schwellen `minClusterLen=4`, `minCitationGapLen=5`; Modell-Overrides). Brief-Schema-Erweiterung kommt, wenn das UI dafür existiert (Memory `feedback_features_before_interface.md`).

---

## Token-Erfassung — bekannte Lücken

H3-Heuristiken haben uneinheitliche Token-Aggregation:
- `runGrundlagentheoriePass` (GTH Step 1) hat **keine** Top-Level-Token-Summe; pro-Container-Statistik im `containers[]`-Array. Wird im StepResult als 0 gezählt — die Step-1-Tokens werden nicht in `pipeline_runs.accumulated_*_tokens` aufaddiert.
- `runDurchfuehrungPassStep2` reportet `cacheCreation` zusätzlich zu `cacheRead`; `cacheCreation` hat im StepResult-Schema keinen Slot und wird nicht propagiert.

Beides bewusst akzeptiert; präzises Tracking lebt in den jeweiligen CLI-Skript-Outputs der Heuristiken. Wenn das später UI-relevant wird, müssen `runGrundlagentheoriePass` und `StepResult` minimal nachgezogen werden.

---

## Backward-Compat-Status

H1-Pfad unverändert lauffähig. Verifikation: `scripts/test-h3-regression.ts <docId>` ist weiterhin grün, weil `phasesForRun()` mit `heuristic='h1'` (Default) exakt die alte Phasen-Liste zurückgibt. `assessment_briefs.h3_enabled` ist Default `false`, alte Briefs verändern sich nicht.

Bei `heuristic='h3'` läuft AUSSCHLIESSLICH H3 — kein H1 davor, kein H2. Bestehende Konstrukt-Tabellen (`argument_nodes`, `memo_content`) werden von H3 nicht angefasst, weil H3 in `function_constructs` schreibt.

---

## Pflicht-Lektüre für Folge-Sessions

Memory:
- `project_three_heuristics_architecture.md` — architektonische Setzung, vor der die Spec steht
- `project_pipeline_run_orchestrator.md` — Mig 038, in dem H3 sich einklinkt
- `feedback_strategic_decisions_need_consent_even_in_auto.md` — High-level-Setzungen brauchen User-Zustimmung
- `feedback_constructs_are_extracts_not_telemetry.md` — Trennung Substanz / Curation (Mig 049 lebt davon)

Repo:
- `docs/h3_orchestrator_spec.md` — die Spec mit den sechs Entscheidungspunkten
- `src/lib/server/pipeline/h3-phases.ts` — die zentrale Datei, falls Phasen erweitert/modifiziert werden müssen
- `migrations/049_construct_validations.sql` — Schema für User-Schutz
