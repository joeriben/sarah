# Modell-Tier-Testung — Handover Folge-Session

**Erstellt:** 2026-05-05
**Vorgänger-Commit:** `9df4837 refactor(tiers): Per-Tier-Candidates-Modell + Override-Logik raus`
**Status:** Tier-Datenmodell + UI sauber. Empfehlungen pro Tier sind **nicht** alle empirisch belegt — sie beruhen teils auf Spot-Tests von 5 Absätzen und teils auf User-Lesart-Übertrag. Folge-Session muss systematisch nachprüfen.

---

## 0. Warnung an die Folge-Session — wie diese Session gelaufen ist

Diese Session war im Tier-System mehrfach schlampig. User-Reklamationen, die alle berechtigt waren:

1. **Override-Blindness** — ich hatte `model-tiers.ts` gelesen, aber die User-Overrides aus `ai-settings.json` nicht konsultiert und Sonnet als „Default" gemeldet, obwohl der User längst auf Mistral gestellt hatte.
2. **Halluzinierte Preise** — mimo $0.40/$1.60, Sonnet $3/$15, **Opus $15/$75** (real $5/$25), Mistral „$2/$6" (real $0.5/$1.5). Bei Geld-Zahlen hilft nur **Quelle abrufen**, nichts schätzen, nichts „in der Größenordnung von" ansetzen.
3. **„OR-passthrough"-Slop** — als Region-Label erfunden, obwohl es schlicht „US" heißt.
4. **„deine Angabe"-Attribution** — User hatte mir die Mistral-Preise nachrecherchiert weil ich aufgegeben hatte; ich habe das dann ihm zugeschrieben statt es als meine Aufgabe zu erkennen.
5. **„Sonnet ist Default" trotz vorliegender Tests** — wiederholt; obwohl Memory `project_mimo_evaluation` und `project_mistral_sonnet_stack_validated` klar etwas Anderes sagten.
6. **Alles in alle Tiers gekippt** — initialer Versuch hatte für jeden Tier alle 5 Routen gleichberechtigt im Pool. Die Tests sagen DIFFERENZIERTE Sachen über Tier-Eignung. „Doppelt so teures Modell unkommentiert daneben" ist Slop, weil es aussieht wie ein gleichwertiges Angebot.

**Lehre:**
- Bei Geld, Modell-Zugriff, Region: **recherchieren, nicht schätzen**. Live-Endpoint pingen, ggf. mit `npx tsx -e '…'`.
- Bei Memory-Bezug: **Memory tatsächlich öffnen** (Read-Tool), nicht „die Memory sagt vermutlich X".
- Bei „der User hat das im UI eingestellt": **`ai-settings.json` lesen**, bevor man behauptet was Default ist.
- Vor jedem „X ist gleichwertig zu Y": **wo ist die Messung?** Wenn keine — explizit so schreiben, nicht stillschweigend nebenstellen.

---

## 1. Was committet ist

`9df4837 refactor(tiers): Per-Tier-Candidates-Modell + Override-Logik raus`

- [src/lib/server/ai/model-tiers.ts](../src/lib/server/ai/model-tiers.ts): `KNOWN_ROUTES` (tier-unabhängige Stammdaten) + `TIER_REGISTRY` (pro Tier `recommended` + `candidates: TierCandidate[]` mit tier-spezifischer `note`). `describeTiers()` joined beides.
- [src/routes/api/settings/tiers/+server.ts](../src/routes/api/settings/tiers/+server.ts): GET liefert nur noch `{ tiers }`, keine Flat-Routes-Liste mehr.
- [src/routes/settings/+page.svelte](../src/routes/settings/+page.svelte): Pro Tier ein Dropdown nur über `t.candidates`, ★ vor `c.isRecommended`, Auswahl-Note darunter. Override-UI komplett raus.
- [src/lib/server/ai/client.ts](../src/lib/server/ai/client.ts): `delegationAgent` ist raus (durch `tiers` abgedeckt). `tiers`-Feld dokumentiert als „User-Wahl pro Heuristik-Stufe", nicht mehr als Override.

Empfehlungen aktuell:

| Tier | Empfehlung | Test-Lage |
|---|---|---|
| `h1.tier1` (basal AG + validity, per-¶) | `mistral-large` | BA-Chapter 4 end-to-end validiert (50 ¶) |
| `h1.tier2` (collapse: section/chapter/document) | `mimo-v2.5-pro` | Section/Chapter-Collapse > Sonnet/Opus auf §1-§5-Spot |
| `h2.tier1` (synth-memo per-¶) | `mimo-v2.5-pro` | 5-¶-Spot ≈ Sonnet |
| `h3.tier1` (extract: EXPOSITION/FD/FG/GTH-sub/DF) | `mimo-v2.5-pro` | nur EXPOSITION direkt; Rest **Übertrag aus H1/H2** |
| `h3.tier2` (synth: SYNTHESE/EXKURS/SR) | `mimo-v2.5-pro` | **keine direkten Tests**, User-Lesart-Übertrag |
| `h3.tier3` (werk-meta: WERK_DESK/WERK_GUT) | `mimo-v2.5-pro` | **keine direkten Tests**, User-Lesart-Übertrag |

Die User-Lesart vom 2026-05-05 lautete: „Sonnet in keinem getesteten Bereich überlegen → mimo als Default belassen, bis empirisch widerlegt." Das ist die Setzung, gegen die zu testen ist.

---

## 2. Auftrag der Folge-Session: systematische Cross-Tier-Testung

**Geltungsbereich:** **mimo + Mistral**. Anthropic (Sonnet, Opus) **nicht** in dieser Test-Welle. Das ist User-Setzung, nicht Bequemlichkeit.

Was zu klären ist (Coverage-Lücken pro Tier, sortiert nach Risiko):

### Lücke A — `h3.tier1` extract jenseits EXPOSITION (mimo)
**Status:** EXPOSITION ist ≈-Sonnet validiert. Die anderen 4 H3-extract-Module (FORSCHUNGSDESIGN, FORSCHUNGSGEGENSTAND, GRUNDLAGENTHEORIE-Sub-Tools = Routing/Reproductive/Discursive, DURCHFUEHRUNG-BEFUND) laufen aktuell auf mimo per **Übertrag-Annahme**. Das ist die größte Lücke, weil hier die meisten Heuristiken hängen.

**Test:** Eine BA mit existierendem GTH/Methodik/Befund laufen lassen, je Modul Output mit Sonnet-Referenz vergleichen wenn vorhanden, sonst inhaltlich gegen den Quelltext.

### Lücke B — `h3.tier2` synth (mimo) und `h3.tier3` werk-meta (mimo)
**Status:** Komplett ungetestet auf mimo. Werk-Meta integriert über die gesamte Konstruktbasis und ist plausibel der anspruchsvollste Schritt — aktuell läuft das auf mimo, ohne irgendeinen Befund.

**Test:** Werk-Lauf einer kleinen aber vollständigen BA (BA-`h3-dev`-Case), WERK_BESCHREIBUNG + WERK_GUTACHT-a/b/c lesen, prüfen ob die Reflexion über die anderen Konstrukte trägt.

### Lücke C — Mistral auf collapse (`h1.tier2`)
**Status:** Im validierten Mistral+Sonnet-Stack lief collapse auf Sonnet, Mistral wurde collapse nie getestet. Aktueller Tier-Eintrag schließt Mistral aus h1.tier2 deshalb bewusst aus. Ist das richtig? Möglich ist, dass Mistral collapse genauso gut macht — das wäre eine 6×-Kosten-Reduktion gegenüber dem Sonnet-Teil des Stacks und müsste eingestellt werden. Genauso möglich: Mistral collapse ist tatsächlich schwächer.

**Test:** Section-Collapse + Chapter-Collapse auf einer BA, mit Mistral. Vergleich gegen mimo-Output (mimo-collapse ist ≈-opus auf chapter und > Sonnet/Opus auf section laut Spot).

### Lücke D — Mistral auf H2-memo (`h2.tier1`)
**Status:** Memory-Vermerk in `project_mimo_evaluation`: „Mistral bleibt konkurrenzfähig". Nicht systematisch gemessen.

**Test:** Per-¶-H2-synth-memo auf einem BA-Kapitel mit Mistral; gegen mimo-Output vergleichen.

### Lücke E — Mistral auf H3 (alle Tiers)
**Status:** Mistral war an H3 nie getestet. Tier-Einträge schließen Mistral deshalb aus h3.tier1/2/3 aus. Wenn Mistral H3 könnte, wäre das eine ähnlich große Kosten-Reduktion wie bei collapse.

**Test:** Sequenz mimo → Mistral pro H3-extract-Modul auf demselben Kapitel; Output-Diff manuell.

### Lücke F — mimo auf H1 basal end-to-end (mehr als 5 ¶)
**Status:** mimo wurde nur auf 5 ¶ in §1-§5 1.1.1 für AG/validity gegen Sonnet/Opus gemessen, dort konvergent. Mistral hat das auf 50 ¶ end-to-end durchgehalten. Hält mimo das?

**Test:** Eine kleine BA (1-2 Kapitel, ~50 ¶) komplett auf mimo basal+AG laufen lassen, gegen den existierenden Mistral-BA-Lauf vergleichen.

---

## 3. Test-Cases — was nehmen, was schützen

**Schutz (Memory `feedback_benchmark_cases_protected.md`):**
- BA Bachelorarbeit FG, BA TM, **Habilitation Timm — `Theorie kultureller Lehrerbildung`**: Vergleichsbasis. Hier **keine** neuen Test-Läufe, weil das die Vergleichbarkeit der bisherigen Goldstand-Befunde zerstört.

**Geeignet als Test-Case:**
- `BA H3 dev` (Case-ID `c42e2d8f-1771-43bb-97c8-f57d7d10530a`) — explizit als H3-Dev-Test angelegt. Erste Wahl für Lücken A/B/E.
- `BA H1 Test` (Case-ID `0b06739c-…`) — falls leer/unbenutzt, geeignet für Lücke F.
- `BA H3 Test 04`, `BA FF H3 Full Test 01` — falls leer/aktuell, sonst neuer dedizierter Test-Case.

**Wenn nichts Passendes existiert:** neuen Test-Case anlegen mit kleinem Input (~50-100 ¶, 1-2 Kapitel) — möglichst eine echte BA mit GTH/Methodik/Befund/Schluss, sonst greifen die H3-Extraktoren ins Leere.

---

## 4. Methodik — wie testen, ohne Slop zu produzieren

1. **Baseline-Lauf** auf mimo (oder mistral, je nach Tier). Output speichern (Run-ID, Konstrukt-Inhalte als Text-Export oder DB-Snapshot der relevanten `function_constructs` / `argument_nodes` etc.).
2. **Comparator-Lauf** auf der zu testenden Route. Über die Tier-UI umstellen (Settings → Modell-Tiers → Dropdown), nicht ai-settings.json direkt patchen.
3. **Inhaltlicher Diff**, nicht nur Token-Diff:
   - AG: gleiche Claims/Edges? Fallacy-Whitelist konvergent? §:A-Anker erhalten?
   - Validity: gleiche Verdikte? Gleiche Begründungen? Wo divergiert, ist die Divergenz substantiell oder Formulierungs-Rauschen?
   - H3-extract: dieselben Schlüssel-Konstrukte gefunden? Quelltext-Anker auf denselben Absätzen?
   - H3-synth/werk-meta: integriert die Synthese die Befunde plausibel? Findet die Werk-Reflexion etwas oder paraphrasiert sie?
4. **Kosten** aus `pipeline_call_log` ziehen — nicht schätzen. SQL: `SELECT model, sum(input_tokens), sum(output_tokens), sum(cost_usd) FROM pipeline_call_log WHERE run_id = ?`.
5. **Befund pro Lücke** in einem dedizierten Doc unter `docs/model_test_<lücke>_<datum>.md` festhalten: Setup, Modelle, Inputs, Output-Auszüge, Verdikt. Memory `project_mimo_evaluation` und `project_mistral_sonnet_stack_validated` sind die Vorlage für die Form.
6. **TIER_REGISTRY-Notes nachziehen** wenn der Test eine Aussage scharf macht oder umstößt. Notizen sind keine Werbe-Texte — sie referenzieren konkret den Test, der die Aussage stützt.

---

## 5. Was die Folge-Session **nicht** tun soll

- **Keine** neuen Sonnet/Opus-Vergleichsläufe in dieser Test-Welle. User-Setzung.
- **Kein** „die Memory sagt …" ohne Memory-Datei-Read.
- **Keine** Schätzungen für Modell-Preise oder Kosten — `pipeline_call_log.cost_usd` oder Live-API-Pings.
- **Keine** UI-Änderungen am Tier-Picker. Der ist gesetzt. Wenn die Tests die Empfehlungen verschieben, dann nur über `TIER_REGISTRY.recommended` und ggf. `candidates`-Notes.
- **Kein** Commit eines Befunds bevor der Test wirklich gelaufen ist — siehe Memory `feedback_no_hallucinated_qskala.md`.

---

## 6. Quer-Referenzen

- Validierungs-Memorys: `project_mimo_evaluation.md`, `project_mistral_sonnet_stack_validated.md`
- Heuristiken-Architektur: `project_three_heuristics_architecture.md`
- Pipeline-Run: `project_pipeline_run_orchestrator.md`
- Heuristik-Liste H3: `docs/h3_implementation_status.md`
- Aktueller Stuck-Guard-Stand (orthogonale Baustelle, **vor** großen H3-Test-Läufen klären): `docs/h3_handover_2026-05-04_session2.md` §3.1
