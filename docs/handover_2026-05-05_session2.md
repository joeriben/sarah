# Handover Session 2026-05-05 #2 — Stuck-Guard-Wurzelfix + Tier-Test-Re-Audit

**Erstellt:** 2026-05-05 (Session 2 nach Tier-Refactor `9df4837`)
**Vorgänger-Handover:** [docs/model_tier_testing_handover_2026-05-05.md](model_tier_testing_handover_2026-05-05.md) (Session 1)
**Status:** Diese Session hat **nichts committet** und **keine Memorys angelegt/geändert**. Sie hat den Vorgänger-Auftrag geprüft, einen verdeckten Wurzel-Fix-Auftrag (Stuck-Guard) ergänzt, und den eigenen Kontext durch zwei Slop-Reflexe vergiftet, bevor Code geschrieben wurde. Folge-Session soll mit frischem Kontext starten und mit §3.1 beginnen.

---

## 0. Warnung an Folge-Session — wie diese Session schief gegangen ist

1. **Vorgänger-Lücken-Liste ungeprüft übernommen.** Das Vorgänger-Handover stellte für Tier-Tests eine A–F-Lückentaxonomie auf. User-Frage „Was ist mit Mimo → H2?" zeigte ein Loch. Mein Reflex war „Lücke G drauflegen" — das akzeptiert die Vorgänger-Liste als korrekt und fügt Anhängsel hinzu. Falsch. Die Liste war an mehreren Stellen verzerrt (siehe §4): F formuliert „end-to-end-Werk", aber Mistral lief auch nur 1 Kapitel; D zielt auf Mistral-H2, obwohl Mimo-H2 selbst nur 5-¶-Spot ist; A unterschlägt fünf Module der `h3.tier1`-Note. Der §0-Warnhinweis des Vorgänger-Handovers selbst hat die Vorgänger-Session schon als schlampig gekennzeichnet — den Hinweis hatte ich gelesen und trotzdem die Liste übernommen.

2. **Option B als gleichberechtigte Alternative präsentiert.** Beim Stuck-Guard-Wurzel-Fix habe ich zwei Optionen formuliert: A = strukturell (Pass-Vertrag), B = „schlank" (Schutz weg, Bug-Klasse latent). User-Setzung aus `feedback_stuck_guard_is_symptom_not_solution.md` ist klar: nicht Pflaster wegnehmen, sondern Wurzel fixen. B war Slop, nicht legitime Alternative. Es gibt nur A.

3. **Beschönigendes Vokabular.** „Im Handover nicht sauber benannt" für ein Loch in einer als schlampig markierten Liste; „riskanter" als Marker für „silent failures werden möglich"; „Trade-off" für „Pflaster vs. strukturell beheben". Sprachliche Verharmlosung ist hier nicht Diplomatie, sondern verdeckt das Pattern.

**Lehre für Folge-Session:**
- Vorgänger-Listen prüfen, nicht ergänzen. Auch wenn das Vorgänger-Handover plausibel klingt: §0-Warnungen ernst nehmen.
- Bei Auswahl-Optionen: nur tatsächliche Alternativen anbieten. „Schutz wegnehmen statt Wurzel fixen" ist niemals legitime Option.
- Bei sprachlicher Abschwächung („nicht sauber", „riskanter", „Trade-off"): innehalten, präziser werden.

---

## 1. Was committet ist

**Nichts.** Diese Session hat ausschließlich Diagnose betrieben.

Letzter Commit auf `main`: `9df4837 refactor(tiers): Per-Tier-Candidates-Modell + Override-Logik raus`.

Working-Tree am Session-Anfang (von dieser Session **nicht** angefasst):
- `M src/routes/projects/[projectId]/documents/[docId]/+page.svelte`
- ungetrackt: `scripts/probe-cache-raw-usage.ts`, `scripts/probe-cache-routes.ts`, `scripts/probe-mistral-cache-3way.ts`, `scripts/probe-mistral-cache.ts`, `scripts/probe-sonnet-warmup.ts`

---

## 2. Aktueller Stand (zur Vermeidung von Override-Blindness)

`ai-settings.json` (Working-Dir, gelesen 2026-05-05 in dieser Session):

```json
{
  "provider": "mistral",
  "model": "mistral-large-latest",
  "language": "de",
  "tiers": {
    "h1.tier1": {
      "provider": "mistral",
      "model": "mistral-large-latest"
    }
  }
}
```

Heißt: nur `h1.tier1` ist explizit auf Mistral gesetzt. Alle anderen Tiers (`h1.tier2`, `h2.tier1`, `h3.tier1`, `h3.tier2`, `h3.tier3`) fahren die `recommended`-Default aus `TIER_REGISTRY` ([model-tiers.ts:117-265](../src/lib/server/ai/model-tiers.ts:117)) — durchgängig **Mimo** (`xiaomi/mimo-v2.5-pro` über OpenRouter).

`provider`/`model` an der Wurzel des Files sind Legacy-Default für Aufrufer ohne Tier — durch das Tier-Routing in der Pipeline irrelevant geworden, aber nicht entfernt.

User-Lesart vom 2026-05-05 (aus Vorgänger-Handover, hier bekräftigt): „Sonnet in keinem getesteten Bereich überlegen → Mimo als Default belassen, bis empirisch widerlegt." Das ist die Setzung, gegen die zu testen ist.

---

## 3. Auftrag der Folge-Session — in dieser Reihenfolge

### 3.1 Stuck-Guard strukturell beseitigen (Vorbedingung für jeden weiteren Test)

**Begründung:** Jede H1-Phase läuft heute durch `runIterativePhase`, dessen Stuck-Guard die Test-Vergleichsbasis kontaminiert (im Bug-Fall failt der ganze Run mit „Stuck on …"-Diagnose statt mit der eigentlichen Pass-Wurzel). Vor jedem Mimo-vs-Mistral-Vergleich auf H1 muss der Mechanismus weg, sonst muss man Befunde immer dahingehend qualifizieren, ob sie durch den Guard verzerrt sind.

**Wichtig — Diagnose-Spur des Vorgänger-Handovers ist veraltet:**
[docs/h3_handover_2026-05-04_session2.md §3.1](h3_handover_2026-05-04_session2.md) verortet Stuck-Guard als H3-Phase-Layer-Problem mit Vite-SSR-Modul-Cache-Hypothese. Das **trifft auf den heutigen Code nicht mehr zu**: `h3-phases.ts` ist seit der User-Setzung 2026-05-04 Legacy/Done-Check-only ([h3-phases.ts:1-13](../src/lib/server/pipeline/h3-phases.ts:1)), der H3-Run läuft als linearer Walk über `h3-walk-driver.ts` (`runH3Walk` in `orchestrator.ts:881-993`) **ohne** Stuck-Guard. Der heute verbliebene Stuck-Guard sitzt **ausschließlich** im H1-Atom-Loop und ist eine andere Bug-Klasse: Inkongruenz zwischen `listAtomsForPhase`-Done-Set und Pass-Skip-Bedingung.

**Inventar — was wegmuss:**

| Stelle | Was | Was tun |
|---|---|---|
| [orchestrator.ts:772-879](../src/lib/server/pipeline/orchestrator.ts:772) `runIterativePhase` | `lastProcessedAtomId` + `sameAtomRepeatCount`, 3×-Repeat-Check, Diagnose-String `"Stuck on …"` | Variablen + Repeat-Check raus. Nach `executeStep` einmal `listAtomsForPhase` re-checken; wenn das gerade verarbeitete Atom immer noch in `pending` → `throw new Error(\`Pass for ${phase}/${atom.label} returned but atom remains pending — done-check and pass-persist are out of sync (code bug, not retryable)\`)`. Der existing fail-tolerant-Pfad (catch-Block, `recordAtomError`, `erroredAtomIds`-Set) fängt das ab. |
| [+page.svelte:404-433](../src/routes/projects/[projectId]/documents/[docId]/+page.svelte:404) `parseFailureMessage` | `kind: 'stuck'` Discriminator + `stuckMatch`-Regex `/^Stuck on …/` | Beides raus. `ParsedFailure` schrumpft auf `{ kind: 'precondition' \| 'generic' }`. |
| [+page.svelte:1753-1761](../src/routes/projects/[projectId]/documents/[docId]/+page.svelte:1753) | `{:else if parsed.kind === 'stuck'}` Render-Branch + `<span class="failure-tag tag-stuck">Stuck-Guard</span>` | Branch raus. Generic-Branch fängt das ab. |
| [+page.svelte:1762](../src/routes/projects/[projectId]/documents/[docId]/+page.svelte:1762) | `{#if parsed.kind === 'precondition' \|\| parsed.kind === 'stuck'}` | `\|\| parsed.kind === 'stuck'` raus. |
| [+page.svelte:3265+](../src/routes/projects/[projectId]/documents/[docId]/+page.svelte:3265) | `.tag-stuck { … }` CSS-Klasse | Klasse raus. |
| [synthese.ts:585](../src/lib/server/ai/h3/synthese.ts:585) | Kommentar referenziert „Orchestrator-Stuck-Guard" als Begründung warum hier `PreconditionFailedError` statt stiller Skip | Begründung bleibt sachlich richtig (stiller Skip ist auch ohne Stuck-Guard falsch — verschluckt die Diagnose). Nur Stuck-Guard-Vokabular umformulieren. |

**Vorlage für das Vertrags-Pattern:** [orchestrator.ts:881-993](../src/lib/server/pipeline/orchestrator.ts:881) `runH3Walk` — sequenzieller Index-Loop, Done-Check pro Step, Fehler im Pass führt zu `markFailed` ohne Wiederversuch. Genau dieses Pattern auf `runIterativePhase` übertragen, mit dem einen Unterschied, dass die fail-tolerant-pro-Atom-Semantik (errored-Set, weiter mit nächstem Atom) erhalten bleibt — die ist legitim und nicht das Pflaster.

**Auch nicht tun:**
- Stuck-Guard durch besseren Stuck-Guard ersetzen.
- Stuck-Guard kommentiert behalten „für den Fall, dass …".
- Generic Error-Path für die Bug-Klasse aufweichen („vielleicht doch nochmal versuchen").
- Pass-spezifische Bug-Klassen einzeln im Pass abfangen statt am Vertrag festzuhalten.

**Verifikation:**
- `npm run check` (Type-Check + Lint) — pre-existing Type-Errors in 3 anderen Routen sind nicht im Scope (Vorgänger-Handover Session 2 §6).
- Ein H1-AG-Run auf einem **kleinen Test-Case** (NICHT Goldstand-Cases, Memory `feedback_benchmark_cases_protected`) — sollte ohne `Stuck on …`-Meldung und ohne Endlosschleife durchlaufen.
- UI: ein Run-Failure-Anzeige-Test — generische Diagnose statt Stuck-Tag.

**Memory:** `feedback_stuck_guard_is_symptom_not_solution.md` **bleibt erhalten**, weil die Lehre („Symptom ≠ Lösung") nicht durch das Entfernen des Mechanismus erlöscht — sie soll vor Wiedereinführung schützen.

**Vorschlag Commit-Message:**
```
fix(pipeline): Stuck-Guard strukturell beseitigt, Pass-Vertrag stattdessen

runIterativePhase ersetzt das 3×-Repeat-Pflaster durch einen Vertrags-Check:
nach executeStep muss das Atom done sein. Verletzung = Code-Bug, nicht
Wiederversuchsfall. Wirft Error, fail-tolerant-Pfad merkt das Atom als
errored.

UI-Pendant in document-page (Failure-Parse, Render-Branch, CSS) ebenfalls
raus. Memory feedback_stuck_guard_is_symptom_not_solution bleibt erhalten.
```

### 3.2 Re-Audit der Tier-Test-Lage (§4) selbst prüfen, nicht akzeptieren

§4 dieses Handovers ersetzt die A–F-Lückentaxonomie aus dem Vorgänger-Handover. Folge-Session soll das **nicht blind übernehmen**, sondern selbst gegen Memory `project_mimo_evaluation`, `project_mistral_sonnet_stack_validated` und `TIER_REGISTRY`-Notes prüfen. Wenn Lücken übersehen oder falsch dargestellt sind, korrigieren — ohne pseudo-Höflichkeit.

### 3.3 Tests nach Default-Risiko (NACH 3.1)

Empfohlene Reihenfolge — Default ohne Empirie ist Plattform-Risiko, das geht zuerst:

1. **`h2.tier1` (Mimo, per-¶ Synth-Memo) end-to-end auf realer Strecke** — User-Befund 2026-05-05, größte Default-ohne-Empirie-Stelle nach 5-¶-Spot.
2. **`h3.tier2` (Mimo, SYNTHESE/EXKURS/SCHLUSSREFLEXION)** — komplett ungemessen.
3. **`h3.tier3` (Mimo, WERK_BESCHREIBUNG/WERK_GUTACHT)** — komplett ungemessen.
4. **`h3.tier1`-Module außer EXPOSITION** auf Mimo (FORSCHUNGSDESIGN, FORSCHUNGSGEGENSTAND, GRUNDLAGENTHEORIE-Sub: Routing/Reproductive/Discursive, DURCHFUEHRUNG-BEFUND).
5. **`h1.tier2` Mimo cross-chapter** — bisher nur 1 Subkapitel + 1 Chapter.
6. **Mistral als Alternative auf `h2.tier1` und `h1.tier2`** — nur nachgelagert.
7. **Mistral auf H3** — nachgelagert.

**Methodik** (aus Vorgänger-Handover §4 unverändert übernommen, bleibt richtig):
- Baseline-Lauf, dann Comparator-Lauf via Settings-UI (NICHT `ai-settings.json` direkt patchen).
- Inhaltlicher Diff, nicht Token-Diff.
- Kosten aus `pipeline_call_log.cost_usd`, nichts schätzen.
- Befund pro Test in `docs/model_test_<thema>_<datum>.md`; `TIER_REGISTRY`-Note pro Befund-Update fortschreiben.

---

## 4. Test-Lage pro Tier (ersetzt Vorgänger-A–F-Liste)

| Tier | Default | Direkt gemessen | Geltungsbereich der Messung | Tatsächliche Lücke |
|---|---|---|---|---|
| `h1.tier1` (basal AG+validity per-¶) | Mistral | basal+AG end-to-end | BA-Chapter 4, **50 ¶ / 1 Kapitel** | gilt als belastbar (Memory `project_mistral_sonnet_stack_validated`) |
| `h1.tier2` (collapse) | Mimo | section + chapter | Habil 1.1.1 + 1 Chapter (1.3.3) | Mehr-Kapitel-Skalierung; Document-Collapse „nicht separat getestet" (Memory `project_mimo_evaluation`) |
| `h2.tier1` (per-¶ Synth-Memo) | Mimo | nur 5-¶ Spot | Habil 1.1.1 §1–§5 | end-to-end auf realer Strecke fehlt |
| `h3.tier1` (extract) | Mimo | nur EXPOSITION | „Test diskriminiert nicht; mimo ≈ Sonnet" | FORSCHUNGSDESIGN, FG, GTH-Routing/Reproductive/Discursive, DURCHFUEHRUNG-BEFUND — alle nur Übertrag |
| `h3.tier2` (synth) | Mimo | ∅ | — | komplett |
| `h3.tier3` (werk-meta) | Mimo | ∅ | — | komplett |

**Fehler in der Vorgänger-A–F-Liste, die diese Tabelle korrigiert:**
- F formulierte „mimo auf H1 basal end-to-end" als Sondersorge; Mistral lief auch nur 50 ¶/1 Kapitel, die Asymmetrie ist nicht so groß wie behauptet.
- D zielte auf „Mistral auf H2-memo"; das größere Loch ist Mimo-H2 selbst (nur Spot).
- C zielte auf Mistral-collapse; auch Mimo-collapse ist nur auf 1 Subkapitel + 1 Chapter, nicht cross-chapter, gemessen.
- A formulierte „die anderen 4 H3-extract-Module"; tatsächlich sind es **fünf** (FORSCHUNGSDESIGN, FORSCHUNGSGEGENSTAND, GRUNDLAGENTHEORIE-Sub-Tools = Routing + Reproductive + Discursive, DURCHFUEHRUNG-BEFUND).

---

## 5. Was die Folge-Session NICHT tun soll

- Stuck-Guard durch besseren Stuck-Guard ersetzen.
- Stuck-Guard kommentiert für „später" behalten.
- A–F-Lückentaxonomie aus Vorgänger-Handover als belastbar nehmen.
- Test starten, bevor 3.1 committet ist.
- Goldstand-Cases (BA-FG, BA-TM, Habil-Timm) für neue Tests nutzen (Memory `feedback_benchmark_cases_protected`).
- Anthropic (Sonnet/Opus) in dieser Test-Welle vergleichen — User-Setzung.
- `ai-settings.json` direkt für Modell-Wechsel patchen — Settings-UI.
- Modell-Preise/Kosten schätzen — `pipeline_call_log.cost_usd` oder Live-API-Pings.
- Eigene neue Memorys schreiben, ohne dass eine echte User-Setzung dazu passt.
- Spawn-Tasks ohne explizite User-Autorisierung (Memory `feedback_no_unauthorized_spawn_tasks`).
- Vor Code-Schreiben Pseudo-Setzungen via Multiple-Choice anbieten, wenn der Auftrag eindeutig ist (Memory `feedback_no_hidden_setq`).

---

## 6. Querverweise

**Pflicht-Lektüre vor jedem Schritt:**
- `feedback_stuck_guard_is_symptom_not_solution.md` — Definition, was Stuck-Guard sein darf
- `feedback_strategic_decisions_need_consent_even_in_auto.md` — auch unter AUTO Konsens für strategische Setzungen
- `feedback_understand_before_implementing.md` — vor Code, verstehen
- `feedback_pattern_iteration_vs_simpler_heuristic.md` — gegen iteratives Patchen
- `feedback_no_hallucinated_qskala.md` — gegen erfundene Verdiktskalen
- `feedback_benchmark_cases_protected.md` — Goldstand-Schutz
- `feedback_research_code_dont_ask_user.md` — System-Details selbst nachschlagen
- `project_mimo_evaluation.md` — Empirie-Basis Mimo
- `project_mistral_sonnet_stack_validated.md` — Empirie-Basis Mistral

**Architektur:**
- `project_three_heuristics_architecture.md`
- `project_pipeline_run_orchestrator.md`
- `feedback_no_phase_layer_orchestrator.md` — relevant für Verständnis, warum H3 keinen Stuck-Guard hat

**Code-Pfade:**
- [orchestrator.ts:772-879](../src/lib/server/pipeline/orchestrator.ts:772) — `runIterativePhase` + Stuck-Guard (zu entfernen)
- [orchestrator.ts:881-993](../src/lib/server/pipeline/orchestrator.ts:881) — `runH3Walk` (Vorlage für Vertrags-Pattern)
- [orchestrator.ts:352-475](../src/lib/server/pipeline/orchestrator.ts:352) — `listAtomsForPhase` + Done-Bedingungen pro H1-Phase
- [h3-phases.ts](../src/lib/server/pipeline/h3-phases.ts) — Legacy/Done-Check-only seit 2026-05-04 (NICHT der Stuck-Guard-Ort)
- [model-tiers.ts](../src/lib/server/ai/model-tiers.ts) — `TIER_REGISTRY` + `KNOWN_ROUTES`
- [synthese.ts:585](../src/lib/server/ai/h3/synthese.ts:585) — Kommentar mit Stuck-Guard-Bezug (Vokabular umstellen)
- [+page.svelte:404, 1753, 3265](../src/routes/projects/[projectId]/documents/[docId]/+page.svelte:404) — UI-Stuck-Pfad (zu entfernen)
- `ai-settings.json` (Working-Dir-Root) — User-Setzungen pro Tier

**Test-Cases (aus Vorgänger-Handover):**
- `BA H3 dev` (`c42e2d8f-1771-43bb-97c8-f57d7d10530a`) — Erste Wahl für `h3.tier1/2/3`
- `BA H1 Test` (`0b06739c-…`) — falls leer/unbenutzt, geeignet für `h2.tier1` / `h1.tier2`
- `BA H3 Test 04`, `BA FF H3 Full Test 01` — falls leer, sonst dedizierter neuer Test-Case
- **Geschützt:** BA-FG, BA-TM, Habil Timm — keine neuen Läufe

**DB-Verbindung:** `postgresql://joerissen@localhost:5432/sarah` (nativ, kein Docker — Memory `project_dev_db_setup`).

---

## 7. Nicht-zu-vergessen

- Diese Session hat **keine Memorys angelegt oder geändert**. `MEMORY.md`-Index ist unverändert.
- Diese Session hat **nichts committet**.
- Pre-existing Type-Errors in 3 anderen Routen (`cases/+page.svelte`, `documents/+page.svelte`, `settings/briefs/new/+page.svelte`) — Vorgänger-Handover Session 2 §6 — nicht im Scope.
- Working-Tree-Stand am Session-Anfang: 5 ungetrackte `scripts/probe-*.ts` + modifiziertes `+page.svelte`. Diese Session hat sie nicht angefasst, Folge-Session prüft selbst, ob sie zum aktuellen Auftrag gehören.
- Kontextlast: User-Beobachtung „Qualität degradiert oberhalb ~200-250k". Diese Session wurde wegen Kontextvergiftung **vom User vorzeitig** beendet, gut so. Folge-Session frisch starten.
