# Handover — Qualifizierung der selbstdeklarierten Original-Formulierung

**Adressat:** die nachfolgende Session, frischer Context.
**Stand:** Spec abgenickt 2026-05-03, Implementation steht aus.
**Bezug:** `docs/h3_implementation_status.md` Phase 3, „Was offen ist", Punkt 1.

---

## Worum es geht

Im Modul für die Einleitungs-Heuristik (H3:EXPOSITION) gibt es heute zwei Lese-Resultate pro Werk:

- **FRAGESTELLUNG** — die rekonstruierte tatsächliche Fragestellung
- **MOTIVATION** — die zusammengefasste Motivations-Passage

Es kommt ein drittes hinzu:

- **Qualifizierung der selbstdeklarierten Original-Formulierung** — das, was die Autorin selbst als „Forschungsfrage" formuliert hat (typisch eingeleitet mit „Die Forschungsfrage lautet:" o.ä.) wird identifiziert, wörtlich zitiert und in **einem Satz** qualifiziert.

Das ist KEINE Skala, KEINE Stufenbewertung, KEIN Spalt-Vergleich zur rekonstruierten Fragestellung. Eine Vorgänger-Iteration hat genau diese Vermischung gemacht und wurde verworfen — siehe Hintergrund am Ende.

---

## Architektur-Setzung — strikt einzuhalten

**Drei separate LLM-Calls auf identischem Eingabe-Material**, ohne Datenfluss zwischen ihnen:

```
Quell-Absätze der Einleitung (= Quelltext-Snippet)
  ├─→ Rekonstruktions-Call → Datensatz „FRAGESTELLUNG"
  ├─→ Motivations-Call (falls Motivations-Absätze vorhanden) → Datensatz „MOTIVATION"
  └─→ Beurteilungs-Call (NEU) → Datensatz für die Qualifizierung
```

Jeder Call sieht **nur** die Quell-Absätze. Der Beurteilungs-Call sieht **nicht** die rekonstruierte Fragestellung und **nicht** die Motivations-Zusammenfassung. Drei Calls, drei Datensätze, keine Querverbindungen.

Diese Trennung ist die zentrale Lehre aus dem verworfenen Versuch und nicht stilistisch — sie ist Architektur-Setzung.

---

## Output des Beurteilungs-Calls

JSON-Schema:

```json
{
  "original_wortlaut": "<wörtliches Zitat>" | null,
  "qualifikation": "<ein Satz>" | null
}
```

Beide Felder werden gemeinsam in den `content` des neuen Datensatzes geschrieben — sie gehören semantisch zusammen, weil das Zitat den qualifizierenden Satz verankert.

Wenn keine Original-Formulierung im Quelltext erkennbar ist: kein Datensatz anlegen. Abwesenheit ist Befund (Memory `feedback_constructs_are_extracts_not_telemetry.md`).

---

## Prompt-Wortlaut — 1:1 zu verwenden, NICHT umformulieren

> Du bekommst die Absätze einer Werk-Einleitung. Identifiziere darin die selbstdeklarierte Forschungsfrage der Autorin (typisch eingeleitet mit „Die Forschungsfrage lautet:" o.ä., manchmal auch nur als Frage im Wortlaut).
>
> Falls eine solche Original-Formulierung erkennbar ist:
> - Halte sie als wörtliches Zitat fest.
> - Qualifiziere sie in einem einzigen Satz, auf Basis einer selbst-gerankten Auswahl dieser fünf Kriterien:
>   - sachliche Konsistenz
>   - logische Konsistenz
>   - sprachliche Präzision
>   - Vermögen, die Arbeit zu motivieren / Klärungsbeitrag zu erlauben (eine bloße Themenangabe wie „Leben und Werk von Maria Montessori" fällt hier durch; „Werk von Montessori versus Leben" ist im Ansatz Fragestellung, weil ein Verhältnis gesetzt wird)
>   - Zusammenführen heterogener Elemente
>
> Du wählst und rankst, welche dieser Kriterien an dieser Original-Formulierung am meisten ins Gewicht fallen — der qualifizierende Satz stützt sich auf diese Auswahl, nicht zwingend auf alle fünf.
>
> Falls keine selbstdeklarierte Original-Formulierung erkennbar ist, antworte mit beiden Feldern null.
>
> Antwort als JSON:
> ```
> {
>   "original_wortlaut": "<wörtliches Zitat>" | null,
>   "qualifikation": "<ein Satz>" | null
> }
> ```

Memory `feedback_no_slop_in_prompts.md` gilt: 1:1 lifteren mit Scope-Substitution, keine eigenmächtigen Erweiterungen, keine Slop-Marker, keine zusätzlichen Hinweise oder Beispiele über die hier gegebenen hinaus.

---

## Datenbank-Persistierung

- Tabelle: `function_constructs`
- `outline_function_type = 'EXPOSITION'`
- `construct_kind`: **noch nicht festgelegt** — Vorschlag zum Abnicken vor Implementation: `'ORIGINAL_FORMULIERUNG_QUALIFIZIERT'` oder `'SELBSTDEKLARIERTE_FORMULIERUNG'`. Kein Eigenmächtig-Setzen.
- `content`: das JSON-Objekt aus dem Beurteilungs-Call (`{original_wortlaut, qualifikation}`)
- `anchor_element_ids`: dieselben Quell-Absatz-IDs, die in den Beurteilungs-Call gegangen sind (technische Verankerung, nicht semantische Verbindung zur FRAGESTELLUNG)
- Es ist ein eigener Datensatz neben FRAGESTELLUNG und MOTIVATION, kein Anhängsel.

---

## Workflow — strikt einzuhalten

1. Pflicht-Lektüre lesen (siehe unten).
2. Spec-Diff vorbereiten: in `src/lib/server/ai/h3/exposition.ts` einen neuen LLM-Call ergänzen, der den oben genannten Prompt verwendet, gleicher Eingabe-Snippet wie die Rekonstruktion. Persistierungs-Kategorie und Trigger-Anzeige in `scripts/test-h3-exposition.ts` erweitern.
3. Vor dem ersten Lauf: **System-Prompt-Wortlaut und Code-Diff dem User zum Abnicken vorlegen.** Nicht losrennen und einen LLM-Lauf gegen BA H3 dev machen, ohne dass der User explizit OK sagt. Knapp-Bestätigungen wie „passt" oder „ok" auf einen Architektur-Vorschlag sind kein Blanko-Schein für den ungesehenen Output (Lehre 11 in der Status-Doku-Fehler-Liste).
4. Nach Abnick: **isolierter Lauf** des neuen Schritts gegen BA H3 dev — nicht das ganze EXPOSITION-Modul re-runnen, weil sonst die korrekte FRAGESTELLUNG (siehe unten) durch eine möglicherweise schwächere Variante dupliziert würde (Lehre 14 in der Fehler-Liste, offener Punkt 2 zur Re-Run-Idempotenz).
5. Output zeigen, vom User validieren lassen.
6. Erst nach User-Validierung: commit mit Co-Author-Tag.

---

## Test-Case

- **Case:** „BA H3 dev", `case_id = c42e2d8f-1771-43bb-97c8-f57d7d10530a`
- **central_document_id:** `d1993e8a-f25b-479c-9526-d527215969c6`

In diesem Werk steht die selbstdeklarierte Original-Formulierung der Autorin im Wortlaut:

> Inwiefern fördern Bildungsprogramme im Rahmen der UNESCO-GCED das Bewusstsein für globale Probleme der Gegenwart?

Das ist eine naive empirische Wirkungsfrage. Erwartung an den 1-Satz-Qualifikator: typisch werden „sprachliche Präzision" (Begriffe „Bewusstsein", „fördern" sind als Prüfgrößen nicht entscheidbar) und „Vermögen, die Arbeit zu motivieren / Klärungsbeitrag zu erlauben" (empirische Wirkungsfrage in einer BA nicht einlösbar) am stärksten ins Gewicht fallen. Welche Kriterien das Modell tatsächlich rankt und wie der Satz formuliert ist, ist offen — der User validiert.

Die korrekte rekonstruierte FRAGESTELLUNG steht bereits in der Datenbank: `function_constructs.id = 5867251a-d40c-4e68-9710-650a29852443`. Der Beurteilungs-Call sieht diese **nicht** und nutzt sie nicht.

---

## Pflicht-Lektüre vor irgendeiner Implementation

**Memory** (Pfad: `/Users/joerissen/.claude/projects/-Users-joerissen-ai-sarah/memory/`):

- `project_fragestellung_definition.md` — was eine Fragestellung ist und was nicht; warum die selbstdeklarierte Forschungsfrage typischerweise Slop ist
- `feedback_no_hallucinated_qskala.md` — Schutz vor erneuter Skalen-Erfindung; aktueller Stand der Spec ist hier festgehalten
- `feedback_constructs_are_extracts_not_telemetry.md` — `content` enthält Substanz, keine Klassifikator-Telemetrie
- `feedback_no_hidden_setq.md` — keine versteckten inhaltlichen Setzungen; keine Multiple-Choice wenn die Setzung schon ausgesprochen ist
- `feedback_no_slop_in_prompts.md` — validierte Prompt-Bestandteile 1:1 verwenden, keine emergenten Zusätze
- `feedback_understand_before_implementing.md` — Domänenbegriffe vor Implementation klären
- `project_three_heuristics_architecture.md` — Architektur-Grundlage des H3-Modells
- `project_critical_friend_identity.md` — SARAH analysiert, beurteilt nicht autonom

**Repo-Dokumentation:**

- `docs/h3_implementation_status.md` — voller Status, Fehler-Liste mit 15 Punkten zur Vermeidung, alle offenen Punkte. Insbesondere Phase 3 „Was offen ist" Punkt 1 (diese Aufgabe) und Punkt 2 (Re-Run-Idempotenz, hängt zusammen).
- `docs/h3_implementation_plan.md` — übergreifender Phasen-Plan.
- `CLAUDE.md` — Projekt-Grundprinzipien.

**Mother-Session** (Hintergrund-Material zur ursprünglichen H3-Architektur):

`/Users/joerissen/Downloads/session-export-H3 dev mother/`

Die Mother-Session hat das Drei-Heuristiken-Modell, die Funktionstyp-Liste, die Cross-Typ-Bezüge und die Choreographien der einzelnen Heuristiken verhandelt. Die Setzung „H3:EXPOSITION extrahiert FRAGESTELLUNG und MOTIVATION als persistente Konstrukte" stammt von dort. Die Qualifizierung der selbstdeklarierten Original-Formulierung als zusätzliches Lese-Resultat ist 2026-05-03 in der Folge-Session entschieden worden, NICHT in Mother. Wenn du dort etwas zu „qualifizieren" oder „beurteilen" findest, ist das ein anderer Kontext (typischerweise H3:WERK_GUTACHT, ein späterer Werk-Ebenen-Pass).

Mother bei Unklarheiten zur übergreifenden Architektur konsultieren — bei der konkreten Spec dieser Aufgabe sind dieses Handover-Dokument und die Status-Doku führend.

---

## Was nicht passieren darf

- **Vermischung mit der Rekonstruktion** — kein Spalt-Vergleich Original ↔ Rekonstruktion in der Qualifikation, kein „die selbstdeklarierte Frage steht im Spannungsverhältnis zu …", keine Erwähnung der rekonstruierten Fragestellung im Output.
- **Skala / Stufen-Label** — kein „tragfähig/schwach/verfehlt", kein „rot/gelb/grün", kein numerischer Score. Das ist Wertungs-Achse, sie läuft separat in H3:WERK_GUTACHT-b und ist hier nicht Aufgabe.
- **Mehr als 1 Satz** — keine prosaische Achsen-Abklapperung über mehrere Sätze, keine Stichpunkte. Exakt 1 Satz, der sich auf die selbst-gerankte Auswahl der fünf Kriterien stützt.
- **Slop-Wortlaut als Bezugspunkt im System-Prompt** — der oben gegebene Prompt-Wortlaut enthält das nicht und darf nicht erweitert werden.
- **Re-Run des EXPOSITION-Moduls als Ganzes** — der neue Schritt wird isoliert getriggert, sonst wird die korrekte FRAGESTELLUNG (5867251a) durch eine möglicherweise schwächere Variante dupliziert. Idempotenz mit Schutz validierter Stände nachzuziehen ist offener Punkt 2 in der Status-Doku.

---

## Hintergrund — was zur verworfenen Vorgänger-Iteration gehört

Eine Iteration in der vorigen Session hat versucht, dieselbe Aufgabe als prosaischen 11-Zeiler über fünf Achsen zu lösen, der die selbstdeklarierte Frage wörtlich aufnahm und mit der rekonstruierten verglich. Das wurde vom User komplett verworfen. Die Verwerfung steht in der Status-Doku-Fehler-Liste als Punkte 11–14 (knapp-Bestätigungen falsch interpretiert, Slop-Wortlaut im Prompt, Wertung mit Darstellung vermischt, Re-Run ohne Schutz).

Die verworfene Iteration ist über `git revert` aus dem Hauptzweig herausgenommen. Datenbank-Reste (FRAGESTELLUNGS_BEFUND-Eintrag, Duplikat-FRAGESTELLUNG) sind gelöscht. Die korrekte FRAGESTELLUNG des Vormittags ist unangetastet.

Du musst diesen Verlauf nicht im Detail verstehen, um die Implementation zu bauen — die Spec hier oben ist self-contained. Die Hintergrund-Information ist nur dafür da, dass du nicht versehentlich in dieselbe Falle läufst.
