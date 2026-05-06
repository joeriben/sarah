# 10 — Pipeline H4 (selbstkorrigierende Heuristik)

**Stand: 2026-05-06** · Status: Phase A (Fundament) komplett, Phase B (Schleifen-Mechanik) im Bau.

H4 ist eine **eigenständige vierte Heuristik** parallel zu H1/H2/H3 — exklusiv pro Run wie die anderen drei (`options.heuristic = 'h4'`). Die bisherige Drei-Heuristiken-Matrix (siehe Memory `project_three_heuristics_architecture`) erweitert sich damit zur Vier-Heuristiken-Matrix:

| Heuristik | Charakter |
|-----------|-----------|
| H1 | argumentationsanalytisch |
| H2 | hermeneutisch-synthetisierend |
| H3 | adaptiv (funktionstyp-routend, linearer Walk) |
| **H4** | **selbstkorrigierend** |

H4 ruft H1- und H2-Pass-Funktionen **per Verweis** auf — nicht als Parallelstruktur. Verbesserungen an H1/H2 ziehen automatisch in H4 nach. Dual-coding wird vermieden.

H4 endet auf **¶-Ebene** — keine eigene Subkapitel-/Kapitel-/Werk-Aggregation. „Selbstkorrigierend" heißt: jede ¶-Einheit wird intern (zwischen den H1- und H2-Tools) so weit verhandelt, wie es das Substrat erlaubt; jede nachgelagerte Aggregation (egal ob durch eine H1-Aggregations-Strecke, eine H2-Aggregations-Strecke oder die Meta-Synthese) liest den korrigierten Substrat-Stand automatisch aus den DB-Tabellen.

---

## 1. Dreifache Motivation

H4 löst nicht ein Problem, sondern hebt drei orthogonale Hebel gleichzeitig:

1. **H1-Korrektur am Entstehungsort.** Eine in H1 ungenaue Argumenteinstufung (z.B. fälschliches `referential_grounding=namedropping` für eine substanziell verortete Autor-Erwähnung) wird normalerweise durch alle H1-Aggregations-Schichten propagiert und ist erst auf Werk-Ebene als Differenz zur H2-Linie sichtbar. H4 greift früher — am ¶, in dem die Einstufung entstand.
2. **H2 erreicht präzisere Ergebnisse durch korrigierten Substrat.** Da H4 mit fresh-H2 endet (nach abgeschlossener Klärung), lesen alle nachgeschalteten H2-Loader (Subkapitel-, Kapitel-, Werk-Synthese — falls jemand sie nach H4 laufen lässt) die revidierte Per-¶-Schicht.
3. **Punktuelle „Fachexpertise" via `simulated_expert`-Slot.** H2 darf in jeder Iteration konzentrierte Sachfragen an ein dediziertes LLM stellen (z.B. „Wurde Klafkis Allgemeinbildungs-Konzept 1985 in welchem Werk formuliert?"). Der Slot-Name ist bewusst ehrlich: das ist keine echte Fachexpertise, sondern eine LLM-Antwort — halluzinationsanfällig wie jede andere Modell-Antwort, mit den Vor-/Nachteilen des konfigurierten Modells.

H4 verhindert nicht alle Fehleinschätzungen — nur, dass Fehleinschätzungen unrevidiert nach oben durchgereicht werden, wenn die jeweils andere Linie (oder ein konzentrierter Sachfragen-Slot) die Information zur Revision hat.

---

## 2. Tools-per-Verweis (Architektur-Prinzip)

H4 importiert und ruft direkt:

- `runArgumentationGraphPass` (H1/1) — initialer per-¶ Argumentations-Graph + Re-Eval.
- `runArgumentValidityPass` (H1/2) — initiale Validity- + Grounding-Klassifikation + Re-Eval.
- `runParagraphPass` (H2/1) — initiales `[reflektierend]`-Memo + finales fresh-Memo.

Bei H1-Re-Eval wird die existierende Pass-Funktion **per-Argument-Aufruf** verwendet. Falls die Pass-Funktion derzeit nur ¶-granular ist, wird der einzeln-Argument-Modus als ergänzender Aufrufpfad in der Pass-Datei selbst hinzugefügt — nicht als parallele Datei in `hermeneutic/h4/`.

Konsequenz: H4-Code in `src/lib/server/pipeline/heuristics/h4/` ist *Orchestrator-Glue* (Trigger-Detektion, Loop-State, Persistenz) — keine Prompt-Module, keine Parser, kein Zweit-Stack der H1/H2-Logik.

---

## 3. Trigger

Pro ¶ wird die Schleife initiiert, wenn nach H1's `argumentation_graph` (+ `argument_validity`) und H2's `paragraph_synthetic` mindestens eine der drei Bedingungen auf den H1-Argumenten dieses ¶ wahr ist:

```
∃ argument: validity_assessment.carries == false                       (Cluster: validity_failure)
∨ ∃ argument: referential_grounding ∈ {namedropping, abstract}         (Cluster: namedropping | abstract)
∨ ∃ argument_edge mit kind='contradicts' im ¶                          (Cluster: contradiction)
```

Alle drei Bedingungen lesen existierende `argument_nodes`/`argument_edges`-Felder — kein neues Schema, keine zusätzliche Klassifikation.

---

## 4. Schleifen-Mechanik (asymmetrisch)

```
1. H1 läuft clean → argument_nodes
2. H2 läuft clean (linienrein) → ¶-Memo v1, mit Inscription-Tag [reflektierend/draft]
3. Trigger-Check auf H1
4. wenn fires:
   a. H2 formuliert Einwand (Free-Text, ggf. mit Mini-Stufe-3-Recherche, siehe §6)
   b. H1 reevaluiert (stateless, per-Argument) → ggf. revidierte argument_nodes + Begründung
   c. counter += 1
   d. Trigger-Check auf revidiertem H1:
      - nicht mehr fires → break (status=resolved)
      - fires und counter < 3 → zurück zu (a)
      - fires und counter == 3 → break (status=unresolved, Cap erreicht)
5. H2 läuft fresh (ohne Einwand-Memory) auf finalem H1 → ¶-Memo final mit Tag [reflektierend]
   (überschreibt v1 nicht physisch — siehe Inscription-Strategie §7)
```

**Iterations-Modell A** (Setzung): jede H2-Einwand-Formulierung zählt als eine Iteration, max 3. Die finale fresh-H2-Re-Run-Phase zählt nicht mit. Initial-H2-Run zählt nicht mit.

**Asymmetrie:** H1 ist *stateless* — kein Iterations-Zähler im Prompt, kein Memory der vorigen Iteration. Jeder Aufruf ist ein einmaliger Beurteilungsauftrag. H2 trägt die Iterations-History (siehe §5), kann eskalieren.

**Orchestrator hält den Loop-State**, nicht die Modelle.

---

## 5. H1-Prompt + H2-Einwand-Rolle

### 5.1 H1-Prompt (stateless, per-Argument)

```
Argument: "[claim-Text aus argument_nodes]"
Bisherige Einstufung: [referential_grounding=…, validity_assessment=…]
Andererseits: [Einwand-Text, von H2 formuliert, ggf. mit Recherche-Faktum]

Beurteile den Einwand und beziehe ihn ggf. in deine Prüfung ein.
Begründe deine Entscheidung in 1-2 Sätzen.
```

Output: revidierte (oder bestätigte) `argument_nodes`-Felder + `begruendung` (1-2 Sätze).

### 5.2 H2 in Einwand-Rolle (mit Vorgeschichte)

In Iteration `n` sieht H2:

- aktueller H1-Stand (ggf. revidiert in vorigen Iterationen)
- ¶-Text
- eigener Initial-Kommentar v1
- für jede frühere Iteration `k < n`: `einwand_k` + `H1.begruendung_k`

Damit ist Eskalation möglich: wenn H1 in Iteration 1 mit Begründung Y abgelehnt hat, kann Iteration 2 Y direkt adressieren — etwa durch Mini-Stufe-3-Recherche zur Untermauerung.

In der **finalen fresh-Rolle** sieht H2 nur das (ggf. revidierte) H1 + ¶-Text. Keine Einwand-Historie, kein v1-Memory. Schreibt fresh.

---

## 6. Mini-Stufe-3 (`simulated_expert` in der Schleife)

H2 darf in jeder Iteration den `simulated_expert`-Slot konsultieren:

- **Format:** Free-Text-Frage von H2, Suffix automatisch concatenated: `"Deine Antwort darf nicht länger als 1000 Tokens sein."`
- **Modell:** `resolveSlot('simulated_expert')` — Default Opus, EU-Alternative Sonnet@Mammouth, EU-nativ Mistral-Large.
- **Token-Budget:** `maxInputTokens` (Default 250) + `maxOutputTokens` (Default 1000).
- **Konzentriert:** das knappe Budget ist Teil des Werkzeug-Vertrags, nicht eine Sparmaßnahme.
- **Antwort fließt in den Einwand-Text ein**, nicht als separater Kanal an H1.

Mini-Stufe-3 ist H2-getriggert, nicht orchestrator-automatisch. H2 entscheidet, ob die Frage Modell-Wissen erfordert. Persistenz: `paragraph_einwand_iterations.simulated_expert_q/a` (paarweise NULL oder paarweise gesetzt, DB-Constraint).

---

## 7. Finale H2-Memo & Inscription-Strategie

H4 produziert pro ¶ zwei H2-Memo-Versionen, am selben `scope_element_id`:

- **v1** (Schritt 2 in §4) — initiales H2-Memo, geschrieben mit Tag `[reflektierend/draft]` (Sub-Tag, neu), während die Schleife läuft.
- **final** (Schritt 5 in §4) — finales fresh-H2-Memo, geschrieben mit Default-Tag `[reflektierend]`.

Konsequenz: jeder bestehende H2-Aggregations-Loader (`per-paragraph.ts`-Folge-Lookups, `section-collapse-synthetic.ts`, `chapter-collapse-synthetic.ts`) liest *automatisch* die finale Memo, weil er mit `LIKE '[reflektierend]%'` filtert — die `[reflektierend/draft]`-Memos sind über die Bracket-Boundary ausgeschlossen (gleiches Muster wie `[interpretierend]` vs. `[interpretierend-retrograde]`, siehe 04-pipeline-h1-h2.md §8.4).

Bei Run-Wiederaufnahme nach Abbruch: Idempotenz über das Tag-Suffix — `[reflektierend/draft]`-Memos werden bei Re-Run der Schleife überschrieben, `[reflektierend]`-Memos terminieren den ¶ definitiv.

---

## 8. LLM-Slots

Konfiguriert in `src/lib/server/ai/llm-slots.ts`, persistiert in `ai-settings.json` `slots`. Slots sind **orthogonal zu Tiers**: Tiers binden Pipeline-Phasen an Provider+Model (Token-Budget per-Call), Slots binden ein *Werkzeug* an Provider+Model+fixe Token-Budgets (das Budget ist Teil des Werkzeug-Vertrags).

| Slot | Zweck | Default |
|------|-------|---------|
| `simulated_expert` | Sachfragen-Slot in der H4-Schleife (§6) | claude-opus-4.7@OpenRouter, 250in/1000out |
| `fact_check` | Quellen-/Zitations-Verifikation (vorerst gleicher Default wie `simulated_expert`, später ggf. weiter differenziert) | claude-opus-4.7@OpenRouter |

UI-Ort: `/settings?tab=slots`. Resolver: `resolveSlot(slot)`. Begründung Default Opus: für deutsche Bildungsphilosophie-Sachfragen (Klafki, Humboldt, Litt, Bollnow, Mollenhauer, Benner) wahrscheinlich höhere Trainings-Korpus-Exposition als MiMo (chinesisch-STEM) oder Mistral (französisch-europäisch) — Plausibilitäts-Default, nicht gemessen.

---

## 9. Audit-Persistenz (Migration 053)

Tabelle `paragraph_einwand_iterations` — eine Zeile pro Iteration:

- `run_id`, `paragraph_element_id`, `iteration_n` (1-3) — UNIQUE.
- `trigger_clusters` JSONB — welche Cluster feuerten (`validity_failure | namedropping | abstract | contradiction`).
- `einwand_text`, `simulated_expert_q`/`a` (paarweise).
- `h1_revised_fields` JSONB — Snapshot der revidierten `argument_nodes`-Felder, keyed nach `argument_nodes.id`.
- `h1_begruendung` TEXT.
- `status` ∈ `pending | resolved | unresolved`.

Per-¶-Aggregat „letzter Status" = Status der höchsten `iteration_n`-Zeile pro (run, ¶). Keine eigene Aggregat-Tabelle.

Tief persistiert für Debugging und empirische Schleifen-Analyse: Konvergenz-Quoten, häufige Trigger-Cluster, Mini-Stufe-3-Hit-Rate, Stand-off-Pattern.

---

## 10. Phasen-Plan

| Phase | Inhalt | Status |
|-------|--------|--------|
| A | Fundament: §10-Doku, Mig 053, AiSettings.slots, llm-slots.ts, Settings-Tab | komplett (Commits `388bac2`, `d740518`) |
| B | Trigger-Detektor + Loop-Mechanik im Orchestrator + H1/H2-Caller-Adapter + ¶-Indikator | im Bau |
| C | Mini-Stufe-3-Caller in H2-Einwand-Formulation, Persistenz von Q/A in Mig 053 | offen |
| D | UI-Indikator pro ¶ (Resolved/Unresolved-Marker), Audit-Reader | offen |

---

## 11. Verhältnis zur Meta-Synthese (Benchmark-Linie)

Die existierende `heuristic='meta'`-Composite-Pipeline (siehe 04-pipeline-h1-h2.md §7) produziert Werk-Ebene-Synthese mit drei Literaturbezugs-Ankern, basierend auf statistischem Pre-Filter + agentischer Wahl. H4 produziert per-¶-Korrekturen mit punktueller Sachfragen-Konsultation.

Beide adressieren Literaturbezug — H4 anchor-präzise im Substrat, Meta auf Werk-Ebene aggregiert. Sie schließen sich nicht aus: H4 + nachgeschaltete Meta-Synthese liest revidierte argument_nodes automatisch. Empirische Frage: liefert H4 → meta präzisere Literaturanker als meta solo? Das ist eine **Benchmark-Frage für Phase B+ Spot-Tests**, keine Architektur-Setzung.

---

## 12. Out-of-scope (V1 von H4)

- **Eigene Aggregations-Strecke** (Subkapitel/Kapitel/Werk) — H4 hat keine. Aggregation läuft, falls gewünscht, über H2's bestehende Loader auf den revidierten Substrat-Daten.
- **Kapitel-übergreifender Recherche-Aggregator** („Große Stufe 3" in früheren Drafts) — wird, falls überhaupt umgesetzt, später designed; nicht in H4-V1.
- **Synthese-Pässe à la Retrograde-2-Pass.** H4 ist Substrat-Korrektur, keine Synthese-Modifikation.
