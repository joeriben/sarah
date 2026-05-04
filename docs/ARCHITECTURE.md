# SARAH — Architektur (Inhaltsverzeichnis)

**Stand: 2026-05-04** · Eintrittspunkt für jede neue Session.

Diese Doku ist der **single source of truth** für Architektur, Datenmodell und Pipeline-Stand. Alle Teildokumente sind kurz (≤200 Zeilen) und auf schnelles Scannen unter Context-Druck optimiert.

---

## Lesereihenfolge für neue Sessions

1. `CLAUDE.md` (Repo-Root) — Kernprinzipien.
2. **[00-foundations.md](architecture/00-foundations.md)** — Epistemologie, transaktionale Ontologie, CCS-Gradient.
3. Themenspezifisch (siehe unten).

---

## Teildokumente

| #  | Datei | Inhalt | Wenn du... |
|----|-------|--------|------------|
| 00 | [foundations](architecture/00-foundations.md) | Epistemologische Grundlagen, Drei-Schichten, Critical-Friend-Identität | ... eine epistemische Setzung verstehen oder begründen willst |
| 01 | [data-model](architecture/01-data-model.md) | Tabellen, Migrationen 001–048, Query-Layer, Invarianten, Drift-Spuren | ... Schema änderst, Query schreibst, oder eine alte Spalte siehst |
| 02 | [documents](architecture/02-documents.md) | Parser (DOCX-academic), Outline-Gate, Embeddings, Anonymisierung Phase A | ... Dokument-Verarbeitung anfasst |
| 03 | [ai-infrastructure](architecture/03-ai-infrastructure.md) | Provider-Routing, Two-Track-Strategie, Failsafe (PII-Pre-Call), JSON-Repair | ... LLM-Calls hinzufügst oder Modelle wechselst |
| 04 | [pipeline-h1-h2](architecture/04-pipeline-h1-h2.md) | Orchestrator, analytische Hauptlinie AG→L3→L1→L0, synthetisches Addendum | ... an der hermeneutischen Pipeline arbeitest |
| 05 | [pipeline-h3](architecture/05-pipeline-h3.md) | Drei-Heuristiken-Architektur, Funktionstyp-Zuweisung, EXPOSITION/FORSCHUNGSDESIGN/GRUNDLAGENTHEORIE/DURCHFUEHRUNG/EXKURS/SYNTHESE/SCHLUSSREFLEXION-Status | ... H3 anfasst — **Implementations-Stand pro Funktionstyp hier** |
| 06 | [cases-briefs-falltyp](architecture/06-cases-briefs-falltyp.md) | Case-Triade, system-weite Brief-Library, Falltyp-System (geplant), 4-Stufen-UI-Roadmap | ... mit Cases, Briefs, oder Falltyp-Roadmap arbeitest |
| 07 | [api-and-ui](architecture/07-api-and-ui.md) | Endpoint-Inventar, UI-Routes, Komponenten, Shared-Module | ... ein API-Endpoint suchst oder eine UI-Seite baust |
| 08 | [conventions](architecture/08-conventions.md) | Commit-Disziplin, Doku-Update-Regeln, Vokabular, AUTO-Mode-Grenzen | ... committen, Doku updaten, oder unsicher über Vorgehen bist |
| 09 | [legacy-docs-ledger](architecture/09-legacy-docs-ledger.md) | Status aller älteren `docs/*.md` — autoritativ vs. veraltet vs. ersetzt durch | ... ein altes `design-*.md` liest und wissen willst, ob es noch gilt |

---

## Wo finde ich...?

| Frage | Antwort |
|-------|---------|
| Welche Tabelle hat Spalte X? | [01-data-model](architecture/01-data-model.md) |
| Welche Phase läuft im Pipeline-Run wann? | [04-pipeline-h1-h2 §1](architecture/04-pipeline-h1-h2.md) |
| Was ist der aktuelle Stand von H3:GRUNDLAGENTHEORIE? | [05-pipeline-h3 §4.3](architecture/05-pipeline-h3.md) |
| Wie funktioniert H3:DURCHFUEHRUNG (Hotspots → H1 → Grounding → BEFUND)? | [05-pipeline-h3 §4.4](architecture/05-pipeline-h3.md) |
| Wie modifiziert H3:EXKURS den FORSCHUNGSGEGENSTAND? | [05-pipeline-h3 §4.5](architecture/05-pipeline-h3.md) bzw. [h3_exkurs_status.md](h3_exkurs_status.md) |
| Wie funktioniert H3:SYNTHESE (GESAMTERGEBNIS + ERKENNTNIS_INTEGRATION)? | [05-pipeline-h3 §4.6](architecture/05-pipeline-h3.md) bzw. [h3_synthese_status.md](h3_synthese_status.md) |
| Wie funktioniert H3:SCHLUSSREFLEXION (GELTUNGSANSPRUCH/GRENZEN/ANSCHLUSSFORSCHUNG)? | [05-pipeline-h3 §4.7](architecture/05-pipeline-h3.md) bzw. [h3_schlussreflexion_status.md](h3_schlussreflexion_status.md) |
| Wie heißt der Outline-Confirm-Endpoint? | [07-api-and-ui §Outline](architecture/07-api-and-ui.md) |
| Welche Migration hat das Feld eingeführt? | [01-data-model §1 Migrationsindex](architecture/01-data-model.md) |
| Ist `design-clusters.md` noch gültig? | [09-legacy-docs-ledger](architecture/09-legacy-docs-ledger.md) (Antwort: nein) |
| Was darf AUTO-Mode entscheiden? | [08-conventions §AUTO](architecture/08-conventions.md) |
| Welche Provider darf ich vorschlagen? | [03-ai-infrastructure §Provider](architecture/03-ai-infrastructure.md) |

---

## Update-Disziplin

**Pflicht bei substanziellen Änderungen** (siehe [08-conventions](architecture/08-conventions.md)):

- **Migration neu** → Eintrag in `01-data-model.md §1` und Tabelle in §2 nachziehen, **im selben Commit**.
- **Pipeline-Phase / Heuristik-Komponente neu oder verändert** → `04-pipeline-h1-h2.md` oder `05-pipeline-h3.md`, **im selben Commit**.
- **API-Endpoint neu** → `07-api-and-ui.md`, **im selben Commit**.
- **Architektonische Setzung gekippt** → `09-legacy-docs-ledger.md` plus Eintrag in der betroffenen Datei.
- **Stand-Datum oben in der Datei mitziehen** (jedes Teildokument hat ein Datum oben rechts).

Wenn ein Teildokument >250 Zeilen wird: aufteilen, nicht weiterwachsen lassen. Findbarkeit > Vollständigkeit pro Datei.

---

## Was *nicht* in dieser Doku steht

- **Tagessessions / Entscheidungs-Narrative** → `docs/DEVLOG.md`
- **Manual / End-User-Workflows** → `docs/manual.md` (teils veraltet, siehe Ledger)
- **Experiment-Outputs** → `docs/experiments/`
- **Session-Transkripte** → `docs/sessions/`
- **Memory (User/Feedback/Project)** → `~/.claude/projects/-Users-joerissen-ai-sarah/memory/`
