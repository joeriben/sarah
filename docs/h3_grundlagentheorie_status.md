# H3:GRUNDLAGENTHEORIE — Status

Eigenständige Status-Doku der GRUNDLAGENTHEORIE-Session (parallel zu `h3_implementation_status.md`, das die FORSCHUNGSDESIGN-Session pflegt).

Letztes Update: 2026-05-03 spätabends (Pyramide alle vier Schritte am Material verifiziert: Habil Timm `2635e73c…` und BA H3 dev `c42e2d8f…`; Schritt 4 FORSCHUNGSGEGENSTAND als Werk-Aggregat implementiert; FORSCHUNGSDESIGN-Pass auf Habil end-to-end gelaufen — Specification-Kette FRAGESTELLUNG → FORSCHUNGSGEGENSTAND → METHODIK-Beurteilung trägt am Material, BASIS-Output enthält kontextuelle Sample-Kritik gegen den breiteren Forschungsgegenstand; Klassifikator-Trennschärfe demonstriert; Bug-Fix `grundlagentheorie_routing.ts:457` für leere BLOCK_ROUTING; Container-Orchestrator + WERK-Ebene offen).

---

## Pyramide (Mother-Session-Setzung, Schritte 2–4 final 2026-05-03)

| Schritt | Tool | Kosten | Stand |
|---|---|---|---|
| 1 | VERWEIS_PROFIL_BAUEN (deterministisch, Author-Pattern-basiert) | quasi null | **implementiert** in `grundlagentheorie.ts` (Klammer-Heuristik-Refactor-Versuch 2026-05-03 verworfen, siehe Sektion unten) |
| 2 | **Routing**: WIEDERGABE_PRÜFEN auf Verdachts-Blöcken aus Verweisprofil (Block-LLM) | LLM × Verdachts-Blöcke | **implementiert** in `grundlagentheorie_routing.ts` (Commit `bc5890f`) |
| 3 reproduktiv | H2 synthetische Block-Würdigung + **ECKPUNKT_CHECK** (a Kernbegriff, b Kontamination, c Provenienz) | 2 LLM × Wiedergabe-Block | **implementiert** in `grundlagentheorie_reproductive.ts` (Commit `77806eb`) |
| 3 diskursiv | DISKURSIV_BEZUG_PRÜFEN auf Block-Ebene (gegen FRAGESTELLUNG) — H1 §-AG-Wiederverwendung kommt im Container-Orchestrator | 1 LLM × Block | **implementiert** in `grundlagentheorie_discursive.ts` (Commit `a80bd3a`) |
| 4 | **FORSCHUNGSGEGENSTAND_REKONSTRUIEREN** als Werk-aggregierte End-Synthese | 1 LLM pro Werk | **implementiert** in `grundlagentheorie_forschungsgegenstand.ts` (User-Setzung 2026-05-03 spätabends: aggregiert vor FORSCHUNGSDESIGN-Pass) |
| Orchestrator | Container-Pass, der alle Schichten koordiniert + bestehende H1-Pipeline auf diskursive ¶ anwendet | — | offen |

Hypothese (Test nach Implementation): Pyramide spart deutlich gegenüber pauschalem H1 auf alle ¶ — reproduktive Strecken (laut Habil-Daten ≥30 % der ¶) entfallen aus dem teuren H1-Pass und werden durch Block-LLM-Calls ersetzt.

---

## Schritt 1 — abgeschlossen

`src/lib/server/ai/h3/grundlagentheorie.ts` + `migrations/048_bibliography_entries.sql` + `scripts/test-h3-grundlagentheorie.ts` + `scripts/test-h3-grundlagentheorie-streuung.ts`.

Strategie: `docs/h3_grundlagentheorie_parsing_strategy.md` (vom User gegen mein voreiliges Erstwurf-File geschärft).

### Komponenten (alle deterministisch, kein LLM)

1. **Container-Auflösung GRUNDLAGENTHEORIE**: heading-hierarchisch über `outline_function_type='GRUNDLAGENTHEORIE'`. Pro Heading ein Container.
2. **Bibliografie-Liste am Werk-Ende**: primär über `section_kind='bibliography'` + `element_type IN ('bibliography_entry', 'paragraph')`; Fallback Heading-Text-Match `Literaturverzeichnis|Literatur|Bibliografie|…`. Persistiert in `bibliography_entries` (Migration 048). Pro Eintrag: Erstautor-Familienname + Year deterministisch extrahiert. Idempotent via DELETE-then-INSERT pro `document_id`.
3. **Inline-Citation-Extraktion** im Container über zwei Stufen:
   - Narrativer Stil `Author (Jahr)` (außerhalb von Klammern)
   - Klammer-Block `\(([^()]+)\)` mit beliebig vielen Sub-Citations innerhalb (über `;`/`,`/Präfix-Trenner getrennt: `vgl.`, `Vgl.`, `auch`, `u.a.`, `kritisch dazu siehe`, …)
   - Author-Pattern erfasst: Standardform, all-caps Akronyme (UNESCO/BUND/GENE), Mehrwort-Familiennamen (Castro Varela / United Nations / Kiwi Menrath bis 3 Wörter), Adelsformen (von Saldern / da Costa / van …), Mehrautoren mit `&`/`/`/`und`, et-al-Varianten (`et al.`/`et. al.`/`et al`/`et. al`), `u.a.`/`e.a.`-Marker.
   - Stop-Liste filtert deutsche Datums-/Determinatoren-/Präpositions-Wörter über alle Wörter im Erstauthor (verhindert "Stand Anfang 2022", "Im Jahr 2022", "Vgl Reckwitz" etc.).
   - **Bekannte Schwächen** (dokumentiert für nächsten Refactor-Versuch): Author-Wörter aus Fließtext werden gelegentlich mitgefressen (`den Einzelnen Harant, 2020`, `Praktiken Kolbe et al., 2008`, `Migrationsgeschichten Georgi et al., 2011`, `Kommission, 2023` aus "UNESCO-Kommission" durch Bindestrich-Split), und Doppelzählungen wie `Kühn, 2022a, 2022b` werden teilweise kaputtgelesen. Insgesamt 5 dokumentierte Edge-Case-Defekte bei Habil; Mehrheit der ~370 Citations sauber.
4. **Cross-Referenz Inline → Bibliografie** über Familienname + Year + optional Suffix.
5. **Verweisprofil** mit allen Indikatoren: `byAuthor`, `byParagraph` (Per-¶-Signatur mit citationCount/dominantAuthor/density), `firstMentionOrder`, Density-Felder (HHI, Top-1/Top-3-Share, maxConsecutiveParagraphsDominatedByAuthor — Reproduktions-Block-Indikator), Coverage-Felder (resolved/orphan).

### Persistenz

- `bibliography_entries` (Migration 048) — Werk-Ebene, idempotent.
- `function_constructs` mit `outline_function_type='GRUNDLAGENTHEORIE'`, `construct_kind='VERWEIS_PROFIL'` — pro Container ein Konstrukt. **Keine Idempotenz** (analog EXPOSITION-Stil — Re-Run dupliziert in der experimentellen Phase).

### Validierung

| Werk | Container | Citations | Unique Autoren | HHI | Top-1-Share | Konsekutiv-Cluster |
|---|---|---|---|---|---|---|
| BA H3 dev | "Theoretischer Rahmen" (48 ¶) | 36 | 3 | **0.64** | 0.78 (Klafki) | **7 ¶ Klafki** |
| BA TM | "Theoretischer Rahmen" (32 ¶) | 18 | 13 | **0.09** | 0.15 (Burghard) | 2 ¶ |
| Habil-Timm | whole-work (328 ¶, kein GTH-Marker gesetzt) | 374 | 230 | **0.012** | 0.04 (Reckwitz) | n/a |

User-Hypothese (Bandbreite × Frequenz als Reprod/Diskuss-Indikator) deutlich bestätigt: Konzentrations-Maße trennen scharf zwischen mono-reproduktiv (BA H3 dev, HHI 0.64) und nicht-mono-reproduktiv (BA TM, Habil).

---

## User-Setzungen aus dieser Session

1. ~~**Klassen-Frage zu Schritt 2 final**~~ und ~~**Strategie a/b/c für Schritt 2**~~ — **überholt 2026-05-03** durch Korrektur (Punkt 6).
2. **Funktionstypen-Setzung BA TM** (User-manuell vor Vergleichslauf): `Einleitung→EXPOSITION`, `Theoretischer Rahmen→GRUNDLAGENTHEORIE`, `Forschungsstand→DURCHFUEHRUNG`, `Diskussion→SYNTHESE`, `Fazit→SCHLUSSREFLEXION`. Mit Anmerkung: "Durchführung = Analyse des Forschungsstandes (explorative Arbeit)" — relevant für H3:DURCHFUEHRUNG später.
3. **Cross-Validation mit AG-Pass**: User-Befund "AG hat 'frei behauptet' beim Bodenkontakt für die gleichen citation-freien Strecken" — Triangulation Schritt-1-Profil mit AG-Output ist möglich, wird in WERK_GUTACHT-b zusammengeführt.
4. **Schlamperei nicht retten**: 22-¶-citation-freie Strecke im BA-TM-Theorieteil ist methodische Schwäche, kein Klassen-Definitions-Problem.
5. **Klammer-Heuristik vor Author-Pattern** als Refactor-Idee — Versuch 2026-05-03 (Commit `a5d4551`) nach Diff-Diagnose am Material verworfen, Original-Heuristik wiederhergestellt. Befund + Lehre in Sektion "Refactor-Versuch 2026-05-03" unten.
6. **Schritte 2–4 final (2026-05-03)**: keine separate LLM-¶-Klassifikation, kein Konstrukt PASSAGE_KLASSIFIKATION. Architektur: Routing (Block-LLM) → entweder H2+ECKPUNKT_CHECK auf reproduktive Blöcke oder H1+DISKURSIV_BEZUG_PRÜFEN auf diskursive Blöcke + Standard-Strecken; FORSCHUNGSGEGENSTAND_REKONSTRUIEREN am Container-Ende. ECKPUNKT_CHECK + DISKURSIV_BEZUG_PRÜFEN beide auf **Block-Ebene** (symmetrisch, granular). Details in Sektion "Schritte 2–4".

---

## Schritte 2–4 — Architektur final 2026-05-03

Kein eigenes Konstrukt PASSAGE_KLASSIFIKATION. Das aufgebrochene Material aus dem Verweisprofil **ist bereits** das Material, mit dem die existierenden Pässe (H1/H2) gefüttert werden — Schritt 2 ist ein **Routing-Mechanismus** zwischen den Pässen, Schritt 3 sind die Pässe + GTH-Spezial-Tools, Schritt 4 ist Container-End-Aggregation.

### Pipeline pro GTH-Container

```
pro Verdachts-Block aus Verweisprofil:
  Routing (WIEDERGABE_PRÜFEN, Block-LLM, billig)
    → ja  →  H2 (synthetische Block-Würdigung)  +  ECKPUNKT_CHECK
    → nein →  H1 §-AG pro ¶                    +  DISKURSIV_BEZUG_PRÜFEN (Block)

pro Standard-Strecke (vielfältige Citations, kein Verdacht):
  H1 §-AG pro ¶  +  DISKURSIV_BEZUG_PRÜFEN (Block)

am Container-Ende:
  FORSCHUNGSGEGENSTAND_REKONSTRUIEREN (Aggregation)
```

### Schritt 2 — Routing (WIEDERGABE_PRÜFEN)

**Verdachts-Blöcke** aus Verweisprofil identifizieren:
- Langstrecken ohne Citations
- Strecken mit repetitiver Author-Dominanz (`maxConsecutiveParagraphsDominatedByAuthor` über Schwelle, hohe Top-1-Share)

**Pro Verdachts-Block: ein billiger Block-LLM-Call** mit Prompt-Kern: "Prüfe die Vermutung, dass es sich um bloße Wiedergabe handelt, nicht um dichte Diskussion." Output binär: bestätigt/verworfen.

### Schritt 3 reproduktiv (H2 + ECKPUNKT_CHECK)

Bei `Routing → ja`: zwei LLM-Calls auf demselben Block.

- **H2** macht die generische synthetisch-hermeneutische Würdigung des Blocks ("Was wird hier gesagt?")
- **ECKPUNKT_CHECK** macht die GTH-spezifische Qualitätsprüfung der Wiedergabe in einem Pass über drei Achsen:
  - **(a) Kernbegriff korrekt** wiedergegeben (z.B. "kategoriale Bildung" bei Klafki im Sinn formal/material-Verschränkung, nicht verkürzt)
  - **(b) Kontamination** — werden Drittkonzepte ohne Markierung eingeschoben (Klafki-Wiedergabe + plötzlich "Resilienz" ohne Verbindungs-Begründung)
  - **(c) Provenienz** — Behauptungen, die einer Quelle bedürfen, aber ohne Beleg dastehen

Output: Reviewer-Indikator pro Achse (grün/gelb/rot) + ¶-Anker für problematische Stellen. **Deskriptiv, nicht beurteilend** (Critical-Friend-Identität).

### Schritt 3 diskursiv (H1 + DISKURSIV_BEZUG_PRÜFEN)

Bei `Routing → nein` (= dichte Diskussion trotz Citation-Pattern) und auf allen Standard-Strecken:

- **H1** läuft als volle §-Argumentanalyse pro ¶
- **DISKURSIV_BEZUG_PRÜFEN** läuft als ein Block-LLM-Call (nicht ¶-weise) und prüft den Bezug des Blocks zur **FRAGESTELLUNG** der Arbeit:
  - **explizit** ("mit Blick auf die hier gestellte Frage…")
  - **implizit** (Stichworte/Begriffe der Fragestellung tauchen auf)
  - **bezugslos** (drumrum-Theorie, fachlich nicht falsch aber zur Frage lose)

Cross-Ref: liest `FRAGESTELLUNG`-Konstrukt aus EXPOSITION-Pass.

Output: Indikator pro Block + Aggregat "Anteil bezugsloser diskursiver Blöcke im Container".

### Schritt 4 — FORSCHUNGSGEGENSTAND_REKONSTRUIEREN

**Werk-aggregierte End-Synthese**: ein LLM-Call pro Werk (nicht pro Container), aggregiert über alle GRUNDLAGENTHEORIE-Container, nachdem alle Block-Pässe durch sind. Input: FRAGESTELLUNG aus EXPOSITION + kondensierte Container-Übersichten (VERWEIS_PROFIL Top-Autoren + HHI, BLOCK_WUERDIGUNG-Summaries der reproduktiv-Blöcke + ECKPUNKT-Signale, DISKURSIV-Block-Klassifikationen). Output: rekonstruierter Forschungsgegenstand des Werks + 3-7 Subject-Keywords (in BA/Habil oft implizit, selten explizit benannt).

**Architektur-Setzung 2026-05-03 spätabends (User)**: aggregiertes Konstrukt pro Werk, nicht pro Container. Begründung: H3:FORSCHUNGSDESIGN-Pass braucht den vollständigen Forschungsgegenstand, also muss er bevor FORSCHUNGSDESIGN startet aggregiert vorliegen. Bei Werken mit nur einem GTH-Container (BA H3 dev) ist Werk-aggregiert == Container-aggregiert; bei Werken mit mehreren Containern (Habil) wird über alle Container hinweg synthetisiert.

### Effekt

Lange reproduktive Passagen werden gesehen, gewürdigt und auf Wiedergabe-Qualität geprüft (H2+ECKPUNKT auf Block-Ebene), aber **nicht ¶-weise mit voller Argumentationsanalyse belastet**. Cost-Saving + epistemisch korrekt — H1 würde fremde Argumente sonst als eigene labeln (vgl. `project_three_heuristics_architecture.md`).

### Status der Datei

`grundlagentheorie.ts` ist auf Schritt-1-Stand (Author-Pattern-Heuristik). Der zwischenzeitliche Klammer-Heuristik-Refactor wurde nach Diff-Diagnose am Material verworfen. Schritte 2–4 sind spec-fertig, Implementation offen.

---

## Refactor-Versuch 2026-05-03 — Klammer-zentrierte Citation-Heuristik (verworfen)

Versuch in Commit `a5d4551`, nach Diff-Diagnose am Material gegen die Original-Heuristik verworfen und mit Variante-B-Rollback wiederhergestellt (selektives `git checkout` der Datei + Doc-Bereinigung in einem Folge-Commit, kein git-revert).

### Konzept (User-Spec, weiterhin gültig für nächsten Versuch)

Diagnostisches Merkmal eines Verweises ist nicht der Author-Name (jeder Stil schreibt den anders), sondern die **Verweis-Struktur in der Klammer**:

| Pattern in der Klammer | Klassifikation |
|---|---|
| (Buchstaben oder nicht) + vier Ziffern + Trenner (`,` / `:` / `S.` / `p.` / `;` o.ä.) + 1–4 arabische oder römische Ziffern | **Quelle mit Seitenangabe** |
| Buchstaben + vier Ziffern (ohne Seitenangabe-Tail) | **Quelle ohne Seitenangabe** |
| nur vier Ziffern in Klammern | **Jahresangabe** (Autor steht im Fließtext davor) |

Plus: Verweis-Marker `aaO` / `a.a.O.` / `ebd.` / `ders.` / `dies.` als alternative Anker statt Jahreszahl.

### Was im verworfenen Versuch schiefging

Konzept war richtig, aber die Sub-Block-Trennung innerhalb der Klammer war zu locker implementiert. Diff-Diagnose (alte vs. neue Heuristik nebeneinander auf identischen ¶-Texten):

| Werk | alt | neu | Verloren | Gewonnen | Bewertung |
|---|---|---|---|---|---|
| BA H3 dev | 36 | 36 | 0 | 0 | identisch (kein Effekt) |
| BA TM | 18 | 20 | 0 | +2 (echt: Anonymisierungs-Tag `[NAME_002]`, `Gillespie,2017` ohne Space) | leichte Verbesserung |
| Habil-Timm | 374 | 351 | 33 | 10 | **schlechter** |

Bei Habil davon Klassifikation am Material:
- ~28 echte Citations weg — Multi-Author mit `&` (`Mecheril & Rose, 2012`, `Bourdieu & Passeron, 1971`, `Cramer & Drahmann, 2019`, …), Citations nach Präfix-Markern `vgl./vgl. u.a./kritisch:/zitiert nach`, Komma-getrennte Multi-Citations innerhalb einer Klammer, `und`-statt-`&`-Verknüpfung
- ~5 alte False Positives korrekt entfernt
- ~3 echte Verbesserungen (besseres Mehr-Author-Erfassen)
- ~5 **neue False Positives** — Klammer-Inhalt mit Folgewörtern wird komplett als Author-Suffix gelesen (`Böhme et al., 2015, in der Fokussierung auf unterrichtliche Praktiken Kolbe et al., 2008:132` schluckt **zwei** Citations zu einer; analog `Bohnsack, 2006 in Bezug auf Bourdieu und Wacqant 1987`, `Thompson, 2006 in Bezug auf Biesta`, `Cramer & Drahmann, 2019, Cramer et al., 2019`); `vgl. ebd.` mit Author=`vgl.` year=undefined; teilweise Author=Marker
- Bandbreite: 230 → 218 unique Autoren (-12)

Netto: substanzieller Recall-Verlust + neue False-Positive-Klasse.

### Spec für nächsten Versuch (wenn jemand die Klammer-Heuristik nochmal probiert)

Die fünf Patterns oben bleiben gültig. Was beim nächsten Mal **vorab schriftlich fixiert** werden muss:
- Sub-Blocks **nur** an `;` trennen, nicht an `,`
- Pro Sub-Block: Präfix-Marker `vgl.|siehe|s.|cf.|vgl. u.a.|kritisch:|zitiert nach|z.B.|u.a.` strikt wegstrippen, bevor Author-Extraktion startet
- Author-Teil: alle Tokens vor dem ersten 4-Ziffer-Year, mit `& / und / et al.` als interne Verknüpfer behalten — keine Tokens nach dem Year
- Alles nach Year + optional Page-Tail (Komma + Ziffer/`S.`/`f.`/`ff.`) ist Klammer-Kontext, **nicht Bestandteil der Citation** — kommentierende Fortsetzungen wie "in Bezug auf X", "in der Fokussierung auf Y" gehören zum Begleittext

### Lehre

1. Agent-Bericht nicht ungeprüft übernehmen. Der Refactor-Agent berichtete Habil-Differenz als "verdrängte False Positives, Größenordnung stabil" — am Material nicht haltbar (28 echte Citations verloren, 5 neue False Positives entstanden). Ich (Claude) habe diesen Bericht eine Antwort lang weitergegeben, bevor ich auf User-Frage hin am Material verifizierte. **Material-Verifikation muss vor Weitergabe stehen, nicht nach.**
2. "Architektonisch besser" ≠ "empirisch besser". Konzeptionelle Eleganz (5 Zeilen statt 200) ist kein Ersatz für Verifikation gegen erprobte Baseline.
3. Diff-Diagnose-Methodik dokumentiert (für Wiederholung beim nächsten Refactor-Versuch): alte und neue `extractInlineCitations` als Standalone-Funktionen exportieren, auf identischen ¶-Texten parallel laufen lassen, pro Treffer Diff über Schlüssel `paragraphId|firstAuthor|year|page` (NICHT offset, weil unterschiedliche Anker), pro Verlust/Gewinn ¶-Index + Klammer-Kontext ausgeben, am Material klassifizieren.

---

## Files dieser Session

Alle ehemals unversioniert, in dieser Session committet:

- `migrations/048_bibliography_entries.sql`
- `src/lib/server/ai/h3/grundlagentheorie.ts`
- `scripts/test-h3-grundlagentheorie.ts`
- `scripts/test-h3-grundlagentheorie-streuung.ts`
- `docs/h3_grundlagentheorie_parsing_strategy.md`
- `docs/h3_grundlagentheorie_status.md` (diese Datei)

---

## Pflicht-Lektüre für Folge-Session

Memory-Pfad: `/Users/joerissen/.claude/projects/-Users-joerissen-ai-sarah/memory/`.

**Architektonische Setzungen (Mother-Session 4ca02b6d und Folge):**
- `project_three_heuristics_architecture.md` — Mother-Session-Setzung: H1/H2/H3-Modell, Funktionstyp-Achse, Falltyp-Konfiguration, vollständige H3-Heuristiken-Liste. **Quelle der Pyramide-Spec für GRUNDLAGENTHEORIE.**
- `project_critical_friend_identity.md` — SARAH analysiert, beurteilt nicht autonom. PASSAGE_KLASSIFIKATION ist deskriptiv, kein Urteil; Wertung erst auf Werk-Ebene durch WERK_GUTACHT.
- `project_fragestellung_definition.md` — Fragestellung = Problemfeld + Perspektive. Wird in Schritt 3b (DISKURSIV_BEZUG_PRÜFEN) als Cross-Typ-Bezug eingelesen.
- `project_falltyp_architecture.md` — Falltyp am Case, Stufe-3-Roadmap.

**Verhaltens-Setzungen (besonders relevant für H3:GRUNDLAGENTHEORIE):**
- `feedback_constructs_are_extracts_not_telemetry.md` — `function_constructs.content` enthält nur Substanz, keine Lauf-Metadaten. Negative Befunde nicht reifizieren.
- `feedback_pattern_iteration_vs_simpler_heuristic.md` (NEU diese Session) — Pattern-Diagnostik vor Pattern-Vollständigkeit. Klammer-Heuristik vor Author-Pattern.
- `feedback_strategic_decisions_need_consent_even_in_auto.md` (NEU diese Session) — high-level Setzungen brauchen User-Zustimmung auch unter AUTO mode.
- `feedback_no_hallucinated_qskala.md` — keine ungebetenen Skalen erfinden (Parallel-Session-Lehre, gilt analog für PASSAGE_KLASSIFIKATION-Schema).
- `feedback_no_hidden_setq.md` — keine Multi-Choice wenn die Setzung schon getroffen ist.
- `feedback_benchmark_cases_protected.md` — Test-Cases sind `c42e2d8f-…` ("BA H3 dev") und `d9233156-…` ("Bachelorarbeit TM"). Habil-Cases sind Benchmarks, NICHT modifizieren.
- `feedback_features_before_interface.md` — Substanz erst, Steuerungs-UI später.
- `feedback_commit_after_substantial_steps.md` — pro logischer Einheit eigener Commit.

**Repo-Doku:**
- `docs/h3_implementation_plan.md` — Phasen-Plan und Sub-Agent-Strategie.
- `docs/h3_implementation_status.md` — pflegt die Forschungsdesign-Session; parallel zu dieser Datei.
- `docs/h3_grundlagentheorie_parsing_strategy.md` — diese Session, vor User-Diskussion über Bibliografie-LLM und Klammer-Heuristik geschärft.

## Implementations-Stand & nächste Schritte (2026-05-03 abends)

### Implementiert (4 Tools + Test-Skripte, alle gegen BA H3 dev am Material verifiziert)

| Tool | Modul | Test-Skript | Commit |
|---|---|---|---|
| Verweisprofil | `grundlagentheorie.ts` | `test-h3-grundlagentheorie.ts`, `…-streuung.ts` | (Schritt 1, früher) |
| Routing (WIEDERGABE_PRÜFEN) | `grundlagentheorie_routing.ts` | `test-h3-routing.ts` | `bc5890f` |
| H2 + ECKPUNKT_CHECK | `grundlagentheorie_reproductive.ts` | `test-h3-reproductive.ts` | `77806eb` |
| DISKURSIV_BEZUG_PRÜFEN | `grundlagentheorie_discursive.ts` | `test-h3-discursive.ts` | `a80bd3a` |
| FORSCHUNGSGEGENSTAND_REKONSTRUIEREN | `grundlagentheorie_forschungsgegenstand.ts` | `test-h3-forschungsgegenstand.ts` | (folgender Commit) |

Persistenz-Konstrukte: `VERWEIS_PROFIL`, `BLOCK_ROUTING`, `BLOCK_WUERDIGUNG`, `ECKPUNKT_BEFUND`, `DISKURSIV_BEZUG_BEFUND`, `FORSCHUNGSGEGENSTAND` — alle mit `outline_function_type='GRUNDLAGENTHEORIE'`. Keine Idempotenz (experimentelle Phase). FORSCHUNGSGEGENSTAND verankert auf alle ¶ aller GTH-Container (Werk-Aggregat).

Default-Modell überall: `openrouter/anthropic/claude-sonnet-4.6` (überschreibt `ai-settings.json`-Opus-Default; spec-konform "billig"). Konfigurierbar via `modelOverride`.

Anonymisierungs-Failsafe deaktiviert (Commit `d617098`, User-Setzung) — Hard-Block produzierte False-Positives auf bereits anonymisierten Werken.

### BA H3 dev — verifizierte Befunde am Material

- Routing: 3 Verdachts-Blöcke (1 citation_gap ¶25-29, 2 author_cluster ¶34-40 + ¶42-46), alle "wiedergabe high" — am Material korrekt (Klafki-Reproduktion).
- Reproductive (3 Blöcke × 2 Calls): provenienz-Achse "red" für ¶25-29 (kein Beleg pro didaktischem Prinzip), Kontamination "lebenslanges Lernen" als nicht-Klafki-Begriff erkannt — am Material defensibel.
- Discursive (4 standard_stretch-Blöcke): alle "implizit green" — Theorie-Kapitel arbeitet Klafki-Perspektive auf, GCED-Anwendungsfrage erst in DURCHFUEHRUNG. Klassifikator-Set `explizit/implizit/bezugslos` hat in diesem Werk noch keine Trennschärfe gezeigt; Härtetest mit gemischtem Bezugsverhalten steht aus.

### Habil H3 Test (Case `2635e73c…`) — verifizierte Befunde am Material 2026-05-03 spätabends

Pyramide vollständig durch (4 Schritte) auf 2 GTH-Containern der Habilitation Timm "Theorie kultureller Lehrerbildung":

| Schritt | Calls | Tokens (in/out) | Laufzeit | Befund |
|---|---|---|---|---|
| EXPOSITION (Opus 4.7) | 2 | 14.658 / 436 | 8.9s | FRAGESTELLUNG + MOTIVATION sauber extrahiert |
| Schritt 1 Verweisprofil (det.) | 0 | — | 1.9s | 2 Container, 76+106 Citations, 72+91 Autoren |
| Schritt 2 Routing (Sonnet 4.6) | 0 | — | 1.4s | **0 Verdachts-Blöcke** beide Container |
| Schritt 3 reproduktiv | 0 | — | 1.4s | no-op (keine Verdachts-Blöcke) |
| Schritt 3 diskursiv (Sonnet 4.6) | 2 | 25.102 / 614 | 17.1s | beide Container "explizit green" |
| **H3-GRUNDLAGENTHEORIE gesamt** | **4** | **39.760 / 1.050** | **~30s** | |

**Container A "Theoretische Anschlüsse — Kulturalität und Globalität"** (27 ¶): HHI 0.018, Top-1-Share 0.05, max-Konsekutiv 2 ¶ — extrem polyphon. DISKURSIV "explizit green" mit 4 Anchors (¶0, ¶4, ¶26 nennen FRAGESTELLUNG direkt).

**Container B "Schule und Professionalität in der Globalität"** (26 ¶): HHI 0.017, Top-1-Share 0.06, max-Konsekutiv 1 ¶ (Adick) — noch breiter. DISKURSIV "explizit green" mit 3 Anchors.

**Pyramide trennt korrekt** zwischen mono-reproduktiver BA (HHI 0.64, Klafki-Cluster ¶25-29, Reproduktiv-Pass aktiviert) und polyphoner Habil (HHI 0.018, kein Cluster ≥4 ¶ und kein Citation-Gap ≥5 ¶, alles diskursiv). Klassen-Verhalten gemäß Spec.

**Cost-Hypothese bestätigt**: Pyramide auf 53 ¶ = 4 LLM-Calls / 40k Tokens / **~20 ct OpenRouter** (User-Tracking). Pauschales H1 wäre ~160-265k Tokens (~5x). Plus epistemisch korrekt — pauschales H1 würde fremde Argumente in polyphonen Containern als eigene labeln.

**Bug-Fix**: `grundlagentheorie_routing.ts:457` — `containerResultBlocks.length > 0`-Filter entfernt. Routing persistiert jetzt auch leere BLOCK_ROUTING-Konstrukte, sodass Reproduktiv und Diskursiv für polyphone Container anschlussfähig sind. Vorher: harter Fehler "BLOCK_ROUTING fehlt".

**Klassifikator-Trennschärfe (Default-Lauf) weiterhin offen**: BA "implizit green", Habil bei Defaults "explizit green" — `bezugslos` ist in beiden Werken nicht aufgetreten. Default-Schwellen produzieren bei Habil zu wenig Granularität, um die Bandbreite zu zeigen.

**Granularitäts-Beobachtung**: Diskursiv läuft auf je einem Standard-Stretch über 26-27 ¶ als Ganzes. Sub-Heading-bewusste Sub-Block-Bildung (Container A wechselt von "Kultur und Kulturalität" zu "Globalität") könnte innere Bandbreite sichtbar machen — Idee für Container-Orchestrator.

#### Vergleichslauf gesenkte Schwellen (`--cluster=2 --gap=3`) auf Habil

| Schritt | Calls | Tokens (in/out) | Befund |
|---|---|---|---|
| Routing gesenkt | 5 | 5.989 / 980 | 5 Verdachts-Blöcke (4 in A, 1 in B) |
| Reproduktiv | 2 | 2.645 / 842 | 1 wiedergabe-Block aktiviert |
| Diskursiv | 10 | 32.047 / 2.495 | 10 Blöcke insgesamt mit Klassifikations-Bandbreite |
| **Vergleichslauf gesamt** | **17** | **40.681 / 4.317** | |

**Routing-Befund (gesenkt)**:
- Container A: ¶4-6 citation_gap → diskussion (high), ¶9-10 Hörning → diskussion (medium), **¶11-12 Reckwitz → wiedergabe (high)**, ¶15-16 Forster → diskussion (medium)
- Container B: ¶6-9 citation_gap → diskussion (high)

**Reproduktiv-Befund** auf ¶11-12 Reckwitz (wiedergabe): kernbegriff **green**, kontamination **yellow** ("In ¶11 ohne explizite Abgrenzungsmarkierung Konzepte"), provenienz **green** — erster gelber Befund am Habil-Material, konkreter Reviewer-Hinweis.

**Diskursiv-Befund** Container A (7 Blöcke): explizit green an ¶0-3, ¶13-14, ¶17-26 (FRAGESTELLUNG namentlich genannt); implizit green an ¶4-6, ¶7-8, ¶15-16 (Forster); **implizit yellow an ¶9-10 (Hörning)** — zweiter gelber Befund. Container B (3 Blöcke): implizit green und explizit green durchmischt.

**Klassifikator-Trennschärfe nun demonstriert** (explizit / implizit / yellow im selben Werk). `bezugslos` weiterhin nicht aufgetreten — am Habil-Material defensibel: das Theoriekapitel ist konsistent fragestellungsrelevant.

**Lehre für Schwellen**: Default `cluster=4 gap=5` ist auf BA-mono-reproduktive Werke kalibriert. Bei polyphonen Habil-artigen Werken liefern niedrigere Schwellen (`cluster=2 gap=3`) wertvolle granulare Befunde, ohne Cost-Hypothese zu sprengen (17 Calls bleiben deutlich unter pauschalem H1).

#### Schritt 4 (FORSCHUNGSGEGENSTAND) auf Habil — verifizierter Befund

| Werk-Schritt | Calls | Tokens (in/out) | Laufzeit |
|---|---|---|---|
| FORSCHUNGSGEGENSTAND_REKONSTRUIEREN (Sonnet 4.6) | 1 | 3.018 / 458 | 9.3s |

**Output Habil** (5 Sätze deskriptiv): "Der Forschungsgegenstand ist eine Theorie kultureller Lehrkräftebildung, die Professionalisierung von Lehrkräften unter den Bedingungen kultureller Diversität und globaler Komplexität konzeptuell fasst. Kulturalität wird dabei nicht als festes Merkmal von Gruppen, sondern als kontingente, relational emergente und praxisgebundene Dimension des Sozialen verstanden, die durch Transkulturalität, Heterogenität und wechselnde Differenzlinien charakterisiert ist. Den gesellschaftlichen Horizont bildet eine Analyse antagonistischer Kulturalisierungsregimes — Hyperkultur und Kulturessentialismus —, die als Bezugsfolie für pädagogische Anforderungen in einer globalisierten Weltgesellschaft dienen. Schule wird dabei als Ort spezifischer Schulkultur und kultureller Bildungsprozesse gefasst…"

**Subject-Keywords**: Kulturalität, Globalität, Kulturessentialismus, Hyperkultur, Schulkultur, Professionalisierung, Kultur-Reflexivität.

Konstruktiv defensibel — die Synthese hebt die antagonistischen Kulturalisierungsregimes (Reckwitz-Container A) zusammen mit der Schulkultur-Linie (Helsper-Cramer-Container B) auf, ohne die Theoriearbeit zu beurteilen. Specification der FRAGESTELLUNG erfolgt korrekt: aus "wie lässt sich eine Theorie entwickeln" wird "der Gegenstand zielt auf eine kultur-reflexive Akzentuierung der Lehrkräftebildung".

**Pyramide-Gesamt-Cost auf Habil** (alle 4 Schritte zusammen, mit gesenkten Schwellen): 18 LLM-Calls / ~44k Tokens / **~25-30 ct OpenRouter** für 53 ¶ in 2 Containern. Pauschales H1 wäre ~250-400k Tokens (~6-9x).

#### BA H3 dev — Schritt 4 verifiziert (1-Container-Werk)

| | Calls | Tokens (in/out) | Laufzeit |
|---|---|---|---|
| FORSCHUNGSGEGENSTAND_REKONSTRUIEREN | 1 | 1.124 / 443 | 8.3s |

Werk-Aggregat-Modell läuft auch bei Werken mit nur einem GTH-Container ("Theoretischer Rahmen", 48 ¶) sauber durch. Output paragrafisch:

> "Der Forschungsgegenstand ist das UNESCO-Konzept der Global Citizenship Education, verstanden als bildungsprogrammatisches Angebot zur Erschließung globaler Gegenwartsprobleme, das einer bildungstheoretischen Überprüfung unterzogen wird. Als Maßstab dieser Überprüfung dient Klafkis kritisch-konstruktive Didaktik, insbesondere seine Theorie der epochaltypischen Schlüsselprobleme als Strukturprinzip einer zeitgemäßen Allgemeinbildung. … Der Gegenstand ist somit die normativ vermessene Schnittfläche zwischen einer international-institutionellen Bildungsagenda und einer kritisch-emanzipatorischen didaktischen Tradition."

**Subject-Keywords**: epochaltypische Schlüsselprobleme, kritisch-konstruktive Didaktik, Allgemeinbildung, Global Citizenship Education, Mündigkeit, Emanzipation, Solidarität.

Specification der FRAGESTELLUNG ("ob bzw. inwieweit GCED bildungstheoretisch tragfähig ist") gelingt präzise: die Theoriearbeit hat das Spannungsverhältnis Klafki ↔ GCED konstituiert, das ist die Schnittfläche, an der die DURCHFÜHRUNG ansetzen kann.

#### FORSCHUNGSDESIGN-Pass auf Habil — end-to-end-Specification-Kette validiert

Erster Test der vollen Cross-Typ-Verkabelung: FRAGESTELLUNG (EXPOSITION) + FORSCHUNGSGEGENSTAND (GRUNDLAGENTHEORIE) → METHODIK-Beurteilung (FORSCHUNGSDESIGN).

| | Calls | Tokens (in/out) | Laufzeit | Modell |
|---|---|---|---|---|
| FORSCHUNGSDESIGN end-to-end | 1 | 12.527 / 1.041 | 12.7s | Opus 4.7 |

Container automatisch via outline_container-Strategie gefunden ("Orientierungen von Lehramtsstudierenden…", 25 ¶). Bezugsrahmen vollständig (FRAGESTELLUNG ✓, FORSCHUNGSGEGENSTAND ✓). Drei Konstrukte produziert:

- **METHODOLOGIE**: qualitativ-rekonstruktive Forschungslogik praxistheoretischer Prägung, atheoretisches Wissen nach Mannheim, Beobachtung 2./3. Ordnung
- **METHODEN**: dokumentarische Methode nach Bohnsack, Theoretical Sampling, kommunikativ-konsensuelle Validierung
- **BASIS**: 28 Gruppendiskussionen, 112 Lehramtsstudierende, drei Fachgruppen + zwei selbstorganisierte politische Gruppen

**Kritischer Befund am BASIS-Output**: der LLM erkennt aus dem FORSCHUNGSGEGENSTAND-Bezug eine *eingeschränkte Tragfähigkeit der Sample-Begründung*: "Die Begründung der Sampleauswahl bezieht sich schlüssig auf die Frage nach Orientierungen angehender Lehrkräfte im Feld kultureller Vermittlung, **greift aber nur eingeschränkt auf den breiteren Forschungsgegenstand (Kulturalität unter Bedingungen globaler Komplexität, Hyperkultur/Kulturessentialismus) zurück**; dies wird in den Limitationen selbst reflektiert — so fehlen etwa Gruppen mit stärker kulturell diversifizierter Lebenswelt."

Genau das ist der Kern qualitativer Methodendiskussion: Sample-Adäquatheit gegen den vollen Forschungsgegenstand. Ohne FORSCHUNGSGEGENSTAND-Konstrukt wäre dieser Befund nicht möglich gewesen — der LLM hätte nur gegen die FRAGESTELLUNG als oberflächliche Wortform geprüft. Mit FORSCHUNGSGEGENSTAND prüft er gegen die *Specification der FRAGESTELLUNG aus der Theoriearbeit*. **Architektur trägt am Material.**

### Nächste Session — empfohlener Auftakt

1. **Container-Orchestrator** (verbindet alle vier Schichten + bindet existierende H1-Pipeline auf diskursive ¶ ein, falls Brief-Flag gesetzt). Sub-Block-Bildung an Sub-Headings als Erweiterung gegen den 26-¶-Mega-Block-Befund.
2. **Schwellen-Konfigurierbarkeit** im Falltyp-System verankern: Habil-artige (polyphon) → niedrigere Defaults; BA-artige (mono-reproduktiv) → strenge Defaults. Heute pro Lauf via CLI-Flag, später Falltyp-Konfiguration.
3. **WERK-Ebene** angehen — H3:WERK_DESKRIPTION + H3:WERK_GUTACHT (a/b ohne gated-c). Hängt davon ab, dass weitere Funktionstypen Konstrukte produzieren; mindestens FORSCHUNGSDESIGN ist heute mit dabei. WERK_GUTACHT-b nutzt das Bewertungsachsen-Raster aus der Mother-Session-Setzung (`project_three_heuristics_architecture.md`).
4. **uncommitted DURCHFÜHRUNG-Änderungen klären** — `src/lib/server/ai/h3/durchfuehrung.ts`, `scripts/test-h3-durchfuehrung.ts`, `docs/architecture/05-pipeline-h3.md` liegen lokal modifiziert; nicht aus dieser Session.

### Open Setq-Defaults

- `minClusterLen=4` / `minCitationGapLen=5` (Routing) — bisher nur gegen BA-Cases getestet
- `minStandardStretchLen=1` (Discursive) — Single-¶-Blöcke. Bei Habil ggf. hochsetzen wenn noisy
- `maxTokens` im Reproductive-Pass auf 1500 hochgesetzt (3 Achsen mit Rationale brauchen Budget); Routing/Discursive 800

---

## Lehre für die Folge-Session

- `feedback_pattern_iteration_vs_simpler_heuristic.md`: bei akademischem Text-Pattern erst Diagnostik-Granularität prüfen. Vorgängersession hat ca. 50 k Tokens auf iteratives Pattern-Patchen verbrannt, obwohl der User mit "enthält die Klammer eine Zahl?" eine 5-Zeilen-Heuristik vorschlug.
- **Neu 2026-05-03 nachmittags**: Agent-Berichte zu numerischen Refactor-Resultaten **nicht ungeprüft übernehmen**. Diff-Diagnose am Material vor Weitergabe — die Methodik ist im Refactor-Versuch-Sektion oben dokumentiert. Vermeidet Schaden durch zwischenzeitlich defekte Implementierung.
- **Neu 2026-05-03 nachmittags**: bewährte Heuristiken nicht durch "konzeptionell saubere" Refactors ersetzen ohne Side-by-Side-Validierung. Eleganz allein ist kein Ersatz für Empirik.
