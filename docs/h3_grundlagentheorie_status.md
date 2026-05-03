# H3:GRUNDLAGENTHEORIE — Status

Eigenständige Status-Doku der GRUNDLAGENTHEORIE-Session (parallel zu `h3_implementation_status.md`, das die FORSCHUNGSDESIGN-Session pflegt).

Letztes Update: 2026-05-03 (Schritt 1 abgeschlossen, Schritt 2 offen).

---

## Pyramide (Mother-Session-Setzung)

| Schritt | Tool | Kosten | Stand |
|---|---|---|---|
| 1 | VERWEIS_PROFIL_BAUEN (Regex/deterministisch) | quasi null | **abgeschlossen** |
| 2 | REPRODUKTIV_VS_DISKURSIV (LLM, billig) | LLM × 1 pro Container | **offen** |
| 3a | ECKPUNKT_CHECK auf reproduktive ¶ | LLM, gezielt | offen |
| 3b | DISKURSIV_BEZUG_PRÜFEN auf diskursive ¶ gegen FRAGESTELLUNG | LLM, gezielt | offen |
| 4 | FORSCHUNGSGEGENSTAND_REKONSTRUIEREN am Kapitelende | LLM × 1 pro Container | offen |

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

1. **Klassen-Frage zu Schritt 2 final**: zweiwertig `reproduktiv | diskursiv`, keine eigene Klasse für Sachbeschreibung-Schlamperei. Methodische Mängel werden nicht reifiziert, sondern als Befund aus orthogonalen Achsen (Klasse × Beleg) sichtbar — "reproduktiv ohne Beleg in einem Theorie-Container = Methodik-Lücke", konsumiert in WERK_GUTACHT.
2. **Strategie a/b/c für Schritt 2 gesetzt**:
   - (a) Granularität: pro ¶
   - (b) Klassen-Set: zweiwertig REPRODUKTIV/DISKURSIV
   - (c) Persistenz: ein PASSAGE_KLASSIFIKATION-Konstrukt pro Container, content = `{ paragraphClasses: [{paragraphId, class}] }`
3. **Funktionstypen-Setzung BA TM** (User-manuell vor Vergleichslauf): `Einleitung→EXPOSITION`, `Theoretischer Rahmen→GRUNDLAGENTHEORIE`, `Forschungsstand→DURCHFUEHRUNG`, `Diskussion→SYNTHESE`, `Fazit→SCHLUSSREFLEXION`. Mit Anmerkung: "Durchführung = Analyse des Forschungsstandes (explorative Arbeit)" — relevant für H3:DURCHFUEHRUNG später.
4. **Cross-Validation mit AG-Pass**: User-Befund "AG hat 'frei behauptet' beim Bodenkontakt für die gleichen citation-freien Strecken" — Triangulation Schritt-1-Profil mit AG-Output ist möglich, wird in WERK_GUTACHT-b zusammengeführt.
5. **Schlamperei nicht retten**: 22-¶-citation-freie Strecke im BA-TM-Theorieteil ist methodische Schwäche, kein Klassen-Definitions-Problem.

---

## Schritt 2 — offen, Strategie steht

LLM-Klassifikation pro ¶ als REPRODUKTIV oder DISKURSIV. Input: Container-Volltext + Verweisprofil als strukturierter Kontext. Persistenz: ein PASSAGE_KLASSIFIKATION-Konstrukt pro Container.

**Imports waren angefangen** (`grundlagentheorie.ts` hatte zwischendurch `z`, `chat`, `extractAndValidateJSON` importiert) — **wieder rausgenommen** weil Schritt 2 vom User vor Implementation gestoppt wurde. File ist jetzt clean wie nach Schritt 1.

---

## Offen / Refactor-TODO

**Klammer-zentrierte Citation-Heuristik** (User-Vorschlag, dokumentiert für nachhaltigen Refactor):

> "enthält diese Klammer eine Jahreszahl und/oder aaO oder ebd.? Enthält sie eine Seitenzahl 'S. xyz', ', xyz'? Enthält sie überhaupt eine Zahl? wenn nicht ist sie kein Verweis."

Das ist eine architektonisch bessere Heuristik als das aktuelle Author-Pattern-Karneval: 5 Zeilen statt 200, robuster gegen Edge-Cases, weil das diagnostische Merkmal von Citations nicht der Author-Name ist (jeder Stil schreibt den anders), sondern die **Verweis-Struktur in der Klammer** (Jahreszahl + ggf. Seitenangabe + ggf. Verweis-Marker `aaO`/`ebd.`).

Aktueller Pattern-Stand funktioniert empirisch (BA TM: 18 Citations, alle korrekt; Habil: 374 mit Coverage 81 %), aber jeder Edge-Case kostet einen weiteren Patch. Klammer-Heuristik wäre stabilerer Boden.

**Soll als ERSTER Refactor in der Folge-Session passieren**, bevor Schritt 2 dazukommt. Der Schritt-1-Output (Verweisprofil) ist API-seitig stabil — Refactor des Detektors ändert nicht die Schnittstelle.

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

## Lehre für die Folge-Session

Eine **neue Lehre-Memory** wurde angelegt: `feedback_pattern_iteration_vs_simpler_heuristic.md` — bei akademischem Text-Pattern: einfachere Diagnostik (Klammer-zentriert) prüfen, **bevor** Author-Pattern-Vollständigkeit angegangen wird. Diese Session hat ca. 50 k Tokens auf iteratives Pattern-Patchen verbrannt, obwohl der User mit "enthält die Klammer eine Zahl?" eine 5-Zeilen-Heuristik vorschlug.
