# Handover — Argumentations-Graph-Experiment, Stand nach Validierungsstrecke

**Last touched:** 2026-04-30
**Last commits:**
- `a958f82` (Validierungslauf S1: Methodologische Grundlegung + Schema-Robustheit)
- `6b49687` (Validierungslauf S2: Schule und Globalität + Truncation-Robustheit)
- (pending) Validierungslauf S3: Anforderungen an Professionalität

## Stand in einem Satz

Die analytische Linie (Migrations 032+033) ist nach S3-Pflichtbestandteils-
Schärfung an drei strukturell unterschiedlichen Subkapiteln (Methodologische
Grundlegung, Schule und Globalität, Anforderungen an Professionalität)
empirisch validiert; die Stoppregel des vorigen Handovers ist erfüllt.

## Was zuletzt passierte (Validierungsstrecke)

| Subkapitel | Klasse | ¶ | args | scaff | Synthese-Befund |
|---|---|---|---|---|---|
| Methodologische Grundlegung | A / standardisiert | 5 | 12 | 19 | ✓ alle vier Pflichtbestandteile greifen, Werk-Architektur dünner ohne Failure-Modus |
| Schule und Globalität | B / Anwendung | 9 | 30 | 41 | ✓✓ stärker als Globalität; integrative Spannungsdiagnose erfasst Konzept-Anwendungs-Lücke |
| Anforderungen an Professionalität | B / normativ-konzeptuell | 13 | 51 | 67 | ✓✓✓ höchstes Niveau, Cross-Subkapitel-Konsistenz |

**Bemerkenswerte emergente Eigenschaft:** die Pipeline erkennt
werkübergreifende Stilmerkmale ohne Cross-Subkapitel-Prompt
("rezeptiv-applizierend statt kritisch-erprobend"; "kumulative
Nicht-Prüfung des Scheunpflug-Modells durch alle drei Anwendungs-Subkapitel"
mit konkreter Argument-Identifikation aus früherem Subkapitel).
Ermöglicht durch scaffolding-Cross-Anker und prior-edges, die
Subkapitel-Grenzen überschreiten.

**Pipeline-Robustheits-Patches** (durch reale Failures der Validierungsläufe
getrieben, nicht over-engineering):
- `anchor_phrase` 80 → 500 chars (sanity cap; Style-Warning ≥ 80)
- `scaffolding.excerpt` 500 → 1000 chars (sanity cap; Style-Warning ≥ 500)
- `maxTokens` 4000 → 8000 (per-paragraph), 2000 → 4000 (synthesis)
- JSON.parse/Schema-Failure: raw response wird nach `/tmp/...failure-*.txt`
  gedumpt vor Exception-Propagation

## Aufgabe der nächsten Session

**Promotion-Entscheidung treffen** und ggf. die zwei resultierenden Arbeiten
durchziehen:

### Frage 1: Promotion der analytischen Linie

Vorige Handover-Frage wörtlich: "ab welchem Validierungsstand kann die
hermeneutische Linie ernsthaft als optional gestellt werden? Mindestens 3
strukturell unterschiedliche Subkapitel mit konsistenter S3-Qualität."

Stand: Hürde erfüllt (Klasse-A-Methodologie + zwei Klasse-B-Subkapitel mit
unterschiedlichem Profil).

Implikationen einer "ja"-Entscheidung sind nachzudenken (was ändert sich am
Brief-Default? Endpunkt-Verhalten? UI?). Empfehlung in der Session-Diskussion
entwickeln.

### Frage 2: Direction-3 Klasse A implementieren

Bei Klasse-B-Subkapiteln (Anwendung, normativ-konzeptuell, Theorie-Brücke)
greift das aktuelle Globalität-Set ohne Anpassung — der LLM erkennt das
Profil aus dem Material. Bei Klasse-A-Subkapiteln (funktional standardisiert)
wird ein Bestandteil dünner (Werk-Architektur bei Methodologie-Kapiteln).

Empfehlung: Heading-Heuristik einführen, die Klasse-A-Subkapitel klassifiziert
("Methodik|Methoden|Methodologie", "Einleitung|Forschungsfrage", "Fazit|
Konklusion|Schlussbetrachtung", "Durchführung|Datenerhebung"), und das
Synthese-Prompt typ-spezifisch akzentuiert. Datengestützte Profile pro
Standardkapiteltyp siehe Memory `project_argumentations_graph_experiment.md`
Direction 3.

Voraussetzung vor Implementierung: Klärung mit User, ob hartes Set-Switch
oder weiche Akzent-Anweisung im Prompt.

### Frage 3: API-Endpoint erweitern

Aktuell triggert der Endpoint `src/routes/api/cases/[caseId]/hermeneutic/
paragraph/[paragraphId]/+server.ts` nur den synthetischen Pass. Wenn die
analytische Linie produktiv geht: Endpoint erweitern, sodass bei
`brief.argumentation_graph=true` zusätzlich der analytische Pass läuft (und
am Subkapitel-Ende der graph-fed collapse). Auch der Subkapitel-Synthese-
Endpoint muss bei dem Brief-Flag den `runGraphCollapse` zusätzlich anstoßen.

Trigger-Logik:
- per-paragraph: nach `runHermeneuticPass` (synthetic) ggf. auch
  `runArgumentationGraphPass` (analytical) — heute manuell, künftig
  automatisch wenn Flag.
- per-subchapter: nach dem letzten Paragraphen-Pass ggf. auch
  `runGraphCollapse` zusätzlich zum synthetischen `runSectionCollapse`.

## Files / Pfade

- Memory: `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md` — vollständige Architektur-Notiz, mit Validation-Tabelle, Cross-Subkapitel-Erkenntnis und Robustheits-Updates.
- Per-Absatz-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Subkapitel-Synthese: `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts`
- Dev driver Per-Absatz: `scripts/run-argumentation-graphs.ts`
- Dev driver Synthese: `scripts/run-graph-collapse.ts`
- Vergleichsbericht-Renderer: `scripts/render-graph-comparison.ts`
- Bisheriger Bericht (nur Globalität): `docs/experiments/argumentation-graph-globalitaet.md` — die drei Validierungs-Subkapitel sind bisher nicht in einen Side-by-side-Bericht geflossen; die Synthese-Outputs sind in der DB persistiert (siehe Memo-IDs unten).
- Migrations: `migrations/032_argumentation_graph_experiment.sql` + `033_scaffolding_elements.sql`

## Test-Daten-IDs (Habilitation-Timm)

```
case_id          0abe0588-badb-4e72-b3c4-1edd4a376cb6
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      f7afee4b-729b-4a0d-963e-b3b31c6b3dcc
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

Validierte Subkapitel (Heading-IDs):
- Globalität: `ac0a6c7a-d38c-48ea-9414-55cda02df246`
- Methodologische Grundlegung: `0a13d404-20d7-4422-9e67-72181cf98fa5`
- Schule und Globalität: `7dee784c-4097-4f7e-80b0-85f3bf7e6f85`
- Anforderungen an Professionalität: `6e0a1737-8996-49ad-830e-7e2290c3d838`

Synthese-Memos (in `appearances` mit inscription `[kontextualisierend/subchapter/graph]`):
- Methodologische Grundlegung: `b69e13c5-5fec-4384-9df6-c2df0698e038`
- Schule und Globalität: `c9e455fd-e4b3-4116-b6a0-9bda68a0d3ad`
- Anforderungen an Professionalität: `43e4e0ff-87b3-4273-948a-f7f8fb445fd2`

LLM: `mammouth claude-sonnet-4-6`. Key in `mammouth.key` (gitignored).

## SQL-Helfer für IDs eines neuen Subkapitels

```sql
-- Paragraph-IDs für ein gewähltes Subkapitel (Heading-ID einsetzen):
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

## Stoppregel (für künftige Validierungsläufe an weiteren Subkapiteln)

Aktuelle Stoppregel ist erfüllt — die analytische Linie ist promotionsreif.
Für *neue* Subkapitel-Typen (z.B. Diskussion, Forschungsstand-Kapitel,
empirische Befunddarstellung) gilt: einzelne Validierungsläufe können
weiterhin Erkenntnisgewinn bringen, sind aber nicht mehr stoppend.
Direction-3-Klasse-B-Subtypisierung wartet auf konkreten Bedarf, nicht auf
Validierung um ihrer selbst willen.
