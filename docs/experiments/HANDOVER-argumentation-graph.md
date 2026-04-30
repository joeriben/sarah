# Handover — Argumentations-Graph nach Promotion B (Schritt 1+2)

**Last touched:** 2026-04-30
**Last commits (heutige Session, in Reihenfolge):**
- `a958f82` Validierungslauf S1: Methodologische Grundlegung + Schema-Robustheit
- `6b49687` Validierungslauf S2: Schule und Globalität + Truncation-Robustheit
- `c1b6d07` Validierungslauf S3: Anforderungen an Professionalität + Validierungsabschluss
- `8b9dd1d` Promotion B Schritt 1+2: argumentation_graph DEFAULT true + collapse idempotency

## Stand in einem Satz

Die analytische Linie ist nach S3-Pflichtbestandteils-Schärfung an drei
strukturell unterschiedlichen Subkapiteln validiert; **Promotion B ist
beschlossen** (analytisch wird Default, hermeneutisch wird on-demand pro
Subkapitel/Absatz statt Brief-Flag); **Migration 034 ist angewendet**;
`runGraphCollapse` ist **idempotent**. Was fehlt, um Promotion B UI-seitig
wirksam zu machen: Endpoint-Erweiterung mit Auto-Collapse-Trigger und
SSE-Streaming, plus Direction 4 (chapter + document collapse) parallel.

## Validierungsstand (abgeschlossen)

| Subkapitel | Klasse | ¶ | args | scaff | Befund |
|---|---|---|---|---|---|
| Globalität (S0–S3) | B / Theorie-Brücke | 5 | 12 | 12 | ✓ S3-Pflichtbestandteile entwickelt |
| Methodologische Grundlegung | A / Methodologie | 5 | 12 | 19 | ✓ alle vier greifen, Werk-Architektur dünner ohne Failure |
| Schule und Globalität | B / Anwendung | 9 | 30 | 41 | ✓✓ stärker als Globalität |
| Anforderungen an Professionalität | B / normativ-konzeptuell | 13 | 51 | 67 | ✓✓✓ höchstes Niveau, Cross-Subkapitel-Konsistenz |

**Emergente Eigenschaft:** die Pipeline erkennt werkübergreifende
Stilmerkmale ohne Cross-Subkapitel-Prompt ("rezeptiv-applizierend",
"kumulative Nicht-Prüfung des Scheunpflug-Modells durch alle drei
Anwendungs-Subkapitel"). Ermöglicht durch scaffolding-Cross-Anker und
prior-edges, die Subkapitel-Grenzen überschreiten dürfen. Beim weiteren
Pipeline-Ausbau bewusst erhalten.

## Architektur-Entscheidungen heute (alles in Memory dokumentiert)

### Promotion B — analytisch wird Default

- `assessment_briefs.argumentation_graph DEFAULT true` (Migration 034 ✓ angewendet)
- Bestehende Briefs unverändert
- **Hermeneutisch wird KEIN Brief-Flag**, sondern on-demand pro Subkapitel/Absatz (User-Position: "kann später pro Unterkapitel oder Absatz aktiviert werden, sogar automatisiert als Optimierungselement bei niedriger analytischer Konfidenz")
- Begründung der Promotion: hermeneutisch ist gegenüber analytisch *strict dominated* — erfasst dieselben Kontexte, aber permissiv (verwechselt rhetorische Schlussmarker mit validen Argumenten)

### Document-Level-Run als Default-Workflow

Drei-Ebenen-Architektur:
- Atom: `POST .../paragraph/[paragraphId]` (existing, zu erweitern)
- Aggregator: `POST .../subchapter/[headingId]` (neu)
- Orchestrator (Default-Workflow): `POST .../document` (neu)

Mit:
- **SSE-Streaming** für Fortschrittsanzeige
- **Pre-flight-Kostenschätzung** + zwingender `?confirmed_cost_cap=X.XX` Bestätigungs-Parameter
- **Running-Cost-Check** + graceful abort bei Cap-Überschreitung
- **Resume durch Idempotency**: jeder unterbrochene Run kann durch Re-Initiierung dort weitermachen, wo er aufhörte

### Direction 4 — Rekursive Aggregations-Pipeline

Die Pipeline endet heute bei `runGraphCollapse` (Subkapitel-Synthese). Es
fehlen die zwei höheren Aggregations-Ebenen, die ein Document-Level-Run
braucht:

| Level | Input | Output Memo | Existiert? |
|---|---|---|---|
| Paragraph | Text | `argument_nodes`, `scaffolding_elements` | ✓ |
| Subkapitel | Args+Scaffolding | `[kontextualisierend/subchapter/graph]` | ✓ |
| **Hauptkapitel** | Subkapitel-Memos | `[kontextualisierend/chapter/graph]` | ✗ |
| **Werk** | Hauptkapitel-Memos | `[kontextualisierend/document/graph]` | ✗ |

`scope_level` enum muss erweitert werden um `'chapter'` und `'document'`.

Pflichtbestandteils-Profile pro Aggregations-Ebene siehe Memory.
**Designentscheidung offen:** ob die Pflichtbestandteile pro Ebene neu
formuliert werden oder ob das Globalität-Set durchgereicht wird mit
ebene-spezifischer Akzent-Anweisung. Validierungslauf nach Implementation
nötig.

### Direction 3 — Kapiteltyp als Datenmodell-Feature (für 2.0/3.0)

User-Klarstellung: Direction 3 ist **kein** prompt-internes Heuristik-
Feature, sondern eine **Datenmodell-Erweiterung analog zu
`assessment_briefs.work_type`**. `chapter_type` lebt pro Heading,
wird im Synthese-Prompt explizit mitgegeben, manuell überschreibbar.

Schema-Wahl: **Variante II** (eigene Tabelle `chapter_classifications`),
weil Erweiterungen für Reviewer-Kommentare/Revisionen vorgesehen sind
(2.0/3.0).

Kanonische `work_type`-Werte (User-Liste 2026-04-30):
- Hausarbeit BA / Hausarbeit MA
- BA-Arbeit / MA-Arbeit
- Dissertation
- Habilitationsschrift

Direction 3 ist **nicht Teil** der Promotion-B-Implementation. Wartet auf
2.0/3.0.

## Aufgabe der nächsten Session

Promotion B UI-seitig wirksam machen. Reihenfolge:

### Schritt 3: `scope_level` enum erweitern (Migration 035)

```sql
-- Migration 035: extend scope_level enum for recursive aggregation
-- Current values: 'paragraph', 'subchapter'
-- Add: 'chapter', 'document'
ALTER TYPE memo_scope_level ADD VALUE 'chapter';
ALTER TYPE memo_scope_level ADD VALUE 'document';
```

Vorher prüfen, ob `scope_level` ein enum-Typ ist (pg ENUM) oder ein
TEXT-Constraint. Bei TEXT-Constraint anders.

### Schritt 4: `runChapterCollapse` und `runDocumentCollapse`

Vorlage: `runGraphCollapse` in `section-collapse-from-graph.ts`.

`runChapterCollapse(caseId, chapterHeadingId, userId)`:
- Lade alle Subkapitel-Memos `[kontextualisierend/subchapter/graph]` für
  alle Subkapitel innerhalb des chapterHeadings (lookup via
  `document_elements.char_start` zwischen chapter und next-chapter).
- Synthese-Prompt mit Pflichtbestandteilen für Hauptkapitel-Ebene
  (siehe Memory Direction 4).
- Output: `[kontextualisierend/chapter/graph]` Memo.
- Idempotent (skip wenn Memo existiert).

`runDocumentCollapse(caseId, userId)`:
- Lade alle Hauptkapitel-Memos `[kontextualisierend/chapter/graph]`.
- Synthese-Prompt mit Werk-Ebene-Pflichtbestandteilen (Forschungsbeitrag-
  Diagnose, Gesamtkohärenz, Niveau-Beurteilung mit work_type-Akzent).
- Output: `[kontextualisierend/document/graph]` Memo.
- Idempotent.

Plus `maxTokens` ggf. anpassen für die größeren Aggregationen (Werk-
Synthese hat als Input alle Hauptkapitel-Memos, kann substantiell größer
sein als Subkapitel-Synthese).

### Schritt 5: Per-paragraph-Endpoint erweitern

Aktuell triggert er nur `runParagraphPass` (synthetic). Erweiterung:

```typescript
POST /api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]
  ?include_synthetic=true|false  (default: false nach Promotion B)

1. Load brief.
2. If brief.argumentation_graph (= true für neue Briefs nach Migration 034):
     a. await runArgumentationGraphPass(caseId, paragraphId)  // idempotent
     b. After successful pass: check if subchapter is now complete
        (count paragraphs with args/scaffolding vs. total paragraphs of
        subchapter). If yes:
          await runGraphCollapse(caseId, headingId, userId)  // idempotent
          // Then check if chapter is complete (all subchapters have
          // graph-fed memos). If yes:
          await runChapterCollapse(caseId, chapterHeadingId, userId)
          // Then if document is complete:
          await runDocumentCollapse(caseId, userId)
3. If include_synthetic === true:
     await runParagraphPass(caseId, paragraphId, userId)  // synthetic
4. Return: { graphRun?, graphCollapseRun?, chapterCollapseRun?,
            documentCollapseRun?, syntheticRun? }
```

**Subkapitel-Vollständigkeits-Check:** count paragraphs of the subchapter
WHERE id IN (SELECT paragraph_element_id FROM argument_nodes UNION
SELECT paragraph_element_id FROM scaffolding_elements). If count equals
total paragraph count of subchapter → complete.

**Hauptkapitel-Vollständigkeits-Check:** alle Subkapitel-Headings
innerhalb des chapter haben jeweils ein Memo
`[kontextualisierend/subchapter/graph]`.

**Werk-Vollständigkeits-Check:** alle Hauptkapitel-Headings haben jeweils
ein Memo `[kontextualisierend/chapter/graph]`.

### Schritt 6: Subchapter- und Document-Endpoint mit SSE

Beide sind Orchestratoren, die intern den per-paragraph-Pass aufrufen.

`POST /api/cases/[caseId]/hermeneutic/subchapter/[headingId]`:
- Liste alle Paragraphen des Subkapitels in forward order.
- Iteriere, rufe pro Paragraph `runArgumentationGraphPass` (idempotent).
- Streame ein SSE-Event pro Paragraph.
- Am Ende: `runGraphCollapse` + ggf. höhere Ebenen.

`POST /api/cases/[caseId]/hermeneutic/document`:
- Liste alle Paragraphen des Werkes in forward order.
- Pre-flight: paragraph_count zurückgeben mit Kostenschätzung.
- Verlange `?confirmed_cost_cap=X.XX`.
- Iteriere, streame Events. Bei `accumulatedCost > cost_cap` → graceful abort.

SSE-Pattern in SvelteKit:
```typescript
const stream = new ReadableStream({
  async start(controller) {
    // emit events
    controller.enqueue(`event: paragraph_done\ndata: ${JSON.stringify(...)}\n\n`);
    // ...
    controller.close();
  }
});
return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
```

### Schritt 7: Validierung Direction 4

Lauf an einem Hauptkapitel des Timm-Manuskripts (z.B. das Theorie-
Hauptkapitel mit Globalität + Schule und Globalität + Anforderungen an
Professionalität als Subkapitel — alle drei haben bereits Subkapitel-
Memos in der DB). Output gegen die hermeneutische Lektüre prüfen.

Dann Werk-Collapse für das gesamte Manuskript.

Falls die Pflichtbestandteile auf Hauptkapitel/Werk-Ebene anders gewichtet
werden müssen: Prompt-Iteration analog zu S3.

### Schritt 8: Frontend (separat, UI ist noch nicht weit entwickelt)

- Document-Run-Initiator-Komponente: zeigt Pre-flight-Kosten, lässt
  Cost-Cap setzen, Bestätigungs-Click.
- Live-Fortschrittsanzeige während des Runs (SSE-Konsumenten-Komponente).
- Abort-Button.
- Ergebnis-Übersicht: Subkapitel-Synthesen, Hauptkapitel-Synthesen,
  Werk-Synthese hierarchisch dargestellt.
- On-demand-Trigger für hermeneutischen Pass pro Subkapitel/Absatz.

## Files / Pfade

- **Memory** (vollständig): `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md` — alle Architektur-Entscheidungen, Validierungs-Befund, Direction 1–4, Promotion-B-Architektur, work_type-Werte.
- Per-Absatz-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Subkapitel-Synthese: `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts` (jetzt idempotent)
- Endpoint (zu erweitern): `src/routes/api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]/+server.ts`
- Per-Paragraph-Synthetic-Pass: `src/lib/server/ai/hermeneutic/per-paragraph.ts` (`runParagraphPass`)
- Dev driver: `scripts/run-argumentation-graphs.ts`, `scripts/run-graph-collapse.ts`
- Migrations: `migrations/032_argumentation_graph_experiment.sql`, `033_scaffolding_elements.sql`, `034_argumentation_graph_default_true.sql`

## Test-Daten-IDs (Habilitation-Timm)

```
case_id          0abe0588-badb-4e72-b3c4-1edd4a376cb6
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      f7afee4b-729b-4a0d-963e-b3b31c6b3dcc
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

Validierte Subkapitel (Heading-IDs, alle vier haben graph-fed Memos):
- Globalität: `ac0a6c7a-d38c-48ea-9414-55cda02df246`
- Methodologische Grundlegung: `0a13d404-20d7-4422-9e67-72181cf98fa5` → memo `b69e13c5-...`
- Schule und Globalität: `7dee784c-4097-4f7e-80b0-85f3bf7e6f85` → memo `c9e455fd-...`
- Anforderungen an Professionalität: `6e0a1737-8996-49ad-830e-7e2290c3d838` → memo `43e4e0ff-...`

Für Direction-4-Validierung: Hauptkapitel-Heading-ID des Theorie-Kapitels
(das die obigen Subkapitel enthält) muss zuerst gezogen werden — siehe
SQL-Helper unten.

## SQL-Helfer

**Paragraph-IDs für ein gewähltes Subkapitel** (Heading-ID einsetzen):
```sql
SELECT id, char_start
FROM document_elements
WHERE document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
  AND element_type = 'paragraph'
  AND section_kind = 'main'
  AND char_start >= (SELECT char_start FROM document_elements WHERE id = '<HEADING_ID>')
  AND char_start <  COALESCE(
        (SELECT MIN(char_start) FROM document_elements
         WHERE document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
           AND element_type = 'heading' AND section_kind = 'main'
           AND char_start > (SELECT char_start FROM document_elements WHERE id = '<HEADING_ID>')),
        (SELECT length(full_text) FROM document_content
         WHERE naming_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc')
      )
ORDER BY char_start;
```

**Hauptkapitel-Outline** (für Direction 4):
```sql
SELECT id, char_start,
       SUBSTRING((SELECT full_text FROM document_content
                  WHERE naming_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc')
                 FROM char_start FOR (char_end - char_start)) AS heading_text,
       (SELECT count(*) FROM document_elements e2
        WHERE e2.document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
          AND e2.element_type = 'heading' AND e2.section_kind = 'main') AS total_main_headings
FROM document_elements
WHERE document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
  AND element_type = 'heading'
  AND section_kind = 'main'
ORDER BY char_start;
```

Heading-Hierarchie (Hauptkapitel vs. Subkapitel) wahrscheinlich über
`document_elements.heading_level` oder einen analogen Outline-Level —
beim Implementieren prüfen.

## Robustheits-Stand der Pipeline (alle commited)

- `anchor_phrase` cap 80 → 500 chars (sanity); Style-Warning ≥ 80
- `scaffolding.excerpt` cap 500 → 1000 chars (sanity); Style-Warning ≥ 500
- `maxTokens` 4000 → 8000 (per-paragraph), 2000 → 4000 (subchapter synthesis)
- JSON.parse / Schema-Validation Failure dumpt raw response nach `/tmp/...failure-*.txt`
- typographic-quote repair für DOCX/OCR-Artefakte
- premise-Schema permissiv: unknown types → `background` mit inline marker
- `runGraphCollapse` idempotent (skipt mit existingMemoId)
- `runArgumentationGraphPass` idempotent (skipt wenn argument_nodes/scaffolding_elements existieren)

## LLM

`mammouth claude-sonnet-4-6`. Key in `mammouth.key` (gitignored).

## Nächste konkrete Aktion

Migration 035 (`scope_level` enum erweitern) und `runChapterCollapse`-
Funktion schreiben. Beides architektonisch low-risk, klare Vorlage in
`runGraphCollapse`. Danach `runDocumentCollapse`. Erst dann den Endpoint-
Umbau angehen, weil der Endpoint die volle Aggregations-Hierarchie
auto-triggern soll und die höheren Funktionen vorher existieren müssen.
