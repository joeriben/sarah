# Ticket — Hermeneutischer Zirkel: Bottom-Up-Halbiteration nach Paragraph-Retrograde

**Status**: open
**Erstellt**: 2026-05-06
**Priorität**: hoch (architektonisches Versprechen wird derzeit nicht eingelöst)

## Framing — was es ist

Hermeneutischer Zirkel im Sinne Schleiermachers/Gadamers: Verstehen
bewegt sich zwischen Teil und Ganzem. Die User-Setzung bei der
Identifikation:

> „Nun wo ich weiß worum es geht — Fragestellung — und worauf es
> hinausläuft — Forschungsdesign, Durchführung — und wo mögliche
> Probleme liegen, kann ich jeden Abschnitt/Absatz daraufhin noch einmal
> lesen und meine damalige Perspektive auf den Absatz revidieren."

Was bisher als „FFN/Backprop-style retrograde pass" gelabelt war (Commit
`0df5234`, Memory `project_argumentations_graph_experiment.md`), ist
korrekt benannt: hermeneutischer Zirkel. Backprop ist bidirektional pro
Iteration; unser bisheriger Pass ist es nicht. Die Sprach-Korrektur ist
Teil dieses Tickets (siehe Sub-Task A).

## Problem

Die aktuelle Retrograde-Strecke implementiert nur **die halbe Bewegung
des Zirkels** — die Bewegung vom Ganzen zurück in den Teil. Die
Gegenbewegung — vom revidierten Teil zurück ins revidierte Ganze —
fehlt.

```
Forward (Teil → Ganzes):
  ¶ → Subkap → Hauptkap → W

Top-Down-Retrograde (Ganzes → Teil)  ← haben wir
  W → Hauptkap-Retro → Subkap-Retro → ¶-Retro

Bottom-Up-Retrograde (revidierter Teil → revidiertes Ganzes)  ← FEHLT
  ¶-Retro → Subkap-Retro-v2 → Hauptkap-Retro-v2 → W-v2
```

Konkret: wenn die Paragraph-Retrogrades unter Werk-Licht entdecken, dass
„§47 der eigentliche Pivot ist, nicht §15", gibt es derzeit keinen Pfad,
das in die Hauptkap-Diagnose oder W zu revidieren. Die Hauptkap-Diagnose
ist eingefroren, bevor die Paragraph-Retros überhaupt starten — das ¶-Retro
ist Konsumentin, nicht Mitschreiberin der Werk-Lesart. Damit verfehlt
die Architektur den Zirkel-Anspruch.

## Sub-Tasks

### A. Sprach-Korrektur (klein, sofort möglich)

- Code-Kommentare in den drei Retrograde-Modulen
  (`chapter-collapse-retrograde.ts`, `section-collapse-retrograde.ts`,
  `paragraph-retrograde.ts`) und im Orchestrator: „FFN-Backprop-style"
  → „hermeneutischer Zirkel, Top-Down-Halbiteration".
- Memory-Eintrag `project_argumentations_graph_experiment.md`
  entsprechend updaten.
- Architektur-Doku `docs/architecture/04-pipeline-h1-h2.md` falls
  betroffen.

### B. Bottom-Up-Halbiteration (Hauptarbeit)

Drei zusätzliche Phasen NACH `paragraph_retrograde`:

1. `subchapter_collapse_retrograde_bottomup` — synthetisiert das
   Subkapitel aus den Paragraph-Retrogrades neu, mit dem Hauptkapitel-
   Top-Down-Retro als Kontext. Anders als der Top-Down-Subkap-Retro
   (der das Hauptkapitel absorbiert) absorbiert er die ¶-Retros.
2. `chapter_collapse_retrograde_bottomup` — Hauptkapitel aus Subkap-v2
   + W-Top-Down als Kontext.
3. `document_collapse_retrograde_bottomup` — W-v2 aus den Hauptkap-v2.

**Idempotenz-Tags** (kollisionsfrei zu den bestehenden):
- `[kontextualisierend/subchapter/synthetic-retrograde-bottomup]`
- `[kontextualisierend/chapter/synthetic-retrograde-bottomup]`
- `[kontextualisierend/work/synthetic-retrograde-bottomup]`

**Speichermodell**: parallel zu den Top-Down-Retrogrades, NICHT als
Überschreibung. Damit hat der Reader pro Hauptkapitel drei Lesarten
nebeneinander:
- Forward (initiale Lektüre, kumulativ-sequenziell aufgebaut)
- Top-Down-Retrograde (Werk-Licht auf das Kapitel)
- Bottom-Up-Retrograde (revidiertes Werk-Licht aus den ¶-Retros)

### C. Diktion in den Bottom-Up-Prompts

Aufgaben-Sprache muss klar zwischen Top-Down und Bottom-Up trennen:

- Top-Down-Retro (existiert): „lies das Kapitel im Licht des
  Werk-Ergebnisses neu — was verschiebt, bestätigt, korrigiert sich?"
- Bottom-Up-Retro (neu): „die Paragraphen sind in zweiter Lektüre
  bereits revidiert. Lies das Kapitel jetzt aus den revidierten
  Paragraphen heraus neu — wo verschiebt das die Werk-Architektur-
  Diagnose, die du im Top-Down-Pass gegeben hast?"

Wichtig: Bottom-Up darf NICHT bloß den Top-Down wiederholen. Wenn die
revidierten Paragraphen die Top-Down-Diagnose unverändert tragen, wird
das knapp markiert; nur wo sie sie verschieben, wird neu geschrieben.
(Analoges Anti-Wiederhol-Pattern wie im Top-Down-Prompt.)

## Acceptance

- [ ] Drei Memo-Lesarten pro Hauptkapitel sichtbar im Reader: Forward,
  Top-Down-Retro, Bottom-Up-Retro.
- [ ] Bottom-Up greift nachweislich die Paragraph-Retro-Inhalte ab
  (Spot-Check: zwei Paragraph-Retros mit divergenten Befunden gegenüber
  dem Forward → muss in Subkap-v2/Hauptkap-v2/W-v2 sichtbar werden).
- [ ] Sprach-Korrektur in Code+Memory+Doku abgeschlossen — kein
  „FFN/Backprop" mehr im laufenden Repo.
- [ ] Opt-in-Flag wie bei `retrograde_pass`; Default bleibt aus, bis
  Spot-Check auf BA + Habil bestanden.

## Offene Designfragen / Risiken

Die Bottom-Up-Halbiteration ist eine **nicht-validierte Hypothese**. Vor
Implementation klären:

1. **Granularitäts-Frage** (User-Hinweis 2026-05-06): startet der
   Bottom-Up-Pass auf **Paragraph-** oder auf **Subkapitel-Ebene**?
   - Variante A (Paragraph-up): die ¶-Retros sind die Quelle der
     Revision; vier Aggregations-Schichten werden neu gebaut
     (¶-Retro → Subkap-v2 → Kap-v2 → W-v2). Maximale Granularität,
     aber teuer und potenziell zu rauschig — 69 ¶-Retros werden auf
     3 Subkap-Memos aggregiert, viel Information geht ohnehin verloren.
   - Variante B (Subkap-up): die Subkap-Retros (Top-Down-Pass) sind
     die Quelle; nur zwei Schichten werden neu gebaut
     (Subkap-Retro → Kap-v2 → W-v2). Weniger Granularität, aber näher
     am Naturalismus des Zirkels: das Verständnis revidiert sich auf
     Sinneinheiten-Niveau, nicht pro Satz.
   - Variante C (Kap-up, fast trivial): nur W wird aus den
     Hauptkap-Top-Down-Retros neu gebaut. Kostengünstigster Test, ob
     die Idee überhaupt zieht.

   Empfehlung: vor Implementation an einem Test-Case probieren —
   ¶-Retros vs. Subkap-Retros lesen und vergleichen, welche Ebene
   substanzielle, nicht-redundante Verschiebungen produziert. Die
   billigere Variante C/B zuerst testen; Variante A nur wenn nachweislich
   ¶-spezifische Befunde verloren gehen.

2. **Funktioniert es überhaupt?** (User-Hinweis 2026-05-06: „vielleicht
   einfach eine nicht funktionierende idee"). Die Operation ist
   plausibel hermeneutisch begründet, aber das ist kein Garant für
   substanzielle LLM-Outputs. Mögliche Misserfolgs-Modi:
   - Bottom-Up-v2 produziert nur stilistische Varianten der Top-Down-
     Memos ohne neue Substanz (LLM neigt zur Diktions-Konsistenz).
   - Bottom-Up-v2 weicht so stark vom Top-Down ab, dass Reviewer
     ratlos vor drei widersprüchlichen Lesarten steht (Verlust von
     Klarheit statt Gewinn).
   - Die Aggregation der Paragraph-Retros zu Subkap-v2 verliert
     dieselbe Information wie der Forward-Pass — der Bottom-Up wird
     dann zu einer teuren Wiederholung des Forward.

   **Validierungs-Plan vor Default-Aktivierung**: ein Test-Case mit
   bekanntem Befund-Profil, drei Lesarten nebeneinander prüfen. Wenn
   Bottom-Up-v2 keinen identifizierbaren Mehrwert gegen Top-Down zeigt,
   wird das Feature nicht ausgerollt — Idee abgehakt, kein Sunk-Cost-
   Verteidigen.

3. **Reader-UI-Last**: drei Memos pro Hauptkapitel überfordern den
   Reviewer möglicherweise. Falls Bottom-Up-v2 wenig Mehrwert hat,
   könnte das Top-Down-Memo wegfallen und nur Bottom-Up-v2 als
   „endgültige Retrograde-Lesart" gezeigt werden — Architektur-
   Entscheidung, die nach dem Validierungs-Spot-Check getroffen wird.

## Out of Scope

- Echte iterative Konvergenz (Option 3 aus der Architektur-Diskussion):
  mehrere Bottom-Up-/Top-Down-Schwingungen bis zu einem Konvergenz-
  Kriterium. Definition von Konvergenz für Prosa-Memos ist offen,
  Aufwand vermutlich nicht im Verhältnis zum Gewinn — separat
  diskutieren, wenn die einzelne Bottom-Up-Halbiteration in der Praxis
  zu wenig leistet.
- Änderungen am Forward-Pass.
- Änderungen an H1 oder H3 (das Ticket ist H2-spezifisch; H3 hat einen
  eigenen Walk).

## Bezüge

- Memory `feedback_h2_is_cumulative_synthesis_not_thin.md`: H2 ist
  kumulativ-sequenzielle Synthese — der Bottom-Up-Pass ist die
  natürliche Schließung des Zirkels, der im Forward begonnen wurde.
- Memory `project_pipeline_run_orchestrator.md`: das Master-Run-UI
  zeigt Pause/Resume; die zusätzlichen Phasen müssen sich in das
  bestehende Phasen-Listing einfügen.
- Memory `project_argumentations_graph_experiment.md`: enthält die
  alte „FFN/Backprop"-Sprache, die in Sub-Task A korrigiert wird.
- Heutiger Befund (2026-05-06): die Werk-Diagnose im Top-Down-Pass
  kann durch Plattform-Artefakte (z.B. fehlende Heading-Numerierung)
  kontaminiert sein. Das Bottom-Up-Halbiterations-Ergebnis wird
  schärfer, weil es solche Artefakte gegen die textbasierten
  Paragraph-Retros prüft — Substrate-Hygiene-Ticket separat.
