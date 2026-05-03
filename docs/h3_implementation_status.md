# H3-Implementierungs-Status

Lebendes Status-Dokument der H3-Implementierung. Plan-Übersicht: [`h3_implementation_plan.md`](./h3_implementation_plan.md).

Letztes Update: 2026-05-03 (Phase-3-Beginn).

---

## Aktueller Stand

| Phase | Status |
|---|---|
| Phase 0 (Bestandsaufnahme) | ✓ |
| Phase 1 (Datenmodell + Vor-Heuristik FUNKTIONSTYP_ZUWEISEN) | ✓ |
| Phase 2 (UI-Reframing H1/H2/H3 als drei gleichrangige Optionen) | **verworfen** — siehe unten |
| Phase 3 (H3:EXPOSITION) | **begonnen** — FRAGESTELLUNG-Rekonstruktion implementiert + validiert |
| Phase 4+ | offen |

---

## Phase 1 ✓ (abgeschlossen, unverändert seit Commit 207c2a7)

Migrationen 043–047, Vor-Heuristik FUNKTIONSTYP_ZUWEISEN (`src/lib/server/pipeline/function-type-assignment.ts`), Outline-Page-UI um Funktionstyp-Setter, isomorphes Vokabular `src/lib/shared/h3-vocabulary.ts`. Test-Case "BA H3 dev" (`case_id=c42e2d8f-1771-43bb-97c8-f57d7d10530a`, `central_document_id=d1993e8a-f25b-479c-9526-d527215969c6`) hat Funktionstyp-Markierungen am Outline (Einleitung→EXPOSITION/KAPITEL etc.).

---

## Phase 2 — verworfen

Phase 2 wie in der vorigen Status-Doku spec'd (drei Heuristik-Karten H1/H2/H3 im Pipeline-Run-Setup, H3-Voraussetzungs-Gate in `phasesForRun()`, Brief-Default-Flag `include_synthetic_default`, Reader-H2-Spalte) ist als Konzept verworfen. Zwei strukturelle Gründe:

1. **Heuristik-Wahl ist falltyp-determiniert, nicht User-Toggle.** Memory `project_three_heuristics_architecture.md` (Falltyp-Konfiguration: qualification_review→H3 voll, peer_review→H1+ABSTRACT-als-EXPOSITION, cumulative→Hybrid mit Kollegialitäts-Respekt) und `project_falltyp_architecture.md` (Falltyp lebt am Case, Stufe-3-UI). Die Phase-2-Spec hat das Routing fälschlich als User-Wahl pro Run modelliert.

2. **UI-Reframing für nicht existierende Features ist verkehrte Reihenfolge.** Phase 2 wollte H3 als sichtbare dritte Spalte etablieren, obwohl noch keine H3-Heuristik existierte. Memory `feedback_features_before_interface.md` (neu in dieser Session): Substanz erst, Steuerungsinterface danach.

Was aus der Phase-2-Spec konkret wegfällt:
- Drei Heuristik-Karten als Run-Toggle
- Migration 048 für `include_synthetic_default`
- H3-Voraussetzungs-Gate in `phasesForRun()`
- Reader-H2-Spalte (separater Tab) — nur dann, wenn die Lese-Erfahrung das später wirklich erfordert
- Pipeline-Run-Setup-Reframing

Was bleibt als nebenläufige Pflege (nicht als Phase):
- Vokabular-Hygiene "Strategie → Heuristik" wo das in UI-Strings auftaucht.

---

## Phase 3 — begonnen: H3:EXPOSITION

Erste H3-Heuristik. Extrahiert aus dem EXPOSITION-Container (heading-hierarchisch über `outline_function_type='EXPOSITION'`) eines Werkes:
- **FRAGESTELLUNG**: rekonstruiert die *tatsächliche* Fragestellung der Arbeit (Problemfeld + Perspektive zusammengeführt; Methode/Motivation/Selbstdeklarations-Slop explizit ausgeschlossen). Persistiert als `function_constructs.construct_kind='FRAGESTELLUNG'`.
- **MOTIVATION**: fasst die Motivations-¶ (vor dem Fragestellungs-Cluster) in 1–3 Sätzen zusammen, falls vorhanden. Persistiert als `construct_kind='MOTIVATION'`.

### Architektur

`src/lib/server/ai/h3/exposition.ts` — drei Schritte:

1. **Parser** (deterministisch, regex-basiert, kein LLM): identifiziert rückwärts im Container den Cluster der ¶ mit Frage-Markern (Fragezeichen, "Forschungsfrage", "lautet:", "diese Arbeit untersucht/zeigt/fragt", "im Mittelpunkt steht", etc.). Alle ¶ vor diesem Cluster im selben Container = Motivation.
2. **LLM rekonstruiert FRAGESTELLUNG** aus den Cluster-¶. Prompt fordert *kritische* Re-Konstruktion: die selbstdeklarierte Frage der Autorin ist oft naive Wirkungsfrage / Slop und nicht zu reproduzieren; rekonstruiere die analytische De-Facto-Anlage (typisch: theoretische Folie als Bezugspunkt für ein Material).
3. **LLM fasst MOTIVATION** zusammen aus den Motivations-¶, falls vorhanden.

Fallback: wenn der Parser im Container nichts findet → ein einziger LLM-Call über den ganzen Container macht Identifikation + Rekonstruktion + Motivations-Zusammenfassung in einem Schwung.

Persistierung-Schema: `function_constructs.content = { text: <…> }`. Keine Klassifikator-Telemetrie (kein `status`, `rationale`, `probe_path`). Anker liegen in `anchor_element_ids`.

**Bewusst weggelassen** (kommt erst wenn nötig):
- Kein Eintrag in `pipeline_runs` — H3-Pipeline-Integration kommt erst, wenn mehrere H3-Heuristiken existieren UND Falltyp-System (Stufe 3 der UI-Roadmap) das Routing übernimmt.
- Kein Endpoint, keine Reader-UI für die neuen Konstrukte — Substanz erst.
- Keine Idempotenz / Skip-on-existing — Re-Run dupliziert, akzeptabel in der experimentellen Phase.

### Trigger

CLI: `npx tsx scripts/test-h3-exposition.ts <caseId>`. Kein UI, kein API-Endpoint.

### Validierung

Testlauf gegen "BA H3 dev" (`c42e2d8f-1771-43bb-97c8-f57d7d10530a`):
- Container: 2 paragraph-Elemente unter Heading "Einleitung"
- Parser-Treffer (kein LLM-Fallback)
- 1 LLM-Call · 2633 in / 324 out tokens · 4 sec · `openrouter/anthropic/claude-opus-4.7`
- Rekonstruierte FRAGESTELLUNG (vom User als korrekt bestätigt):
  > Im Zentrum steht die Frage, ob bzw. inwieweit die UNESCO-Bildungsprogramme der Global Citizenship Education (GCED) inhaltlich und bildungstheoretisch tragfähig sind, um globale Gegenwartsprobleme bildungsrelevant zu erschließen. Als Perspektive dient dabei Klafkis kritisch-konstruktive Didaktik mit der Theorie der epochaltypischen Schlüsselprobleme, die als bildungstheoretischer Maßstab an das GCED-Konzept angelegt wird. Zu klären ist damit, ob die GCED-Programme den von Klafki formulierten Ansprüchen an eine auf Mündigkeit, Emanzipation und Solidarität zielende Allgemeinbildung entsprechen oder konzeptionell nachgeschärft werden müssten.
- MOTIVATION: keines (Fragestellungs-¶ war erster im Container)

### Was offen ist (für Anschluss-Session)

1. **Qualitätsbeurteilung der Originalformulierung** — User-Anforderung am Session-Ende: das LLM soll zusätzlich die selbstdeklarierte Forschungsfrage der Autorin auf einer dreistufigen Skala (`tragfaehig` / `schwach` / `verfehlt`) bewerten plus knappe Begründung. Zweck: nachfolgende Module (WERK_GUTACHT, andere H3-Heuristiken) müssen Slop-Originalformulierungen erkennen können, sonst werden sie verwirrt. Persistierung im FRAGESTELLUNG-content (nicht als Klassifikator-Telemetrie, sondern als substanzielles Reviewer-Signal über die Quelle).
2. **Test gegen weitere Werke** — z.B. read-only Lauf gegen Habil-Timm (`161d41b4-…`) zum Vergleich. Benchmark-Cases NICHT modifizieren, nur runExpositionPass laufen lassen und Resultat anschauen.
3. **Nächste H3-Heuristik gemäss Phasen-Plan**: H3:GRUNDLAGENTHEORIE (siehe `h3_implementation_plan.md`).

---

## Handover für Anschluss-Session

**Pflicht-Lektüre vor irgendeiner Implementierung** (Memory-Pfad: `/Users/joerissen/.claude/projects/-Users-joerissen-ai-sarah/memory/`):

Substanzielle Setzungen:
- `project_three_heuristics_architecture.md` — Drei-Heuristiken-Modell, Falltyp-Konfiguration (DETERMINIERT, kein User-Toggle), H3-Heuristiken-Liste, Granularitäts-Defaults
- `project_falltyp_architecture.md` — Falltyp am Case, Stufe-3-Roadmap
- `project_fragestellung_definition.md` — Fragestellung = Problemfeld + Perspektive; tatsächliche vs. selbstdeklarierte Fragestellung; kritische Rekonstruktion statt naiver Reproduktion (NEU diese Session)
- `project_critical_friend_identity.md` — SARAH analysiert, beurteilt nicht autonom; gated-c

Verhaltens-Setzungen (besonders relevant nach den Verfehlungen dieser Session):
- `feedback_features_before_interface.md` — UI/Steuerungs-Diskussionen erst wenn Feature existiert (NEU diese Session)
- `feedback_constructs_are_extracts_not_telemetry.md` — `function_constructs.content` enthält nur Substanz, keine Lauf-Metadaten (NEU diese Session)
- `feedback_no_hidden_setq.md` — Multiple-Choice-Fragen nicht stellen, wenn die Setzung bereits ausgesprochen ist
- `feedback_vocab_heuristik_not_strategie.md` — "Heuristik", nicht "Strategie"
- `feedback_benchmark_cases_protected.md` — Test-Case ist `c42e2d8f-…` ("BA H3 dev"), NICHT die Benchmark-Cases

### Diese Fehler dürfen NICHT wiederholt werden

Die folgenden Fehler haben in dieser Session zusammen ca. 250k Tokens und mehrere Stunden des Users gekostet:

1. **Multi-Choice-Fragen stellen, wenn die Antwort längst in Memory steht.** Mehrfach passiert (Phase-2-A/B/C, Container-Auflösung, 4-Punkte-Skizze, Modellwahl). Korrektur: lesen, dann tun. Wenn etwas in Memory präzise gesetzt ist, wird nicht gefragt — höchstens umgesetzt.
2. **Heuristik-Routing als User-Toggle modellieren.** Memory ist eindeutig: Falltyp determiniert. Toggle-UI ist falsch konzipiert.
3. **UI bauen für Features die nicht existieren** (Phase-2-Spec im Ganzen). Substanz zuerst.
4. **Konstrukt-Schema mit Klassifikator-Telemetrie aufblähen** (`status`, `rationale`, `probe_path`, Anker-Duplikat). `content` enthält die extrahierte Substanz, sonst nichts.
5. **Reifizierte "kein-Befund"-Marker erfinden** (z.B. `thema_verfehlt`-Status). Wenn die Heuristik nichts findet → kein Konstrukt persistieren. Spätere WERK_GUTACHT konsumiert die Abwesenheit als Befund.
6. **LLM-Probe pro ¶, wo ein deterministischer Regex-Parser reicht.** Pyramide billig→teuer (Memory `project_three_heuristics_architecture.md`).
7. **Naive Reproduktion einer selbstdeklarierten Forschungsfrage.** "Inwiefern fördert X das Y" ist meist Slop, nicht die echte Fragestellung. Aufgabe ist KRITISCHE REKONSTRUKTION (Memory `project_fragestellung_definition.md`).
8. **Mehrfach redundante Bestandsaufnahmen.** Maximal eine Codebase-Sondierung pro Aufgabe.
9. **Konzeptuelle Begriffe naiv-alltagssprachlich verstehen** ("Fragestellung" ≠ grammatische Frage). Bei Methodenbegriffen ggf. recherchieren oder fragen, **vor** der Implementation, nicht nach drei Iterationen.
10. **Loscoden, bevor das Problem verstanden ist.** In dieser Session wurde H3:EXPOSITION drei Mal refactoriert, weil zentrale Domänenbegriffe (Konstrukt, Fragestellung, Heuristik-Routing) bei der ersten Implementierung nicht verstanden waren. Reihenfolge: erst Memory + Methodologie-Begriffe klären, dann skizzieren, dann coden — nicht umgekehrt.

### Konkrete nächste Schritte

In dieser Reihenfolge:

1. Qualitätsbeurteilung der Originalformulierung in `src/lib/server/ai/h3/exposition.ts` einbauen — Schema (`RekonstruktionSchema` + `FallbackSchema`) erweitern um `qualitaet: { rating: 'tragfaehig'|'schwach'|'verfehlt', begruendung: string }`, System-Prompt entsprechend ergänzen, im content der FRAGESTELLUNG-Persistenz mitführen. Re-Run gegen BA H3 dev, prüfen.
2. Read-only Vergleichsläufe gegen weitere Werke (Habil-Timm) zum Robustheits-Check.
3. H3:GRUNDLAGENTHEORIE als nächste H3-Heuristik gemäss `h3_implementation_plan.md`.

---

## Backward-Compat-Klausel

Unverändert gegenüber Phase 1:
- Datenbasis bleibt gemeinsam (argument_nodes, memo_content, function_constructs).
- H1/H2-Pfade unverändert; H3 ist additiv.
- Sichtbares H1/H2-Verhalten auf existing Cases ohne H3-Setzungen identisch.

---

## Backward-Compat-Risiken

(unverändert übernommen aus voriger Status-Doku — gilt weiter)

| Risiko | Files | Mitigation |
|---|---|---|
| Outline-Hierarchie umstrukturiert → AG-Listung bricht | `orchestrator.ts:301, 440` | Nur additive Spalten, NULL-Default |
| memo_content-Scope geändert → Done-Checks brechen | `orchestrator.ts:379–427`, `pipeline-status/+server.ts:150–167` | Neue Scopes nur für H3-Konstrukte, alt unverändert |
| argument_nodes-Schema gebrochen → Status-Counts brechen | `pipeline-status/+server.ts:201–218` | Schema einfrieren; H3-Konstrukte in eigener Tabelle |
| Brief-Default-Inversion → Pipeline-Logik bricht | `orchestrator.ts:563`, `/run/+server.ts:99–104` | Neue Flags Default false |
| Pass-Signature gebrochen → executeStep bricht | `orchestrator.ts:482–559` | H3 als neue Phase mit eigener Pass-Funktion, alte Signaturen unverändert |
| Run-State bricht Resume | `orchestrator.ts`, `/run/+server.ts` | Migrationen mit Backward-Compat-Reads (COALESCE) |
