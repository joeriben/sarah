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

### C) Werk-Prompt — User-Entscheidung offen

**Datei:** `src/lib/server/ai/hermeneutic/document-collapse.ts` — aktuell drei Pflichtbestandteile (Forschungsbeitrag-Diagnose, Gesamtkohärenz und Werk-Architektur, Niveau-Beurteilung mit Werktyp-Akzent).

Soll Tragweite/Tragfähigkeit auch hier als (d) ergänzt werden?
- **Pro:** Werk-Tragweite (was beansprucht das Werk insgesamt zu leisten) und Werk-Tragfähigkeit (wird das im Werk-Korpus argumentativ getragen) sind genuine Werk-Fragen, in Forschungsbeitrag/Niveau nicht voll abgedeckt — man kann einen modesten Anspruch sauber tragen oder einen großen Anspruch unzureichend stützen, beides eigenständige Diagnosen.
- **Contra:** Überlappung mit Forschungsbeitrag-Diagnose ("was leistet das Werk als Ganzes") möglich.

Mein Lean: ja, ergänzen. Aber: User-Bestätigung einholen, bevor das Werk-Prompt verändert wird.

Wenn ja: vier Pflichtbestandteile auf Werk-Ebene, Synthese-Länge zurück auf 10–15 Sätze.

## Stand der Direction-4-Implementation

| Item | Status | Pfad |
|---|---|---|
| Migration 036 (`aggregation_subchapter_level smallint nullable` auf `heading_classifications`) | geschrieben, **NICHT angewendet** | `migrations/036_chapter_aggregation_level.sql` |
| Helper für resolved Outline + Median-Algorithmus + Persistenz | ✓ | `src/lib/server/ai/hermeneutic/heading-hierarchy.ts` |
| `runChapterCollapse` (mit Mode-conditional Input: paragraphs vs. subchapter-memos; bei L3 mit L2-Numerierungs-Gruppierung als Strukturhinweis) | ✓ — Prompt **wartet auf (d)-Ergänzung** | `src/lib/server/ai/hermeneutic/chapter-collapse.ts` |
| `runDocumentCollapse` (alle L1-Memos → Werk-Memo) | ✓ — Prompt **wartet auf User-Entscheidung zu (d)** | `src/lib/server/ai/hermeneutic/document-collapse.ts` |
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

1. **(d)-Ersetzung in beiden Prompts** (Subkapitel + Hauptkapitel), siehe Aufgabe 0 oben. Werk-Ebene: User-Bestätigung einholen, ob (d) auch dort ergänzt wird, dann ggf. dort dieselbe Ersetzung.
2. **Migration 036 anwenden:** `psql $DATABASE_URL < migrations/036_chapter_aggregation_level.sql`
3. **Dev-Driver-Skripte schreiben:** `scripts/run-chapter-collapse.ts` (Argumente: caseId, l1HeadingId) und `scripts/run-document-collapse.ts` (Argumente: caseId). Vorlage: `scripts/run-graph-collapse.ts`. Output: Tokens, synthese, ggf. argumentationswiedergabe, auffaelligkeiten — dump nach `docs/experiments/`.
4. **Validierungslauf am Theorie-Hauptkapitel** des Timm-Manuskripts (das L1-Kapitel, in dem Globalität, Schule und Globalität, Anforderungen an Professionalität liegen). Output gegen die hermeneutische Lektüre prüfen — analog zum S1→S3-Vorgehen auf Subkapitel-Ebene; bei Bedarf Prompt-Iteration auf Hauptkapitel-Ebene.
5. **Werk-Lauf** über das gesamte Timm-Manuskript, sobald alle L1-Hauptkapitel ein Memo haben.
6. **Endpoint-Erweiterung mit Auto-Trigger und SSE** (Schritte 5+6 aus dem vorigen Handover, unverändert in der Aufgabenstellung).

## Files / Pfade

- **Memory** (essenziell vor Prompt-Touch): `~/.claude/projects/-Users-joerissen-ai-sarah/memory/feedback_no_slop_in_prompts.md` — drei Slop-Warnsignale, opt-out-Klausel-Regel, Anwendungs-Anleitung.
- **Memory** (Architektur-Übersicht): `~/.claude/projects/-Users-joerissen-ai-sarah/memory/project_argumentations_graph_experiment.md` — voraussichtlich noch auf altem Stand, beim nächsten Mal aktualisieren.
- Per-Absatz-Pass: `src/lib/server/ai/hermeneutic/argumentation-graph.ts`
- Subkapitel-Synthese: `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts` (idempotent; **wartet auf (d)-Ersetzung**)
- Hauptkapitel-Synthese: `src/lib/server/ai/hermeneutic/chapter-collapse.ts` (idempotent; **wartet auf (d)-Ergänzung**)
- Werk-Synthese: `src/lib/server/ai/hermeneutic/document-collapse.ts` (idempotent; (d)-Frage offen)
- Heading-Hierarchie-Helper: `src/lib/server/ai/hermeneutic/heading-hierarchy.ts`
- Per-Paragraph-Synthetic-Pass: `src/lib/server/ai/hermeneutic/per-paragraph.ts`
- Endpoint (zu erweitern): `src/routes/api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]/+server.ts`
- Dev-Driver bisher: `scripts/run-argumentation-graphs.ts`, `scripts/run-graph-collapse.ts`
- Migrations: `032_argumentation_graph_experiment.sql`, `033_scaffolding_elements.sql`, `034_argumentation_graph_default_true.sql`, `035_heading_classifications.sql` (User-Outline-Validierung), `036_chapter_aggregation_level.sql` (per-chapter Subkapitel-Ebene, **noch nicht angewendet**)

## Meta-Hinweis für die Folge-Session

Diese Session ist gegen Ende kontext-schwer geworden. Beobachtbare Symptome: Drift in Pattern-Matching-Modus statt eigenständiges Urteil, Überkorrekturen (z.B. von "ein Pflichtbestandteil ist Slop" zu "die ganze Pipeline ist nur deskriptiv"), affirmatives Echo statt kritisches Engagement. User hat das in der Session direkt benannt und korrigiert.

Für die Folge-Session: bei jedem Vorschlag, der eine Allgemeinregel aus einem Einzelbefund konstruiert ("X war Slop → ALLE X sind Slop"), zwei Sekunden anhalten und prüfen, ob der Schluss tatsächlich kommutiert. Bei jedem User-Hinweis nicht reflexartig adoptieren, sondern zuerst überlegen, ob der Befund vorab schon im Code steht (Beispiel dieser Session: einmal behauptet, eine Migration sei nötig, die schon existierte). Erst belegen, dann argumentieren.
