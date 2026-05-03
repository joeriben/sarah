# H3-Implementierungs-Status

Lebendes Status-Dokument der H3-Implementierung. Jede Session aktualisiert diesen Stand. Plan-Übersicht: [`h3_implementation_plan.md`](./h3_implementation_plan.md).

---

## Aktueller Stand (Phase 1 abgeschlossen)

### Was steht
- Migrationen 043–047 angewandt und schema-verifiziert (`function_constructs`, `heading_classifications`-Extension, `virtual_function_containers`, `case_review_drafts`, `assessment_briefs.h3_enabled`).
- Isomorphes Vokabular `src/lib/shared/h3-vocabulary.ts` (Types, Konstanten, deutsche Display-Labels).
- Backend-Service `src/lib/server/pipeline/function-type-assignment.ts` mit `computeFunctionTypeAssignments`, `persistFunctionTypeAssignments`, `suggestFunctionTypesForDocument`.
- API: `POST /api/projects/[projectId]/documents/[docId]/outline/suggest-function-types` triggert die Heuristik; `PUT /outline/[headingId]` um `outline_function_type` + `granularity_level` erweitert.
- `loadEffectiveOutline` liefert die vier neuen Felder (`outlineFunctionType`, `granularityLevel`, `outlineFunctionTypeConfidence`, `outlineFunctionTypeUserSet`).
- Outline-Page-UI um pro-Heading-Funktionstyp- und Granularitäts-Dropdown + Header-Button "Funktionstypen heuristisch vorschlagen" + Counter erweitert.
- Smoke-Skripte `scripts/test-h3-suggest.ts` + `scripts/test-h3-regression.ts` (CLI-Tools für Folge-Phasen).
- Memory `feedback_commit_after_substantial_steps.md` neu, MEMORY-Index aktualisiert.

### Verifiziert
- **Schema**: alle Tabellen + Constraints + Indizes wie spec'd (`psql \d`-Verifikation).
- **Service-Smoke** an Test-Case "BA H3 dev" (`d1993e8a-…`, work_type=bachelor_thesis): 6 Konstrukt-Vorschläge persistiert — Einleitung→EXPOSITION/KAPITEL, Theoretischer Rahmen→GRUNDLAGENTHEORIE/UNTERKAPITEL, Gegenüberstellung-Heading→SYNTHESE, Kritische Reflexion + Fazit→SCHLUSSREFLEXION, "Eigenständigkeitserklärung" als letztes L1 → SCHLUSSREFLEXION (Position-Default mit conf 0.6) — saubere Demo, dass User-Override-Bedarf an unsicheren Stellen sichtbar wird.
- **Benchmark-Schutz**: ein versehentlicher Smoke an Bachelorarbeit-Benchmark (e1a474a0-…) wurde im selben Schritt zurückgerollt (UPDATE … WHERE outline_function_type_user_set=false → NULL).
- **Regression H1**: AG 71/71, section 7/7, chapter 5/5, work 1/1 — counts vollständig wie zuvor.
- **Regression H2**: paragraph_synthetic 0/71 pending — Atom-Listing intakt.
- **svelte-check**: 3 Errors, alle pre-existing (`./maps.js`-Modul, `cases/new`-DocSource, `briefs/new`-work_type), 0 neu.
- **tsc --noEmit**: keine neuen Errors gegenüber pre-existing baseline.

### Bekannte Probleme / bewusst aufgeschoben
- **Migrations-Tracking-Drift**: 039+040 waren in der DB schema-aktiv, aber nicht in `_migrations` registriert. Wurden manuell eingetragen. 041+042 (Anonymization) sind weder schema- noch tracking-aktiv und wurden bewusst nicht angewandt — separate Anonymization-Aufgabe.
- **Browser-UI-Verification ausgelassen**: Login-Daten in dev-DB nicht im Repo, manueller Browser-Test durch User empfohlen.
- **FORSCHUNGSDESIGN-Kaskade implizit**: Memory-Spec spricht von "Kapitel→Unterkapitel→Abschnitt kaskadierend, wenn nirgends als Kapitel". Aktuelle `granularityFor()`-Logik richtet die Granularität am Heading-Level aus — passt für die meisten Fälle, aber explizite Kaskade über die ganze Outline wäre möglich. Aufgeschoben auf Phase 2/3, falls nötig.
- **WERK_STRUKTUR aus Outline-Dropdown ausgeblendet**: per Architektur-Setzung wird WERK_STRUKTUR nicht über Outline-Knoten gesetzt, sondern durch H3:WERK_STRUKTUR-Heuristik (Phase 5).

### Backward-Compat-Status
- H1: ✓ Counts unverändert.
- H2: ✓ Atom-Listing intakt.
- Outline-Confirm bestehender Cases: weiter möglich (NULL-Defaults greifen automatisch).

---

## Nächster Schritt: Phase 2 — H1/H2/H3 als drei gleichrangige Optionen + UI-Reframing

Plan-Übersicht: `docs/h3_implementation_plan.md`, Phase 2.

### Was Phase 2 leistet
- **UI-Reframing Pipeline-Run**: drei-Spuren-Auswahl H1 / H2 / H3 im Run-Setup. H3-Karte zeigt Voraussetzung "Outline-Funktionstypen zugewiesen" als Aktivierungs-Check.
- **H2 aus Appendix-Position holen**: heutige `paragraph_synthetic`-Phase ist optionales Addendum; in Phase 2 wird sie zur sichtbar gleichrangigen Option im Run-Setup. Reader-Tab bekommt eine eigene H2-Spalte (statt Modal-Aufschlag).
- **Brief-Library**: H2 als sichtbare Brief-Kategorie (Brief-Default-Flag analog zu `argumentation_graph` und `validity_check`), nicht nur Run-Option.
- **Vokabular**: UI-Strings durchgängig auf "Heuristik" (nicht "Strategie"); Reader-Spalten, Pipeline-Setup-Modal, Brief-Library-Karten.
- **H3-Voraussetzungs-Gate**: ein H3-Run kann nur starten, wenn `brief.h3_enabled === true` UND `>= 1 heading_classifications` einen `outline_function_type !== NULL` hat. Sonst Fehler-JSON analog zu `OUTLINE_NOT_CONFIRMED`.

### Konkrete Schritte
1. **Brief-Migration** für H2-Default-Flag (`include_synthetic_default`) opt-in mit Default false — analog zu `validity_check` (Mig 040).
2. **Pipeline-Run-Setup-UI**: drei Heuristik-Karten H1/H2/H3 mit Aktivierungs-Toggles. Pre-flight-Anzeige zeigt jeweilige Atom-Counts.
3. **Reader-Tabs**: H2-Memos bekommen eigenen Tab/Spalte im Reader.
4. **Status-Endpoint**: Brief-DTO um `include_synthetic_default` erweitern.
5. **`phasesForRun()`-Erweiterung**: H3-Phasen nur bei aktivem Flag + erfüllter Outline-Voraussetzung; sonst H3-still-stehen-lassen, H1/H2 normal weiter.
6. **Regression-Check**: Counts auf den Test-Cases (nicht Benchmark!) müssen unverändert sein.

### Pflicht-Lektüre für Phase-2-Session

**Memory:**
- `project_three_heuristics_architecture.md` — drei-Heuristiken-Konzept
- `project_critical_friend_identity.md` — Sprachregel "analysiert" / "Indikator"
- `project_pipeline_run_orchestrator.md` — Mig 038 + Master-Run-UI-Stand
- `feedback_vocab_heuristik_not_strategie.md` — Vokabular-Hygiene
- `feedback_color_only_for_reviewer_signals.md` — Farben sind Reviewer-Signale
- `feedback_commit_after_substantial_steps.md` — Commit-Rhythmus
- `feedback_benchmark_cases_protected.md` — Test-Cases vs. Benchmark-Cases trennen

**Test-Case** für Phase 2 (vom User angelegt 2026-05-03):
- "BA H3 dev" — `case_id=c42e2d8f-1771-43bb-97c8-f57d7d10530a`, `central_document_id=d1993e8a-f25b-479c-9526-d527215969c6`, Brief "Bachelor-Arbeit – Standardvorlage". Nicht: BA Benchmark `e1a474a0-…`, Habil-Timm `161d41b4-…`.

**Repo-Doku:**
- `docs/h3_implementation_plan.md` — Phasen-Übersicht
- Diese Datei — Phase-2-Spec

**Code-Files (Phase-2-Andockstellen):**
- `src/lib/server/pipeline/orchestrator.ts` — `phasesForRun()`, Atom-Listing
- `src/routes/api/cases/[caseId]/pipeline/run/+server.ts` — Run-Start
- `src/routes/api/cases/[caseId]/pipeline-status/+server.ts` — Brief-DTO erweitern
- `src/routes/api/briefs/[id]/+server.ts` und Brief-Library-UI — H2-Default-Flag
- Reader-Komponenten (`ReaderModal.svelte` und benachbarte) — H2-Spalte

---

## Backward-Compat-Klausel — Präzisierung

Die Maxime "H1/H2 dürfen nicht brechen" ist nicht "AG-/Memo-Pfade einfrieren", sondern:

- **Datenbasis bleibt gemeinsam**: Argumente (`argument_nodes`/`argument_edges`/`scaffolding_elements`), Memos (`memo_content`), Konstrukte (neu: `function_constructs`) müssen für alle drei Heuristiken konsumierbar sein. H1/H2/H3 stehen auf demselben Boden.
- **Pfade dürfen adaptiert werden**: Section-/Chapter-Collapse können künftig über einen Abstraction-Layer iterieren, der Outline-Knoten *und* virtuelle Funktions-Container gleich behandelt. D.h. `listSubchapterAtoms`/`listChapterAtoms` können erweitert werden, solange das beobachtbare Verhalten für nicht-H3-Cases identisch bleibt.
- **Sichtbares H1/H2-Verhalten bleibt unverändert** auf existierenden Cases ohne H3-Setzungen: gleiche Befundzahl, gleiche Memo-Texte. Das ist die operative BC-Garantie.

## Backward-Compat-Risiken (für jede Phase 1+ relevant)

| Risiko | Files | Mitigation |
|---|---|---|
| Outline-Hierarchie umstrukturiert → AG-Listung bricht | `orchestrator.ts:301, 440` | Nur additive Spalten, NULL-Default |
| memo_content-Scope geändert → Done-Checks brechen | `orchestrator.ts:379–427`, `pipeline-status/+server.ts:150–167` | Neue Scopes nur für H3-Konstrukte, alt unverändert |
| argument_nodes-Schema gebrochen → Status-Counts brechen | `pipeline-status/+server.ts:201–218` | Schema einfrieren; H3-Konstrukte in eigener Tabelle |
| Brief-Default-Inversion → Pipeline-Logik bricht | `orchestrator.ts:563`, `/run/+server.ts:99–104` | Neue Flags Default false |
| Pass-Signature gebrochen → executeStep bricht | `orchestrator.ts:482–559` | H3 als neue Phase mit eigener Pass-Funktion, alte Signaturen unverändert |
| Run-State bricht Resume | `orchestrator.ts`, `/run/+server.ts` | Migrationen mit Backward-Compat-Reads (COALESCE) |

---

## Handover-Notes

Phase 1 abgeschlossen 2026-05-03. Folgende Commits:
- `feat(h3): Phase-1-Datenmodell für funktionstyp-orchestrierte Heuristik` — Migrationen 043–047 + Doku-Anlage.
- `feat(h3): Vor-Heuristik FUNKTIONSTYP_ZUWEISEN — Service + API` — Backend.
- `feat(h3-ui): Outline-Page um Funktionstyp-Setter + Heuristik-Trigger` — UI + Smoke-Skripte.

Nach Phase 2 — Folge-Session aktualisiert oben den "Aktueller Stand"-Block, fügt darunter Phase-3-Spec ein (H3-Pilot: H3:EXPOSITION mit FRAGESTELLUNG_PROBE + KONTEXTPROBE_RÜCKWÄRTS).
