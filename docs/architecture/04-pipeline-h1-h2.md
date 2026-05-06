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

**Forward-interleaved Walk** (statt strikt phasenweiser Ausführung): pro Hauptkapitel werden die Absätze eines Subkapitels synthetisiert, dann das Subkapitel kollabiert, dann das nächste Subkapitel begonnen. Erst wenn alle Subkapitel eines Hauptkapitels collapsed sind, läuft chapter_collapse_synthetic; document_collapse_synthetic zum Schluss. Nur so ist die in `per-paragraph.ts:loadParagraphContext` geladene Schicht „abgeschlossene Subkapitel davor" tatsächlich populated — bei strikt linearer Phasenordnung wäre sie dormant. Implementiert in `runH2Hierarchical`/`buildH2HierarchicalPlan`. Per-Phasen-Atom-Counts bleiben unverändert (Preflight unverändert).

**Linien-rein:** jeder H2-Collapse lädt ausschließlich synthetic-getaggte Vorgänger (Tag-Filter im Loader). H1-Daten desselben Werks bleiben unsichtbar — und vice versa.

**`include_validity`** ist H1-only (validity setzt argument_nodes voraus). Codes (In-Vivo-Codes) wurden aus `paragraph_synthetic` entfernt (Commit `fb523c9`, failsafe-Risiko bei nicht-DSGVO Providern).

**`retrograde_pass`** ist H2-only (siehe §8). Wirkt zusätzlich auch auf den `meta`-Composite-Run (H1 → H2 → meta_synthesis), der den retrograden 2. Pass zwischen H2-Forward und meta_synthesis einschiebt. Default off.

---

## 2. Orchestrator-Mechanik

```
startOrResumeRun(caseId, options, userId)
  ↓ (DB: pipeline_runs INSERT oder existing paused row reaktivieren)
runPipelineLoop(runId)
  ↓
  if heuristic == 'h2':
     plan = buildH2HierarchicalPlan(documentId)     ← {phase, atom}-Sequenz
     for step in plan:                              ← interleaved ¶/section/…
        if cancel_requested: mark paused; exit
        if listAtomsForPhase(step.phase) sagt done: skip+emit step-done(skipped)
        try executeStep(step.phase, step.atom)
            executeStep dispatcht (H2-Branch):
              paragraph_synthetic         → runParagraphPass()
              section_collapse_synthetic  → runSectionCollapseSynthetic()
              chapter_collapse_synthetic  → runChapterCollapseSynthetic()
              document_collapse_synthetic → runDocumentCollapseSynthetic()
        catch error: atom_errors.push({...}); continue   ← fail-tolerant
        Pass-Vertrag-Check; updateProgress(tokens)
  else:                                              ← H1 / H3
     phases = phasesForRun(options)
     for phase in phases:
        atoms = listAtomsForPhase(runId, phase)     ← idempotenz: filtert "done"
        for atom in atoms:
           if cancel_requested: mark paused; exit
           try executeStep(phase, atom)
               executeStep dispatcht:
                 # H1-Linie
                 argumentation_graph         → runArgumentationGraphPass()
                 argument_validity           → runArgumentValidityPass()
                 section_collapse            → runGraphCollapse()       (subchapter)
                 chapter_collapse            → runChapterCollapse()
                 document_collapse           → runDocumentCollapse()
                 # H3 (linearer Walk, siehe 05-pipeline-h3.md)
                 h3_walk                     → runH3Walk()
           catch error: atom_errors.push({...}); continue  ← fail-tolerant
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
| `paragraph_synthetic` | H2 | EXISTS `memo_content` mit memo_type='interpretierend' Tag `[interpretierend]…` (forward-only) |
| `section_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/subchapter/synthetic]` |
| `chapter_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/chapter/synthetic]` |
| `document_collapse_synthetic` | H2 | EXISTS `memo_content` mit Tag `[kontextualisierend/work/synthetic]` |
| `chapter_collapse_retrograde` | H2 (opt.) | EXISTS `memo_content` mit Tag `[kontextualisierend/chapter/synthetic-retrograde]` |
| `section_collapse_retrograde` | H2 (opt.) | EXISTS `memo_content` mit Tag `[kontextualisierend/subchapter/synthetic-retrograde]` |
| `paragraph_retrograde` | H2 (opt.) | EXISTS `memo_content` mit memo_type='interpretierend' Tag `[interpretierend-retrograde]…` |

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
| `chapter-collapse-retrograde.ts` | H2 / R1 | Chapter retrograd: Forward-Chapter + W → revisionierte Chapter-Synthese |
| `section-collapse-retrograde.ts` | H2 / R2 | Subchapter retrograd: Forward-Subchapter + Retro-Chapter → revisionierte Subchapter-Synthese |
| `paragraph-retrograde.ts` | H2 / R3 | Per-¶ retrograd: Forward-`[interpretierend]` + Retro-Subchapter → revisionierte interpretierend-Memo |
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
| `interpretierend` | paragraph | H2 (R3, opt.) | `paragraph-retrograde` | `[interpretierend-retrograde]…` | revisioniertes Per-¶-Memo, Bezug auf Retro-Subchapter |
| `kontextualisierend` | subchapter | H2 (R2, opt.) | `section-collapse-retrograde` | `[kontextualisierend/subchapter/synthetic-retrograde]` | revisionierte Subchapter-Synthese, Bezug auf Retro-Chapter |
| `kontextualisierend` | chapter | H2 (R1, opt.) | `chapter-collapse-retrograde` | `[kontextualisierend/chapter/synthetic-retrograde]` | revisionierte Chapter-Synthese, Bezug auf W |
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

## 7. Meta-Synthese (implementiert 2026-05-05 — Schritt 1)

**Status:** Schritt 1 implementiert (Backend + Frontend). Schritte 2/3 (iterative Verfeinerung, agentische Volltext-Anfrage) sind weiterhin nicht Teil der Implementation — siehe §7.6.

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

Reiter **Meta-Synthese** im Document-View zwischen *Synthesen* und *Begleitdocs*. Tab rendert die vier-schritt-Prosa als sequentielle Lavender-akzentuierte Blöcke (positive Werkhypothese · geteilte Defizithypothese · H1↔H2-Differenz · Synthesehypothese) plus die drei Literaturbezugs-Anker als nummerierte Liste mit klickbaren §-Refs (öffnen Reader an der entsprechenden Stelle). Trigger via Radio-Button **Meta · Review-Synthese (H1 + H2 + Literaturbezugs-Anker)** zwischen H2 und H3 im Run-Setup-Auswahlmenü.

### 7.6 Folgestufe (Schritt 2/3 — separat)

- **Schritt 2 — iterative Verfeinerung** der Synthese: noch nicht ausdesigned (dialogische Spannungs-Pässe vs. Self-Critique-Pässe offen).
- **Schritt 3 — agentische Volltext-Anfrage** von bis zu drei `paragraphs.raw_text`-Stellen plus user-bereitgestellter Quellen-Literatur für Fact-Check der Teil-B-Anker. Bricht die „nur aus Analysen inferierbar"-Disziplin von Teil A bewusst auf, klar als zweite Stufe markiert.

Beide Folgestufen sind nicht Teil der ersten Implementation.

### 7.7 Implementations-Entscheidungen (2026-05-05)

- **Persistenz**: bestehendes `memo_content`-Pattern (`memo_type='kontextualisierend'`, `scope_level='work'`, Tag-Suffix `/meta` → Naming-Inscription `[kontextualisierend/work/meta]…`); Teil A als markdown-assemblierter prose-Content, Teil-B-Anker und die vier Sektions-Strings als JSONB in `appearances.properties` (`fact_check_anchors`, `synthese_parts`).
- **Run-Modell**: ein Run mit erweitertem `RunOptions.heuristic = 'meta'` (Composite) — `phasesForRun` kettet `PHASE_ORDER_ANALYTICAL` (± `argument_validity`) → `PHASE_ORDER_SYNTHETIC` → `meta_synthesis` als terminales Glied. Tier-Routing: Meta nutzt `h1.tier2`.
- **Run-Setup-UI**: Radio "Meta · Review-Synthese" steht zwischen H2 und H3 im exklusiven Heuristik-Selector; nicht als zusätzliche numerische Option, sondern als regulärer vierter Eintrag im selben Radiogruppen-Set.

---

## 8. Retrograde-2-Pass (H2-Modifikator, optional) — DEPRECATED

> **DEPRECATED bis auf weiteres (2026-05-06).** Erste Spot-Checks zeigten,
> dass die Strecke nur die *Top-Down-Halbiteration* eines hermeneutischen
> Zirkels implementiert (W → ¶) — die Bottom-Up-Schließung (¶-Retros zurück
> in W) fehlt. Außerdem deutete das Hauptkapitel-Retro Plattform-Artefakte
> (Heading-Numerierungs-Lücken aus dem DOCX-Parser) als textsubstanzielle
> Befunde, baute also Werk-Architektur-Diagnosen auf einem Substrat-Bug auf.
>
> Die UI-Checkbox „Retrograde-Pass" ist entfernt, das `retrograde_pass`-Flag
> wird in `phasesForRun` ignoriert, persistierte Memos sind soft-deleted.
> Code (Module, Phase-Namen, Idempotenz-Tags) bleibt erhalten als Kontrakt
> für die geplante Reaktivierung — Sprach-Korrektur und
> Bottom-Up-Halbiteration sind im Ticket
> `docs/ticket_hermeneutischer_zirkel_bottom_up.md` beschrieben. Die
> folgende Beschreibung dokumentiert den deaktivierten Stand.

**Status:** implementiert 2026-05-05 als (irreführend so gelabeltes) „FFN-Backprop-style"-Refinement der H2-Forward-Memos. Default off, schaltbar via `RunOptions.retrograde_pass=true`. Wirkt bei `heuristic='h2'` und beim Composite `heuristic='meta'` (in dem Fall zwischen H2-Forward und `meta_synthesis` eingeschoben).

### 8.1 Idee

Nach der Forward-Strecke (¶ → Subkap → Kap → W) liegt mit der Werk-Synthese ein höchst verdichtetes Bezugsbild vor, das beim sequentiellen Aufbau der einzelnen Schichten noch nicht existierte. Der retrograde 2. Pass läuft deshalb **top-down im Lichte der Werk-Synthese**: jede Ebene wird einmal neu gelesen, **nachdem** die jeweils übergeordnete Ebene retrograd aktualisiert wurde. Die Bewegung entspricht dem Backprop-Schritt einer FFN-Schicht — hier nicht zur Gewichtsanpassung, sondern zur Verfeinerung der natürlichsprachlichen Repräsentation.

### 8.2 Phasen-Reihenfolge

`PHASE_ORDER_RETROGRADE = [chapter_collapse_retrograde, section_collapse_retrograde, paragraph_retrograde]` — wird bei `retrograde_pass=true` an `PHASE_ORDER_SYNTHETIC` angehängt.

| # | Phase | Inputs | Output-Tag |
|---|-------|--------|------------|
| R1 | `chapter_collapse_retrograde` | Forward-Chapter (`[…/chapter/synthetic]`) + W (`[…/work/synthetic]`) | `[kontextualisierend/chapter/synthetic-retrograde]…` |
| R2 | `section_collapse_retrograde` | Forward-Subchapter (`[…/subchapter/synthetic]`) + Retro-Chapter (`[…/chapter/synthetic-retrograde]`) | `[kontextualisierend/subchapter/synthetic-retrograde]…` |
| R3 | `paragraph_retrograde` | Forward-`[interpretierend]` + Retro-Subchapter (`[…/subchapter/synthetic-retrograde]`) | `[interpretierend-retrograde]…` |

### 8.3 Bewegungen im Prompt (alle drei Module)

Drei explizite, gleichberechtigte Bewegungen — **bestätigen / verschieben / korrigieren**. Der Prompt instruiert ausdrücklich, das Forward-Memo nicht zu wiederholen, wenn nichts verschoben oder korrigiert wird; statt dessen das Bestätigte mit kurzer Begründung zu markieren. Damit liegt der retrograde Ertrag im Delta zur Forward-Schicht, nicht in einer Zweitfassung derselben Lektüre.

### 8.4 Linien-Trennung (kollisionsfrei)

Forward- und retrograde Memos liegen am selben `scope_element_id`. Trennung erfolgt über die Inscription-Bracket-Position:
- `[interpretierend]…` matcht NICHT `[interpretierend-retrograde]…` (Bracket-Boundary-LIKE).
- `[kontextualisierend/X/synthetic]…` matcht NICHT `[kontextualisierend/X/synthetic-retrograde]…`.

Forward-Loader (`per-paragraph.ts`, `section-collapse-synthetic.ts`, `chapter-collapse-synthetic.ts`) wurden ergänzt um expliziten `LIKE '[interpretierend]%'`-Filter — damit retrograde Memos den Forward-Pfad nicht polluten, wenn Forward + Retrograde im selben Werk koexistieren.

### 8.5 Idempotenz / Resume

Pro Atom prüft die Retrograde-Funktion vor dem Run, ob bereits ein retrograde-getaggtes Memo am selben `scope_element_id` existiert; falls ja, skip. `listAtomsForPhase` filtert Done-Atome via Inscription-LIKE auf das Retrograde-Tag. Resume-safe wie der Forward-Walk.

### 8.6 Tier-Routing

Alle drei Retrograde-Phasen nutzen `resolveTier('h2.tier1')` — selbe Modell-Klasse wie der H2-Forward-Walk. Die zusätzliche LLM-Rechenzeit ist proportional zur Forward-Strecke (R1: ein Call pro L1-Kapitel, R2: ein Call pro Leaf-Subchapter auf Aggregations-Level, R3: ein Call pro Hauptlinien-Absatz). Praktisch verdoppelt sich der H2-Token-Aufwand bei aktiviertem Retrograde-Pass.

### 8.7 UI-Lage

Checkbox "Retrograde-Pass (FFN-Backprop-style)" in einem `.run-modifiers`-Fieldset unter dem Heuristik-Radio-Selector, sichtbar **nur wenn** `effectiveHeuristic ∈ {h2, meta}`. Default off. Der Master-Run-Trigger sendet das Flag im POST-Body als `retrograde_pass: boolean`; der Server-Endpoint (`/api/cases/[caseId]/pipeline/run`) reicht es als `RunOptions.retrograde_pass` an `runPipelineLoop` weiter.

### 8.8 Persistenz

Pro Schicht parallel zur Forward-Persistenz. Memo-Triade unverändert (`namings` + `appearances` mit `mode='entity'` + `memo_content`); diskriminierend ist das Inscription-Tag. `appearances.properties.source = 'synthetic_retrograde'` markiert R3-Memos zusätzlich auf JSONB-Ebene für Reader/Synthesen-Tab-Filter.

---

## 9. H1↔H2 Einwand-Schleife & Stufe-3-Werkzeuge (geplant — Phase A: Fundament)

**Status:** Designentscheidung 2026-05-06. Phase A (Fundament: Doku, Migration, LLM-Slots-Settings) im Bau. Phase B (Schleifen-Mechanik), Phase C (Stufe-3-Mini-Aufruf) und Phase D (Große Stufe 3) folgen.

Die Einwand-Schleife ist eine **per-¶-Klärung zwischen H1 und H2**, bevor Fehl-Einstufungen ins Kapitel-Aggregat durchgereicht werden. Sie wirkt nur im Composite `heuristic='meta'` (linienreine H1+H2-Stand-alone-Runs sind unverändert). Die Schleife ist **asymmetrisch**: H2 reicht einen Einwand ein, H1 prüft und revidiert ggf., H2 schreibt am Ende fresh.

### 9.1 Motivation

Im additiven Default-Composite läuft H1 vollständig durch, danach H2 vollständig, danach Meta-Synthese aggregiert. Eine in H1 ungenaue Argumenteinstufung (z.B. fälschliches `referential_grounding=namedropping` für eine substanziell verortete Autor-Erwähnung) wird über alle H1-Aggregations-Schichten durchgereicht und ist erst auf Werk-Ebene in der Meta-Synthese als Differenz zwischen H1 und H2 sichtbar. Die Einwand-Schleife greift früher: am Punkt der Entstehung.

Die Schleife verhindert nicht alle Fehleinschätzungen — sie verhindert nur, dass Fehleinschätzungen **unrevidiert nach oben durchgereicht** werden, wenn die jeweils andere Linie die Information zur Revision hat.

### 9.2 Trigger

Pro ¶ wird die Schleife initiiert, wenn nach H1's `argumentation_graph` (+`argument_validity`) und H2's `paragraph_synthetic` mindestens eine der Bedingungen auf den H1-Argumenten dieses ¶ wahr ist:

```
∃ argument: validity_assessment.carries == false
∨ ∃ argument: referential_grounding ∈ {namedropping, abstract}
∨ ∃ argument_edge mit kind='contradicts' im ¶
```

Alle drei Bedingungen lesen existierende `argument_nodes`/`argument_edges`-Felder — kein neues Schema, keine zusätzliche Klassifikation.

### 9.3 Schleifen-Mechanik

```
1. H1 läuft clean → argument_nodes
2. H2 läuft clean (linienrein) → ¶-Kommentar v1
3. Trigger-Check auf H1
4. wenn fires:
   a. H2 formuliert Einwand (Free-Text, ggf. mit Mini-Stufe-3-Recherche)
   b. H1 reevaluiert (stateless) → ggf. revidierte argument_nodes + Begründung
   c. counter += 1
   d. Trigger-Check auf revidiertem H1:
      - nicht mehr fires → break (status=resolved)
      - fires und counter < 3 → zurück zu (a)
      - fires und counter == 3 → break (status=unresolved)
5. H2 läuft fresh (ohne Einwand-Memory) auf finalem H1 → ¶-Kommentar final (überschreibt v1)
```

**Iterations-Modell A:** jede H2-Einwand-Formulierung zählt als eine Iteration, max 3. Die finale fresh-H2-Re-Run-Phase zählt nicht mit.

**Termination:** drei Endzustände — `resolved` (Trigger erlischt), `unresolved` (counter==3 erreicht), `resolved` (H2 verzichtet auf weiteren Einwand). Status fällt strukturell aus dem Loop, kein LLM-Flag nötig.

**Orchestrator hält den Loop-State**, nicht die Modelle. H1 hat keine Schleifen-Awareness.

### 9.4 H1-Prompt-Template (stateless)

```
Argument: "[claim-Text aus argument_nodes]"
Bisherige Einstufung: [referential_grounding=…, validity_assessment=…]
Andererseits: [Einwand-Text, von H2 formuliert, ggf. mit Recherche-Faktum]

Beurteile den Einwand und beziehe ihn ggf. in deine Prüfung ein.
Begründe deine Entscheidung in 1-2 Sätzen.
```

H1-Output: revidierte (oder bestätigte) `argument_nodes`-Felder + `begruendung` (1-2 Sätze Prosa). Kein Verweis auf "iteration n", kein Verweis auf "H2", kein Schleifen-Bewusstsein. Jeder Aufruf ist ein einmaliger Beurteilungsauftrag.

### 9.5 H2-Einwand-Rolle (mit Vorgeschichte)

H2 in der Einwand-Rolle sieht in Iteration `n`:

- aktueller Stand H1 (ggf. revidiert in vorigen Iterationen)
- ¶-Text
- eigener Initial-Kommentar v1
- für jede frühere Iteration `k < n`: `einwand_k` + `H1.begruendung_k`

Damit ist Eskalation möglich: wenn H1 in Iteration 1 mit Begründung Y abgelehnt hat, kann Iteration 2 Y direkt adressieren — z.B. durch Mini-Stufe-3-Recherche zur Untermauerung des Einwands.

In der **finalen fresh-Rolle** sieht H2 nur das (ggf. revidierte) H1 + ¶-Text. Keine Einwand-Historie, kein v1-Memory. Schreibt fresh und überschreibt v1.

### 9.6 Stufe-3-Mini (in der Schleife)

H2 darf in jeder Iteration den `simulated_expert`-Slot konsultieren, um Sachfragen zu klären, die per Modell-Wissen entscheidbar sind, aber nicht durch das vorhandene Pipeline-Material:

- **Beispiel:** "Wurde Klafkis Allgemeinbildungs-Konzept 1985 in welchem Werk formuliert?"
- **Format:** Free-Text-Frage von H2, Suffix automatisch concatenated: `"Deine Antwort darf nicht länger als 1000 Tokens sein."`
- **Modell:** `resolveSlot('simulated_expert')` (siehe §9.8)
- **Token-Budget:** `maxInputTokens` (Default 250) + `maxOutputTokens` (Default 1000) aus Slot-Config
- **Antwort fließt in den Einwand-Text ein**, nicht als separater Kanal an H1

Mini-Stufe-3 ist H2-getriggert, nicht orchestrator-automatisch. H2 entscheidet, ob die Frage Modell-Wissen erfordert.

### 9.7 Große Stufe 3 (Kapitel-Aggregator)

Akkumulierte Klärungs-Ergebnisse pro Hauptkapitel werden vor `chapter_collapse_synthetic` ausgewertet. Trigger:

```
fires_large_stufe3 := unresolved_set.nonempty
                   ∨ ∃ cluster: count({¶ : ¶.cluster=cluster}) ≥ N    (Default N=2)
```

V1 ist **cluster-basiert** (zählt `validity_failure | namedropping | abstract | contradiction`-Vorkommen pro Kapitel, anchor-blind). Anchor-basiertes Pattern-Matching (z.B. "Klafki in ¶3, ¶17, ¶42") nachgeschaltet, falls V1 zu viele False-Positives produziert.

Bei Trigger feuert ein einzelner Aufruf an die "Große Stufe 3":

- **Modell:** `resolveSlot('simulated_expert')`, aber mit großzügigerem Token-Budget (RAG/Upload-fähig)
- **Eingabe:** Liste der unresolved-¶s mit Mini-Chat-Historie + aggregierte Cluster-Patterns
- **Ausgabe:** Memo `[kontextualisierend/chapter/large_stufe3]…`, fließt in die Kapitelsynthese als zusätzliche Stimme — überschreibt **keine** ¶-Kommentare
- **Frequenz:** ein Call pro Kapitel maximal (Kostenkontrolle)

### 9.8 LLM-Slots (Konfiguration)

Parallel zu `model-tiers` für Pipeline-Phasen: orthogonales Slot-System für Tool-LLMs. Konfiguration in `ai-settings.json` als neues Feld `slots`, gleicher Persistenz-Mechanismus wie `tiers`.

| Slot | Zweck | Default |
|------|-------|---------|
| `simulated_expert` | Sachfragen-Modell für Mini-Stufe-3 und Große Stufe 3 | claude-opus-4.7 (OpenRouter), 250in/1000out |
| `fact_check` | Fact-Check-Slot, später ggf. weiter differenziert | TBD |

Slot-Schema (jeder Slot):

```typescript
{
  provider: Provider;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
}
```

Resolver: `resolveSlot('simulated_expert')` liefert die User-Wahl aus `ai-settings.json` `slots.simulated_expert`, sonst die Registry-Empfehlung. UI-Ort: `/settings?tab=llm-slots`.

Begründung Default Opus: für deutsche Bildungsphilosophie-Sachfragen wahrscheinlich höhere Trainings-Korpus-Exposition als MiMo (chinesischer Reasoning-Schwerpunkt) oder Mistral (französisch-europäisch, weniger deutschsprachig-akademisch). Keine kontrollierten Benchmarks auf dieser Domäne — die Setzung ist Plausibilitäts-Default, nicht gemessen.

### 9.9 Audit-Persistenz

Migration 053: Tabelle `paragraph_einwand_iterations`. Pro Iteration ein Row mit:

- `run_id`, `paragraph_element_id`, `iteration_n`
- `trigger_clusters` JSONB (welche Cluster feuerten)
- `einwand_text`, `simulated_expert_q`/`simulated_expert_a` (NULL falls nicht aufgerufen)
- `h1_revised_fields` JSONB, `h1_begruendung`
- `status` ('resolved' | 'unresolved' | 'pending')

Tief persistiert für Debugging und empirische Analyse der Schleife (Konvergenz-Quoten, häufige Trigger-Cluster, Mini-Stufe-3-Hit-Rate).

### 9.10 Phasen-Plan

| Phase | Inhalt | Status |
|-------|--------|--------|
| A | Fundament: §9-Doku, Mig 053, AiSettings-Erweiterung, llm-slots.ts, /settings-Tab | im Bau |
| B | Schleifen-Mechanik im Orchestrator, H1/H2-Prompt-Erweiterung, ¶-Indikator | offen |
| C | Stufe-3-Mini-Caller, Einbettung in H2-Einwand-Formulation | offen |
| D | Großer-Stufe-3-Aggregator + RAG-Hook + Kapitel-Memo + UI-Indikator | offen |
