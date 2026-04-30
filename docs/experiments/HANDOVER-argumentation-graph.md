# Handover — Argumentations-Graph-Experiment, Stand nach S3

**Last touched:** 2026-04-30
**Last commits:** `0c5ed43` (full pipeline), `8d492d9` (Synthese-Pflichtbestandteile)

## Stand in einem Satz

Die analytische Linie (Migrations 032+033) liefert nach Pflichtbestandteils-Schärfung des Synthese-Prompts an Globalität §1–§5 ein Ergebnis, das die hermeneutisch-synthetische Lektüre stellenweise schlägt. Validierung an weiteren Subkapiteln steht aus.

## Was zuletzt passierte

Drei Synthese-Läufe an Globalität (S1, S2, S3) zeigten zwei reproduzierbare Lücken der ersten Versionen gegenüber der hermeneutisch-synthetischen Variante:
- Kernbewegung wurde nicht "gekrönt", sondern als Auffälligkeit notiert.
- Werk-Architektur-Verortung verlor die Rückbindung an das vorherige Subkapitel.
- Mehrere Schwächen wurden als Liste statt als integrative Spannungsdiagnose ausgegeben.

Lösung: vier Pflichtbestandteile (argumentative Bewegung / Kernbewegung-Identifikation / Werk-Architektur-Verortung / integrative Spannungsdiagnose) explizit in die Prompt-Anweisung. Resultat in S3: die Synthese ist *schärfer* als die hermeneutische Variante, ohne deren Tiefe zu verlieren — siehe `docs/experiments/argumentation-graph-globalitaet.md` Sektion "Kontextualisierende Synthese (graph-fed)".

## Aufgabe der nächsten Session

**Validieren, ob S3-Schärfe stabil ist über strukturell unterschiedliche Subkapitel-Typen** — oder eine Eigenheit von Globalität war.

Empfohlene Reihenfolge:
1. **Methodologische Grundlegung** (5 ¶, Heading-ID `0a13d404-20d7-4422-9e67-72181cf98fa5`, char_start 106782) — methodisch-prozedurales Material, anders strukturiert als die theoretische Begriffsarbeit von Globalität. Cheapest first probe (~$0.20 + $0.05 für die Synthese).
2. Falls (1) erfolgreich: **Schule und Globalität** (9 ¶, `7dee784c-4097-4f7e-80b0-85f3bf7e6f85`, char_start 64261) — angewandter Kontext, verwendet das Globalitäts-Konzept; gibt Hinweise ob die analytische Linie Anwendungstexte gleich gut erfasst.
3. Falls (2) erfolgreich: **Anforderungen an die Professionalität von Lehrkräften** (13 ¶, `6e0a1737-8996-49ad-830e-7e2290c3d838`) — größerer Lauf, normativ-konzeptuell.

Pro Subkapitel:
- Per-Absatz-Pass via angepasster `scripts/run-argumentation-graphs.ts` (PARAGRAPH_IDS-Array austauschen — IDs aus `document_elements WHERE element_type='paragraph' AND char_start BETWEEN heading.char_start AND next_heading.char_start ORDER BY char_start`)
- Graph-fed Collapse via angepasster `scripts/run-graph-collapse.ts` (SUBCHAPTER_HEADING_ID austauschen)
- Side-by-side Vergleich mit der existierenden hermeneutischen Lektüre, falls vorhanden

## Was zu prüfen ist

- Bleibt die **Kernbewegung-Identifikation** verlässlich, wenn der Text keine offensichtliche deskriptiv→normativ-Struktur hat (z.B. methodische Begründungen, Anwendungsbeispiele)?
- Bleibt die **Werk-Architektur-Verortung** sinnvoll bei Subkapiteln, die nicht Theorie-Brücken sind?
- Schlägt die **integrative Spannungsdiagnose** in einen Modus um, der Spannungen *konstruiert* wo keine sind? (Failure-Modus: das LLM zwingt sich zu einer Diagnose, weil sie als Pflichtbestandteil markiert ist.)
- Wenn ein Subkapitel argumentationsstrukturell *schwach* ist (kaum cross-Edges, viele scaffolding-Inseln): erkennt die Synthese das, oder simuliert sie eine Bewegungsfigur?

## Files / Pfade

- Memory: `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md` — vollständige Architektur-Notiz
- Per-Absatz-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Subkapitel-Synthese: `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts`
- Dev driver Per-Absatz: `scripts/run-argumentation-graphs.ts`
- Dev driver Synthese: `scripts/run-graph-collapse.ts`
- Vergleichsbericht-Renderer: `scripts/render-graph-comparison.ts`
- Bisheriger Bericht: `docs/experiments/argumentation-graph-globalitaet.md`
- Migrations: `migrations/032_argumentation_graph_experiment.sql` + `033_scaffolding_elements.sql`

## Test-Daten-IDs (Habilitation-Timm)

```
case_id          0abe0588-badb-4e72-b3c4-1edd4a376cb6
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      f7afee4b-729b-4a0d-963e-b3b31c6b3dcc
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

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

## Offene Designfragen

- **Direction 1** (FFN/Backprop-retrograder Pass) im Memory skizziert — würde forward-references und strukturelle Argument-Zentralitätsmetriken liefern. Aktuell macht S3 die Kernbewegung-Identifikation per LLM-Inferenz; ein graph-strukturelles Ranking wäre verlässlicher. Erwägen, sobald 2–3 Subkapitel validiert sind.
- **Promotion-Frage**: ab welchem Validierungsstand kann die hermeneutische Linie ernsthaft als optional gestellt werden? Mindestens 3 strukturell unterschiedliche Subkapitel mit konsistenter S3-Qualität.
- **API-Endpoint** triggert aktuell nur den synthetischen Pass (`src/routes/api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]/+server.ts`). Wenn analytische Linie produktiv geht: Endpoint erweitern, sodass bei `brief.argumentation_graph=true` zusätzlich der analytische Pass läuft.

## Stoppregel

Wenn die Validierungsläufe an (1) und (2) zeigen, dass S3-Schärfe nur an Globalität funktioniert: zurück an die Prompt-Werkbank, erst danach Direction 1 erwägen. Prompt-Iteration ist billiger als Architektur-Erweiterung.
