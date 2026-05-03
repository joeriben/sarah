# H3-Implementierungs-Status

Lebendes Status-Dokument der H3-Implementierung. Jede Session aktualisiert diesen Stand. Plan-Übersicht: [`h3_implementation_plan.md`](./h3_implementation_plan.md).

---

## Aktueller Stand (Phase 0 abgeschlossen)

### Was steht
- Konzept-Erarbeitung für H3 abgeschlossen, Memory-konsolidiert.
- `docs/h3_implementation_plan.md` als Phasen-Übersicht angelegt.
- Bestandsaufnahme der existierenden Pipeline-Architektur durch Explore-Agent in Phase 0 erstellt — Befunde unten als Phase-1-Spec präzisiert.

### Was nicht steht
- Keine Code-Änderungen.
- Keine Migrationen.
- H1/H2 unverändert.

---

## Nächster Schritt: Phase 1 — Datenmodell + Vor-Heuristik FUNKTIONSTYP_ZUWEISEN

### Migrations-Reihenfolge (additiv, NULL-able, kein Breaking Change)

1. **Konstrukte-Tabelle** `function_constructs` (oder ähnlich)
   - Spalten: `id`, `case_id` (FK), `document_id` (FK), `function_type` (ENUM: EXPOSITION, GRUNDLAGENTHEORIE, FORSCHUNGSDESIGN, DURCHFÜHRUNG, EXKURS, SYNTHESE, SCHLUSSREFLEXION, WERK_STRUKTUR), `construct_kind` (z.B. FRAGESTELLUNG, MOTIVATION, KERNBEGRIFF, FORSCHUNGSGEGENSTAND, METHODOLOGIE, METHODEN, BASIS, ERKENNTNIS, GESAMTERGEBNIS, GELTUNGSANSPRUCH, GRENZEN, ANSCHLUSSFORSCHUNG, STRUKTUR_HERLEITUNG, WERK_BESCHREIBUNG, GUTACHT_HINWEIS), `anchor_element_ids` (array of FK auf `document_elements`), `content` (TEXT/JSONB), `version_stack` (JSONB array für CCS-Stack via EXKURS-Re-Spec), `source_run_id` (FK auf `pipeline_runs`), Zeitstempel

2. **Outline-Extension** an `heading_classifications`
   - Neue Spalten: `function_type` (ENUM, NULL-able), `granularity_level` (ENUM: KAPITEL/UNTERKAPITEL/ABSCHNITT, NULL-able)
   - Bestehende Konsumenten (`orchestrator.ts:301, 440`) ignorieren NULL — Backward-Compat trivial.

3. **Virtual-Container-Tabelle** `virtual_function_containers`
   - Spalten: `id`, `case_id` (FK), `document_id` (FK), `function_type` (ENUM), `source_anchor_ranges` (JSONB array `[{element_id, start_seq, end_seq}]`), Zeitstempel
   - Generische Aggregations-Container — werden in Phase 1 nur von H3 konsumiert, sind aber perspektivisch auch für H1/H2 als Atom-Einheit ansprechbar (siehe BC-Klausel-Präzisierung unten).

4. **review_draft-Liste** — neue Tabelle `case_review_drafts`
   - Spalten: `id`, `case_id` (FK), `document_id` (FK auf `namings`), `owner_kind` (ENUM: SELF / SECOND_REVIEWER / EXTERNAL), `seq`, Zeitstempel
   - Backward-Compat: bestehender FK `cases.review_draft_document_id` bleibt; neue Tabelle wird parallel gepflegt; in Phase 1 wird der bestehende FK bei Schreibvorgängen mitgesetzt; UI bleibt Single-Slot. Lange Sicht (Phase 6): Migration auf View, dann FK-Drop.

5. **Brief-Flag** `assessment_briefs.h3_enabled` (BOOLEAN, Default false, NOT NULL)
   - `orchestrator.phasesForRun()` schaltet H3-Phasen nur ein, wenn `brief.h3_enabled OR options.include_h3`.

### Backend: Vor-Heuristik FUNKTIONSTYP_ZUWEISEN
- Neue Service-Funktion in `src/lib/server/pipeline/` (eigene Datei, z.B. `function-type-assignment.ts`)
- Input: `document_id`, `case_id`, `outline_state` (aus `heading_classifications`)
- Heuristik: Position im Werk + Heading-Marker-Regex (`Einleitung|Methode|Methoden|Methodologie|Forschungsdesign|Fazit|Schluss|...`) + Falltyp-Default
- Output: pro `heading_classifications`-Eintrag ein `(function_type, granularity_level)`-Paar mit Confidence
- Persistenz: schreibt in die neuen Spalten (additiv, kein bestehender Code wird überschrieben)

### UI: Outline-Confirm um Funktionstyp-Setter erweitern
- Datei: `src/routes/projects/[projectId]/documents/[docId]/outline/+page.svelte`
- Pro Outline-Knoten: Anzeige des heuristischen Funktionstyp-Vorschlags + Override-Dropdown
- "Bestätigen"-Button speichert function_type + granularity_level zusammen mit dem Outline-Confirm
- Endpoint-Erweiterung: `/api/projects/[projectId]/documents/[docId]/outline/confirm` nimmt zusätzliche Felder an

### Regression-Check (Pflicht vor Phase-1-Abschluss)
- H1-Pipeline auf Demo-Habilitation laufen lassen → Befunde identisch zu vor Phase 1
- H2-Pipeline (include_synthetic) → Memos identisch
- Status-Endpoint liefert unveränderte Counts
- Outline-Confirm bestehender Cases ohne H3-Setzung weiter möglich (NULL-Default)

---

## Pflicht-Lektüre für Phase-1-Session

**Memory:**
- `project_three_heuristics_architecture.md` — H3-Architektur, Konstrukte-Liste, Falltyp-Konfiguration
- `project_critical_friend_identity.md` — Plattform-Identität, gated-c-Mechanismus
- `project_pipeline_run_orchestrator.md` — Mig 038 Stand
- `project_no_caseless_docs.md` — Anlege-Reihenfolge Project→Case→Doc
- `feedback_no_hidden_setq.md` — keine versteckten Setzungen
- `feedback_vocab_heuristik_not_strategie.md` — Vokabular

**Repo-Doku:**
- `docs/h3_implementation_plan.md` — Phasen-Übersicht
- Diese Datei — Phase-1-Spec

**Code-Files (Bestandsaufnahme aus Phase 0, mit Zeilen):**
- `migrations/038_pipeline_runs.sql` — Pipeline-Runs-Schema
- `src/lib/server/pipeline/orchestrator.ts` — `runPipelineLoop()`, `phasesForRun()` (Z.563), `executeStep()` (Z.482–559), `listParagraphAtoms()` (Z.301), `listSubchapterAtoms()` (Z.440), `listAtomsForPhase()` (Z.379–427)
- `src/routes/api/cases/[caseId]/pipeline/run/+server.ts` — Run-Start (Z.81 outline-Gate, Z.99–104 Brief-Flag-Konsum)
- `src/routes/api/cases/[caseId]/pipeline-status/+server.ts` — AG/Memo-Done-Counts (Z.150–167, Z.201–218)
- `migrations/035_*.sql` — heading_classifications Schema + outline_status
- `migrations/037_*.sql` — Briefs systemweit
- `migrations/032_*.sql`, `migrations/033_*.sql` — argument_nodes, scaffolding_elements
- `src/routes/projects/[projectId]/documents/[docId]/outline/+page.svelte` — Outline-Confirm-UI

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

Nach Phase 1 — Folge-Session aktualisiert oben den "Aktueller Stand"-Block, fügt darunter Phase-2-Spec ein.
