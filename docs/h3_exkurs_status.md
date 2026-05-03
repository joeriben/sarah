# H3:EXKURS — Status

Eigenständige Status-Doku der EXKURS-Heuristik (parallel zu `h3_grundlagentheorie_status.md` für die Pyramide und `h3_implementation_status.md` für FORSCHUNGSDESIGN).

Letztes Update: 2026-05-04 (Architektur nach Variante-C-Verwerfung auf destruktive FG-Modifikation umgestellt; formal gegen BA H3 dev validiert; semantisch echter EXKURS-Test offen).

---

## Architektur — Iteration

### Vormittags 2026-05-04 — Variante C (verworfen)

EXKURS produziert ein eigenständiges `RE_SPEC_AKT`-Konstrukt am EXKURS-Anker; FG-Konstrukt bleibt byte-identisch unverändert. Stack-Diff als Reviewer-Indikator über Query auf RE_SPEC_AKT-Sequenz.

**Problem**: Variante C verändert den FG für nachgelagerte Heuristiken nicht. FORSCHUNGSDESIGN/SYNTHESE/SR lesen FG direkt per SELECT und sähen ohne zusätzlichen Aggregator-Read die RE_SPEC_AKTE nicht. Implementation würde alle FG-Konsumenten zu Aggregator-Reads zwingen — User-Befund: zu umständlich, weit weg von der epistemischen Bewegung.

### Mittags 2026-05-04 — Vereinfachte Variante (umgesetzt)

EXKURS modifiziert das vorhandene FORSCHUNGSGEGENSTAND-Konstrukt direkt:

- `function_constructs.content` wird durch eine LLM-rekomponierte neue Version ersetzt (vollständiger neuer FG-Text in 3–5 Sätzen + ggf. ergänzte `subjectKeywords`)
- `function_constructs.version_stack` bekommt einen `re_spec`-Eintrag mit Metadata (`source_exkurs_anchors`, `imported_concepts`, `affected_concepts`, `re_spec_text`, `exkurs_anchor_text`, `content_snapshot` des neuen Stands)

**Wirkung**: Konsumenten (FORSCHUNGSDESIGN, später SYNTHESE/SR/WERK_*) lesen FG ganz normal per SELECT und bekommen den re-spezifizierten Stand. Keine Code-Änderung in den Folge-Heuristiken nötig.

**Audit-Trail**: bleibt im `version_stack` (`origin` + `re_spec`-Einträge). Aktuell nicht instrumentiert.

---

## Pipeline (eine Stufe pro EXKURS-Container)

```
pro EXKURS-Container im Werk (outline-sortiert):
  1 LLM-Call mit Input:
    - FRAGESTELLUNG (aus EXPOSITION)
    - priorForschungsgegenstandText (aktueller FG-Stand, ggf. nach früheren EXKURS-Re-Spezifikationen)
    - priorSubjectKeywords
    - EXKURS-Container-¶ (alle)
  → JSON-Output:
    - importedConcepts: [{name, sourceAuthor|null}, ...]
    - affectedConcepts: [string, ...] (bevorzugt aus priorSubjectKeywords)
    - newForschungsgegenstandText: vollständiger neuer FG-Text (ersetzt prior 1:1)
    - newSubjectKeywords: aktualisierte Liste (3–7 Begriffe)
    - reSpecText: 1–3 Sätze deskriptive Beschreibung der vollzogenen Umdeutung
    - exkursAnchorText: Anlass-Text aus EXKURS selbst | null
    - noRespec: true bei reiner Hintergrund-/Methoden-Notiz ohne echten Re-Spec
  Persistenz:
    - bei noRespec=true: nichts schreiben, FG bleibt 1:1 unverändert
    - sonst: UPDATE FG (content=neuer Stand, version_stack=filtered+append)
```

Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`. Max-Tokens 1500. Konfigurierbar via `modelOverride`.

### Idempotenz

- Vor Stack-Append: bestehende `re_spec`-Einträge mit identischem `source_exkurs_anchors`-Set werden aus dem Stack entfernt. Re-Run für gleichen EXKURS = ein `re_spec`-Eintrag.
- `content` wird via `rebuildContentFromStack` aus dem gefilterten Stack errechnet — letzter `re_spec`-Eintrag bestimmt aktuellen Stand. Wenn keine `re_spec`-Einträge mehr da sind (alles weggefiltert), fällt content auf `origin.content_snapshot` zurück.
- FRAGESTELLUNG wird nur gelesen, nie geschrieben. FORSCHUNGSGEGENSTAND-Konstrukt-Row wird modifiziert (gleiche `id` bleibt), nicht dupliziert.
- Diagnose-Output zeigt Count beider vorgelagerten Konstrukt-Typen + WARN bei >1 (Sichtbarmachung von Bestand-Duplikaten ohne Auto-Cleanup).

### Sequenzialität bei mehreren EXKURSEN im Werk

Container werden outline-sortiert geladen. Pro EXKURS wird zuerst der aktuelle FG-Stand neu aus DB geladen, sodass jeder EXKURS auf dem bereits re-spezifizierten Stand des vorigen aufsetzt. Damit entsteht ein lineares, sequenzielles Re-Spec-Geschehen.

---

## Implementation

| Datei | Inhalt |
|---|---|
| `src/lib/server/ai/h3/exkurs.ts` | `loadExkursContainers`, `loadFragestellungWithDiagnostics`, `loadForschungsgegenstandWithDiagnostics` (gibt Stack zurück), `extractRespec` (LLM mit zwei-teiliger Aufgabe: Analyse + neuer FG-Text), `applyRespecToForschungsgegenstand` (idempotenter UPDATE), `rebuildContentFromStack`, `runExkursPass` |
| `scripts/test-h3-exkurs.ts` | CLI-Test mit `--persist`, `--mark-as-exkurs="<heading-substring>"` (temp-Markierung + FG-Snapshot mit auto-restore im finally) |

Konstrukt-Bezeichnungen: `RE_SPEC_AKT` als eigenständiger `construct_kind` ist **entfallen**. Stattdessen `version_stack`-Einträge mit `kind='re_spec'` am bestehenden FORSCHUNGSGEGENSTAND-Konstrukt.

### Test-Skript-Convenience

`--mark-as-exkurs="<heading-substring>"`:
1. Snapshot des FORSCHUNGSGEGENSTAND-Konstrukts (id + content + version_stack) vor Lauf
2. Markiert ein bestehendes GRUNDLAGENTHEORIE-Heading temporär als EXKURS
3. Läuft den Pass
4. Im finally: FG-Snapshot zurück (UPDATE auf Vor-Lauf-Stand) + Klassifikations-Restore. Beide unabhängig — wenn eines fehlschlägt, das andere trotzdem versuchen. Crash-safe (SQL-Snippets im Fehler-Output).

---

## Verifikation 2026-05-04

### TSC clean

`exkurs.ts` und `test-h3-exkurs.ts` ohne Type-Errors. Workaround für bestehenden Project-Type-Issue im JSON-Extract-Pattern via `'in'`-Guard (siehe Offene Punkte).

### No-op-Lauf gegen BA H3 dev (Case `c42e2d8f-…`, kein EXKURS im Bestand)

- 0 LLM-Calls
- Diagnose: 1 FRAGESTELLUNG, 1 FORSCHUNGSGEGENSTAND (keine Duplikate)
- 0 EXKURS-Container → no-op-Pass terminiert sauber
- 64ms (DB-Reads only)

### Funktionaler Lauf mit temp-Markierung "Theoretischer Rahmen" auf BA H3 dev

- FG-Snapshot vor Lauf gesichert
- 1 LLM-Call (Sonnet 4.6 via OpenRouter), 16.7s, 15.498 in / 775 out Tokens
- LLM-Befund: `noRespec=true` mit präziser Begründung — der Klafki-Theorierahmen ist eine Erstexposition des theoretischen Maßstabs, der bereits im FORSCHUNGSGEGENSTAND verankert ist; keine Begriffe werden umgedeutet oder erweitert
- Stack-Tiefe vor → nach: 1 → 1 (kein `re_spec`-Eintrag, weil noRespec)
- FG-content unverändert (subjectKeywords identisch zum prior)
- `exkursAnchorText` korrekt aus Übergangs-Satz extrahiert: »Nachdem die epochaltypischen Schlüsselprobleme als inhaltliche Orientierungspunkte allgemeiner Bildung herausgearbeitet wurden, stellt sich die Frage nach einer didaktischen Grundlage…«
- Auto-Cleanup: FG-Snapshot restored, Heading-Klassifikation restored, Stack-Tiefe nachher = 1, FG-content identisch zum Vor-Lauf-Stand

### Funktionaler Test mit semantisch echtem EXKURS-Container

Steht aus. EXKURS-Klassifikationen sind im Bestand selten (User-Befund). Sobald ein Werk einen tatsächlichen EXKURS hat (z.B. Bourdieu-Habitus → Foucault-Dispositiv-Diskussion → Habitus als Disponierung), wird der Test wiederholt um den vollen Re-Spec-Pfad zu validieren (nicht-noRespec, Stack-Tiefe 1→2, FG-content tatsächlich modifiziert).

---

## Offene Punkte

1. **V.3.0 — Stack-Intelligenz**: aktueller `version_stack` ist materialisiert, aber nicht instrumentiert. Mother-Idee (`project_three_heuristics_architecture.md`): Reviewer-Indikator über Stack-Diff-Bewegung als Erkenntnisfortschritt vs. Regression — der LLM könnte transformatorische Emergenz an Stack-Bewegungen erkennen (Begriffsverschiebung, -erweiterung, -widerruf). Heute zurückgestellt — der Wert hängt davon ab, dass mehrere EXKURSE pro Werk einen aussagekräftigen Stack erzeugen, was im aktuellen Bestand nicht prüfbar ist. Implementation als V.3.0 wenn (a) Werke mit mehreren EXKURSEN im Bestand vorliegen, (b) WERK_GUTACHT-b Hotspot-Würdigung ein Reviewer-Indikator-Feld erwartet, in das der Stack-Diff-Befund einfließen kann.

2. **Funktionaler Test mit echtem EXKURS-Container** (siehe oben).

3. **Container-Orchestrator**: EXKURS in die Master-Pipeline eingliedern. Reihenfolge: nach FORSCHUNGSGEGENSTAND-Aggregat (das EXKURS liest), vor FORSCHUNGSDESIGN (das den re-spezifizierten FG liest). Spec offen.

4. **TS-Type-Issue im JSON-Extract-Pattern**: `parsed.stage` wird vom TS-Compiler nicht durch `if (!parsed.ok)` ge-narrowed — gleicher Effekt in `grundlagentheorie_forschungsgegenstand.ts`. Workaround in `exkurs.ts` via `'in'`-Guard. Echter Project-Fix wäre eine Anpassung in `json-extract.ts` (Discriminated-Union-Form), out-of-scope für diesen Sprint.

---

## Pflicht-Lektüre

- `docs/h3_grundlagentheorie_status.md` — FORSCHUNGSGEGENSTAND-Schema (subjectKeywords als String-Array, version_stack mit `kind: 'origin'`-Eintrag), das EXKURS modifiziert
- Memory `project_three_heuristics_architecture.md` — Mother-Setzung der H3-Heuristiken-Liste (EXKURS als Slot, ursprüngliche RE_SPEC_AKT-Idee als V.3.0-Roadmap dokumentiert)
- Memory `project_critical_friend_identity.md` — EXKURS-Output ist deskriptiv, nicht beurteilend
- Migration `043_function_constructs.sql` — version_stack-Schema (origin/re_spec-Pattern); Doku-Kommentar dort beschreibt genau das umgesetzte Modell
- `docs/architecture/05-pipeline-h3.md` Abschnitt 4.5 — Pipeline-Doku mit Architektur-Setzung und V.3.0-Vermerk
