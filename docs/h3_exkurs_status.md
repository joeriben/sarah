# H3:EXKURS — Status

Eigenständige Status-Doku der EXKURS-Heuristik (parallel zu `h3_grundlagentheorie_status.md` für die Pyramide und `h3_implementation_status.md` für FORSCHUNGSDESIGN).

Letztes Update: 2026-05-04 (Modul-Erstimplementation, formaler Test gegen BA H3 dev mit temp-Markierung erfolgreich; funktionaler Test gegen ein Werk mit echtem EXKURS-Container steht aus, weil EXKURS-Klassifikationen im Bestand selten sind).

---

## Architektur-Setzung (Folge-Session zur Mother)

User-Setzungen 2026-05-04 vormittags, in Klärungs-Schritten:

1. **EXKURS ist keine GRUNDLAGENTHEORIE-Spiegelung.** Keine Verweisprofil-/Routing-Pyramide. EXKURS ist eine theoretische Wendung, die einen externen Begriff einführt und damit Begriffe des bisherigen FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert. Beispiel (User): Arbeit baut auf Bourdieus Habitus auf; ein EXKURS diskutiert Foucaults Dispositivbegriff; danach wird Habitus als foucaultsche Disponierung verstanden.

2. **Kein systematischer Trigger-BEFUND.** Mother sprach von "EXKURS_ANKER auf auslösende ERKENNTNIS" — das wurde verworfen, weil ein computable FK auf eine spezifische DURCHFÜHRUNGS-BEFUND nicht in jeder Arbeit existiert. Stattdessen: der vom EXKURS selbst formulierte Anlass-Text aus den Eingangs-¶ wird als `exkursAnchorText` extrahiert, kein separates EXKURS_ANKER-Konstrukt.

3. **RE_SPEC_AKT zielt auf den FORSCHUNGSGEGENSTAND** (Werk-Konstrukt), nicht auf isolierte subjectKeywords. Affected concepts werden bevorzugt aus den vorgegebenen subjectKeywords gewählt.

4. **Stack-Repräsentation Option C (User-Wahl mit Begründung):** RE_SPEC_AKT als eigenständiges Konstrukt mit eigenem origin-Stack-Eintrag, **kein Append-Modify** am vorgelagerten FORSCHUNGSGEGENSTAND.version_stack. Begründung: Migration-043-Doku-Lesart (Stack-Erweiterung am FORSCHUNGSGEGENSTAND) wäre der einzige echte Multi-Eintrag-Stack im System — semantisch odd. Stack-Diff (für späteren Reviewer-Indikator) ist über Query rekonstruierbar: `SELECT * FROM function_constructs WHERE construct_kind='RE_SPEC_AKT' AND document_id=$1 ORDER BY created_at`.

5. **Idempotenz-Pflicht:** EXKURS schreibt **niemals** einen neuen FORSCHUNGSGEGENSTAND oder FRAGESTELLUNG (auch keine Modifikation). EXKURS-eigene RE_SPEC_AKT-Persistenz ist delete-before-insert pro EXKURS-Container. Read-Pfade prüfen Bestand-Duplikate (Count) und warnen, falls >1 — kein Auto-Cleanup vorgelagerter Konstrukte.

6. **Kein Reviewer-Indikator in dieser Stufe.** Stack-Diff (Erweiterung/Verschiebung/Regression) ist deferred bis WERK-Ebene und arbeitet später read-only auf dem Aggregat der RE_SPEC_AKT-Konstrukte.

---

## Pipeline (eine Stufe)

```
pro EXKURS-Container im Werk:
  1 LLM-Call mit Input:
    - FRAGESTELLUNG (aus EXPOSITION)
    - FORSCHUNGSGEGENSTAND (Werk-Aggregat aus GRUNDLAGENTHEORIE)
    - subjectKeywords (aus FORSCHUNGSGEGENSTAND.content)
    - EXKURS-Container-¶ (alle)
  → JSON-Output:
    - importedConcepts: [{name, sourceAuthor|null}, ...]
    - affectedConcepts: [string, ...] (bevorzugt aus subjectKeywords)
    - reSpecText: 1–3 Sätze deskriptiv
    - exkursAnchorText: vom EXKURS selbst formulierter Anlass | null
    - noRespec: true bei reiner Hintergrund-/Methoden-Notiz ohne Re-Spec
  Persistenz: function_constructs row mit
    construct_kind='RE_SPEC_AKT', outline_function_type='EXKURS',
    anchor_element_ids = alle EXKURS-Container-¶,
    version_stack = [{kind:'origin', at, by_user_id:null, source_run_id:null, content_snapshot}]
```

Default-Modell: `openrouter/anthropic/claude-sonnet-4.6`. Max-Tokens 1500. Konfigurierbar via `modelOverride`.

---

## Implementation

| Datei | Inhalt |
|---|---|
| `src/lib/server/ai/h3/exkurs.ts` | `loadExkursContainers`, `loadFragestellungWithDiagnostics`, `loadForschungsgegenstandWithDiagnostics`, `extractRespecAkt`, `clearExistingRespecActsForContainer`, `persistRespecAkt`, `runExkursPass` |
| `scripts/test-h3-exkurs.ts` | CLI-Test mit `--persist`, `--mark-as-exkurs="<heading-substring>"` (temp-Markierung mit auto-reset im finally), `--provider=…/--model=…` |

Persistenz-Konstrukt: `RE_SPEC_AKT` mit `outline_function_type='EXKURS'` (Konstrukt-kind in der zentralen Liste neu).

### Idempotenz

- Pro EXKURS-Container: delete-before-insert auf gleichem `anchor_element_ids`-Set. Re-Run liefert garantiert genau ein RE_SPEC_AKT pro Container.
- FRAGESTELLUNG/FORSCHUNGSGEGENSTAND werden nur gelesen, nie geschrieben — EXKURS verursacht keine Duplikate dort.
- Diagnose-Output zeigt Count beider vorgelagerten Konstrukt-Typen + WARN bei >1 (zur Sichtbarmachung von Bestand-Duplikaten ohne Auto-Cleanup).

### Test-Skript-Convenience

`--mark-as-exkurs="<heading-substring>"` markiert ein bestehendes GRUNDLAGENTHEORIE-Heading temporär als EXKURS, läuft den Pass, setzt im finally die Klassifikation zurück und löscht die im Test-Lauf erzeugten RE_SPEC_AKT-Konstrukte gezielt per ID. Crash-safe (falls reset failed: ausgegebenes SQL-Snippet zum Manual-Restore).

---

## Verifikation 2026-05-04

### No-op-Lauf gegen BA H3 dev (Case `c42e2d8f-…`, kein EXKURS im Bestand)

- 0 LLM-Calls
- Diagnose: 1 FRAGESTELLUNG, 1 FORSCHUNGSGEGENSTAND (keine Duplikate)
- 0 EXKURS-Container → no-op-Pass terminiert sauber
- 64ms (DB-Reads only)

### Funktionaler Lauf mit temp-Markierung "Theoretischer Rahmen" auf BA H3 dev

- 1 LLM-Call (Sonnet 4.6 via OpenRouter), 12.6s, 15.152 in / 595 out Tokens
- Output: `importedConcepts=[]` (korrekt — Klafki-Theorierahmen importiert keinen externen Begriff), `affectedConcepts=[6 von 7 subjectKeywords]`, `reSpecText` deskriptiv-präzise zu Klafkis Theoriearchitektur, `exkursAnchorText` korrekt aus dem Übergangs-Satz extrahiert
- Cleanup: heading_classifications zurück auf GRUNDLAGENTHEORIE, 1 RE_SPEC_AKT entfernt, 0 Orphans im Bestand
- Lauf-Stochastik: in einem früheren Lauf gab der LLM `noRespec=true` zurück mit gleicher Begründung — beide Antworten konsistent damit, dass das BA-H3-dev-Theoriekapitel kein klassischer EXKURS ist

### Funktionaler Test gegen ein Werk mit echtem EXKURS-Container

Steht aus. EXKURS-Klassifikationen sind im Bestand selten (User-Befund). Sobald ein Werk einen tatsächlichen EXKURS hat (z.B. Bourdieu-Habitus → Foucault-Dispositiv-Diskussion → Habitus als Disponierung), wird der Test wiederholt um die importedConcepts-Extraktion und die affectedConcepts-Selektion auf einem semantisch echten EXKURS zu validieren.

---

## Offene Punkte

1. **WERK-Ebene Stack-Diff**: Reviewer-Indikator (Erweiterung/Verschiebung/Regression über die Sequenz aller RE_SPEC_AKT-Konstrukte eines Werks) ist deferred bis WERK_DESKRIPTION/WERK_GUTACHT-Phase. Aggregat-Query auf `RE_SPEC_AKT ORDER BY anchor-Outline-Position` (nicht created_at — Outline-Reihenfolge ist die hermeneutisch relevante).

2. **Multiple EXKURSE pro Werk**: Container-Loader gruppiert pro Heading. Ein Werk mit mehreren EXKURSEN bekommt mehrere RE_SPEC_AKT-Konstrukte — die Sequenz bildet den Stack des FORSCHUNGSGEGENSTANDs (virtuell). Kein Test-Fall im Bestand verfügbar.

3. **Container-Orchestrator**: EXKURS in die Master-Pipeline eingliedern (nach FORSCHUNGSGEGENSTAND, vor FORSCHUNGSDESIGN — oder parallel, da FORSCHUNGSDESIGN den FORSCHUNGSGEGENSTAND liest, nicht die RE_SPEC_AKTE). Spec offen.

4. **TS-Type-Issue im JSON-Extract-Pattern**: `parsed.stage` wird vom TS-Compiler nicht durch `if (!parsed.ok)` ge-narrowed — gleicher Effekt in `grundlagentheorie_forschungsgegenstand.ts`. Workaround in `exkurs.ts` via `'in'`-Guard. Echter Project-Fix wäre eine Anpassung in `json-extract.ts` (Discriminated-Union-Form), out-of-scope für diesen Sprint.

---

## Pflicht-Lektüre

- `docs/h3_grundlagentheorie_status.md` — FORSCHUNGSGEGENSTAND-Schema (subjectKeywords als String-Array), das EXKURS liest
- Memory `project_three_heuristics_architecture.md` — Mother-Setzung der H3-Heuristiken-Liste (EXKURS als Slot)
- Memory `project_critical_friend_identity.md` — RE_SPEC_AKT ist deskriptiv, nicht beurteilend
- Migration `043_function_constructs.sql` — version_stack-Schema (origin/re_spec-Pattern), wir nutzen aktuell nur origin pro RE_SPEC_AKT-Konstrukt
