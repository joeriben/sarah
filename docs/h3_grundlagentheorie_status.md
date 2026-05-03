# H3:GRUNDLAGENTHEORIE — Status

Eigenständige Status-Doku der GRUNDLAGENTHEORIE-Session (parallel zu `h3_implementation_status.md`, das die FORSCHUNGSDESIGN-Session pflegt).

Letztes Update: 2026-05-03 (Schritt 1 abgeschlossen; Schritt-2-Spec durch User korrigiert: Routing statt eigene Klassifikation; Klammer-Heuristik-Refactor-Versuch nach Diff-Diagnose verworfen, Original-Heuristik wiederhergestellt).

---

## Pyramide (Mother-Session-Setzung, Schritt 2 korrigiert 2026-05-03)

| Schritt | Tool | Kosten | Stand |
|---|---|---|---|
| 1 | VERWEIS_PROFIL_BAUEN (deterministisch, Author-Pattern-basiert) | quasi null | **abgeschlossen** (Klammer-Heuristik-Refactor-Versuch 2026-05-03 verworfen, siehe Sektion unten) |
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

`grundlagentheorie.ts` ist auf Schritt-1-Stand (Author-Pattern-Heuristik). Der zwischenzeitliche Klammer-Heuristik-Refactor wurde nach Diff-Diagnose am Material verworfen.

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

## Lehre für die Folge-Session

- `feedback_pattern_iteration_vs_simpler_heuristic.md`: bei akademischem Text-Pattern erst Diagnostik-Granularität prüfen. Vorgängersession hat ca. 50 k Tokens auf iteratives Pattern-Patchen verbrannt, obwohl der User mit "enthält die Klammer eine Zahl?" eine 5-Zeilen-Heuristik vorschlug.
- **Neu 2026-05-03 nachmittags**: Agent-Berichte zu numerischen Refactor-Resultaten **nicht ungeprüft übernehmen**. Diff-Diagnose am Material vor Weitergabe — die Methodik ist im Refactor-Versuch-Sektion oben dokumentiert. Vermeidet Schaden durch zwischenzeitlich defekte Implementierung.
- **Neu 2026-05-03 nachmittags**: bewährte Heuristiken nicht durch "konzeptionell saubere" Refactors ersetzen ohne Side-by-Side-Validierung. Eleganz allein ist kein Ersatz für Empirik.
