# 04 — Pipeline H1/H2 (Orchestrator + zwei symmetrische Linien)

**Stand: 2026-05-05** · Pipeline-Orchestrator + zwei symmetrische Heuristik-Linien (analytisch / synthetisch-hermeneutisch). Drei-Heuristiken-Architektur: H1, H2, H3 sind exklusiv pro Run (`options.heuristic`).

Eintrittspunkt: `src/lib/server/pipeline/orchestrator.ts`. Per-Heuristik-Implementierung in `src/lib/server/ai/hermeneutic/`.

State: `pipeline_runs`-Tabelle (Mig 038). Max 1 aktiver Run pro Case (DB-Constraint).

---

## 1. Phasen-Reihenfolge

`phasesForRun(options)` wählt anhand `options.heuristic ∈ {h1, h2, h3}` exklusiv die Linie. Für H3 siehe `05-pipeline-h3.md` (linearer Walk-Driver).

### 1.1 H1 — analytische Linie (`PHASE_ORDER_ANALYTICAL`)

| # | Phase | Ergebnis | Tabelle(n) |
|---|-------|----------|------------|
| 1 | `argumentation_graph` | per-¶ Argumente + Kanten + Scaffolding | `argument_nodes`, `argument_edges`, `scaffolding_elements`, `scaffolding_anchors` |
| 2* | `argument_validity` | Validity + Grounding-Klassifikation pro Argument | `argument_nodes.referential_grounding`, `argument_nodes.validity_assessment` |
| 3 | `section_collapse` | Subchapter-Synthese (kontextualisierend, L2/L3) | `memo_content` (memo_type='kontextualisierend', scope_level='subchapter', Tag `[…/graph]`) |
| 4 | `chapter_collapse` | Kapitel-Synthese (synthese + argumentationswiedergabe + auffaelligkeiten) | `memo_content` (scope_level='chapter', Tag `[…/graph]`) |
| 5 | `document_collapse` | Werk-Synthese (synthese + auffaelligkeiten) | `memo_content` (scope_level='work', `scope_element_id` NULL, Tag `[…/graph]`) |

`*` nur wenn `options.include_validity === true` (Brief-Default `validity_check`).

### 1.2 H2 — synthetisch-hermeneutische Linie (`PHASE_ORDER_SYNTHETIC`)

Cousin der H1-Linie, kumulativ-sequenziell statt argument-extraktiv. **Vokabular-Trennung:** H2-Kapitel-Output trägt `verlaufswiedergabe` (Bewegungstrajektorie) statt H1's `argumentationswiedergabe`. Werk-Ebene hat in H2 *keine* eigene wiedergabe — die Hauptkapitel-`verlaufswiedergaben` der vorgeschalteten Pässe stehen für sich.

| # | Phase | Ergebnis | Tabelle(n) |
|---|-------|----------|------------|
| 1 | `paragraph_synthetic` | per-¶ formulierend + interpretierend Memo (interpretive chain) | `memo_content` (memo_type ∈ {formulierend, interpretierend}, scope_level='paragraph') |
| 2 | `section_collapse_synthetic` | Subchapter-Synthese aus interpretive chain | `memo_content` (scope_level='subchapter', Tag `[…/synthetic]`) |
| 3 | `chapter_collapse_synthetic` | Kapitel-Synthese (synthese + verlaufswiedergabe + auffaelligkeiten) | `memo_content` (scope_level='chapter', Tag `[…/synthetic]`) |
| 4 | `document_collapse_synthetic` | Werk-Synthese (synthese + auffaelligkeiten, *ohne* werk-wiedergabe) | `memo_content` (scope_level='work', Tag `[…/synthetic]`) |

**Linien-rein:** jeder H2-Collapse lädt ausschließlich synthetic-getaggte Vorgänger (Tag-Filter im Loader). H1-Daten desselben Werks bleiben unsichtbar — und vice versa.

**`include_validity`** ist H1-only (validity setzt argument_nodes voraus). Codes (In-Vivo-Codes) wurden aus `paragraph_synthetic` entfernt (Commit `fb523c9`, failsafe-Risiko bei nicht-DSGVO Providern).

---

## 2. Orchestrator-Mechanik

```
startOrResumeRun(caseId, options, userId)
  ↓ (DB: pipeline_runs INSERT oder existing paused row reaktivieren)
runPipelineLoop(runId)
  ↓
  phases = phasesForRun(options)                    ← H1 / H2 / H3 exklusiv
  for phase in phases:
     atoms = listAtomsForPhase(runId, phase)        ← idempotenz: filtert "done"
     for atom in atoms:
        if cancel_requested:
            mark paused; exit
        try executeStep(phase, atom)
            ↓
            executeStep dispatcht:
              # H1-Linie
              argumentation_graph         → runArgumentationGraphPass()
              argument_validity           → runArgumentValidityPass()
              section_collapse            → runGraphCollapse()       (subchapter)
              chapter_collapse            → runChapterCollapse()
              document_collapse           → runDocumentCollapse()
              # H2-Linie
              paragraph_synthetic         → runParagraphPass()
              section_collapse_synthetic  → runSectionCollapseSynthetic()
              chapter_collapse_synthetic  → runChapterCollapseSynthetic()
              document_collapse_synthetic → runDocumentCollapseSynthetic()
              # H3 (linearer Walk, siehe 05-pipeline-h3.md)
              h3_walk                     → runH3Walk()
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

Die `listAtomsForPhase`-Queries filtern bereits-erledigte Atome via Inscription-Tag-Filter:

| Phase | Linie | Done-Kriterium |
|-------|-------|----------------|
| `argumentation_graph` | H1 | EXISTS `argument_nodes` ODER `scaffolding_elements` für Paragraph |
| `argument_validity` | H1 | NOT NULL `argument_nodes.validity_assessment` für Paragraph |
| `section_collapse` | H1 | EXISTS `memo_content` mit Tag `[kontextualisierend/subchapter/graph]` |
| `chapter_collapse` | H1 | EXISTS `memo_content` mit Tag `[kontextualisierend/chapter/graph]` |
| `document_collapse` | H1 | EXISTS `memo_content` mit Tag `[kontextualisierend/work/graph]` |
| `paragraph_synthetic` | H2 | EXISTS `memo_content` mit memo_type='interpretierend' für Paragraph |
| `section_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/subchapter/synthetic]` |
| `chapter_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/chapter/synthetic]` |
| `document_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/work/synthetic]` |

Pass-Vertrag: nach `executeStep` muss `listAtomsForPhase` das Atom als done führen. Verletzung = Code-Bug (Inkongruenz zwischen Done-Set und Pass-Skip/Persist-Bedingung) → wird als generic Error geworfen und vom Fail-Tolerant-Pfad als Atom-Fehler verbucht; Loop läuft mit nächstem Atom weiter (Stuck-Guard ersetzt durch Pass-Vertrag, Commit `c197bc3`, Memory `feedback_stuck_guard_is_symptom_not_solution`).

### 2.3 Fail-Tolerant-Mode

- Per-Atom-Fehler → in-memory `erroredAtomIds`, persistiert als JSON-Tail-20 in `pipeline_runs.error_message`.
- Atom übersprungen, Loop läuft weiter.
- Resume retry'd errored Atome einmal (Set wird geleert).
- Final-Status: `completed_with_errors` als Marker im JSON-Body.

---

## 3. Heuristik-Module (`src/lib/server/ai/hermeneutic/`)

| Datei | Linie / Phase | Zweck |
|-------|---------------|-------|
| `argumentation-graph.ts` | H1 / 1 | Per-¶ LLM-Call: Argumente (claim+premises+anchor_phrase+grounding) + Edges + Scaffolding |
| `argumentation-graph-prose-parser.ts` | H1 / 1 | Parser für Prose-Format-Output |
| `argument-validity.ts` | H1 / 2 | Charity-Pass: bewertet validity_assessment pro Node |
| `validity-helpers.ts` | H1 / 2 | Fallacy-Taxonomie + `extractFallacy()`, `formatFallacyLine()` |
| `section-collapse.ts` | H1 / 3 | Subchapter → kontextualisierend memo, aus per-¶-AG-Daten |
| `section-collapse-from-graph.ts` | H1 / 3 | Helper: Graph-Konsolidierung pro Subchapter |
| `chapter-collapse.ts` | H1 / 4 | Chapter → triple-purpose memo (synthese + argumentationswiedergabe + auffaelligkeiten) |
| `chapter-flow-summary.ts` | H1 / 4b | optional: kapitelverlauf-Memo (Bewegungsbogen) |
| `document-collapse.ts` | H1 / 5 | Werk → synthese + auffaelligkeiten |
| `per-paragraph.ts` | H2 / 1 | Per-¶ formulierend + interpretierend Memo (interpretive chain — Grundlage der H2-Aggregation) |
| `section-collapse-synthetic.ts` | H2 / 2 | Subchapter → kontextualisierend memo, aus interpretive chain |
| `chapter-collapse-synthetic.ts` | H2 / 3 | Chapter → triple-purpose memo (synthese + verlaufswiedergabe + auffaelligkeiten), zwei Eingangs-Modi (paragraphs/subchapter-memos) |
| `document-collapse-synthetic.ts` | H2 / 4 | Werk → synthese + auffaelligkeiten (kein werk-wiedergabe-Feld) |
| `heading-hierarchy.ts` | (helper) | Subchapter-Level-Wahl (1/2/3), gespeichert in `heading_classifications.aggregation_subchapter_level` — H1 und H2 teilen den Eintrag |

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

`scope_element_id` ist NULL — Werk-Ebene hat kein `document_element`-Anker. Werk-Bezug über `appearances.properties.document_id`.

### 3.4 H2-Linie — kumulativ-sequenziell

Die H2-Linie ist Cousin der H1-Linie, baut aber auf der **interpretive chain** (Folge der `interpretierend`-Per-¶-Memos im Subkapitel-Kontext) statt auf dem Argumentations-Graph auf.

**Architekturprinzip *linien-rein***: jeder H2-Loader filtert Inscription-Tag auf `[…/synthetic]%`. Ein H2-Chapter-Collapse sieht keine H1-Subkapitel-Memos desselben Werks (Tag-Mismatch); ein H2-Document-Collapse keine H1-Chapter-Memos. Das gilt auch in die Gegenrichtung. Beide Linien können seriell auf demselben Werk laufen, kollidieren aber nicht.

**Vokabular-Trennung von H1**:
- H1-Chapter-Output: `synthese + argumentationswiedergabe + auffaelligkeiten`.
- H2-Chapter-Output: `synthese + verlaufswiedergabe + auffaelligkeiten`.
- *verlaufswiedergabe* trägt die hermeneutische Bewegung im Kapitel (Trajektorie der Argumentations-/Lese-Bewegung), nicht ein argumentationsstruktur-zentriertes Skelett.
- H2-Document hat kein wiedergabe-Feld — Werk-`verlaufswiedergaben` der vorgeschalteten Hauptkapitel-Pässe stehen für sich.

**4 Pflichtbestandteile** (H2-Chapter, gespiegelt aus H1, mit hermeneutischer Diktion + Opt-Out-Klauseln): Hermeneutische Bewegung / Kernbewegung mit Refs / Werk-Architektur-Verortung / Hermeneutische Tragfähigkeit.

**3 Pflichtbestandteile** (H2-Document): Forschungsbeitrag-Diagnose / Gesamtkohärenz und Werk-Architektur / Niveau-Beurteilung mit Werktyp-Akzent.

**Dual-Mode-Loader** im chapter-collapse-synthetic:
- `mode='paragraphs'` (Aggregation-Level 1, flat chapter): Direktaggregation aus den `interpretierend`-Per-¶-Memos.
- `mode='subchapter-memos'` (Level 2/3, strukturiert): Aggregation aus den vorgeschalteten subchapter-synthetischen Memos.

**Storage**:
- Inhalt → `memo_content.content` (Synthese-Prosa).
- Nicht-Content-Felder (`verlaufswiedergabe`, `auffaelligkeiten`) → `appearances.properties` (JSONB-Beiwerk pro Memo).

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

| memo_type | scope_level | Linie | Erzeuger | Inscription-Tag | Inhalt |
|-----------|-------------|-------|----------|-----------------|--------|
| `formulierend` | paragraph | H2 | `per-paragraph` (H2/1) | — | reformulierende Wiedergabe |
| `interpretierend` | paragraph | H2 | `per-paragraph` (H2/1) | — | Interpretation (Codes entfernt, Commit fb523c9) |
| `kontextualisierend` | subchapter | H1 | `section-collapse` (H1/3) | `[kontextualisierend/subchapter/graph]` | Verdichtung aus AG-Daten |
| `kontextualisierend` | subchapter | H2 | `section-collapse-synthetic` (H2/2) | `[kontextualisierend/subchapter/synthetic]` | Verdichtung aus interpretive chain |
| `kontextualisierend` | chapter | H1 | `chapter-collapse` (H1/4) | `[kontextualisierend/chapter/graph]` | synthese + argumentationswiedergabe + auffaelligkeiten |
| `kontextualisierend` | chapter | H2 | `chapter-collapse-synthetic` (H2/3) | `[kontextualisierend/chapter/synthetic]` | synthese + verlaufswiedergabe + auffaelligkeiten |
| `kontextualisierend` | work | H1 | `document-collapse` (H1/5) | `[kontextualisierend/work/graph]` | synthese + auffaelligkeiten |
| `kontextualisierend` | work | H2 | `document-collapse-synthetic` (H2/4) | `[kontextualisierend/work/synthetic]` | synthese + auffaelligkeiten (kein werk-wiedergabe-Feld) |
| `kapitelverlauf` | chapter | H1 | `chapter-flow-summary` (H1/4b, opt.) | — | Bewegungsbogen |

**Linien-Diskriminator:** `memo_content.naming_inscription` trägt das Tag-Suffix `/graph` (H1) oder `/synthetic` (H2) für Idempotenz-Lookup *und* für linien-reine Loader-Filter (siehe §3.4). H2-Loader liest niemals H1-Vorgänger desselben Werks und vice versa.

**Storage-Pattern (alle kontextualisierend-Memos):**
- Synthese-Prosa → `memo_content.content`.
- Nicht-Content-Felder (`argumentationswiedergabe` bei H1-Chapter, `verlaufswiedergabe` bei H2-Chapter, `auffaelligkeiten` jeweils) → `appearances.properties` (JSONB).

**Beachte:** `docs/design-memo-ontology.md` adressiert zusätzlich Description-Memos (am Code, am Naming-Akt) — die liegen außerhalb dieser Pipeline. Pipeline-Code implementiert nur die analytischen Memo-Typen oben.

---

## 6. Wo Pause-Pause aufpassen?

- **Resume nach DB-Restart**: aktive Runs landen in `paused`-Status (kein laufender Worker). Manuelles `startOrResumeRun` nötig.
- **Zwei parallele Resume-Versuche**: partial UNIQUE-Index verhindert mehr als 1 running/paused pro Case. Zweiter Versuch → 23505.
- **Cost-Cap**: `options.cost_cap_usd` blockt nur, wenn `accumulated_cost_usd` aktiv aktualisiert wird (passiert in `updateProgress`). Erweiterungspunkt für Hard-Stops.

---

## 7. Meta-Synthese (geplant — beschlossen 2026-05-05)

**Status:** konzeptuell, nicht implementiert.

Synthese-Schicht oberhalb von H1+H2: konsumiert beide Werk-Outputs desselben Werks und produziert eine reviewfähige Meta-Synthese plus Anker für späteren Fact-Check (Volltext-Tool-Use, Folgestufe — siehe §7.6). Die Meta-Synthese ist **keine vierte Heuristik** (Drei-Heuristiken-Architektur H1/H2/H3 bleibt erhalten), sondern eine Synthese-über-Heuristik-Outputs.

### 7.1 Trigger

Neue dritte Option im Run-Setup-Auswahlmenü (bisherige Option 3 rutscht auf 4): sequenzieller Master-Run **H1 → H2 → Meta-Synthese**. Erweitert die Single-Heuristic-Annahme von §1 (`options.heuristic ∈ {h1,h2,h3}` exklusiv pro Sub-Lauf): der Master-Run kettet die H1-Phasen-Folge und die H2-Phasen-Folge und schließt mit dem terminalen `meta_synthesis`-Glied.

### 7.2 Output (zwei Teile in einem Lauf)

**Teil A — Synthese-Prose** in vier Schritten, strikt nur aus H1- und H2-Werk-Synthesen inferierbar (kein Volltext-Zugriff in dieser Stufe):

1. Positive Werkhypothese, die beide Analysen dem Werk zuschreiben.
2. Defizithypothese, die beide Analysen teilen.
3. Differenz zwischen H1 und H2 — was sieht H1 schärfer, was sieht H2 genauer.
4. Belastbare Synthesehypothese, **ausdrücklich als Hypothese markiert**, weil das Werk selbst nicht erneut gelesen wurde.

Disziplin: keine neuen inhaltlichen Befunde erfinden, keine fallbezogenen Aussagen außerhalb der H1+H2-Outputs, strikte Trennung „aus den Analysen inferierbar" vs. „nur am Werk prüfbar".

**Teil B — drei Literaturbezugs-Anker** für späteren Fact-Check, jeweils mit Begründung, warum dieser Bezug die Interpretation entscheidet.

### 7.3 Inputs

- H1-Werk-Synthese (`memo_content` mit Tag `[kontextualisierend/work/graph]`).
- H2-Werk-Synthese (`memo_content` mit Tag `[kontextualisierend/work/synthetic]`).
- Für Teil-B-Anker zusätzlich: `argument_nodes` (claim, premises, anchor_phrase, referential_grounding) und `argument_edges` des Werks.

### 7.4 Pre-Filter Teil B (hybrid)

Statistischer Pre-Filter liefert Kandidaten-Pool, agentische Wahl der drei Anker mit Begründung. Pre-Filter-Quellen:

- `argument_nodes.referential_grounding ≠ 'abstract'` (= Bezug auf Literatur, nicht reine Paraphrase) — span-blind, aber pro-Argument klassifiziert (siehe §4 + Memory `project_pipeline_grounding_is_span_blind`).
- Zitations-Marker in `paragraphs.raw_text` (regex über `(Autor Jahr)`, Fußnoten-Marker) — direkt zählbar pro Absatz.
- Zentralität im argument_graph (eingehende + ausgehende edges) — direkt aus den H1-Daten.

Statistik allein identifiziert „wo wird zitiert, was ist zentral", nicht „welche Literaturlesart entscheidet die Interpretation" — Letzteres bleibt agentisch.

### 7.5 UI-Lage

Neuer Reiter **Meta-Synthese** im Document-View, rechts neben Synthesen und Research. Lesbar dort, getriggert über Run-Setup-Option 3 (siehe §7.1). UI-Routes-Eintrag in `07-api-and-ui.md` folgt mit der Implementation.

### 7.6 Folgestufe (Schritt 2/3 — separat)

- **Schritt 2 — iterative Verfeinerung** der Synthese: noch nicht ausdesigned (dialogische Spannungs-Pässe vs. Self-Critique-Pässe offen).
- **Schritt 3 — agentische Volltext-Anfrage** von bis zu drei `paragraphs.raw_text`-Stellen plus user-bereitgestellter Quellen-Literatur für Fact-Check der Teil-B-Anker. Bricht die „nur aus Analysen inferierbar"-Disziplin von Teil A bewusst auf, klar als zweite Stufe markiert.

Beide Folgestufen sind nicht Teil der ersten Implementation.

### 7.7 Offene Implementations-Punkte

- **Persistenz**: passt das `memo_content`-Pattern (z.B. `memo_type='kontextualisierend'`, `scope_level='work'`, neuer Tag-Suffix `/meta`)? Teil B als JSONB in `appearances.properties`? Oder eigene Tabelle?
- **Run-Modell**: ein Run mit erweiterter `phasesForRun`-Folge (H1-Phasen + H2-Phasen + `meta_synthesis`), oder drei Sub-Runs orchestriert vom Master?
- **Exakte Position der neuen Run-Setup-Option 3**: am Run-Setup-Code verifizieren, bisherige Option 3 sauber auf 4 umlabeln.
