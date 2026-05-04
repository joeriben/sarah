# H3-Orchestrator-Spec

Spec der Pipeline-Run-Orchestrator-Schicht für H3, **vor Implementation**. Sechs Entscheidungspunkte, jeder einzeln User-abzunicken (Memory `feedback_strategic_decisions_need_consent_even_in_auto.md` — AUTO mode legitimiert keine high-level Setzungen).

Konzeptionelle Grundlage:
- Mother-Session-Setzungen (`project_three_heuristics_architecture.md`)
- Status-Stand: [`h3_implementation_status.md`](./h3_implementation_status.md), [`h3_grundlagentheorie_status.md`](./h3_grundlagentheorie_status.md)
- Heutiger Pipeline-Orchestrator: Memory `project_pipeline_run_orchestrator.md` (Mig 038)

## Andockpunkt (Mother-Setzung, korrigiert 2026-05-04)

H3 hängt sich an `phasesForRun()` in `src/lib/server/pipeline/orchestrator.ts` als **alternative Phasen-Liste** — H1, H2 und H3 sind drei eigenständige, **exklusive** Heuristik-Pfade pro Run (Memory `project_three_heuristics_architecture.md`). Bei `include_h3=true` läuft ausschließlich H3, NICHT H1+H3. Wer mehrere Pfade auf demselben Werk anwenden will, triggert sequenziell mehrere Runs — automatische Verkettung gibt es nicht.

Mig 038 (SSE, Pause/Resume, Idempotenz, Token-Tracking, `cancel_requested`) bleibt unverändert; H3 erbt das Verhalten. Outline-Confirm-Gate (`outline_status='confirmed'`) bleibt Vorbedingung. `executeStep()` Pass-Signaturen eingefroren — H3 als neue Pass-Funktion, alte Signaturen unangetastet.

> **Korrektur-Hinweis 2026-05-04:** frühere Fassung dieser Spec (Z.12 vor Korrektur) und die Status-Doku haben H3 als "zusätzliche Phasen" beschrieben, die nach H1/H2 anhängen. Das war falsch und führte zu einem fehlgeschlagenen E2E-Test, bei dem `include_h3=true` 109 H1-AG-Atome triggerte, bevor irgendeine H3-Phase laufen konnte.

## Reihenfolge der H3-Phasen (vom User gesetzt)

```
EXPOSITION
  → GRUNDLAGENTHEORIE
    → FORSCHUNGSDESIGN
      → DURCHFÜHRUNG
        → SYNTHESE
          → SCHLUSSREFLEXION
            → EXKURS
              → WERK_DESKRIPTION
                → WERK_GUTACHT (a + b; c/d/e/f bleiben gated, später)
```

**EXKURS-Container sind positional, nicht typisch DURCHFÜHRUNGs-eingebettet.** Sie können an beliebiger Stelle im Werk auftreten — typischerweise in GRUNDLAGENTHEORIE, bei theoretischen Arbeiten auch in DURCHFÜHRUNG, bei empirischen Arbeiten dort selten. Die `h3_exkurs`-Phase iteriert über alle EXKURS-markierten Container und bearbeitet jeden an seiner Dokument-Position; sie läuft erst, wenn alle primären Funktionstyp-Phasen durchgelaufen sind, damit Cross-Typ-Konstrukte aller dokument-vorgängigen Positionen verfügbar sind. Ob nachgelagerte Re-Aggregation einzelner primärer Konstrukte (z.B. FORSCHUNGSGEGENSTAND-Refresh nach EXKURS-Re-Specs auf KERNBEGRIFFE) nötig ist, bleibt offen — entscheidet sich bei EXKURS-Heuristik-Implementation.

---

## #1 — Phasen-Granularität

### Optionen

**(a) Monolithische `h3`-Phase.** Eine Phase, die intern alles ausführt. SSE/Pause/Resume nur als Ganzes.

**(b) Sub-Phasen pro H3-Heuristik.** `h3_exposition`, `h3_grundlagentheorie`, `h3_forschungsdesign`, `h3_durchfuehrung`, `h3_synthese`, `h3_schlussreflexion`, `h3_exkurs`, `h3_werk_deskription`, `h3_werk_gutacht` — neun Phasen.

### Empfehlung: (b)

- Pro Heuristik unterschiedliche Dauer/Cost — Fortschritt sichtbar im UI.
- Cross-Typ-Abhängigkeiten (#2) sauber auf Phase-Ebene formulierbar.
- Falltyp-Reduktion (`peer_review`) skippt einzelne Phasen ohne Sonder-Logik.
- Crash-Resume (#5) hat natürliche Phase-Granularität.

Kosten: 9 zusätzliche Einträge in `phasesForRun()`. Tragbar, weil additiv.

---

## #2 — Reihenfolge-Erzwingung & Cross-Typ-Konstrukt-Vorbedingungen (User-entschieden)

### Setzung (User 2026-05-04)

**Bedingungsgefüge ist HART, nicht weich.** Fehlt eine analytisch erforderliche Vorbedingung (z.B. FORSCHUNGSGEGENSTAND vor FORSCHUNGSDESIGN-Analyse), gibt es keinen Analysehorizont → die Phase läuft **nicht**, sondern STOPPT mit klarer Diagnose. Der User muss entscheiden / Information ergänzen.

> "Wenn kein Forschungsgegenstand, dann keine Analyse, weil kein Analysehorizont → STOP. User muss entscheiden / Information ergänzen."

Die heutige FORSCHUNGSDESIGN-Heuristik mit ihrem "FORSCHUNGSGEGENSTAND optional, Prompt mahnt zur Zurückhaltung"-Fallback ist damit **falsch konzipiert** und muss bereinigt werden — Vorbedingungs-Check zieht in den Orchestrator, Heuristik nimmt vollständigen Bezugsrahmen als Invariante an.

### Job des Orchestrators

Genau das ist der Daseinsgrund des Orchestrators: er beantwortet pro Phase die Frage *"ist die Vorbedingung für diese Phase erfüllt?"* und entscheidet auf dieser Basis über Lauf, STOP oder Skip. Die Reihenfolge ergibt sich aus zwei Achsen:

1. **Vorhandene Dokumentstruktur** — welche Funktionstyp-Container existieren laut FUNKTIONSTYP_ZUWEISEN (Phase 1).
2. **Bedingungsgefüge** — welche Konstrukte sind als Vorbedingung deklariert.

### Drei Phasen-Verhalten

| Verhalten | Auslöser |
|---|---|
| **RUN** | Funktionstyp-Container im Dokument vorhanden, alle harten Vorbedingungen erfüllt |
| **STOP** | Funktionstyp-Container vorhanden, aber harte Vorbedingung nicht erfüllt → Run-State `failed` mit Diagnose-Konstrukt; User-Eingriff erforderlich |
| **SKIP** | Funktionstyp-Container im Dokument nicht vorhanden (z.B. Werk hat kein eigenes FORSCHUNGSDESIGN-Kapitel mit Marker) → Run-State `skipped`, Diagnose im Status |

`SKIP` ≠ `STOP`: SKIP ist legitime strukturelle Abwesenheit, STOP ist defekter Bezugsrahmen.

### Vorbedingungs-Tabelle

| Phase | Harte Vorbedingung | STOP-Diagnose-Hinweis |
|---|---|---|
| h3_exposition | — (Wurzel) | — |
| h3_grundlagentheorie | FRAGESTELLUNG | "GRUNDLAGENTHEORIE braucht FRAGESTELLUNG als Bezugspunkt für DISKURSIV_BEZUG_PRÜFEN" |
| h3_forschungsdesign | FRAGESTELLUNG; FORSCHUNGSGEGENSTAND | "Methodische Angemessenheit braucht spezifizierten FORSCHUNGSGEGENSTAND als Maßstab — ohne ihn nur grob gegen FRAGESTELLUNG-Charakterisierung haltbar (= keine Analyse)" |
| h3_durchfuehrung | METHODEN, FORSCHUNGSGEGENSTAND | "DURCHFÜHRUNGs-Beurteilung braucht METHODEN (Verfahrens-Maßstab) und FORSCHUNGSGEGENSTAND (Ziel-Maßstab)" |
| h3_synthese | FRAGESTELLUNG, ERKENNTNISSE | "Systematisierungsleistung braucht ERKENNTNIS-Material und FRAGESTELLUNG als Aggregations-Bezugspunkt" |
| h3_schlussreflexion | GESAMTERGEBNIS | "Geltungsanspruch-Legitimität braucht GESAMTERGEBNIS als Bewertungsbasis" — fehlender SCHLUSSREFLEXION-Container im Outline ist KEIN STOP (Recovery, siehe Abschnitt unten) |
| h3_exkurs | dokument-vorgängige Konstrukte je EXKURS-Container-Position (KERNBEGRIFFE bei EXKURS in GRUNDLAGENTHEORIE; ERKENNTNISSE bei EXKURS in DURCHFÜHRUNG) | per Container: kein Anker am Dokument-Ort → Container-Eintrag im Status als "abwesender Befund" (kein STOP, weil EXKURS-Beitrag ohne Anker keine Beurteilungsbasis hätte) |
| h3_werk_deskription | Outline + Top-Level-Heading vorhanden | STOP wenn keine ladbare Outline / kein Top-Level-Heading |
| h3_werk_gutacht | WERK_BESCHREIBUNG + FRAGESTELLUNG | STOP wenn eines fehlt — WERK_DESKRIPTION-Phase und EXPOSITION-Phase müssen vorab gelaufen sein |

### User-Eingriff bei STOP — heute vs. später

**Heute** (User-Interaktions-UI noch nicht implementiert):
- STOP setzt Phase auf `failed` mit Diagnose
- Run kommt zum Halt
- User muss manuell intervenieren (z.B. fehlenden Funktionstyp-Container am Outline nachpflegen, dann Re-Run)

**Vorgemerkt für UI-Phase**:
- STOP triggert User-Eingriff-Dialog im Pipeline-Run-UI: zeigt fehlende Vorbedingung, bietet Aktionen (Funktionstyp-Re-Assignment, Vor-Phase-Re-Run, Phase überspringen mit Begründung).
- Diese UI-Erweiterung ist **nicht in dieser Spec**, gehört zur "Interface-Implementation"-Phase.

### Konsequenz für FORSCHUNGSDESIGN-Heuristik (Bereinigung)

Die existierende `forschungsdesign.ts`-Heuristik mit ihrem "FORSCHUNGSGEGENSTAND optional, mahne LLM zur Zurückhaltung"-Pattern wird **vor** dem Orchestrator-Anschluss bereinigt: Vorbedingungs-Check entfällt aus der Heuristik (zieht in den Orchestrator), Prompt verliert die "kann fehlen"-Klausel und nimmt FORSCHUNGSGEGENSTAND als Invariante an. Bis zum Orchestrator-Anschluss läuft sie weiterhin per CLI-Skript — dort wird der Vorbedingungs-Check vom Skript erzwungen (heute fehlende Vorbedingung → Skript-Abbruch, kein LLM-Call).

### WERK_DESKRIPTION + WERK_GUTACHT (User-Setzung 2026-05-04, Mig 050)

**WERK_DESKRIPTION** (immer aktiv nach allen Kapitel-Heuristiken): aggregiert alle persistierten Funktionstyp-Konstrukte des Werks zu einer deskriptiv-neutralen Inhaltszusammenfassung (`construct_kind='WERK_BESCHREIBUNG'`). 1 LLM-Call mit Outline + Konstrukten + optional `memo_content` (chapter/subchapter, wenn ein H1- oder H2-Run zuvor lief — Inputs Option B). Anchor: alle nicht-excluded Top-Level-Heading-IDs.

**WERK_GUTACHT-a** (Werk-im-Lichte-der-Fragestellung): längerer Absatz, indikator-getrieben (gelb/rot), KEIN Verdikt. Liest WERK_BESCHREIBUNG + FRAGESTELLUNG + Konstrukte.

**WERK_GUTACHT-b** (Hotspot-Würdigung): pro Achse aus dem Assessment-Achsen-Raster (FRAGESTELLUNG-Qualität, GRUNDLAGENTHEORIE-Fundiertheit, FORSCHUNGSDESIGN-Angemessenheit, DURCHFUEHRUNG-Qualität, SYNTHESE-Systematisierungsleistung, SCHLUSSREFLEXION-Legitimiertheit) ein Indikator `'yellow' | 'red' | null` plus 1–3-Sätze-Rationale. Strukturierend nicht erschöpfend — `null` ist legitim für unauffällige oder nicht-anwendbare Achsen. Grün gibt es bewusst nicht (Pauschal-Bestätigung wäre Critical-Friend-Verstoß).

**WERK_GUTACHT-c** (Fazit aus a+b): heute mit **deaktiviertem Gating** für Testung implementiert (`content.gatingDisabled=true` markiert das transparent). Im Vollausbau ist c gated durch `case.review_draft_document_id`-Upload, mit anschließendem dialogischem Block d/e/f (Blind-Position, Differenz, Reflexive Position) — diese sind weiterhin deferred und kommen mit der Reviewer-Notes-Integration.

Persistenz: ein Konstrukt mit `outline_function_type='WERK_GUTACHT'`, `construct_kind='WERK_GUTACHT'`, `content = {aText, bAxes, cText, gatingDisabled, gatingNote, ...}`. Anchor: gleicher Heading-Set wie WERK_BESCHREIBUNG.

Alle drei WERK_GUTACHT-Stages sind in 3 separaten LLM-Calls (a, dann b, dann c mit a/b als Input). Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`.

### Konsequenz für SCHLUSSREFLEXION-Heuristik (User-Setzung 2026-05-04)

Ohne dedizierten SCHLUSSREFLEXION-Container im Outline läuft die Heuristik nicht in einen STOP, sondern eine Recovery — Annahme aus der Werk-Praxis: in BAs/Habils mit Fazit-Kapitel verschmilzt SR mit SYNTHESE im Schlussbereich.

1. Letztes Top-Level-Kapitel des Werks identifizieren (letztes Heading mit `effectiveLevel === 1`, nicht excluded).
2. **Default-Material:** letztes Drittel der ¶ (`Math.max(1, Math.ceil(n/3))`) → LLM-Aufruf mit erweitertem Output-Schema (`needsMoreContext: boolean`).
3. **Eskalation bei `needsMoreContext=true`:** zweiter LLM-Aufruf mit erweitertem Material — letztes Unterkapitel (falls vorhanden) bzw. ganzes Kapitel.
4. **Defizit-Befund** ("Werk reflektiert keine Geltung/Grenzen explizit") ist legitimes Resultat und wird als reguläres SR-Konstrukt persistiert; fließt in WERK_GUTACHT ein, statt den Run technisch fehlschlagen zu lassen.

`recoveryStage ∈ {'none', 'last-third', 'last-subchapter', 'last-chapter'}` ist Teil von `function_constructs.content`; UI markiert Recovery-Stand transparent (Critical-Friend-Identität — der Reviewer muss erkennen können, dass es kein dedizierter SR-Container war).

Echter `PreconditionFailedError` nur bei strukturell unvollständigem Werk: kein Top-Level-Kapitel ODER Top-Level-Kapitel ohne Folgeabsätze (typischerweise: nicht-konfirmierte Outline).

---

## #3 — Idempotenz-Politik

### Stand heute (uneinheitlich)

| Heuristik | Verhalten | Risiko |
|---|---|---|
| EXPOSITION | keine Idempotenz; Re-Run dupliziert | [Status Z.217](h3_implementation_status.md): heute durch Glück kein Datenverlust |
| GRUNDLAGENTHEORIE | keine Idempotenz | dito |
| FORSCHUNGSDESIGN | clean-vor-insert (DELETE alte Konstrukte + virtual_container) | überschreibt validierte Stände ungefragt |

### Optionen

**(a) Strikt clean-vor-insert pro Phase** (FORSCHUNGSDESIGN-Pattern global).

**(b) Skip-on-existing** (wenn Konstrukte existieren, Phase überspringen).

**(c) User-Schutz + clean-vor-insert.** Wenn validierter Stand existiert, Phase übersprungen; sonst clean-vor-insert.

### Empfehlung: (c)

[Status Z.127](h3_implementation_status.md) hatte das bereits als offenen Punkt: "Idempotenz mit Schutz vor Überschreiben validierter Stände". (c) formalisiert das.

**Sub-Entscheidung — Validierungs-Marker-Mechanismus:**

- **(c1) Spalte `function_constructs.validated_at`** (NULL-able). Einfach, additiv. Spannung zu Memory `feedback_constructs_are_extracts_not_telemetry.md` ("Konstrukte sind Extrakte, nicht Klassifikator-Telemetrie") — `validated_at` ist Curation-Metadaten, nicht Klassifikator-Output, aber an der Grenze.

- **(c2) Separate Tabelle `construct_validations(construct_id, validated_at, validated_by, note)`**. Trennt Substanz und Curation strikt. Mehr Migration, sauberer Datenmodell.

User-Setzung erforderlich. Bis UI für Validierung existiert: Marker manuell via SQL gesetzt.

---

## #4 — Container-Iteration innerhalb einer Heuristik

### Stand heute

- GTH iteriert Container intern sequenziell (mehrere Container pro Werk möglich, Habil: 2)
- FORSCHUNGSDESIGN hat einen virtual_container pro Werk
- EXPOSITION hat einen Container pro Werk
- FORSCHUNGSGEGENSTAND ist werk-aggregiert, kein Container-Iterate

### Optionen

**(a) Container-Iteration intern in der Heuristik.** Orchestrator ruft Heuristik einmal auf; Heuristik iteriert ihre Container selbst. Kein Pause-Punkt zwischen Containern.

**(b) Container als Sub-Sub-Phase.** Pause-Punkt zwischen Containern; SSE zeigt Container-Fortschritt.

### Empfehlung: (a)

- Heutige Heuristiken sind so gebaut.
- Container-Anzahl klein (1-3 typisch).
- Pause-Granularität auf Heuristik-Ebene reicht.

---

## #5 — Crash-Resume / partielle Outputs

### Mig-038-Pattern (existing)

`pipeline_runs` führt Phase-Status `pending`/`running`/`completed`/`failed`. Resume liest Status, springt zur nächsten `pending`-Phase. Cancel via `cancel_requested`.

### H3-Adaption

**Identisches Pattern.** H3-Phasen werden in den existierenden Phase-Status-Mechanismus eingetragen. Pro Phase:

1. Idempotenz-Check (#3): wenn validiert → Phase auf `completed` ohne LLM-Call.
2. Konstrukte schreiben (clean-vor-insert).
3. Phase auf `completed`.
4. Bei Crash → Phase bleibt `running`/`failed`. Resume = Phase neu starten (clean-vor-insert sorgt für Konsistenz).

**Kein eigener H3-Run-State.** H3 erbt von Mig 038.

Sub-Punkt: nach Phase-Abschluss SSE-Event mit Konstrukt-Counts (siehe #6) emittieren.

---

## #6 — SSE-Status-Granularität

### Stand heute

[`pipeline-status/+server.ts:201-218`](../src/routes/api/pipeline-status/+server.ts) zählt `argument_nodes` (AG-Done) und `memo_content`-Counts (H2-Done).

### H3-Done-Checks (pro Phase)

Vorschlag — Done-Check gegen `function_constructs` mit passendem `outline_function_type` und Mindest-Konstrukt-Set:

| Phase | Done wenn folgendes Konstrukt existiert |
|---|---|
| h3_exposition | FRAGESTELLUNG (MOTIVATION + FRAGESTELLUNG_BEURTEILUNG optional) |
| h3_grundlagentheorie | FORSCHUNGSGEGENSTAND (werk-aggregierte End-Synthese) |
| h3_forschungsdesign | METHODOLOGIE oder METHODEN oder BASIS (mind. eines) |
| h3_durchfuehrung | (TBD — Konstrukt-Set folgt aus Heuristik-Implementation) |
| h3_synthese | GESAMTERGEBNIS |
| h3_schlussreflexion | GELTUNGSANSPRUCH |
| h3_exkurs | mindestens ein RE_SPEC_AKT pro EXKURS-Container, oder Leer-Befund (kein Konstrukt persistiert, Container-Eintrag im Status als "abwesender Befund") |
| h3_werk_deskription | WERK_BESCHREIBUNG |
| h3_werk_gutacht | GUTACHT_HINWEISE |

Status-Counts pro Phase: alle Konstrukte mit zugehörigem `outline_function_type`, gruppiert nach `construct_kind`.

---

## Brief-Verkabelung — bewusst nicht in dieser Iteration

H3-Heuristiken brauchen ggf. Brief-Konfiguration (Modell-Override, Prompt-Varianten, GTH-Schwellen `minClusterLen`/`minCitationGapLen`). **Nicht in dieser Spec** — H3-Defaults aus den heutigen CLI-Skripten übernehmen, Brief-Steuerung folgt später, wenn Falltyp-System (Stufe 3 der UI-Roadmap) das Routing übernimmt (Memory `feedback_features_before_interface.md`).

H3-Phasen werden initial mit hartcodierten Defaults aufgerufen. Brief-Feldzuordnung kommt in einer eigenen Phase, wenn das UI dafür existiert.

---

## Falltyp-Routing — wie sich die H3-Phasen-Sequenz aktiviert

Die H3-Phasen-Sequenz dieser Spec gilt für `qualification_review` (BA/MA/Diss). Andere Falltypen aktivieren H3 **nicht oder nur partiell**:

| Falltyp | H3-Aktivierung | H1/H2-Aktivierung |
|---|---|---|
| `qualification_review` | **volle H3-Phasen-Sequenz** (diese Spec) | optional, falls Brief das setzt |
| `peer_review` | **kein H3** | H2 auf Abstract + H1 auf Rest des Beitrags (Memory `project_three_heuristics_architecture.md`) |
| `cumulative_dissertation_review` (default) | Hybrid mit Kollegialitäts-Respekt: H3 voll auf Rahmentext; pro Artikel nur reduziert | je nach Konfiguration |

Falltyp-Routing greift erst, wenn Falltyp-System (Memory `project_falltyp_architecture.md`, Stufe 3 der UI-Roadmap) am Case persistiert ist. **Diese Spec adressiert nur das H3-Sequencing für `qualification_review`** — die anderen Falltypen brauchen ihre eigenen Routing-Entscheidungen, die nicht durch die H3-Phasen-Liste laufen.

Heute (vor Falltyp-System): Pipeline-Run wählt EINEN exklusiven Heuristik-Pfad pro Run. Brief-Flag `h3_enabled=true` → Default-Pfad ist H3; sonst H1. Body-Param `heuristic: 'h1'|'h2'|'h3'` überschreibt den Brief-Default. Wer mehrere Pfade auf demselben Werk anwenden will, triggert sequenziell mehrere Runs — automatische Verkettung gibt es nicht.

> **Korrektur 2026-05-04:** vor dieser Korrektur war im Code `include_h3: boolean` als additives Flag modelliert (H3 hängte an H1+H2 an). Das war falsch und führte zu einem fehlgeschlagenen E2E-Test, bei dem `include_h3: true` 109 H1-AG-Atome triggerte, bevor irgendeine H3-Phase laufen konnte. Korrigiert: `RunOptions.heuristic: 'h1'|'h2'|'h3'`, exklusive Pfad-Wahl. Brief-Spalte `h3_enabled` bleibt vorerst als Übergangs-Modellierung; Folge-Migration ersetzt sie durch eine explizite `heuristic`-Spalte.

---

## Reihenfolge der Implementation (Vorschlag)

1. **Migration**: H3-Phasen in `pipeline_runs` (oder analog) eintragen können; Validierungs-Marker-Mechanismus gemäß Sub-Entscheidung #3.
2. **`phasesForRun()`-Erweiterung** um die neun H3-Phasen, alle initial opt-in über einen einzelnen Brief-Flag `h3_enabled` (Default false; bestehende H1/H2-Runs unverändert).
3. **Pro Phase: Pass-Funktion** in einem neuen Modul `src/lib/server/pipeline/h3-phases.ts` (Cross-Typ-Konstrukt-Vorbedingungs-Validation, Idempotenz-Check, Aufruf der existierenden Heuristik, Konstrukt-Persistierung, Status-Update).
4. **Done-Check-Erweiterung** in `pipeline-status/+server.ts` um die neun H3-Phase-Counts.
5. **UI-Integration**: in dieser Iteration nicht geplant — neue Phasen erscheinen automatisch im existierenden Pipeline-Run-UI.

Regression-Check nach jedem Schritt: H1- und H2-Pfade auf Demo-Habilitation laufen unverändert.

---

## Entscheidungs-Stand (User 2026-05-04)

- [x] #1 Phasen-Granularität: (b) sub-phases — **angenommen**
- [x] #2 Reihenfolge-Erzwingung: HART, mit STOP-Verhalten und vorgemerktem User-Eingriff-UI — **gesetzt**
- [x] #3 Idempotenz: (c) User-Schutz + clean-vor-insert — **angenommen**
  - [ ] #3-Sub OFFEN: (c1) Spalte `function_constructs.validated_at` oder (c2) separate Tabelle `construct_validations`
- [x] #4 Container-Iteration: (a) intern in der Heuristik — **angenommen**
- [x] #5 Crash-Resume: Mig-038-Pattern adoptieren — **angenommen**
- [x] #6 Done-Check-Tabelle — **angenommen**
- [x] Reihenfolge der Implementation 1-5 — **angenommen**

**Nur ein offener Punkt** (#3-Sub) blockiert den Implementations-Start. Vorschlag: **(c2) separate Tabelle**, weil sauberer gegenüber Memory `feedback_constructs_are_extracts_not_telemetry.md` (Konstrukte = Extrakte, Curation getrennt). Falls (c1) bevorzugt: kurz Bescheid.
