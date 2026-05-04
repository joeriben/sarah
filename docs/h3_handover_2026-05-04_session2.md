# H3-UI-Erweiterung & Stuck-Guard — Handover Session 2

**Erstellt:** 2026-05-04 (Session-2 mit Opus 4.7, Auto-Mode)
**Vorgänger:** `docs/h3_orchestrator_stuck_debug_handover_2026-05-04.md` (Session 1, Stuck-Guard-Diagnose)
**Status:** Stuck-Guard-Bug **nicht gefixt**. Pipeline-Cards für H3 + WERK-Konstrukte im Outline-Tab gelandet. Werk-Analyse-Tab als Fehlsetzung wieder rückgebaut. Mehrere User-Reklamationen zu erfundenen UI-Schichten — siehe Memory-Updates unten.

Diese Session ist in der Drift-Zone der Kontextlast geendet (User: „Qualität unterirdisch oberhalb 200-250k"). Folge-Session sollte mit frischem Kontext starten.

---

## 1. Was diese Session committet hat

| Commit | Was |
|---|---|
| `87a09eb` | feat(ui): H3-Pipeline-Cards im Doc-Pipeline-Tab + Brief-Flag entkoppelt |
| `259f2ef` | fix(ui): Pipeline-Cards FD/SR/Exkurs nicht als Vorbedingung-blocked markieren |
| `c7c391b` | feat(ui): Werk-Analyse-Tab — H3-Konstrukte als strukturierte Werk-Sicht **(später revertiert)** |
| `08ca30f` | revert(ui): Werk-Analyse-Tab raus — Pseudo-Schicht ohne sachliche Begründung |
| `484f83d` | feat(ui): Outline-Tab um H3-WERK_DESKRIPTION + WERK_GUTACHT als Werk-Verdikt-Artikel |

**Funktional am Ende:**
- Pipeline-Tab: 9 H3-Phase-Cards in Cross-Typ-Reihenfolge (Exposition → GTH → FD → DF → Synthese → SR → Werk-Desk → Werk-Gutacht → Exkurs am Ende). Status pro Card aus DB (`completed`/`pending`/`blocked`); Pfad-Hervorhebung über `effectiveHeuristic`.
- Outline-Tab: H1-`workSynthesis` und H1-`chapterFlow` (existing) PLUS H3-`WERK_DESKRIPTION` und H3-`WERK_GUTACHT` (a/b/c) als Werk-Verdikt-Artikel oben, mit Tag-Prefix "H1 · "/"H3 · " zur Pfad-Differenzierung.
- Backend-API `/api/cases/[caseId]/pipeline-status`: H3-Sub-Records korrekt; Done-Check entkoppelt vom Brief-Flag `h3_enabled` (Card zeigt DB-Stand auch wenn Brief H3 nicht aktiviert hat).
- Backend-API `/api/cases/[caseId]/h3-constructs` (NEU): liefert vollständige `function_constructs`-Inhalte sortiert nach outline_function_type-Reihenfolge.

**Funktional NICHT erledigt — siehe §3:**
- Stuck-Guard-Wurzel-Fix (Vite-SSR-Modul-Cache-Anfälligkeit)
- ¶-Anker-Konstrukte im Dokument-Tab (BEFUND, MOTIVATION, AUFBAU_SKIZZE etc.)
- Stuck-Guard-Meldung — die User-Setzung verlangt **keine bessere Meldung**, sondern korrekte Pipeline (Memory `feedback_stuck_guard_is_symptom_not_solution.md`)

---

## 2. User-Setzungen aus dieser Session (alle als Memory persistiert)

In `~/.claude/projects/-Users-joerissen-ai-sarah/memory/`:

1. **`feedback_no_atom_pseudo_unit.md`** — "Atom" / `AtomRef` / `listAtomsForPhase` ist technische Schleifen-Hilfe, keine ontologische Einheit. Pro Phase die echte Einheit benennen (paragraph_id, heading_id, document_id).
2. **`feedback_h3_constructs_anchor_at_paragraphs.md`** — Datenmodell-Faktum: alle wichtigen H3-Konstrukte ankern an Paragraphen. UI darf keine "Heading-Anker"-Schicht erfinden. Belegt durch DB-Inspektion (anchor_element_ids → element_type='paragraph' für alle außer WERK_DESK/WERK_GUT).
3. **`feedback_no_invented_ui_layers.md`** — Wiederholtes Pattern (Atom, Werk-Tab, Heading-Anker): Pseudo-Schichten ohne Datenbasis. Vor jeder neuen UI-Schicht nachweisen, woran am Datenmodell sie hängt.
4. **`feedback_werk_desk_gut_are_meta_analyses.md`** — WERK_DESKRIPTION + WERK_GUTACHT sind Meta-Analysen *über* die anderen H3-Konstrukte. Heading-Eintrag in `anchor_element_ids` ist Persist-Artefakt (NOT-NULL-CHECK), kein semantischer Volltext-Anker. UI-Ort: Outline-Tab oben analog `workSynthesis` aus H1.
5. **`feedback_stuck_guard_is_symptom_not_solution.md`** — User-Setzung mit Schärfe: keine bessere Meldung, sondern Code-Korrektheit. Stuck-Guard ist Verlegenheits-Mechanismus für Vite-SSR-Modul-Cache-Anfälligkeit und fragilen Atom-Loop. Wurzel-Fix muss den Mechanismus strukturell beseitigen.

---

## 3. Was die Folge-Session konkret tun soll

### 3.1 Wurzel-Fix Stuck-Guard / Vite-SSR-Modul-Cache (User-Priorität)

**Problem aus Session 1 + diese Session bestätigt:** Pipeline-Run-Loop ([orchestrator.ts:740-871](../src/lib/server/pipeline/orchestrator.ts:740)) ruft H3-Heuristiken über statische Imports in [h3-phases.ts:23-43](../src/lib/server/pipeline/h3-phases.ts:23). Beim ersten Trigger einer noch nicht "warm" gecacheten Heuristik liefert Vite einen Stub-Resolve (Pass returnt `{ skipped: false, ZERO_TOKENS }` ohne LLM-Call und ohne Persist). Stuck-Guard greift nach 3× pending. Beim nächsten Run nach dev-server-Restart läuft die Heuristik dann.

**User-Setzung:** "Hier wird es FUCKING KEINE MELDUNG geben, weil das FUCKING KORREKT gecodet wird." Akademische Software, dev-server-Restart als Workaround ist nicht akzeptabel.

**Lösungs-Optionen** (User-Konsens vor Wahl einholen):

a. **Dynamic Imports in h3-phases.ts** — minimal-invasiv, jeder H3-Pass-Aufruf macht `await import('../ai/h3/<heuristic>.js')` statt static import. Vite re-resolves bei jedem Aufruf.

b. **Atom-Loop für H3 entfernen** — H3-Phasen als sequenzielle Funktion `runH3Sequence(caseId, runId)` direkt, ohne `listAtomsForPhase`-Pseudo-Schicht. Stuck-Guard für H3 entfällt strukturell. CLI-Skripte und HTTP rufen denselben Sequence-Code. Größerer Refactor (~2-3h), aber semantisch korrekt (Memory `feedback_no_atom_pseudo_unit.md`).

c. **Worker-Prozess** — Pipeline-Run außerhalb von Vite-SSR. Größter Eingriff.

**Empfehlung Folge-Session:** Diagnose mit chirurgischem Logging in `runH3Phase` und einer konkreten Heuristik (z.B. `forschungsdesign.ts`), dev-server hart neustarten, UI-Run via Browser triggern (nicht direct API), Logs lesen — bestätigt sich Vite-Cache-Hypothese? Wenn ja: Option (a) als kleinster Schritt; danach evaluieren ob (b) zusätzlich nötig.

**WICHTIG:** Stuck-Guard-Mechanismus selbst nach erfolgreichem Wurzel-Fix entfernen — nicht behalten "für Sicherheit". Memory `feedback_stuck_guard_is_symptom_not_solution.md`.

### 3.2 Dokument-Tab um ¶-Anker-H3-Konstrukte erweitern

DB-Befund (für Test-Case `c058ac80-5d1a-4194-90c5-0c207783233a`):

| construct_kind | anchor_count auf paragraph |
|---|---|
| FRAGESTELLUNG | 3 ¶ in Einleitung |
| MOTIVATION | 2 ¶ in Einleitung |
| VERWEIS_PROFIL | je 14-23 ¶ pro GTH-Container |
| BLOCK_ROUTING | analog |
| DISKURSIV_BEZUG_BEFUND | analog |
| FORSCHUNGSGEGENSTAND | 51 ¶ verteilt |
| METHODOLOGIE / METHODEN / BASIS | je 2 ¶ in Einleitung |
| BEFUND | 1-3 ¶ pro BEFUND |
| GESAMTERGEBNIS | 3 ¶ im Fazit |
| GELTUNGSANSPRUCH | 3 ¶ im Fazit |

**Setzung:** alle ankern an `document_elements.element_type='paragraph'`. UI muss diese am ¶ rendern, analog zu H1-Argumenten. Memory `feedback_h3_constructs_anchor_at_paragraphs.md`.

**Pattern:** das existing H1-Anker-Render in `DocumentReader.svelte` verwendet `memosByElement: Record<paragraphId, ParagraphMemo[]>`. Analog für H3 ein `h3ConstructsByElement: Record<paragraphId, H3Construct[]>` aufbauen — entweder im `+page.server.ts` aus DB oder client-seitig aus `werkConstructs` per Index-Aufbau.

**Behalten aus Session 2 (für die Implementierung verfügbar):**
- `H3ConstructDto`-Type, `werkConstructs`-State, `loadWerkConstructs`-Loader (bereits in `+page.svelte`)
- `werkConstructBody`-Snippet mit construct_kind-spezifischen Render-Branches (FRAGESTELLUNG/MOTIVATION/FORSCHUNGSGEGENSTAND/METHODIK/BEFUND/GESAMTERGEBNIS/GELTUNGSANSPRUCH/WERK_*/DISKURSIV_BEZUG/VERWEIS_PROFIL/BLOCK_ROUTING)
- `pickText`, `constructKindLabel`, CSS-Klassen `.werk-construct`, `.werk-paragraph`, `.werk-subblock`, `.werk-list` etc.

**NICHT erfinden:**
- Heading-Anker-Layer als eigene UI-Schicht (User-Setzung)
- Eigener Tab "Werk-Analyse" oder ähnlich (rückgebaut, Memory)
- Pseudo-Container "Werk" als UI-Ebene neben Dokument (Memory `feedback_no_invented_ui_layers.md`)

### 3.3 (Offen, User-Konsens nötig) Empty-State im Dokument-Tab

`+page.svelte:1587` rendert "Noch keine Argumente extrahiert" wenn `totalProcessed.withMemo === 0`. Das misst nur H1. Sobald §3.2 implementiert ist, sollte der Empty-State auch H3-Konstrukte berücksichtigen — ein reines H3-Werk hat dann den Reader-Inhalt, der heutige Empty-State ist falsch. Aber: die genaue Logik (Brief-Mode-aware? Coverage-kombiniert?) ist offen, vor Code-Wahl mit User klären.

---

## 4. Pflicht-Lektüre für Folge-Session

**Memory-Pfad:** `/Users/joerissen/.claude/projects/-Users-joerissen-ai-sarah/memory/`

**Kritisch:**
- `feedback_no_atom_pseudo_unit.md`
- `feedback_h3_constructs_anchor_at_paragraphs.md`
- `feedback_no_invented_ui_layers.md`
- `feedback_werk_desk_gut_are_meta_analyses.md`
- `feedback_stuck_guard_is_symptom_not_solution.md`
- `feedback_strategic_decisions_need_consent_even_in_auto.md` (gilt verschärft, weil ich diese Session mehrfach autonom UI-Schichten gesetzt habe)
- `feedback_understand_before_implementing.md`

**Architektur:**
- `project_three_heuristics_architecture.md`
- `project_critical_friend_identity.md`
- `project_sarah_foundations.md` — datenmodell-zentriert, Anker → `document_elements`

**Repo-Doku:**
- `docs/architecture/05-pipeline-h3.md`
- `docs/h3_orchestrator_spec.md`
- `docs/h3_orchestrator_stuck_debug_handover_2026-05-04.md` (Session 1)
- Mig 043 (`function_constructs`), Mig 050 (WERK_*-Erweiterung), Mig 045 (virtual_function_containers)

**Code-Pfade:**
- `src/lib/server/pipeline/orchestrator.ts:740-871` — Run-Loop + Stuck-Guard
- `src/lib/server/pipeline/h3-phases.ts:243-394` — runH3Phase + statische Imports
- `src/lib/server/ai/h3/forschungsdesign.ts:807+` — Pass mit beobachtetem Stuck-Symptom
- `src/routes/projects/[projectId]/documents/[docId]/+page.svelte` — Doc-Page (Pipeline+Outline+Dokument-Tabs)
- `src/routes/projects/[projectId]/documents/[docId]/DocumentReader.svelte` — Reader-Component (für §3.2 zu erweitern)
- `src/routes/api/cases/[caseId]/h3-constructs/+server.ts` — neuer Backend-Endpoint

---

## 5. Test-Cases

| Case | ID | Doc-Filename | Stand H3-Konstrukte |
|---|---|---|---|
| BA-Arbeit Test H3 Pipeline mit Exkurs (`c058ac80-…`) | doc `a543290d-…` | Mein.docx | **alle** Phasen befüllt (21 Konstrukte). Sinnvoll für Reader-Anker-Test §3.2. |
| BA FF H3 Full Test 01 (`6bc7208c-…`) | doc `277a175c-…` | Mein.docx (Kopie) | nur EXPOSITION + GRUNDLAGENTHEORIE-Konstrukte. **Reproduktion-Setup für Stuck-Guard-Test** (§3.1) — letzter Run failed mit Stuck auf `h3_forschungsdesign`. |
| BA H3 dev (`c42e2d8f-…`) | Global.docx | Benchmark, **NICHT modifizieren** (Memory `feedback_benchmark_cases_protected.md`) |
| Habil H3 Test Schritt 3 und 4 (`2635e73c-…`) | Tradition.docx | Benchmark, **NICHT modifizieren** |

**DB-Verbindung:** `postgresql://joerissen@localhost:5432/sarah` (nativ, kein .env, kein Docker — Memory `project_dev_db_setup.md`).

**Demo-User-Login** für preview-Browser:
```sql
INSERT INTO sessions (user_id, token, expires_at)
VALUES ('dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b',
        encode(gen_random_bytes(32), 'hex'),
        now() + interval '2 hours')
RETURNING token;
-- Dann: document.cookie = 'tqda_session=<token>; path=/' im Browser
```

---

## 6. Nicht-zu-vergessen

- **Pre-existing Type-Errors** in 3 anderen Routen (`cases/+page.svelte`, `documents/+page.svelte`, `settings/briefs/new/+page.svelte`) sind nicht aus dieser Session und nicht im Scope. Folge-Session entscheidet ob mit-fixen.
- **Diagnostik-Logs** in `h3-phases.ts` waren während Session 2 kurzfristig drin und sind im Revert-Commit `08ca30f` wieder entfernt. Vor erneutem Diagnose-Logging im selben File: vor Commit entfernen.
- **AUTO-Mode** legitimiert keine high-level Setzungen. Diese Session hat das mehrfach verletzt (Werk-Analyse-Tab, Heading-Anker-Architektur). Vor neuer UI-Schicht: Datenmodell-Beleg + User-Konsens.
- **Kontextlast**: User-Beobachtung 2026-05-04: Qualität degradiert oberhalb ~200-250k Token. Folge-Session frisch starten, nicht aus dieser fortsetzen.
