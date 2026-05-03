# H3-Implementierungs-Plan

Implementierungs-Plan für die kontextadaptive Pipeline-Heuristik H3 und ihre Voraussetzungen.

**Konzeptionelle Grundlage:**
- Memory: `project_three_heuristics_architecture.md` — Architektur, H3-Heuristiken, Falltyp-Konfiguration
- Memory: `project_critical_friend_identity.md` — Plattform-Identitäts-Setzung, gated-c-Mechanismus
- Memory: `project_pipeline_run_orchestrator.md` — heutiger Stand der Orchestrierung (Mig 038)
- Memory: `feedback_vocab_heuristik_not_strategie.md` — Vokabular

## Oberste Maxime: Backward-Compatibility

Während des Umbaus dürfen die existierenden Heuristiken (H1/Argumentanalyse, H2/synthetisch-hermeneutisches Per-¶-Memo) **nicht** beschädigt werden. Konsequenzen:

- **Migrationen sind additiv.** Neue Tabellen/Spalten — keine Renames, Removes, Type-Changes ohne Backwards-Compat-Schicht.
- Neue Spalten an existierenden Tabellen sind **NULL-able** mit Default NULL; bestehende Logik bleibt unverändert, neue Logik greift nur, wenn Werte gesetzt sind.
- **Bestehende AG-Outputs bleiben in ihren Tabellen** und werden nicht in die neue Konstrukte-Tabelle "umgezogen".
- **Bestehende Briefs müssen weiter funktionieren**; H3-relevante Brief-Erweiterungen sind opt-in.
- **UI-Reframing** in Phase 2 darf H1/H2-Pfade weder funktional noch begrifflich brechen — nur die Anordnung ändert sich.
- Nach jeder Phase: **Regression-Lauf** auf Demo-Habilitation für H1 und H2; sichtbare Befunde unverändert.
- `review_draft`: Single-Slot-Anzeige der UI bleibt heute, aber Datenmodell ist Liste — beide Lesarten kompatibel.

## Phasen-Plan

### Phase 0 — Bestandsaufnahme (Read-Only)

Ziel: präziser Bericht der existierenden Pipeline-Verkabelung als Spec-Grundlage für Phase 1+.

Zu kartieren:
- Pipeline-Run-Orchestrator (Mig 038): Schema, Endpoints, UI-Komponenten, Pause/Resume-Mechanik
- AG-Pipeline (H1): Aufruf-Pfad, Persistenz-Tabellen, Brief-Verkabelung
- Per-¶-Memo (H2): Aufruf-Pfad, Persistenz, "Appendix"-Charakter im UI
- Outline-Datenmodell: Tabellen, Hierarchie (Kapitel/Unterkapitel/Abschnitt?), Outline-Confirm-Flow
- Brief-System (Mig 037): Schema, Verkabelung mit Pipeline-Runs, Standardvorlagen
- case_documents-Triade: Schema, Slots central/annotation/review_draft

Output: strukturierter Bericht mit Andockpunkten für Phase 1+2 und Backward-Compat-Stellen.

### Phase 1 — Datenmodell + Vor-Heuristik

- Migration: Konstrukte-Tabelle (function_type, case_id, doc_id, anchor, content, version_stack)
- Migration: function_type + granularity_level am Outline (oder neuer Verknüpfungstabelle), NULL-able
- Migration: virtuelle Container (id, function_type, source_anchor_ranges[])
- Migration: review_draft als Liste mit Owner-/Quelle-Marker (UI bleibt single-Slot)
- Backend: Vor-Heuristik FUNKTIONSTYP_ZUWEISEN (Outline-Position + Heading-Marker + Falltyp)
- UI: Outline-Confirm um Funktionstyp-Setter erweitern (Vorschlag + Override)
- Regression-Check: H1/H2 unverändert lauffähig

### Phase 2 — H1+H2 als gleichrangige Optionen

- UI-Reframing Pipeline-Run: drei-Spuren-Auswahl H1/H2/H3 (H3 als "coming soon")
- H2 aus Appendix-Position holen — gleichrangiger Output, eigener Reader-Tab
- Brief-Library: H2 als eigenständige Brief-Kategorie sichtbar machen
- Regression-Check: H1/H2 funktional unverändert

### Phase 3 — H3-Pilot: H3:EXPOSITION

- Tools: FRAGESTELLUNG_PROBE, KONTEXTPROBE_RÜCKWÄRTS
- Choreographie: rückwärts-Suche ab letztem ¶, FORSCHUNGSDESIGN-Marker überspringen
- Persistenz: FRAGESTELLUNG, MOTIVATION als Konstrukte
- Reader-Anzeige der neuen Konstrukte
- End-to-end-Test auf Demo-Habilitation

### Phase 4 — H3-Heuristiken sukzessive

Eine Session pro Heuristik, in dieser Reihenfolge:
- H3:GRUNDLAGENTHEORIE (Pyramide: VERWEIS_PROFIL → REPRODUKTIV/DISKURSIV → ECKPUNKT_CHECK / DISKURSIV_BEZUG → FORSCHUNGSGEGENSTAND-Rekonstruktion)
- H3:FORSCHUNGSDESIGN (METHODIK + scaffolding + validity-fallacy)
- H3:DURCHFÜHRUNG (selektives AG mit agentischem GROUNDING_LOOKUP_RÜCKWÄRTS)
- H3:EXKURS (Stack-Re-Spec, transact-qda Stack-Tool als Vorlage)
- H3:SYNTHESE (H2-Baustein + ERKENNTNIS_INTEGRATION)
- H3:SCHLUSSREFLEXION (GELTUNGSANSPRUCH + GRENZEN + ANSCHLUSSFORSCHUNG)

Querschnittsbausteine (scaffolding, validity-fallacy) ggf. als eigene Mini-Phase 4.0 vor den Heuristiken.

### Phase 5 — WERK-Ebene

- H3:WERK_STRUKTUR (Stringenz Strukturherleitung aus FRAGESTELLUNG)
- H3:WERK_DESKRIPTION (immer aktiv)
- H3:WERK_GUTACHT a + b (immer aktiv) — c und d/e/f bleiben gated, aber noch nicht implementiert

### Phase 6 — Falltyp-Konfiguration + gated-c (nach Stufe 3 der UI-Roadmap)

- review_draft-Upload-Flow + UI-Slot
- WERK_GUTACHT-c gated-Aktivierung
- Dialog-Block d/e/f mit Prompt-Isolation für d (Blind-Position)
- Falltyp-spezifische H3-Konfiguration (4 Falltypen)
- Cumulative-spezifische Heuristiken (CUMULATIVE_KONSISTENZ, ARTIKEL_KONTEXT_LEISTUNG)

## Handover-Format zwischen Sessions

Status wird in `docs/h3_implementation_status.md` geführt (lebendes Dokument, mit Code mitgepflegt). Pro Session-Abschluss:

- **Stand**: Commits, was lauffähig, was getestet
- **Bekannte Probleme / bewusst aufgeschoben**
- **Nächster Schritt**: konkrete Spec der Folge-Session (Schema, Tool-Signaturen, UI-Pfade)
- **Pflicht-Lektüre für Folge-Session**: Memory-Pointer + Files + Repo-Doku-Pointer
- **Backward-Compat-Status**: Regression-Check H1/H2 ok?

Memory enthält Setzungen (Architektur, Identität, Konventionen). Implementations-Status fließt in `docs/`, nicht in Memory.

## Sub-Agent-Strategie innerhalb der Sessions

| Aufgabe | Agent | Wann |
|---|---|---|
| Codebase breit sondieren | Explore-Agent | Phase 0 zentral; punktuell in 1–4 |
| Implementierungs-Detailplan vor Code | Plan-Agent | optional in Phase 1 (Migrationsreihenfolge), Phase 3 (Tool-Architektur) |
| Bounded Implementation paralleler Bausteine | opus-delegator | nur wenn zwei Bausteine wirklich unabhängig |
| Build-/Test-Validierung | Bash + Monitor | nach jedem Implementations-Schritt |

Implementation läuft in der Hauptkonversation — User reviewt dort.
