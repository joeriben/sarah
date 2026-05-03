# 08 — Konventionen + Workflow

**Stand: 2026-05-03** · Commit-Disziplin, Doku-Update-Regeln, Vokabular, AUTO-Mode-Grenzen.

Diese Konventionen sind nicht Empfehlungen — sie sind aus konkreten Inzidenten in den Memory-Records abgeleitet. Wenn du ein Pattern brichst, brichst du eine Vereinbarung.

---

## 1. Commit-Disziplin

Memory `feedback_commit_after_substantial_steps` + `feedback_session_must_document_work_at_commit`.

**Regel:** Pro logischer Einheit (Migrations-Paket, Backend-Service, UI-Erweiterung, Heuristik-Refactor) ein eigener Commit mit präziser Message — **nicht** erst am Session-Ende.

**Pflicht im selben Commit:** inhaltliche / strategische Substanz mit-committen, nicht nur Code-Diff.
- Heuristik-Änderung → Doku-Update in `architecture/05-pipeline-h3.md` ODER `architecture/04-pipeline-h1-h2.md`.
- Migration → Eintrag in `architecture/01-data-model.md §1` + Tabelle in §2.
- Pipeline-Phase → `architecture/04-pipeline-h1-h2.md §1`.
- Neuer Endpoint → `architecture/07-api-and-ui.md §1`.
- Setzung gekippt → `architecture/09-legacy-docs-ledger.md` + Marker im betroffenen Doc.

**Commit-Message-Stil:** wie in den letzten Commits sichtbar (`refactor(h3):`, `revert(h3):`, `docs(h3):`, `feat(...)`, `fix(...)`). Scope-Tag in Klammern.

**Niemals:** `--no-verify`, `--amend` für veröffentlichte Commits, `git push --force` ohne explizite User-Anweisung.

---

## 2. Doku-Update-Disziplin

| Trigger | Pflicht-Update |
|---------|----------------|
| Migration neu | `01-data-model.md` §1 + §2 |
| Tabelle / Spalte verändert | `01-data-model.md` §2 + ggf. §4 (Invarianten) |
| Pipeline-Phase neu / verändert | `04-pipeline-h1-h2.md` §1 + Datei in §3 |
| H3-Funktionstyp-Status verändert | `05-pipeline-h3.md` §4 |
| API-Endpoint neu | `07-api-and-ui.md` §1 (passende Subsektion) |
| UI-Route neu | `07-api-and-ui.md` §2 |
| Legacy-Doc obsolet geworden | `09-legacy-docs-ledger.md` |
| Architekturentscheidung (Phase, Triade, Falltyp, …) | `06-cases-briefs-falltyp.md` ODER neues Doku-Modul |

**Stand-Datum** in jedem Teildokument oben mitziehen wenn substanziell verändert.

**Auflösungs-Regel:** Wenn ein Teildokument >250 Zeilen wird → aufteilen, nicht weiterwachsen lassen. Findbarkeit > Vollständigkeit pro Datei. ToC mit neuem Untermodul ergänzen.

---

## 3. Vokabular-Hygiene

Memory `feedback_vocab_heuristik_not_strategie`: Analyse-Choreographien heißen **Heuristik**. "Strategie" trägt falschen instrumentellen Beiklang.

| ✓ Richtig | ✗ Falsch |
|-----------|----------|
| Heuristik (H1/H2/H3) | Strategie |
| Funktionstyp (`outline_function_type`) | Section-Type, Chapter-Type |
| Phase (Pipeline-Phase) | Schritt, Stage |
| Konstrukt (function_constructs) | Entity, Record |
| Werk | Document (im Methodik-Kontext) |
| Kapitel / Unterkapitel / Abschnitt | Section / Subsection |
| Falltyp | Case-Type (Englisch ok in code), Werk-Typ |
| Critical Friend | Reviewer, Bewertungs-Assistent |

**Memo-Typen sind feststehend:** `formulierend`, `interpretierend`, `kontextualisierend`, `kapitelverlauf` — keine Synonyme.

**Funktionstypen sind feststehend:** `EXPOSITION`, `GRUNDLAGENTHEORIE`, `FORSCHUNGSDESIGN`, `DURCHFUEHRUNG`, `EXKURS`, `SYNTHESE`, `SCHLUSSREFLEXION`, `WERK_STRUKTUR` — siehe `src/lib/shared/h3-vocabulary.ts`.

---

## 4. AUTO-Mode-Grenzen

Memory `feedback_strategic_decisions_need_consent_even_in_auto`.

**Auch unter AUTO:** strategische Entscheidungen brauchen explizite User-Zustimmung. AUTO ist für **bounded niedrig-risiko Tasks**, nicht für Pfad-Setzungen.

| Erlaubt unter AUTO | Verboten unter AUTO |
|--------------------|----------------------|
| Bug-Fix mit klarer Diagnose | Algorithmus-Wahl (z.B. Citation-Heuristik) |
| Code nach abgenicktem Spec | Architektur-Entscheidung (Triade vs. Liste) |
| Migration für abgenicktes Schema | Heuristik-Wahl (Klammer-zentriert vs. Author-Pattern) |
| Refactor innerhalb gegebener Strategie | LLM-Prompt-Design für neuen Schritt |
| Doku-Update nach Code-Diff | Default-Werte / Schwellenwerte ohne explizite Setzung |

Memory `feedback_no_hidden_setq`: keine versteckten inhaltlich relevanten Setzungen via Placeholder / Hint-Maps / Default-Werte vor dem Code-Schreiben. **Multiple-Choice nicht anbieten** wenn der User die Wahl bereits getroffen hat.

Memory `feedback_understand_before_implementing`: Domänenbegriffe vor Implementation klären (Memory, Recherche, knappe User-Klärung). Kein Loscoden auf unklaren Konzepten.

---

## 5. Risk-Aware Operations

Memory `feedback_pattern_iteration_vs_simpler_heuristik`: bei akademischen Text-Patterns (Citations, Marker, Blöcke) erst Diagnostik-Frage stellen. Iteratives Patchen über >3 Runden ist Symptom falscher Granularität.

**Vor riskanten Aktionen** (DB-DROP, force push, branch delete): erst fragen.

**Benchmark-Cases nicht modifizieren** (Memory `feedback_benchmark_cases_protected`): bestehende BA-/Habil-Cases sind Vergleichsbasis. Neue Feature-Tests an dedizierten Test-Cases (z.B. "BA H3 dev").

---

## 6. UI-Bauprinzipien (kompakt)

Memory `feedback_features_before_interface`: Features erst, Steuerungsinterface danach. Keine UI/Toggle/Reframing-Phase für Features die noch nicht existieren. Heuristik-Routing gehört in Falltyp-Konfiguration, nicht in Run-Setup-Toggle.

Memory `feedback_color_only_for_reviewer_signals`: **Farbe** codiert Wertung (rot/gelb/grün = Problem/Ambivalenz/OK). **Niemals** Klassifikator-Typ. Klassifikatoren über Schrift/Form/neutrale Palette.

Memory `feedback_ui_gaps_are_platform_blockers`: UI-Lücken die Recovery aus Daten-Errors verhindern (z.B. fehlender Add/Re-Edit-Pfad für Parser-Fehler) sind keine UX-Bugs — sie machen die Plattform unbenutzbar für reale Dokumente. Priorisieren entsprechend.

---

## 7. Modell-Verbote

Memory `feedback_no_xai_models`: xAI/Grok-Modelle nicht vorschlagen. Bei Modell-Vorschlägen komplett auslassen.

Memory `feedback_local_ollama_unfit_for_pipeline`: lokale 9B-Klasse ist für Pipeline ungeeignet (nemotron-3-super: Refusal, JSON-Halluzination, 40s/¶). Nicht für produktive Phasen vorschlagen.

Memory `feedback_deepseek_v4_unfit_for_basal_ag`: DS4 ist Dead-End für basal/AG (OpenRouter Reasoning-Burn, Mammouth Routing-Hänger, Argument-Komprimierung). Auch langsamer als Sonnet.

---

## 8. Quick-Reference: Memory ↔ Doku

Memory ist die Persistenz-Schicht für **was-zwischen-Sessions-überleben-muss**. Architektur-Doku ist **was-die-Codebase-aktuell-tut**. Bei Konflikt:
- Code = ground truth.
- Wenn Memory-Eintrag und Code divergieren → Code prüfen, Memory updaten.
- Wenn Architektur-Doku und Code divergieren → Code prüfen, Doku im selben Commit fixen.
