# 09 — Legacy-Doku-Ledger

**Stand: 2026-05-03** · Status aller älteren `docs/*.md`-Dateien. Nutze diese Tabelle, bevor du eines der älteren Dokumente ernst nimmst.

---

## 1. Ledger

| Datei | Zeilen | Stand | Status | Wenn du es liest, beachte... |
|-------|--------|-------|--------|-------------------------------|
| `DEVLOG.md` | 448 | live | **AUTORITATIV** für Tagesentscheidungen + Rationale | wird laufend gepflegt; Quelle für "warum haben wir das so entschieden" |
| `manual.md` | 438 | älter | partial — basale Workflows ok, H3-UI fehlt | nicht für H3-Funktionsweise heranziehen |
| `assessment-2026-03-21.md` | 141 | 2026-03-21 | **ÜBERHOLT** — durch H3-Implementations-Status abgelöst | nur historisch (Bilanz transaktionale Ontologie + CCS) |
| `roadmap-2026-03-21.md` | 108 | 2026-03-21 | **ÜBERHOLT** — durch [06-cases-briefs-falltyp §6 (4-Stufen-Roadmap)](06-cases-briefs-falltyp.md#6-4-stufen-roadmap-forscher-ui) ersetzt | ignorieren für aktuelle Planung |
| `design-clusters.md` | 111 | älter | **ÜBERHOLT** — Cluster→Phase-Rename in Mig 022/026 hin und zurück; "Phase" ist final | "phase" / "cluster"-Terminologie hier ist durch H3-Funktionstypen ersetzt |
| `design-documents-and-docnets.md` | 103 | älter | partial — `document_elements`-Schema noch korrekt; "docnet"-UI/Queries inaktuell | für Schema referenzieren ja, für UI nein |
| `design-mother-map-and-coding-flow.md` | 221 | älter | partial — Konzepte (Naming-Emergenz, Coding-Flow) konzeptionell ok, UI-/Implementierungs-Detail nicht aktuell | gute Quelle für Methodik-Hintergrund |
| `design-provenance-and-codes.md` | 131 | älter | **ÜBERHOLT** — Code-System retired (Mig 008). Codes sind derived view über Map-Anchors. Provenance-Matrix konzeptionell ok | aktuelle Provenance siehe [00-foundations §4](00-foundations.md#4-provenance-zwei-orthogonale-dimensionen) |
| `design-memo-ontology.md` | 45 | älter | partial — Description-Memo (am Naming-Akt) konzeptionell ok; Pipeline-Memo-Slice (formulierend/interpretierend/kontextualisierend/kapitelverlauf) lebt nur in Code | aktueller Pipeline-Slice in [04-pipeline-h1-h2 §5](04-pipeline-h1-h2.md#5-memo-ontologie-pipeline-slice) |
| `anonymization-phase-b-handover.md` | 243 | 2026-05-02 | **AUTORITATIV** für Phase-A-Detail + Phase-B-Roadmap | volle Detail-Quelle für Anonymisierung |
| `h3_implementation_plan.md` | 111 | 2026-05-03 | **AUTORITATIV** für H3-Gesamtstrategie | langform; kompakte Übersicht in [05-pipeline-h3](05-pipeline-h3.md) |
| `h3_implementation_status.md` | 266 | **2026-05-03** | **AUTORITATIV** — laufender Status pro Phase | hier zuerst lesen wenn an H3 gearbeitet wird |
| `h3_grundlagentheorie_status.md` | 198 | **2026-05-03** | **AUTORITATIV** — Step-1-Validierung + Test-Cases | enthält Refactor-Verwerfung 2026-05-03 (Klammer-zentriert) |
| `h3_grundlagentheorie_parsing_strategy.md` | 107 | 2026-05-03 | supporting | Detail zur Parsing-Heuristik |
| `handover_h3_exposition_qualifizierung.md` | 169 | 2026-05-03 | **AUTORITATIV** für Qualifizierungs-Spec — pending User-Abnick | Prompt-Wording **verbatim** übernehmen |

---

## 2. Verzeichnisse

| Pfad | Inhalt | Status |
|------|--------|--------|
| `docs/sessions/` | Session-Transkripte (txt) + `00_epistemological_foundations.md` (324 Z., konzeptionelle Basis) | append-only Log |
| `docs/experiments/` | LLM-Output-Vergleiche pro Modell (basal-AG smoketests, side-by-side comparisons, AG-Globalitäts-Studie, Memo-Studien) | append-only Datenbank für Modellvergleich |

`docs/sessions/00_epistemological_foundations.md` ist die **Langform** der konzeptionellen Basis. Memory verweist auf "docs/foundations.md" — das ist der ältere Pfad; aktueller Standort ist `sessions/00_*.md`. Neue Sessions sollten ggf. in [00-foundations](00-foundations.md) einsteigen (Kurzform, ~80 Zeilen) und nur bei Tieferstudie auf das Sessions-Doc gehen.

---

## 3. Migrations-Pfad bei Änderungen an Legacy-Docs

Wenn du an einer als ÜBERHOLT markierten Datei substanziell arbeiten musst:

1. **Stoppen.** Frage zuerst: Gehört die Information in ein aktuelles `architecture/*`-Modul?
2. Wenn ja: Information dorthin überführen, dann das Legacy-Doc archivieren (Header `> ARCHIVIERT 2026-MM-DD — siehe architecture/XX-...md`).
3. Wenn nein: vielleicht ist die Datei wirklich obsolet und kann gelöscht werden — aber **erst nach User-Bestätigung**.

Niemals zwei parallele Wahrheits-Quellen nebeneinander stehen lassen.

---

## 4. Was nicht im Ledger steht

- `CHANGELOG.md` (Repo-Root) — projektweite Versions-Notes (frisch zu halten).
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, License-Files — Standardrepo-Files.
- `CLAUDE.md` (Repo-Root) — Kernprinzipien für Claude-Sessions; Doku selbst.
- Memory unter `~/.claude/projects/-Users-joerissen-ai-sarah/memory/` — Cross-Session-Persistenz, nicht repo-checked-in.
