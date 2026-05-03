# H3:GRUNDLAGENTHEORIE — Status

Eigenständige Status-Doku der GRUNDLAGENTHEORIE-Session (parallel zu `h3_implementation_status.md`, das die FORSCHUNGSDESIGN-Session pflegt).

Letztes Update: 2026-05-03 (Schritt 1 abgeschlossen; Schritt-2-Spec durch User korrigiert: Routing statt eigene Klassifikation).

---

## Pyramide (Mother-Session-Setzung, Schritt 2 korrigiert 2026-05-03)

| Schritt | Tool | Kosten | Stand |
|---|---|---|---|
| 1 | VERWEIS_PROFIL_BAUEN (deterministisch, klammer-zentriert) | quasi null | **abgeschlossen** (Refactor auf Klammer-Heuristik unterwegs) |
| 2 | **Routing** auf Verdachts-Blöcken aus Verweisprofil: WIEDERGABE_PRÜFEN (LLM, billig, Block-Ebene) | LLM × wenige Blöcke | **offen, Spec steht** |
| 2 → ja | H2-Block-Beurteilung auf den ganzen Block (synthetisch-hermeneutisch, **nicht** teure AG) | H2 × 1 pro Block | offen |
| 2 → nein | H1 §-Argumentanalyse pro ¶ im Block | H1 × ¶ | offen |
| Standard | H1 §-AG auf alle übrigen Strecken (vielfältige Citations) | H1 × ¶ | offen |
| 3a/3b/4 | ECKPUNKT_CHECK / DISKURSIV_BEZUG_PRÜFEN / FORSCHUNGSGEGENSTAND_REKONSTRUIEREN — Verhältnis zu H1/H2 nach Routing-Setzung **offen** | — | architektonisch zu klären |

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
5. **Klammer-Heuristik vor Author-Pattern** (Refactor läuft als Sub-Agent, siehe unten).
6. **Korrektur Schritt 2 (2026-05-03)**: keine separate LLM-¶-Klassifikation, kein Konstrukt PASSAGE_KLASSIFIKATION. Stattdessen: Verdachts-Blöcke aus Verweisprofil → günstige Block-LLM-Anfrage "bloße Wiedergabe?" → Routing **H2 auf Block** (ja) oder **H1 §-AG** (nein). Standard-Strecken direkt H1. Effekt: lange reproduktive Passagen werden gesehen und beurteilt, aber nicht mit voller Argumentationsanalyse belastet. Details in Sektion "Schritt 2".

---

## Schritt 2 — User-Korrektur 2026-05-03: Routing, keine eigene Klassifikation

Schritt 2 wird **kein eigenes Konstrukt PASSAGE_KLASSIFIKATION**. Das aufgebrochene Material aus dem Verweisprofil **ist bereits** das Material, mit dem die existierenden Pässe (H1 / H2) gefüttert werden — Schritt 2 ist nur noch ein **Routing-Mechanismus**, der pro Verdachts-Block entscheidet, welcher Pass ihn übernimmt.

### Mechanik

1. **Verdachts-Blöcke identifizieren** aus dem Verweisprofil:
   - Langstrecken ohne Citations
   - Strecken mit repetitiver Author-Dominanz (max-konsekutiv-dominiert-Cluster, Top-1-Share über Schwelle, vgl. Schritt-1-Felder)
2. **Pro Verdachts-Block: WIEDERGABE_PRÜFEN** — billige LLM-Confirm-Anfrage en bloc auf den ganzen Block:
   - Prompt-Kern: "Prüfe die Vermutung, dass es sich um bloße Wiedergabe handelt, nicht um dichte Diskussion."
   - Einziger LLM-Call auf Block-Ebene, nicht ¶-Ebene → günstig
3. **Routing-Ergebnis:**
   - **Wiedergabe bestätigt** → **H2 auf den ganzen Block** (synthetisch-hermeneutische Würdigung, eine Beurteilung für den Block)
   - **Wiedergabe verworfen** (= doch dichte Diskussion trotz Citation-Pattern) → **H1 §-AG pro ¶ im Block** (volle Argumentanalyse)
4. **Standard-Strecken** (vielfältige Citations, normale Density) → **direkt H1 §-AG pro ¶**, ohne Routing

### Effekt

Lange reproduktive Passagen werden **gesehen und beurteilt** (Block-Befund über H2), aber **nicht aufwändig mit voller Argumentationsanalyse behandelt**. Cost-Saving + epistemisch korrekt: H1 würde fremde Argumente als eigene labeln (vgl. `project_three_heuristics_architecture.md`).

### Offene architektonische Frage

Die ursprünglichen Schritte 3a/3b/4 (ECKPUNKT_CHECK, DISKURSIV_BEZUG_PRÜFEN, FORSCHUNGSGEGENSTAND_REKONSTRUIEREN) sind in der Routing-Setzung **noch nicht eingeordnet**. Drei Lesarten denkbar:
- als Sub-Tools INNERHALB H2-Block-Beurteilung (für reproduktive Blöcke)
- als Querschnittsbausteine über Container-Ende (FORSCHUNGSGEGENSTAND ist ohnehin Aggregation)
- als obsolet, weil Routing + H1/H2 sie aufnimmt

→ User-Klärung in Folge-Session, bevor Schritt 2 implementiert wird.

### Status der Datei

`grundlagentheorie.ts` ist clean nach Schritt 1; Klammer-zentrierte Citation-Heuristik (siehe "Refactor 2026-05-03" unten) ist umgesetzt und gegen die Benchmark-Cases validiert.

---

## Refactor 2026-05-03 — Klammer-zentrierte Citation-Heuristik (umgesetzt)

Author-Pattern-Karneval (~200 Zeilen mit Stop-Liste, Mehrwort-Familiennamen, Adelsformen, et-al-Varianten) ersetzt durch klammer-zentrierte Heuristik. Diagnostisches Merkmal eines Verweises ist die **Verweis-Struktur in der Klammer** (4-Ziffer-Year + ggf. Seiten-Tail oder Verweis-Marker `aaO`/`a.a.O.`/`ebd.`/`ders.`/`dies.`), nicht der Author-Name.

User-Spec (verbatim, jetzt umgesetzt):

| Pattern in der Klammer | Klassifikation |
|---|---|
| (Buchstaben oder nicht) + vier Ziffern + Trenner (`,` / `:` / `S.` / `p.` / `;` o.ä.) + 1–4 arabische oder römische Ziffern | **Quelle mit Seitenangabe** |
| Buchstaben + vier Ziffern (ohne Seitenangabe-Tail) | **Quelle ohne Seitenangabe** |
| nur vier Ziffern in Klammern | **Jahresangabe** (Autor steht im Fließtext davor) |

Plus: Verweis-Marker `aaO` / `a.a.O.` / `ebd.` / `ders.` / `dies.` als alternative Anker statt Jahreszahl.

**Pipeline pro Klammer-Block** (`extractInlineCitations`):
1. Klammer-Block matchen `\(([^()]+)\)`
2. Sub-Block-Split: primär per `;`, sekundär per `,` mit Greedy-Reassemble (Komma trennt nur, wenn der Folge-Teil mit Großbuchstabe oder Verweis-Marker beginnt + eigenes Year hat)
3. Pro Sub-Block: Year-Range (`1833–1911`) maskieren → Single-Year-Match → Page-Tail (Trenner-Sequenz `,`/`:`/`;`/`S.`/`p.` + 1–4 Ziffern + optional `f`/`ff`/Range)
4. Author primär aus Sub-Block (vor Year), sekundär aus Fließtext direkt vor `(` (für `(2007)`-Anhängsel)
5. Plausibilitäts-Filter (`isPlausibleAuthorString`): erstes Token mit Großbuchstabe/Adels-Prefix/`[NAME_…]`, nicht in `DATE_PHRASE_STOPWORDS`, max. 1 Lowercase-Token im Author-Teil

**Cross-Referenz-Resolver** vergleicht jetzt das erste Token des Inline-Authors mit `bibliography_entries.first_author_lastname` — damit matcht "Castro Varela" inline auch eine Bib-Entry, die nur "Castro" trägt.

**Validierung gegen Benchmarks:**

| Werk | Metrik | Soll | Refactor | Status |
|---|---|---|---|---|
| BA H3 dev | Citations / HHI / Top-1 / Konsekutiv-Cluster | 36 / 0.64 / 0.78 / 7 ¶ | 36 / 0.6435 / 0.78 / 7 ¶ Klafki | identisch |
| BA TM | Citations | ~18 | 20 | leichte Verbesserung (Anonymisierungs-Tag `[NAME_002]` jetzt erfasst, Luckmann/Gugutzer dazu) |
| BA TM | HHI | 0.09 | 0.0785 | in Range |
| Habil-Timm | Citations | ~374 | 351 | -6 %, in Toleranz; Differenz = primär verdrängte False Positives (Datums-Klammern, Komma-Verkettungen) |
| Habil-Timm | HHI / Top-1 (Reckwitz) | 0.012 / 20 | 0.0122 / 20 | identisch |

**Schnittstelle stabil**: `VerweisProfile`-Struktur unverändert, alle nachgelagerten Konsumenten weiter kompatibel.

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

## Lehre für die Folge-Session

`feedback_pattern_iteration_vs_simpler_heuristic.md` (neu): bei akademischem Text-Pattern erst Diagnostik-Granularität prüfen. Diese Session hat ca. 50 k Tokens auf iteratives Pattern-Patchen verbrannt, obwohl der User mit "enthält die Klammer eine Zahl?" eine 5-Zeilen-Heuristik vorschlug.
