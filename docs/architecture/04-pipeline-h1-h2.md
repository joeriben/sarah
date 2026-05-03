# 04 — Pipeline H1/H2 (Orchestrator + Hermeneutische Hauptlinie)

**Stand: 2026-05-03** · Pipeline-Orchestrator + analytische Hauptlinie + synthetisches Per-¶-Memo als Addendum.

Eintrittspunkt: `src/lib/server/pipeline/orchestrator.ts`. Per-Heuristik-Implementierung in `src/lib/server/ai/hermeneutic/`.

State: `pipeline_runs`-Tabelle (Mig 038). Max 1 aktiver Run pro Case (DB-Constraint).

---

## 1. Phasen-Reihenfolge

**Analytische Hauptlinie** (Pflicht):

| # | Phase | Ergebnis | Tabelle(n) |
|---|-------|----------|------------|
| 1 | `argumentation_graph` | per-¶ Argumente + Kanten + Scaffolding | `argument_nodes`, `argument_edges`, `scaffolding_elements`, `scaffolding_anchors` |
| 2* | `argument_validity` | Validity + Grounding-Klassifikation pro Argument | `argument_nodes.referential_grounding`, `argument_nodes.validity_assessment` |
| 3 | `section_collapse` | Subchapter-Synthese (kontextualisierend, L2/L3) | `memo_content` (memo_type='kontextualisierend', scope_level='subchapter') |
| 4 | `chapter_collapse` | Kapitel-Synthese (synthese + argumentationswiedergabe + auffaelligkeiten) | `memo_content` (scope_level='chapter') |
| 5 | `document_collapse` | Werk-Synthese (synthese + auffaelligkeiten) | `memo_content` (scope_level='work', `scope_element_id` NULL) |

`*` nur wenn `brief.validity_check === true`.

**Optionales Addendum** (nur wenn `options.include_synthetic === true`, **nach** Hauptlinie):

| # | Phase | Ergebnis |
|---|-------|----------|
| 6 | `paragraph_synthetic` | per-¶ formulierend + interpretierend Memos + bis zu 2 In-Vivo-Codes |

Das synthetische Per-¶-Memo ist explizit **Addendum**, nicht Eingang in Section-Collapse — letzterer arbeitet aus dem Argumentation-Graph (Memory `project_pipeline_run_orchestrator`).

---

## 2. Orchestrator-Mechanik

```
startOrResumeRun(caseId, options, userId)
  ↓ (DB: pipeline_runs INSERT oder existing paused row reaktivieren)
runPipelineLoop(runId)
  ↓
  for phase in phases:
     atoms = listAtomsForPhase(runId, phase)        ← idempotenz: filtert "done"
     for atom in atoms:
        if cancel_requested:
            mark paused; exit
        try executeStep(phase, atom)
            ↓
            executeStep dispatcht:
              argumentation_graph  → runArgumentationGraphPass()
              argument_validity    → runArgumentValidityPass()
              section_collapse     → runGraphCollapse()       (subchapter)
              chapter_collapse     → runChapterCollapse()
              document_collapse    → runDocumentCollapse()
              paragraph_synthetic  → runParagraphPass()
        catch error:
            atom_errors.push({...}); continue        ← fail-tolerant
        updateProgress(tokens, current_phase/index)
  ↓
markCompleted(runId)  oder markFailed(...)
```

### 2.1 Pause / Resume

- `requestCancel(runId)` → `cancel_requested=true`.
- Loop checkt vor jedem Atom; bei true → `status='paused'`, exit.
- `startOrResumeRun(caseId, ...)` reaktiviert paused-Run, setzt `cancel_requested=false`.

### 2.2 Idempotenz pro Phase

Die `listAtomsForPhase`-Queries filtern bereits-erledigte Atome:

| Phase | Done-Kriterium |
|-------|----------------|
| `argumentation_graph` | EXISTS `argument_nodes` ODER `scaffolding_elements` für Paragraph |
| `argument_validity` | NOT NULL `argument_nodes.validity_assessment` für Paragraph |
| `section_collapse` | EXISTS `memo_content` mit Tag `[kontextualisierend/subchapter/graph]` |
| `chapter_collapse` | EXISTS `memo_content` mit Tag `[kontextualisierend/chapter/graph]` |
| `document_collapse` | EXISTS `memo_content` mit Tag `[kontextualisierend/work/graph]` |
| `paragraph_synthetic` | EXISTS `memo_content` mit memo_type='formulierend' für Paragraph |

Stuck-Guard: kommt dasselbe Atom 3× hintereinander pending zurück → harter Fail (struktureller Loop-Bug).

### 2.3 Fail-Tolerant-Mode

- Per-Atom-Fehler → in-memory `erroredAtomIds`, persistiert als JSON-Tail-20 in `pipeline_runs.error_message`.
- Atom übersprungen, Loop läuft weiter.
- Resume retry'd errored Atome einmal (Set wird geleert).
- Final-Status: `completed_with_errors` als Marker im JSON-Body.

---

## 3. Heuristik-Module (`src/lib/server/ai/hermeneutic/`)

| Datei | Phase | Zweck |
|-------|-------|-------|
| `argumentation-graph.ts` | 1 | Per-¶ LLM-Call: Argumente (claim+premises+anchor_phrase+grounding) + Edges + Scaffolding |
| `argumentation-graph-prose-parser.ts` | 1 | Parser für Prose-Format-Output |
| `argument-validity.ts` | 2 | Charity-Pass: bewertet validity_assessment pro Node |
| `validity-helpers.ts` | 2 | Fallacy-Taxonomie + `extractFallacy()`, `formatFallacyLine()` |
| `section-collapse.ts` | 3 | Subchapter → kontextualisierend memo, aus per-¶-AG-Daten |
| `section-collapse-from-graph.ts` | 3 | Helper: Graph-Konsolidierung pro Subchapter |
| `chapter-collapse.ts` | 4 | Chapter → triple-purpose memo (synthese + argumentationswiedergabe + auffaelligkeiten) |
| `chapter-flow-summary.ts` | 4b | optional: kapitelverlauf-Memo (Bewegungsbogen) |
| `document-collapse.ts` | 5 | Werk → synthese + auffaelligkeiten |
| `per-paragraph.ts` | 6 | synthetisches per-¶-Memo (formulierend + interpretierend + In-Vivo-Codes) |
| `heading-hierarchy.ts` | (helper) | Subchapter-Level-Wahl (1/2/3), gespeichert in `heading_classifications.aggregation_subchapter_level` |

### 3.1 Section-Collapse Adaptive Subchapter Level

`chooseSubchapterLevel(headings)` entscheidet pro Werk: aggregiere ich auf Level 1, 2 oder 3? Resultat persistiert pro Heading in `heading_classifications.aggregation_subchapter_level`. Heuristik: durchschnittliche Subchapter-Länge + Heading-Verteilung. Manuelle User-Override ist möglich.

### 3.2 Chapter-Collapse — Doppelmodus

Je nach Aggregation:

- **Level 1 (flat chapter)**: konsumiert direkt Paragraph-AG-Daten.
- **Level 2/3 (strukturiert)**: konsumiert die Leaf-Subchapter-Memos auf gewähltem Level. Bei Level 3 wird Level-2-Numerierung als Metadata mitgegeben.

Output triple-purpose:
- `synthese` — analytische Synthese (4 mandatory components).
- `argumentationswiedergabe` — exposition-style chapter summary (für Gutachten-Re-Use).
- `auffaelligkeiten` — per-Memo / per-Argument observations.

### 3.3 Document-Collapse

Aggregiert alle L1-Chapter-Synthesen (+ Flow-Summaries falls vorhanden) zu Werk-Memo. Output:
- `synthese` (3 mandatory components).
- `auffaelligkeiten` (Werk-weite Beobachtungen).

`scope_element_id` ist NULL — Werk-Ebene hat kein `document_element`-Anker.

---

## 4. Argumentation-Graph-Spec (Mig 032/033/040)

**Argument-Node-Felder:**
- `arg_local_id` (z.B. "A1", "A2" — pro Paragraph eindeutig).
- `claim` + `premises` JSONB (`{stated, carried, background}`).
- `anchor_phrase` + `anchor_char_start/end` — Position im Paragraph.
- `position_in_paragraph` INT.
- `referential_grounding` ∈ {none, namedropping, abstract, concrete} (nullable; nur wenn validity_check).
- `validity_assessment` JSONB (carries / inference_form / rationale / fallacy) (nullable).

**Edge-Kinds:** supports, refines, contradicts, presupposes. Scope: `inter_argument` (innerhalb Paragraph) oder `prior_paragraph` (Bezug auf vorherigen Paragraph). DB-Constraint mappt kind → erlaubte scope.

**Scaffolding-Elements:** Layer-2 textorganisatorischer Support, Funktionstyp ∈ {textorganisatorisch, didaktisch, kontextualisierend, rhetorisch}. M:N zu Argumenten (`scaffolding_anchors`, ≥1 Argument-Anchor verpflichtend; sonst Fallback auf Paragraph-Level).

**referential_grounding ist span-blind** (Memory `project_pipeline_grounding_is_span_blind`): pro-Argument-Klassifikation. Endverweis nach Paraphrase-Block wird nur dem letzten Claim zugeordnet. Cluster `abstract` kann Quelltext-Paraphrase-Pattern signalisieren.

---

## 5. Memo-Ontologie (Pipeline-Slice)

| memo_type | scope_level | Erzeuger | Inhalt |
|-----------|-------------|----------|--------|
| `formulierend` | paragraph | per-paragraph (Phase 6) | reformulierende Wiedergabe |
| `interpretierend` | paragraph | per-paragraph (Phase 6) | Interpretation + In-Vivo-Codes |
| `kontextualisierend` | subchapter | section-collapse (Phase 3) | Verdichtung aus AG-Daten |
| `kontextualisierend` | chapter | chapter-collapse (Phase 4) | triple-output |
| `kontextualisierend` | work | document-collapse (Phase 5) | Werk-Synthese |
| `kapitelverlauf` | chapter | chapter-flow-summary (Phase 4b, opt.) | Bewegungsbogen |

`memo_content.naming_inscription` trägt Tags wie `[kontextualisierend/chapter/graph]` für Idempotenz-Lookup.

**Beachte:** `docs/design-memo-ontology.md` adressiert zusätzlich Description-Memos (am Code, am Naming-Akt) — die liegen außerhalb dieser Pipeline. Pipeline-Code implementiert nur die analytischen Memo-Typen oben.

---

## 6. Wo Pause-Pause aufpassen?

- **Resume nach DB-Restart**: aktive Runs landen in `paused`-Status (kein laufender Worker). Manuelles `startOrResumeRun` nötig.
- **Zwei parallele Resume-Versuche**: partial UNIQUE-Index verhindert mehr als 1 running/paused pro Case. Zweiter Versuch → 23505.
- **Cost-Cap**: `options.cost_cap_usd` blockt nur, wenn `accumulated_cost_usd` aktiv aktualisiert wird (passiert in `updateProgress`). Erweiterungspunkt für Hard-Stops.
