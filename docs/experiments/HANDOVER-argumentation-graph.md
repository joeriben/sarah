# Handover — Parser-Fix Heading-Hierarchie + Numerierung

**Last touched:** 2026-04-30 (zweite Session des Tages)
**Vorheriger Handover-Stand:** commit `696c553` (Direction 4 als Hauptaufgabe der nächsten Session)
**Diese Session liefert nur:** Parser-Fix für Heading-Hierarchie. Direction 4 wird verschoben — siehe Reihenfolge unten.

## Stand in einem Satz

Bei der Inspektion vor Direction-4-Implementation fiel auf, dass im
Test-DOCX (Habilitation-Timm) **alle Headings auf level=1** in der DB
landen, obwohl das PDF eine 3-Ebenen-Hierarchie zeigt. Diagnose: bei
PDF→DOCX-Export wird der TOC-pStyle uniform auf TOC1 geflacht; die
Hierarchie steckt in `<w:numPr><w:ilvl/></w:numPr>` der TOC-Paragraphen,
die der bisherige Parser ignorierte. Fix in `docx-academic.ts` ist
implementiert + in-memory verifiziert; **Re-Import + DB-Verifikation
sind der erste Schritt der nächsten Session**.

## Was diese Session geliefert hat

### Parser-Fix in `src/lib/server/documents/parsers/docx-academic.ts`

- Neuer Helper `readNumPrIlvl(p)` extrahiert die Word-Auto-Numbering-Tiefe
  (0-indexed) aus `<w:pPr><w:numPr><w:ilvl/>`.
- **TOC-Pre-Pass** nutzt jetzt zwei Quellen in dieser Reihenfolge:
  1. `numPr/ilvl + 1` — primär (überlebt PDF→DOCX)
  2. `pStyle.slice(3)` (TOC1..TOC9) — Fallback
- **Counter-Array** über alle TOC-Einträge mit ilvl berechnet die
  synthetische arabische Numerierung ("1", "1.1", "1.2.2") nach Position.
- Neue Bookmark-Map `bookmarkToNumbering` reicht die Numerierung an die
  Body-Headings durch.
- `properties.numbering` an `heading`- und `toc_entry`-Elementen
  speichert die Position; Heading-Text bleibt unverändert (Konsumenten
  rendern `${numbering} ${text}` selbst).
- `properties.numbering_mismatch` warnt, falls der Body-Heading-Text
  bereits eine Author-Numerierung trägt, die von der synthetic abweicht
  (kein Stripping, nur Diagnose).

### In-Memory-Verifikation

`scripts/inspect-docx-hierarchy.ts` läuft den Parser auf einem DOCX-File
und druckt TOC-Einträge + Headings mit Level + Numerierung. Output für
Habilitation-Timm:

| Vorher (DB) | Nachher (Parser) | |
|---|---|---|
| 48× L1 + 1× L2 (alle ohne numbering) | 4× L1 + 14× L2 + ~33× L3 (mit numbering) | Hauptkapitel 1+2+4 vollständig |

Validierte Subkapitel der vorherigen Session:
- Globalität: L3, **num=1.2.2** (vorher fälschlich L1)
- Methodologische Grundlegung: L3, **num=2.1.2**
- Schule und Globalität: L3, **num=1.3.2**
- Anforderungen an Professionalität: L3, **num=1.3.3**

## Bekannte Edge-Cases (für User-Validierungs-Feature)

Im Test-DOCX gibt es 2 main-Headings, die im TOC zwar korrektes `ilvl`
tragen, aber **keinen `<w:hyperlink anchor>`** — der Body-Heading wird
via pStyle erkannt (L1 bzw. L2), aber das Numbering kann nicht über die
Bookmark-Map weitergereicht werden:

- "Vergleichshorizonte" — TOC-ilvl=2, kein anchor → sollte num=2.2.2 sein
- "Reflexionen der kulturbezogenen Orientierungen" — TOC-ilvl=0, kein
  anchor → **Hauptkapitel #3**, sollte num=3 sein

Title-Match als Fallback wurde **verworfen** (User-Position 2026-04-30):
nicht generell robust gegen Konverter-Quirks (mehrfach gespaltene
Heading-Texte, fehlerhafte Word-Auto-Numbering etc.). Stattdessen:
**User-Validierungs-Feature** — Outline-Ansicht im UI, User bestätigt /
korrigiert jede Hierarchie-Zuweisung, Pipeline läuft erst nach
Bestätigung.

## Architektur-Entscheidungen dieser Session

1. **Hierarchie-Quelle** ist das **TOC** (numPr/ilvl), nicht der Body-pStyle.
2. **Numerierung wird synthetisch berechnet** (Counter-Array), nicht aus
   Author-Text geparst. Robust gegen Author-Lücken; bei Diskrepanz
   Warning auf `properties.numbering_mismatch`.
3. `properties.numbering` ist **zusätzliches Feld**, der Heading-Text
   bleibt unverändert — bestehende Konsumenten (Memo-Loader,
   substring-basiertes heading-label) sind nicht betroffen.
4. **PDF-Pfad** und Onboard-PDF→DOCX-Konvertierung wurden verworfen
   (Memory: DOCX is the document standard).
5. **Konverter-Edge-Cases** (fehlende anchors, gequetschte ilvl) gehören
   nicht in heuristische Parser-Fixes, sondern in eine User-Validierungs-
   Schicht. Architektur-Konsequenz: TOC-Validierung wird Teil des
   Onboarding-Flows.

## Nächste Session — Reihenfolge

### Schritt 1: Benchmark-Export der bestehenden Test-Daten

`reparseDocument` löscht via CASCADE alle abhängigen Daten
(`argument_nodes`, `scaffolding_elements`, `argument_edges`,
`scaffolding_anchors`, `memo_content`). Vor dem Re-Import exportieren:

- 4 graph-fed Subkapitel-Memos `[kontextualisierend/subchapter/graph]`
  (`mc.content` = synthese, `appearances.properties.auffaelligkeiten`)
- Pro validiertem Subkapitel: alle `argument_nodes`, `argument_edges`,
  `scaffolding_elements`, `scaffolding_anchors`
- Paragraph-Texte mit `char_start`/`char_end` (zur Wieder-Anschließbarkeit
  über Position, weil UUIDs nach Re-Import neu vergeben werden)
- Optional: synthetic-hermeneutic Memos (`[kontextualisierend/subchapter]`,
  `[interpretierend]`, `[formulierend]`) als Quervergleich

Output-Pfad-Vorschlag: `docs/experiments/benchmark-pre-parser-fix-2026-04-30/`
mit `subchapter-{globalitaet,methodologische-grundlegung,schule-und-globalitaet,
anforderungen-an-professionalitaet}.json` + Markdown-Renderings.

### Schritt 2: Re-Import-Test

```typescript
import { reparseDocument } from '$lib/server/documents/parsers';
// Über admin-route oder script:
//   POST /api/admin/reparse-documents  (existiert)
//   oder: src/routes/api/projects/[projectId]/documents/[docId]/parse/+server.ts
```

DB-Verifikation:

```sql
-- Heading-Level-Distribution sollte 1/2/3 zeigen
SELECT properties->>'level' AS level, COUNT(*) FROM document_elements
 WHERE document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
   AND element_type = 'heading' AND section_kind = 'main'
 GROUP BY 1 ORDER BY 1;

-- Numerierung am main-heading sichtbar
SELECT properties->>'level' AS lvl, properties->>'numbering' AS num,
       substring((SELECT full_text FROM document_content
                  WHERE naming_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc')
                 FROM char_start+1 FOR LEAST(char_end-char_start, 60)) AS heading
  FROM document_elements
 WHERE document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
   AND element_type = 'heading' AND section_kind = 'main'
 ORDER BY char_start;
```

Erwartung (basiert auf Inspect-Lauf):
- L1 ≈ 4–6 (Hauptkapitel + ggf. ein paar nicht-numerierte vor Schule)
- L2 ≈ 14
- L3 ≈ 30+
- 2 main-Headings ohne numbering: Vergleichshorizonte, Reflexionen
  (für Schritt 3)

### Schritt 3: User-Validierungs-Feature

Konzept:
- Nach DOCX-Import eine **Outline-Ansicht** im UI: alle Headings mit
  detected level + numbering, hierarchisch dargestellt
- Pro Heading: bestätigen / level ändern / numbering überschreiben / als
  Nicht-Hauptkapitel markieren
- "Pipeline starten"-Button blockiert bis User-Status `confirmed`
- Re-Import bewahrt User-Korrekturen, sofern Wieder-Anschließbarkeit
  (über Heading-Text-Match oder char_start) möglich ist

Offene Architektur-Fragen für die nächste Session:
- DB-Schema: Spalte an `document_elements.properties` (`user_confirmed_level`,
  `user_confirmed_numbering`) oder eigene Tabelle `heading_classifications`?
  (Variante II analog zur in `project_argumentations_graph_experiment.md`
  skizzierten `chapter_classifications`-Tabelle für Direction 3 ist eine
  Option — beide Features würden dann zusammenfallen.)
- UI-Pattern: drag/drop-Tree oder formularbasiert?
- Bestätigungs-Granularität: per Heading oder per Werk?
- Beziehung zu Direction 3 (`chapter_type`, vgl. Memory): potentiell
  vereinte UI für Heading-Klassifikation **und** Kapiteltyp-Klassifikation.

### Schritt 4: Pipeline für die 4 validierten Subkapitel neu laufen lassen

Nach Re-Import + User-Validierung:
- `runArgumentationGraphPass` pro Paragraph (idempotent, skipt wenn da)
- `runGraphCollapse` pro Subkapitel
- Vergleich gegen Benchmark aus Schritt 1: sind die Argument-Strukturen
  reproduzierbar? Sind die Synthesen vergleichbar?

Kosten: ~$0.30–0.50 (4 Subkapitel × ~$0.10–0.13 graph-pass + collapse).

### Schritt 5: Direction 4 (chapter + work collapse)

Implementations-Skizze ist ausführlich in
`~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md`
Sektion "Direction 4". Mit korrekter Heading-Hierarchie + numbering aus
diesem Parser-Fix wird die Subkapitel→Hauptkapitel→Werk-Identifikation
trivial: `level > chapter.level && numbering startsWith chapter.numbering + '.'`.

Kurzfassung:
- `runChapterCollapse(caseId, chapterHeadingId, userId)`
- `runWorkCollapse(caseId, userId)`
- Beide idempotent, Vorlage `runGraphCollapse`
- `scope_level` CHECK-Constraint erlaubt bereits `'chapter'` und `'work'`
  (Migration 030) — keine Migration 035 nötig
- Memo-Inscription `[kontextualisierend/chapter/graph]` und
  `[kontextualisierend/work/graph]`
- Werk-Memo: scope_element_id = first main heading (Buch-Titel)

### Schritt 6: Endpoint-Erweiterung mit SSE + Auto-Trigger

Siehe altes Handover (commit 696c553) — unverändert relevant:
- per-paragraph-Endpoint mit Auto-Collapse-Trigger
- subchapter- und document-Endpoint mit SSE-Streaming
- Pre-flight cost-cap + Running-cost-check
- Resume durch Idempotency

## Files / Pfade

- Parser-Fix: `src/lib/server/documents/parsers/docx-academic.ts`
- Inspect-Skript (kein DB-Effekt): `scripts/inspect-docx-hierarchy.ts`
- Re-Import-Funktion: `src/lib/server/documents/parsers/index.ts` (`reparseDocument`)
- Re-Import-Endpoints: `src/routes/api/admin/reparse-documents/+server.ts`,
  `src/routes/api/projects/[projectId]/documents/[docId]/parse/+server.ts`
- Subkapitel-Synthese (graph-fed): `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts`
- Per-Paragraph-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Argumentations-Graph Memory: `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md`

## Test-Daten-IDs (Habilitation-Timm)

```
case_id          0abe0588-badb-4e72-b3c4-1edd4a376cb6
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      f7afee4b-729b-4a0d-963e-b3b31c6b3dcc
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
docx_path        projekte/habilitation-timm/files/f0a8bf77-6926-45b4-b474-0a1709ae21fb.docx
```

Validierte Subkapitel (graph-fed Memos noch in der DB, Numerierung kommt
nach Re-Import):

| Subkapitel | Heading-ID (gilt nur bis Re-Import) | Numerierung nach Fix |
|---|---|---|
| Globalität | `ac0a6c7a-d38c-48ea-9414-55cda02df246` | 1.2.2 |
| Methodologische Grundlegung | `0a13d404-20d7-4422-9e67-72181cf98fa5` | 2.1.2 |
| Schule und Globalität | `7dee784c-4097-4f7e-80b0-85f3bf7e6f85` | 1.3.2 |
| Anforderungen an Professionalität | `6e0a1737-8996-49ad-830e-7e2290c3d838` | 1.3.3 |

**Wichtig**: Nach `reparseDocument` werden alle `document_elements`-UUIDs
neu vergeben. Wieder-Anschließen über `char_start`/`char_end` oder
Heading-Text. Benchmark-Export (Schritt 1) muss diese Position-Information
mit-exportieren.

## Robustheits-Stand (unverändert seit voriger Session)

- `anchor_phrase` cap 80 → 500 chars (Style-Warning ≥ 80)
- `scaffolding.excerpt` cap 500 → 1000 chars (Style-Warning ≥ 500)
- `maxTokens` 4000 → 8000 (per-paragraph), 2000 → 4000 (subchapter synthesis)
- JSON.parse-Failure dumpt raw response nach `/tmp/...failure-*.txt`
- typographic-quote repair für DOCX/OCR-Artefakte
- premise-Schema permissiv (unknown types → `background` mit inline marker)
- `runGraphCollapse` + `runArgumentationGraphPass` idempotent

## LLM

`mammouth claude-sonnet-4-6`. Key in `mammouth.key` (gitignored).

## Nächste konkrete Aktion

**Schritt 1 starten: Benchmark-Export-Skript schreiben.** Eingabe: die
4 validierten Subkapitel-IDs. Ausgabe: JSON + Markdown unter
`docs/experiments/benchmark-pre-parser-fix-2026-04-30/`. Dann mit User
abstimmen, ob der Re-Import losgeht.
