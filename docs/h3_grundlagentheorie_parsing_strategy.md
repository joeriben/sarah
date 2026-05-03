# H3:GRUNDLAGENTHEORIE — Parsing-Strategie

Strategie für das Citation-Parsing in H3:GRUNDLAGENTHEORIE-Schritt 1 (VERWEIS_PROFIL_BAUEN).

Status: Vorschlag, vor Implementation mit User abstimmen.

In dieser Session wurde voreilig (von mir, vor User-Stop) ein Inline-Regex-Skelett in `src/lib/server/ai/h3/grundlagentheorie.ts` angelegt. Wird gemäss freigegebener Strategie überarbeitet.

---

## Aufgabe

Deterministische Pipeline-Stufe, kein LLM. Liefert ein **Datenartefakt** als strukturierten Input für Schritt 2 (REPRODUKTIV_VS_DISKURSIV-LLM-Klassifikation).

**Primärer Zweck**: Indikatoren für die wahrscheinliche Lage von Grenzen zwischen Literatur-Reproduktion und Diskussion. Die ¶-Distribution der Verweise (Bandbreite × Frequenz × Konzentration) ist das Signal — Reproduktions-Blöcke zeigen typischerweise hohe Konzentration auf wenige Quellen über aufeinanderfolgende ¶, Diskussions-Blöcke zeigen niedrigere Citation-Dichte mit eigen-formulierten Sätzen.

**Sekundärer Zweck**: deskriptive Verweis-Karte für WERK_GUTACHT-Achse "Fundiertheit der GRUNDLAGENTHEORIE" und für ECKPUNKT-Eckpunkte (Korrektheit, Kontamination) in Schritt 3a.

Mother-Session (4ca02b6d) verlangt Schritt 1 ausdrücklich als Regex, kein LLM, deskriptiv. Diese Strategie hält das ein.

## Komponenten — alles deterministisch

### 1. Inline-Citation-Extraktion im GRUNDLAGENTHEORIE-Container

Regex über Container-¶, Erstwurf-Coverage:
- `Author (Jahr)`, `Author (Jahr: Seite)`, `Author (Jahr, S. Seite)`
- `(Author Jahr)`, `(Author Jahr: Seite)`
- Mehrere Autoren mit `/`, `&`, `et al.`, `u. a.`
- `vgl./Vgl.` als Vorzeichen wird mit-erfasst, nicht als separater Marker

Pro Treffer: `(authorString, authorsCanonical[], year, page, paragraphId, paragraphIndex, offsetInParagraph, rawMatch)`.

**Nicht erfasst** im Erstwurf: rein numerische Zitierstile (DIN/Springer), Fußnotensystem (Klassik-Disziplinen), Quellenbeleg in eckigen Klammern. Wenn Werke das brauchen, zweite Regex-Welle.

### 2. Bibliografie-Liste am Werk-Ende

Detektion über Heading-Text-Match: `Literaturverzeichnis|Literatur|Bibliografie|Bibliographie|Quellenverzeichnis|Quellen` (case-insensitive). Falls dafür ein eigenes `outline_function_type='BIBLIOGRAPHY'`-Slot sinnvoller ist — eigene Mini-Setzung in der FUNKTIONSTYP_ZUWEISEN-Vor-Heuristik.

Eintrags-Split: pro DOCX-`paragraph` ein Eintrag (typischer Stil mit hängender Einrückung pro Eintrag), oder Listen-Splitting per Leerzeile/numerische Marker.

Pro Eintrag deterministisch extrahieren:
- erster Familienname (Erstautor) → Match-Schlüssel
- Jahr (`(18|19|20)\d{2}[a-z]?`)
- Rohtext (vollständiger Eintrag)
- Char-Anker

Mehr nicht. **Kein** Werk-Titel-Parsing, **keine** Werk-Typ-Klassifikation, **kein** LLM.

### 3. Cross-Referenz Inline → Bibliografie

Author-Familienname + Jahr-Match. Pro Inline-Citation:
- Match → `bibliography_entry_id` gesetzt
- Kein Match → `orphan` (schwebende Verweisung — selbst ein deskriptiver Befund)

Mehrdeutigkeiten (`Klafki 2007a` vs `Klafki 2007b`): wenn die Inline-Citation kein Suffix trägt, aber das Verzeichnis Suffix-Varianten enthält, bleiben mehrere Kandidaten — Liste statt Single-Match.

### 4. Verweisprofil rechnen

Aus 1+3 das Profil aggregieren. Felder, die das Reprod/Diskuss-Grenz-Signal tragen:

- **Bandbreite**: `uniqueAuthorCount`, `firstMentionOrder`
- **Frequenz**: `mentionsPerAuthor` (Verteilung — mean/max/median/Top-N-Share)
- **Konzentration**: HHI über die Citation-Verteilung; oder Gini — Standard-Maße, einzeilig
- **¶-Verteilung**: `paragraphsPerAuthor` (Distribution-Breite); `paragraphsWithCitation` vs. `paragraphsWithoutCitation`
- **Konsekutiv-Cluster**: `maxConsecutiveParagraphsDominatedByAuthor` (längste Strecke aufeinanderfolgender ¶, in denen derselbe Autor dominiert) — **direkter Reproduktions-Block-Indikator**
- **Pro ¶**: `byParagraph[i] = { citationCount, dominantAuthor, citationDensity }` — strukturiert so, dass Schritt 2 das LLM mit ¶-weisen Verweis-Signaturen versorgen kann
- **Coverage**: `orphanCitations` (Inline-Verweise ohne Bibliografie-Match) — schwebende Verweisungen; deskriptiver Befund, der in WERK_GUTACHT konsultiert wird

**Empirische Streuungs-Prüfung vor Schema-Festlegung**: Lauf gegen BA H3 dev + 1–2 Habil-Cases. Wenn ein Indikator in allen Werken nahezu konstant ist, ist er als Signal wertlos und fällt raus.

## Was nicht in dieser Stufe passiert

- Kein LLM
- Keine Werk-Typ-Klassifikation (Buch/Aufsatz/Dissertation/online)
- Keine primär-vs-sekundär-Heuristik (kein "vgl."/"via"-Marker-Sub-Klassifikator)
- Keine inhaltliche Bewertung der Verweise
- Keine Reviewer-Signale (rot/gelb/grün)

Werk-Typ-Klassifikation und vertiefte Quellenkritik gehören — falls sie in SARAH nötig werden — in einen separaten "Quellenverzeichnis-Pass", der außerhalb von H3:GRUNDLAGENTHEORIE als eigenes Feature steht (Agent-Planung-Session-Roadmap, dort pausiert).

## Persistenz

Pro GRUNDLAGENTHEORIE-Container ein `function_constructs`-Eintrag mit `construct_kind='VERWEIS_PROFIL'`. `content` enthält das Profil + Rohcitations + Cross-Reference-Resultate.

Bibliografie selbst: zwei Optionen, zur Klärung:
- **(α) Eigene Tabelle `bibliography_entries`** (case_id, document_id, char_start, char_end, raw_text, author_lastname, year, suffix). Sauber, abfragbar.
- **(β) Als JSONB im Document-Scope** (z.B. neuer construct_kind='BIBLIOGRAPHY' am Werk-Ende oder eigene Tabellenspalte am `namings`-Document). Schmaler.

Empfehlung: (α), weil Cross-Referenz von Inline-Citations gegen Bibliografie als SQL-Join sinnvoll wird, sobald andere Heuristiken (z.B. spätere DURCHFÜHRUNG-Schritte) ebenfalls Author+Jahr-Cross-Lookup brauchen.

## Aufwand-Schätzung

- Migration `bibliography_entries`: 10 Min
- Bibliografie-Detection + Eintrags-Split + Author/Year-Extract: ~2 h
- Inline-Citation-Regex + Aggregation: ~1.5 h
- Cross-Referenz-Match: 1 h
- Verweisprofil-Felder (inkl. HHI, Konsekutiv-Cluster): 1.5 h
- Test-Script + Streuungs-Vergleichslauf BA + Habil: 1 h

Insgesamt ~7 h. Kein LLM-Aufruf, keine Token-Kosten in dieser Stufe.

## Was zu klären ist

1. Tabelle `bibliography_entries` (α) oder JSONB (β)? Empfehlung α.
2. Bibliografie-Detection per Heading-Text-Match jetzt, oder eigenes `outline_function_type='BIBLIOGRAPHY'`-Slot in der Vor-Heuristik FUNKTIONSTYP_ZUWEISEN ergänzen?
3. Welche Indikator-Felder im Schema verbindlich, welche optional? Streuungs-Prüfung gegen BA + 1–2 Habil-Cases vor Festlegung — danach wird das Schema eingefroren.
4. Was passiert mit der voreilig erstellten `grundlagentheorie.ts`: Container-Auflösung-Block bleibt; Citation-Regex-Block wird gegen die hier festgelegten Felder neu geschrieben; bisheriges `byAuthor/byParagraph` wird um HHI + Konsekutiv-Cluster + Cross-Reference erweitert.
