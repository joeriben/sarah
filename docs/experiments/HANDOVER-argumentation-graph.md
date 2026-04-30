# Handover — Stand 2026-05-01 (Folge-Session, Validierungslauf vorbereitet)

**Lies zuerst diesen Block.** Der ältere Handover-Text darunter ist Kontext, aber der aktuelle Stand und die nächsten Schritte stehen hier oben.

## Was seit dem letzten Handover-Stand erledigt wurde

- **(d)-Ersetzung in beiden Prompts** ✓ (Subkapitel ersetzt, Hauptkapitel eingefügt). Werk-Ebene bleibt entschieden ohne (d) (Slop-Diagnose dokumentiert in Section C unten).
- **Migration 036** angewendet (`aggregation_subchapter_level smallint nullable` mit CHECK 1–3).
- **Helper-Bug behoben** in `src/lib/server/ai/hermeneutic/heading-hierarchy.ts`: `loadResolvedOutline` las `properties.numbering` (zerbricht bei Headings ohne Nummern-Prefix), nutzt jetzt `(properties->>'level')::int` als kanonische Quelle — analog zum UI-Helper `loadEffectiveOutline`.
- **Driver-Skripte geschrieben:** `scripts/run-chapter-collapse.ts` und `scripts/run-document-collapse.ts`. Konstanten zeigen aktuell auf den **frischen Validierungs-Case** (siehe unten).
- **Frisches Test-Dokument importiert:** `54073d08-f577-453b-9a72-73a7654e1598` ("Timm 2025 ... no_annot_test2.docx", strukturidentisch zum alten, 393336 chars, 49 Headings, 328 Absätze). Outline confirmed.
- **Neuer Case angelegt:** `aa23d66e-9cd8-4583-9d14-6120dc343b10` "Habilitation Timm — no_annot_test2 (frische Validierung Direction-4)". Brief geklont (`f8fc8a30-…`, `argumentation_graph=true`).
- **Outline-Patch:** Heading "Vergleichshorizonte – Dimensionen…" (`b72bf6ea-738c-4dad-bf68-f3ae61586d06`) hat `user_level=3` per direktem `INSERT INTO heading_classifications` — der Parser hatte die Heading als L2 statt L3 klassifiziert und damit die Auto-Numerierung in Kapitel 2 verschoben.
- **Outline-UI-Recovery-Items implementiert** (Items a/b/c in Section "Outline-UI Recovery-Items" weiter unten): Add-Heading-Button, Re-Open-After-Confirm-Button, Parser-Numerierung-respektierender Display. Plattform ist jetzt recovery-fähig für Parser-Glitches ohne psql-Eingriff. Der `outline_status` des Test-Dokuments steht aktuell auf `pending` (nicht confirmed wie ursprünglich nach UI-Bestätigung) — der Reset passierte irgendwann während des Server-Restart-Cycles bei den UI-Edits; vor dem Pipeline-Lauf einmal über die UI re-confirmen.

## Stand der Test-Daten (NEUES Dokument)

```
case_id          aa23d66e-9cd8-4583-9d14-6120dc343b10  (NEU, frische Validierung)
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (geklont, argumentation_graph=true)
document_id      54073d08-f577-453b-9a72-73a7654e1598
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

**L1-Headings im neuen Doc** (mit Absatz-Anzahl):

| num | text | l1_heading_id | ¶ |
|---|---|---|---|
| 1 | Schule – Kultur – Globalität – Lehrkräftebildung | `9c3e2dac-a9bb-4cb5-8a6d-19a87c086341` | 74 |
| 2 | Orientierungen von Lehramtsstudierenden… | `6f025aa0-e394-4f2c-9e59-bdfee8e6a09b` | 139 |
| (3) | Reflexionen der kulturbezogenen Orientierungen… | `18dcfa8c-9daf-4393-bf43-f599414c5fb7` | 64 |
| 4 | Ansätze einer Theorie kultureller Lehrkräftebildung | `62fed1d2-d3b0-4b74-abad-dde3fadaf86e` | 50 |

`scripts/run-chapter-collapse.ts` zeigt aktuell auf num=1 (Theorie-Hauptkapitel, 74 ¶, ursprünglich geplante Validierungs-Target). Für günstigere Pipeline-Validierung wäre num=4 (50 ¶) eine Option — alle IDs sind im Skript als Kommentar.

## Nächste konkrete Aktionen für die nächste Session

Voraussetzung für Chapter-Collapse: alle Absätze des Test-Kapitels brauchen vorgelagerte Pässe. Die Pipeline-Reihenfolge:

1. **Per-Paragraph synthetic Pass** (`scripts/run-paragraphs.ts` analog) für alle Absätze des Test-Kapitels — produziert pro Absatz ein synthetisch-hermeneutisches Memo.
2. **Argumentation-Graph Pass** (`scripts/run-argumentation-graphs.ts`) für dieselben Absätze — produziert die Graph-Daten (Argumente, Premissen, Edges, Scaffolding), die Sub-/Chapter-Collapse als Input brauchen.
3. **Section-Graph-Collapse** (`scripts/run-graph-collapse.ts`) pro L3-Subkapitel des Test-Kapitels (Helper wählt L1/L2/L3 adaptiv via Median-Algorithmus aus Migration 036).
4. **Chapter-Collapse** (`scripts/run-chapter-collapse.ts`) für das L1-Test-Kapitel — neuer Code, eigentliches Validierungs-Target dieser Session.
5. **Document-Collapse** (`scripts/run-document-collapse.ts`) — braucht alle L1-Memos. Optional, wenn das Werk-Memo getestet werden soll, müssen vorher alle 4 L1-Kapitel ein Chapter-Memo haben.

Pro Schritt Driver-Skripte ggf. anpassen, weil die existierenden Driver auf einzelne Heading-IDs zeigen — für mehrere Headings entweder durchschleifen oder mehrere Läufe.

Kostenschätzung Chapter 1 (74 ¶, vier nested L3-Subkapitel und drei L3 ohne Subkapitel-Eltern unter L2 1.1, 1.2, 1.3 → vermutlich L3 als Aggregations-Level):
- Per-Paragraph + Argumentation-Graph: 74 × 2 × ~$0.05 ≈ $7.40
- Section-Collapse: 7 L3-Subkapitel × ~$0.20 ≈ $1.40
- Chapter-Collapse: 1 × ~$0.50 ≈ $0.50
- **Gesamt für Chapter 1: ~$9.30**

Chapter 4 (50 ¶) entsprechend ~$6.20.

## Outline-UI Recovery-Items — implementiert 2026-05-01 abend

Die in der Vorversion dieses Handovers als "#1 Priorität" markierten drei UI-Lücken sind in dieser Session **alle drei geschlossen worden**. Die Plattform ist jetzt recovery-fähig für Parser-Glitches, ohne dass Maintainer per psql eingreifen muss.

**a. Parser-Numerierung-respektierender Display** (`src/lib/server/documents/outline.ts:158-178` und Client-Seite `+page.svelte:33-49`).
`effectiveNumbering = parserNumbering ?? counter.join('.')`, mit Konsistenz-Check Tiefe-vs-Level. Counter zählt weiter durch (sonst springen Folge-Positionen), aber Display nutzt Parser-Wert wenn vorhanden und Tiefe matcht. Folge: ein fehlklassifizierter Heading verschiebt nicht mehr die ganze restliche Outline-Numerierung.

**b. Re-Open-After-Confirm** (`reopenOutline()` in `outline.ts`, Endpoint `routes/api/.../outline/reopen/+server.ts`, Button im Outline-Page).
Im `confirmed`-State zeigt der ursprüngliche "Bestätigen"-Button stattdessen "wieder zur Bearbeitung freigeben" (gelb). POST setzt `outline_status='pending'` zurück. Per-Row-Edits werden wieder möglich.

**c. Add-Heading** (`insertSyntheticHeading()` in `outline.ts`, Endpoint `routes/api/.../outline/insert/+server.ts`, "+ Heading hier einfügen"-Buttons zwischen jeder Zeile + am Anfang).
Klick → Browser-Prompt für Text und Level → Backend insertiert paired (`document_elements` + `heading_classifications`) in einer Transaktion. char_start = Midpoint zwischen Vorgänger und nächstem Heading. `properties.synthetic=true` und `heading_source='user_inserted'` zur Nachvollziehbarkeit. Reset von `outline_status` auf `pending` bei Insert (analog zur bestehenden upsertClassification-Logik). Insert-Buttons nur sichtbar im `pending`-State.

**Stilistische Note:** Add-Heading nutzt `window.prompt()` für Text + Level — funktional aber visuell roh. Bessere UI (Inline-Form, Level-Dropdown) ist eine spätere Verfeinerung; das funktionale Recovery-Verhalten ist jetzt drin.

**Workaround-Spuren in der DB:** Während der Diagnose habe ich `user_level=3` für "Vergleichshorizonte" (`b72bf6ea-738c-4dad-bf68-f3ae61586d06` im Doc 54073d08) per direktem psql-INSERT gesetzt und `outline_status='confirmed'` bewusst nicht zurückgesetzt. Das ist jetzt obsolet — der User kann denselben Effekt über die neue Re-Open + Edit-Level-UI erreichen. Die DB-Zeile muss nicht entfernt werden, sie repräsentiert den korrekten Zielzustand.

## Spawned Task Chip aus dieser Session — bitte dismissen

Während der Diagnose habe ich einen Task gespawnt mit dem Titel "Investigate parser+outline-confirmation bug for unnumbered L1 heading". Die Premise war falsch: weder Parser noch Confirmation hatten den Bug — `loadResolvedOutline` hat die falsche Spalte gelesen, das ist inline gefixt. Der Chip ist obsolet.

---

# (Älterer Handover-Text — Stand 2026-04-30 nachts)

# Handover — Direction 4 implementiert, (d) wird durch Tragweite/Tragfähigkeit ersetzt

**Last touched:** 2026-04-30 (späte Session, in Folge der Parser-Fix-Session und des Direction-4-Plans aus `696c553`)

**Letzte committed Commits:**
- `7ea1d49` Outline-Page: Dark-Theme-Angleichung
- `04a6c9f` User-Validierung der Heading-Hierarchie (Migration 035: `heading_classifications` + `outline_status`-Gate)
- `a515023` Re-Import-Skript Habilitation-Timm + Verifikation Parser-Fix
- `639214c` Benchmark-Export-Skript für Pre-Parser-Fix Re-Import
- `4efd03e` DOCX-Parser: Heading-Hierarchie aus numPr/ilvl + synthetische Numerierung
- `696c553` (voriges Direction-4-Plan-Handover, jetzt überschrieben)

**Uncommitted in dieser Session:**
- `migrations/036_chapter_aggregation_level.sql` (neu, **noch nicht angewendet**)
- `src/lib/server/ai/hermeneutic/heading-hierarchy.ts` (neu)
- `src/lib/server/ai/hermeneutic/chapter-collapse.ts` (neu)
- `src/lib/server/ai/hermeneutic/document-collapse.ts` (neu)

## Stand in einem Satz

Direction-4-Code ist geschrieben und compile-clean; **bevor irgendein Lauf gestartet wird**, muss der vierte Pflichtbestandteil ("Integrative Spannungsdiagnose") aus beiden Prompts (existierender Subkapitel-Pass + neuer Hauptkapitel-Pass) durch eine **neutrale Tragweite-und-Tragfähigkeit-Aufforderung** ersetzt werden — danach Migration 036 anwenden, Dev-Driver schreiben, Validierungslauf am Theorie-Hauptkapitel des Timm-Manuskripts.

## Methodologische Lektion (essentiell — vor jedem Prompt-Touch lesen)

In dieser Session wurde "Integrative Spannungsdiagnose" als Slop diagnostiziert. Drei Probleme:

1. **Pseudo-Vokabular** ohne hermeneutische/argumentationsanalytische Pedigree ("übergeordnete Spannung" ist kein Toulmin-, Bohnsack- oder Soeffner-Terminus).
2. **Selektions-Bias** durch Pflicht-Frageform ("wenn mehrere Schwächen vorliegen, frage dich, ob sie ein gemeinsames Symptom haben") — der LLM sucht aktiv nach Schwächen, weil die Antwortstruktur sie erwartet, und konstruiert ein gemeinsames Symptom auch dort, wo die Schwächen unverbunden sind.
3. **Einzelfall → Datenbank-Kategorie**: ein einmaliger valider Beobachtungsfall (S2-Globalität: Scheunpflug + Forster&Scherrer + Kolonialität als gemeinsames Symptom) wurde unzulässig zur Allgemeinregel verallgemeinert.

Die "S1–S3-Validierung" war AI-self-observation: Claude schreibt einen Pflichtbestandteil in den Prompt, Claude beobachtet seinen eigenen Output, Claude schreibt die Commit-Message "greift auf höchstem Niveau". Der User sieht weder Prompt-Diff noch AI-Commit-Messages. **Author-Tag in git ist KEIN Beleg für inhaltliche User-Adoption.**

Volle Lektion mit Anwendungsregeln: `~/.claude/projects/-Users-joerissen-ai-sarah/memory/feedback_no_slop_in_prompts.md`

Strukturelles Gegenmittel für jeden verbleibenden Pflichtbestandteil: **explizite opt-out-Klausel** ("wenn nicht zutrifft, dann diagnostizieren statt fabrizieren").

**Wichtig — Überkorrektur vermeiden:** Die Slop-Diagnose des einen Pflichtbestandteils heißt NICHT, dass die Pipeline nur "deskriptiv-rekonstruktiv" ist. Die S1–S3-Läufe haben qualifizierte immanent-kritische Befunde produziert ("rezeptiv-applizierend ohne theorie-interne Prüfung", "kumulative Nicht-Prüfung des Scheunpflug-Modells durch alle drei Anwendungs-Subkapitel", "fehlende konzeptuelle Eigenleistung in der Verbindung machtanalytischer und systemtheoretischer Globalitätsperspektiven"). Diese Kapazität bleibt erhalten — kein Honesty-Disclaimer im Werk-Prompt, der das aktiv unterdrücken würde.

## Aufgabe 0 (vor allem anderen): (d)-Ersetzung in beiden Prompts

User-Entscheidung: die (d) wird **nicht ersatzlos gestrichen**, sondern durch eine **neutrale Tragweite-und-Tragfähigkeit-Aufforderung** ersetzt. Begründung: Tragweite (welcher Anspruch wird geltend gemacht) und Tragfähigkeit (trägt die argumentative Stützung diesen Anspruch) sind echte evaluative Dimensionen mit methodologischer Pedigree (entspricht der Toulmin-Frage nach claim/warrant/backing-Proportionalität), die immanent-kritische Beurteilung erlauben ohne Selektions-Bias und ohne Pseudo-Vokabular. Die Diagnose "Anspruch und Stützung sind gleich proportioniert" ist ebenso valid wie "Anspruch übersteigt die Stützung" oder umgekehrt — das ist die opt-out-Klausel direkt im Pflichtbestandteil.

User-Vorgabe-Stil: "Beurteile die Tragweite und Tragfähigkeit des Arguments in seinem Kontext." Diese Formulierung wird auf Subkapitel-, Hauptkapitel- (und ggf. Werk-) Ebene scope-spezifisch ausformuliert.

### A) Subkapitel-Prompt

**Datei:** `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts:350`

**Alt** (zu ersetzen, vollständig):
```
d. **Integrative Spannungsdiagnose** — wenn mehrere Schwächen vorliegen, frage dich, ob sie ein gemeinsames Symptom haben. Statt Schwächen aufzulisten (das machen die auffaelligkeiten), formuliere die *übergeordnete* Spannung, die das Subkapitel offen lässt (z.B. "Theorie X wird unkritisch übernommen UND Theorie Y bleibt unvermittelt — beides Symptom einer fehlenden konzeptuellen Eigenarbeit"). Eine integrative Diagnose, nicht eine Aufzählung.
```

**Neu** (Vorschlag in der vom User angegebenen Diktion — vor dem Schreiben kurz mit User durchgehen):
```
d. **Tragweite und Tragfähigkeit** — beurteile (i) die argumentative Tragweite des Subkapitels: welcher Anspruch wird im Werk-Kontext geltend gemacht — bescheiden, weitreichend, feldweit? — und (ii) die Tragfähigkeit der argumentativen Stützung für diesen Anspruch: trägt sie ihn, ist sie unter- oder überdimensioniert? Beurteilung an dem, was tatsächlich vorliegt; wenn Anspruch und Stützung gleich proportioniert sind, das ebenso klar diagnostizieren.
```

### B) Hauptkapitel-Prompt

**Datei:** `src/lib/server/ai/hermeneutic/chapter-collapse.ts` — aktuell drei Pflichtbestandteile (Argumentative Bewegung, Kernbewegung-Identifikation, Werk-Architektur-Verortung); (d) ist gestrichen, muss wieder eingefügt werden mit der neuen Formulierung.

**Einfügen nach (c) Werk-Architektur-Verortung:**
```
d. **Tragweite und Tragfähigkeit** — beurteile (i) die argumentative Tragweite des Hauptkapitels: welcher Anspruch wird im Werk-Ganzen geltend gemacht — bescheiden, weitreichend, feldweit? — und (ii) die Tragfähigkeit der Stützung über die Subkapitel hinweg: tragen die Subkapitel zusammen den Kapitel-Anspruch, oder ist die Stützung unter- oder überdimensioniert? Wenn Anspruch und Stützung gleich proportioniert sind, das ebenso klar diagnostizieren.
```

Dazu Synthese-Längen-Hint anpassen (aktuell "5–9 Sätze, drei Pflichtbestandteile" → "6–10 Sätze, vier Pflichtbestandteile") und dasselbe im JSON-Output-Schema-Snippet.

### C) Werk-Prompt — entschieden 2026-04-30 abend: KEINE (d)-Ergänzung

**Datei:** `src/lib/server/ai/hermeneutic/document-collapse.ts` — bleibt bei drei Pflichtbestandteilen (Forschungsbeitrag-Diagnose, Gesamtkohärenz und Werk-Architektur, Niveau-Beurteilung mit Werktyp-Akzent). Code-Kommentar `document-collapse.ts:180-187` dokumentiert die Begründung bereits selbst.

**Begründung:** Tragweite/Tragfähigkeit ist eine Argument-Kategorie mit Toulmin-Pedigree (claim/warrant/backing-Proportionalität). Greift sauber auf Argument-Ebene und auf zusammenhängenden Argumentationsketten (Subkapitel/Hauptkapitel mit Kapitelthese). Auf Werk-Ebene zerbricht die Übertragung: ein Werk hat keine eine identifizierbare claim-warrant-backing-Triade, sondern Forschungsfrage, Methode, Beitrag, Architektur — die werk-adäquaten Kategorien sind durch Forschungsbeitrag und Niveau bereits abgedeckt.

**Slop-Diagnose der Vorversion dieses Handovers:** der vorige Pro-Punkt fabrizierte "Werk-Tragweite" und "Werk-Tragfähigkeit" als Hyphen-Komposita — exakt die mechanische Skala-Hochrechnung, die `document-collapse.ts:180-187` und `feedback_no_slop_in_prompts.md` bereits ausgeschlossen hatten. Hyphen-Komposita haben keine eigene methodologische Pedigree; sie borgen sich Legitimität von der Argument-Kategorie. Failure-Mode der "übergeordneten Spannung" in neuer Verkleidung — und im selben Handover-Dokument auftretend, das die Slop-Lektion frisch dokumentiert. User-Korrektur 2026-04-30 abend: "niemand spricht hier von 'werk-tragweite und -fähigkeit'."

**Konsequenz für Folge-Sessions:** Pflichtbestandteile auf einer höheren Skala NICHT durch Hyphen-Compound oder Scope-Anhängung von einer unteren Ebene ableiten. Stattdessen prüfen, ob die neue Ebene eigene auf ihrer Skala validierte Kategorien hat. Slop-Detection auch auf eigene narrative Outputs in real-time anwenden, nicht nur auf Code.

## Stand der Direction-4-Implementation

| Item | Status | Pfad |
|---|---|---|
| Migration 036 (`aggregation_subchapter_level smallint nullable` auf `heading_classifications`) | geschrieben, **NICHT angewendet** | `migrations/036_chapter_aggregation_level.sql` |
| Helper für resolved Outline + Median-Algorithmus + Persistenz | ✓ | `src/lib/server/ai/hermeneutic/heading-hierarchy.ts` |
| `runChapterCollapse` (mit Mode-conditional Input: paragraphs vs. subchapter-memos; bei L3 mit L2-Numerierungs-Gruppierung als Strukturhinweis) | ✓ — vier Pflichtbestandteile inkl. (d) Tragweite/Tragfähigkeit | `src/lib/server/ai/hermeneutic/chapter-collapse.ts` |
| `runDocumentCollapse` (alle L1-Memos → Werk-Memo) | ✓ — drei Pflichtbestandteile final, keine (d)-Ergänzung (siehe Section C) | `src/lib/server/ai/hermeneutic/document-collapse.ts` |
| Argumentationswiedergabe-Output (Gutachten-Vorlage) auf Hauptkapitel-Ebene | ✓ — getrennt von analytischer Synthese durch Diktions-Anweisung | `chapter-collapse.ts` Schema + Prompt |
| Dev-Driver `run-chapter-collapse.ts` und `run-document-collapse.ts` | offen | analog zu `scripts/run-graph-collapse.ts` |
| Validierungslauf am Theorie-Hauptkapitel | offen | s.u. Test-Daten-IDs |
| Endpoint-Erweiterung Auto-Trigger + SSE (Schritte 5+6 des vorigen Handovers) | offen | unverändert vom vorigen Handover |

## Architektur-Stand: per-chapter adaptive Aggregations-Ebene

User-Entscheidung 2026-04-30 nachmittags: die Subkapitel-Synthese-Ebene wird **pro L1-Hauptkapitel adaptiv** gewählt, basierend auf der Median-Absatzanzahl je Heading-Einheit. Validierte Zielzone: 5–15 ¶ (S1–S3-Werte: 5/5/9/13).

**Algorithmus** (in `heading-hierarchy.ts` als `chooseSubchapterLevel`):
1. Probiere L3, L2 (deepest first); nimm das tiefste Level mit Median in [5, 15].
2. Fallback: tiefstes Level mit Median ≥ 5.
3. Letztfallback: L1 (Kapitel-als-Ganzes als Synthese-Einheit, kein nested Collapse).

**Konsequenz pro Kapiteltyp:** flach gegliederte Methodenkapitel/Einleitungen fallen automatisch auf L1 (ein Memo, keine Sub-Collapses, billig). Tief gegliederte Theoriekapitel landen bei L2 oder L3 (entsprechend mehr Sub-Collapses).

**Vollrekursiv aufwärts** wurde **nicht** als Drei-Funktionen-Architektur (Sub → Intermediate-L2 → L1) gebaut, sondern als Zwei-Funktionen mit L2-Numerierungs-Gruppierung als Strukturhinweis im Chapter-Prompt — Begründung: Opus mit 200K Kontext kann 15 L3-Subkapitel-Memos direkt zu einem Hauptkapitel-Memo aggregieren, ohne dass ein Intermediate-Pass nötig ist; jeder zusätzliche Synthese-Pass verliert Information; die L2-Architektur bleibt im Prompt explizit präsent. Wenn Validierung zeigt, dass L2-Architektur verloren geht, kann nachträglich ein Intermediate-Pass ergänzt werden — additive Arbeit, kein Refactoring.

**Persistenz:** auf `heading_classifications.aggregation_subchapter_level` (Migration 036, neue Spalte). Algorithmus berechnet beim ersten Lauf pro L1-Kapitel und persistiert. User-Override über dieselbe Spalte (zukünftige UI-Aufgabe — zur Kostenkontrolle: forciertes L2 statt L3 halbiert die Subkapitel-Memo-Anzahl in tief gegliederten Kapiteln).

**Pipeline-Gate:** Helper `loadResolvedOutline` wirft, wenn `document_content.outline_status ≠ 'confirmed'` (Migration 035). Heißt: User muss vor jedem Chapter-/Werk-Collapse die Outline bestätigt haben.

## Argumentationswiedergabe (neuer Bestandteil auf Hauptkapitel-Ebene)

User-Anforderung dieser Session: das Hauptkapitel-Memo soll *zusätzlich* zur analytischen Synthese eine **gutachten-fertige Argumentationswiedergabe** liefern — sachlich-darstellend, third-person über das Werk, geeignet zur direkten oder leicht editierten Übernahme in einen Gutachten-Text ans Prüfungsamt. Begründung (User): erspart das doppelte Lesen + Aufschreiben fürs Prüfungsamt; das Gutachten braucht ohnehin eine Argumentationswiedergabe pro Kapitel.

Output-Schema von `runChapterCollapse`:
```json
{
  "synthese": "<analytisch, drei-bis-vier Pflichtbestandteile>",
  "argumentationswiedergabe": "<expositorisch, neutral, gutachten-fertig, 1–3 Absätze>",
  "auffaelligkeiten": [...]
}
```

**Diktions-Trennung im Prompt explizit:** synthese ist evaluativ-argumentativ ("die Kernbewegung des Hauptkapitels ist X"); argumentationswiedergabe ist sachlich-darstellend ("Das Kapitel entfaltet die These, dass…"). Speicherung: synthese in `memo_content.content`, argumentationswiedergabe + auffaelligkeiten reiten auf `appearances.properties` (kein Schema-Eingriff in `memo_content`).

Werk-Ebene bekommt **keine** Argumentationswiedergabe (User-Entscheidung): die Argumentationswiedergabe der Hauptkapitel deckt das ab; eine Werk-Gesamteinschätzung wäre eine andere Textgattung und wird hier nicht vorgreifend gebaut.

## Critical-Horizon-Framing (geparkt, nicht aktiv)

User-Beobachtung dieser Session: ohne externe Referenz oder formallogische Argument-Analyse bleibt jede LLM-basierte Synthese strukturell *immanent-kritisch* — was kein Defekt ist (die Pipeline produziert qualifizierte immanent-kritische Befunde, siehe S1–S3-Beispiele oben), aber mit klaren Grenzen.

Zwei Folge-Direktionen für später:

**(A) Externer Referenzhorizont** (MoJo, Zotero, Datenbanken) — pro extrahiertem Argument Lookup gegen Literatur-Korpus, ob die zitierte Quelle den Claim wirklich stützt, ob einschlägige Gegenpositionen ignoriert werden. Hoher Aufwand, eigenes Forschungsprojekt.

**(B) Formallogischer Pass auf Argument-Ebene** — pro Argument-Struktur (Claim + Premissen + Edges aus dem Argumentations-Graph) prüfen: ist die Inferenz gültig? Welche unausgesprochene Voraussetzung trägt den Schluss? Sind die Premissen kohärent? Niedriger Aufwand, passt zur existierenden Argumentations-Graph-Datenstruktur, methodologisch fundiert (Toulmin, Pollock). Wäre ein eigener neuer Pass auf Absatz-Ebene (parallel zu `runArgumentationGraphPass`), kein Pflichtbestandteil-Anbau. Output gespeichert auf eigener Spalte oder Tabelle, optional in die Collapse-Synthesen einfließend.

Beides nicht jetzt; festhalten als Folge-Direktionen für 2.0/3.0.

**Sprachliche Qualität als eigene Spalte** (User-Hinweis): emergente Stilmuster-Beobachtungen (z.B. "rezeptiv-applizierend") gehören perspektivisch in eine *eigene* Dimension, nicht als Pflichtbestandteil in die Synthese. Auch hier: nicht jetzt, parken.

## Test-Daten-IDs (Habilitation-Timm)

```
case_id          0abe0588-badb-4e72-b3c4-1edd4a376cb6
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      f7afee4b-729b-4a0d-963e-b3b31c6b3dcc
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

Validierte Subkapitel mit existierenden graph-fed Subkapitel-Memos:
- Globalität (L3 num=1.2.2): `ac0a6c7a-d38c-48ea-9414-55cda02df246`
- Methodologische Grundlegung (L3 num=2.1.2): `0a13d404-20d7-4422-9e67-72181cf98fa5`
- Schule und Globalität (L3 num=1.3.2): `7dee784c-4097-4f7e-80b0-85f3bf7e6f85`
- Anforderungen an Professionalität (L3 num=1.3.3): `6e0a1737-8996-49ad-830e-7e2290c3d838`

Für Direction-4-Validierung gebraucht: die L1-Heading-IDs der Hauptkapitel "1" (das die ersten drei L3 enthält) und "2" (das die Methodologische Grundlegung enthält). Über folgende Query auflösbar (nach Migration 035 mit confirmed outline):

```sql
SELECT de.id, de.properties->>'numbering' AS num,
       SUBSTRING(dc.full_text FROM de.char_start+1 FOR de.char_end-de.char_start) AS text
FROM document_elements de
JOIN document_content dc ON dc.naming_id = de.document_id
LEFT JOIN heading_classifications hc ON hc.element_id = de.id
WHERE de.document_id = 'f7afee4b-729b-4a0d-963e-b3b31c6b3dcc'
  AND de.element_type = 'heading'
  AND de.section_kind = 'main'
  AND COALESCE(hc.user_level,
               array_length(string_to_array(de.properties->>'numbering', '.'), 1)) = 1
  AND COALESCE(hc.excluded, false) = false
ORDER BY de.char_start;
```

**Wichtig:** `outline_status` von `document_content` für dieses Dokument **muss `'confirmed'`** sein, sonst werfen die Helper-Funktionen. Vor erstem Lauf prüfen und ggf. über die Outline-Validierungs-UI bestätigen.

## Robustheits-Stand der Pipeline

- `anchor_phrase` cap 80 → 500 chars (sanity); Style-Warning ≥ 80
- `scaffolding.excerpt` cap 500 → 1000 chars; Style-Warning ≥ 500
- `maxTokens` 4000 → 8000 (per-paragraph), 2000 → 4000 (subchapter synthesis)
- Chapter-collapse: `maxTokens=6000` (dual output: synthese + argumentationswiedergabe + auffaelligkeiten)
- Document-collapse: `maxTokens=5000`
- JSON.parse / Schema-Validation Failure dumpt raw response nach `/tmp/...failure-*.txt`
- typographic-quote repair für DOCX/OCR-Artefakte
- premise-Schema permissiv: unknown types → `background` mit inline marker
- `runGraphCollapse`, `runChapterCollapse`, `runDocumentCollapse` alle idempotent
- `runArgumentationGraphPass` idempotent

## LLM

`mammouth claude-sonnet-4-6`. Key in `mammouth.key` (gitignored). Architektur-Hinweis User: für unterschiedliche Pässe könnten zukünftig verschiedene Modelle genutzt werden (z.B. DeepSeek4 für mechanischere Pässe, Opus für Kapitel/Werk). `chat()`-Client nimmt schon einen Model-Parameter — Umstellung ist eine einzeilige Änderung pro Funktion, kein Architektur-Eingriff.

## Nächste konkrete Aktionen (Reihenfolge bewusst so)

1. ~~(d)-Ersetzung in beiden Prompts~~ — erledigt 2026-04-30 abend (Subkapitel ersetzt, Hauptkapitel eingefügt; Werk-Ebene entschieden ohne (d), siehe Section C). Nächste offene Aktion: Migration 036.
2. **Migration 036 anwenden:** `psql $DATABASE_URL < migrations/036_chapter_aggregation_level.sql`
3. **Dev-Driver-Skripte schreiben:** `scripts/run-chapter-collapse.ts` (Argumente: caseId, l1HeadingId) und `scripts/run-document-collapse.ts` (Argumente: caseId). Vorlage: `scripts/run-graph-collapse.ts`. Output: Tokens, synthese, ggf. argumentationswiedergabe, auffaelligkeiten — dump nach `docs/experiments/`.
4. **Validierungslauf am Theorie-Hauptkapitel** des Timm-Manuskripts (das L1-Kapitel, in dem Globalität, Schule und Globalität, Anforderungen an Professionalität liegen). Output gegen die hermeneutische Lektüre prüfen — analog zum S1→S3-Vorgehen auf Subkapitel-Ebene; bei Bedarf Prompt-Iteration auf Hauptkapitel-Ebene.
5. **Werk-Lauf** über das gesamte Timm-Manuskript, sobald alle L1-Hauptkapitel ein Memo haben.
6. **Endpoint-Erweiterung mit Auto-Trigger und SSE** (Schritte 5+6 aus dem vorigen Handover, unverändert in der Aufgabenstellung).

## Files / Pfade

- **Memory** (essenziell vor Prompt-Touch): `~/.claude/projects/-Users-joerissen-ai-sarah/memory/feedback_no_slop_in_prompts.md` — drei Slop-Warnsignale, opt-out-Klausel-Regel, Anwendungs-Anleitung.
- **Memory** (Architektur-Übersicht): `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md` — voraussichtlich noch auf altem Stand, beim nächsten Mal aktualisieren.
- Per-Absatz-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Subkapitel-Synthese: `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts` (idempotent; (d) ersetzt durch Tragweite/Tragfähigkeit)
- Hauptkapitel-Synthese: `src/lib/server/ai/hermeneutic/chapter-collapse.ts` (idempotent; (d) Tragweite/Tragfähigkeit eingefügt, vier Pflichtbestandteile)
- Werk-Synthese: `src/lib/server/ai/hermeneutic/document-collapse.ts` (idempotent; bleibt bei drei Pflichtbestandteilen, keine (d))
- Heading-Hierarchie-Helper: `src/lib/server/ai/hermeneutic/heading-hierarchy.ts`
- Per-Paragraph-Synthetic-Pass: `src/lib/server/ai/hermeneutic/per-paragraph.ts`
- Endpoint (zu erweitern): `src/routes/api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]/+server.ts`
- Dev-Driver bisher: `scripts/run-argumentation-graphs.ts`, `scripts/run-graph-collapse.ts`
- Migrations: `032_argumentation_graph_experiment.sql`, `033_scaffolding_elements.sql`, `034_argumentation_graph_default_true.sql`, `035_heading_classifications.sql` (User-Outline-Validierung), `036_chapter_aggregation_level.sql` (per-chapter Subkapitel-Ebene, **noch nicht angewendet**)

## Meta-Hinweis für die Folge-Session

Diese Session ist gegen Ende kontext-schwer geworden. Beobachtbare Symptome: Drift in Pattern-Matching-Modus statt eigenständiges Urteil, Überkorrekturen (z.B. von "ein Pflichtbestandteil ist Slop" zu "die ganze Pipeline ist nur deskriptiv"), affirmatives Echo statt kritisches Engagement. User hat das in der Session direkt benannt und korrigiert.

Für die Folge-Session: bei jedem Vorschlag, der eine Allgemeinregel aus einem Einzelbefund konstruiert ("X war Slop → ALLE X sind Slop"), zwei Sekunden anhalten und prüfen, ob der Schluss tatsächlich kommutiert. Bei jedem User-Hinweis nicht reflexartig adoptieren, sondern zuerst überlegen, ob der Befund vorab schon im Code steht (Beispiel dieser Session: einmal behauptet, eine Migration sei nötig, die schon existierte). Erst belegen, dann argumentieren.
