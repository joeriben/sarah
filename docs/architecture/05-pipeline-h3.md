# 05 — Pipeline H3 (Funktionstyp-Heuristiken)

**Stand: 2026-05-05** · Drei-Heuristiken-Architektur, Funktionstyp-Zuweisung, per-Funktionstyp-Implementierungs-Stand.

H3 ist nicht "tiefer als H2", sondern eine **dritte Heuristik gleichrangig zu H1/H2** (Memory `project_three_heuristics_architecture`). Routing zwischen H1/H2/H3 ist **Falltyp-deterministisch** (siehe `06-cases-briefs-falltyp.md`), **nicht** User-Toggle.

Eintrittspunkt: `src/lib/server/pipeline/function-type-assignment.ts` (Pre-Heuristik) + `src/lib/server/ai/h3/*.ts` (Per-Funktionstyp).

---

## 1. Drei-Heuristiken-Übersicht

| Heuristik | Skalierung | Rolle |
|-----------|-----------|-------|
| **H1** | Werk-skaliert (paragraph→subchapter→chapter→work) | analytische Hauptlinie, argument-extraktiv über Argumentations-Graph (siehe `04-pipeline-h1-h2.md` §1.1) |
| **H2** | Werk-skaliert (paragraph→subchapter→chapter→work) | synthetisch-hermeneutische Hauptlinie, kumulativ-sequenziell über interpretive chain; symmetrisch zu H1, eigenständige Vokabel-Schicht (`verlaufswiedergabe` statt `argumentationswiedergabe`) — siehe `04-pipeline-h1-h2.md` §1.2/§3.4 |
| **H3** | per-Funktionstyp (Werk-strukturell) | Funktionstyp-spezifische Konstrukte (FRAGESTELLUNG, METHODOLOGIE, BASIS, VERWEIS_PROFIL, FORSCHUNGSGEGENSTAND, BEFUND, …) |

H1 und H2 sind exklusiv pro Run (`options.heuristic`), aber linien-rein parallelisierbar auf demselben Werk (Tag-Filter `[…/graph]` vs `[…/synthetic]`). H3 läuft **nach** Outline-Confirm und setzt korrekt klassifizierte Funktionstypen voraus.

---

## 2. Funktionstyp-Vokabular (`src/lib/shared/h3-vocabulary.ts`)

**OutlineFunctionType** (8 Werte):

```
EXPOSITION          — Einleitung, Fragestellung, Motivation, Zielsetzung
GRUNDLAGENTHEORIE   — theoretische Verankerung, Forschungsgegenstand
FORSCHUNGSDESIGN    — Methodologie, Methoden, Basis (Datenmaterial)
DURCHFUEHRUNG       — empirische Auswertung, Analyse-Kapitel
EXKURS              — abgegrenzte Vertiefung
SYNTHESE            — Ergebnis-Synthese
SCHLUSSREFLEXION    — Diskussion, Ausblick, methodische Reflexion
WERK_STRUKTUR       — Werk-Ebene (kein Heading-Container)
```

**GranularityLevel** (3 Werte): `KAPITEL`, `UNTERKAPITEL`, `ABSCHNITT`.

Guards: `isOutlineFunctionType()`, `isGranularityLevel()`. Display-Labels (Deutsch): `OUTLINE_FUNCTION_TYPE_LABELS`, `GRANULARITY_LEVEL_LABELS`.

---

## 3. Pre-Heuristik: Funktionstyp-Zuweisung

`function-type-assignment.ts`. Drei Signale, descending confidence:

1. **Heading-Marker-Regex** (0.6–0.95): "Exkurs", "Einleitung", "Fazit", "Methodologie", "Grundlagen", "Diskussion", "Ergebnisse" etc.
2. **Position-Heuristik** (0.6): erstes Top-Level → EXPOSITION; letztes Top-Level → SCHLUSSREFLEXION.
3. **Brief-`work_type`-Default** (lowest, derzeit nicht aktiv).

Persistenz nur dort, wo `outline_function_type_user_set = false` (User-Override-respektierend).

**Granularity-Defaults** (`DEFAULT_GRANULARITY`):

| Funktionstyp | Default-Granularity |
|--------------|---------------------|
| EXPOSITION | KAPITEL |
| GRUNDLAGENTHEORIE | UNTERKAPITEL |
| FORSCHUNGSDESIGN | KAPITEL (kaskadierend) |
| DURCHFUEHRUNG | UNTERKAPITEL |
| EXKURS / SYNTHESE / SCHLUSSREFLEXION | KAPITEL |
| WERK_STRUKTUR | (Werk-Ebene, hier nicht zugewiesen) |

API: `POST /api/projects/:projectId/documents/:docId/outline/suggest-function-types`.

---

## 4. Per-Funktionstyp-Implementierungs-Stand

### 4.1 EXPOSITION (`ai/h3/exposition.ts`) — **begonnen, validiert (FRAGESTELLUNG + MOTIVATION)**

**Konstrukte:** FRAGESTELLUNG, MOTIVATION (Konstrukt-Definition siehe Memory `project_fragestellung_definition`: Fragestellung = Problemfeld + Perspektive, **nicht** grammatische Frage; Methode → FORSCHUNGSDESIGN; Motivation → eigenes Konstrukt).

**Pipeline:**

1. **Backward-Search-Parser (regex, kein LLM)** — sucht ¶-Cluster mit `?`, `Forschungsfrage`, `lautet:`, `untersucht`, `im Mittelpunkt`. Alle ¶ davor = Motivation.
2. **LLM rekonstruiert FRAGESTELLUNG** — kritische Rekonstruktion (filtert Slop / Motivation / Methode raus, bildet keine 1:1-Reproduktion).
3. **LLM summarizes MOTIVATION** (1–3 Sätze, falls Motivation-¶ existieren).

**Fallback** wenn Parser leer: einzelner LLM-Call über ganzen Container (Identifikation + Rekonstruktion + Summary zusammen).

**Persistenz:** `function_constructs` mit `construct_kind ∈ {FRAGESTELLUNG, MOTIVATION}`, `content = { text: <…> }` (nur Extrakt — keine Telemetrie/Status/Rationale, siehe Memory `feedback_constructs_are_extracts_not_telemetry`).

**Re-Run-Gefahr:** dupliziert derzeit. Schutzpattern (clean-before-insert wenn kein `validated_at`-Stempel) ist offen — siehe `docs/h3_implementation_status.md`.

**Offen / pending User-Abnick:** Qualifizierung der selbstdeklarierten Original-Formulierung. Spec in `docs/handover_h3_exposition_qualifizierung.md`. **Strikt:** drei separate isolierte LLM-Calls auf demselben Source-¶ (Rekonstruktion / Motivation / Beurteilung), **null Datenfluss** dazwischen — Beurteilung sieht ausschließlich Source, **nicht** rekonstruierte Fragestellung. Prompt-Wording im Handover verbatim, **nicht** umformulieren (Memory `feedback_no_slop_in_prompts`). Halluzinierte 3-Stufen-Skala (`tragfaehig/schwach/verfehlt`) ist **nicht autorisiert** (Memory `feedback_no_hallucinated_qskala`).

### 4.2 FORSCHUNGSDESIGN (`ai/h3/forschungsdesign.ts`) — **begonnen, validiert (METHODIK_EXTRAHIEREN)**

**Konstrukte:** METHODOLOGIE, METHODEN, BASIS. BASIS umfasst nicht nur "was untersucht wird" (Sample/Korpus), sondern auch dessen **Begründung in Bezug auf die Fragestellung**; fehlende Begründung wird im BASIS-Text als Lücke benannt, nicht still überbrückt (Mother-Session-Setzung Z. 92).

**Pipeline:**

1. **¶-Collection mit Provenance-Tracking** (kaskadierend):
   - a) Outline-Container `FORSCHUNGSDESIGN` (KAPITEL/UNTERKAPITEL).
   - b) Fallback: EXPOSITION-Container + Methoden-Marker-Regex.
   - c) Fallback: full-text scan aller main-¶ + Methoden-Marker-Regex.
2. **Persistenter virtual container** (`virtual_function_containers`) mit source_anchor_ranges (Provenance pro ¶). Re-Run = clean-before-insert.
3. **Reference-Context laden:**
   - FRAGESTELLUNG (aus EXPOSITION-Lauf — characterization-Konstrukt; Pflicht).
   - FORSCHUNGSGEGENSTAND (aus GRUNDLAGENTHEORIE-Lauf — specification-Konstrukt; **kann fehlen** wenn parallele Session noch läuft).
4. **METHODIK_EXTRAHIEREN** — single LLM-Call, JSON-Schema `{methodologie, methoden, basis}` (Felder nullable). Pro non-null Feld → ein `function_construct`.

**Offen:** VALIDITY_FALLACY_PRÜFEN-Querschnittsmodul (laut Mother-Session, in dieser Iteration nicht enthalten); Scaffolding-Querschnittsmodul (deferred).

### 4.3 GRUNDLAGENTHEORIE (`ai/h3/grundlagentheorie.ts` + 4 Submodule) — **Steps 1–4 ✓**

Pyramide aus deterministischer Analyse + selektivem LLM, alle vier Schichten am Material auf BA H3 dev und Habil Timm verifiziert (2026-05-03 spätabends). Detail in `docs/h3_grundlagentheorie_status.md`.

**Step 1: VERWEIS_PROFIL (deterministisch, kein LLM)** — `grundlagentheorie.ts`:

- Container-Resolution via `outline_function_type='GRUNDLAGENTHEORIE'`.
- Bibliographie-Extraktion (Werk-Ende, Fallback Heading-Match) → `bibliography_entries` (Mig 048).
- Inline-Citation-Extraktion (narrative `Author/Year` + Bracket-Blöcke).
- Cross-Ref Inline → Bibliographie (author + year match; orphans tracked).
- Aggregation: `byAuthor`, `byParagraph` (density / dominant / consecutive), HHI, Top-1-Share, consecutive-cluster, coverage (resolved/orphan).
- Persistenz: `function_constructs` VERWEIS_PROFIL pro Container.

**Validierung**: BA H3 dev HHI=0.64 (mono-reproduktiv), BA TM HHI=0.09 (mixed), Habil-Timm HHI=0.012–0.018 (dispersed).

**Refactor-Versuch 2026-05-03 (Klammer-zentrierte Citation-Heuristik) — verworfen.** Bracket-Pattern-Konzept war valide, aber Sub-Block-Split zu lose; verlor 28 wahre Citations im Habil-Test (Net-Recall schlechter). Author-Pattern-Heuristik wiederhergestellt. Detail in `docs/h3_grundlagentheorie_status.md`.

**Step 2: ROUTING (WIEDERGABE_PRÜFEN, block-LLM)** — `grundlagentheorie_routing.ts`:

- Verdachts-Blöcke aus VERWEIS_PROFIL (Author-Cluster ≥ `minClusterLen`, Citation-Gap ≥ `minCitationGapLen`).
- Pro Verdachts-Block 1 LLM-Call: classification ∈ {wiedergabe, diskussion}, confidence ∈ {high, medium, low}.
- Persistenz: `BLOCK_ROUTING` pro Container — auch bei 0 Verdachts-Blöcken (für polyphone Habil-Container; Bug-Fix `c2b7054`), damit Reproduktiv und Diskursiv anschlussfähig sind.
- Defaults `cluster=4 gap=5` sind BA-mono-reproduktiv-kalibriert; polyphone Habil-Container brauchen `cluster=2 gap=3`.

**Step 3 reproduktiv: BLOCK_WUERDIGUNG (H2) + ECKPUNKT_CHECK** — `grundlagentheorie_reproductive.ts`:

- Pro `wiedergabe`-Block 2 LLM-Calls.
- BLOCK_WUERDIGUNG: synthetisch-hermeneutische 2–4-Sätze-Würdigung "Was wird gesagt?".
- ECKPUNKT_CHECK: Reviewer-Indikatoren auf 3 Achsen (`kernbegriff`, `kontamination`, `provenienz`) ∈ {green, yellow, red}.
- Persistenz: `BLOCK_WUERDIGUNG` + `ECKPUNKT_BEFUND` pro Container.

**Step 3 diskursiv: DISKURSIV_BEZUG_PRÜFEN** — `grundlagentheorie_discursive.ts`:

- Pro Block (`routing_diskussion` aus Step 2 + `standard_stretch` der dazwischen liegenden ¶-Sequenzen) 1 LLM-Call.
- Cross-Typ-Bezug: liest FRAGESTELLUNG aus EXPOSITION-Pass.
- Output: `bezug` ∈ {explizit, implizit, bezugslos}, `signal` ∈ {green, yellow, red} + Rationale + Anchor-¶-IDs.
- Persistenz: `DISKURSIV_BEZUG_BEFUND` pro Container.

**Step 4: FORSCHUNGSGEGENSTAND_REKONSTRUIEREN (Werk-Aggregat)** — `grundlagentheorie_forschungsgegenstand.ts`:

- 1 LLM-Call pro Werk (nicht pro Container) — User-Setzung 2026-05-03 spätabends: aggregiertes Konstrukt vor FORSCHUNGSDESIGN-Pass nötig.
- Inputs: FRAGESTELLUNG (EXPOSITION) + pro GRUNDLAGENTHEORIE-Container kondensierte Übersicht (VERWEIS_PROFIL Top-Autoren + HHI, BLOCK_WUERDIGUNG-Summaries, ECKPUNKT-Signale, DISKURSIV-Block-Klassifikationen — letztere drei optional).
- Output: deskriptiver Forschungsgegenstand (3–5 Sätze) + 3–7 Subject-Keywords + optional Salient-Container-Indices.
- Persistenz: `FORSCHUNGSGEGENSTAND` mit `anchor_element_ids` = alle ¶ aller GTH-Container des Werks.
- Validiert auf Habil (2 Container, Hyperkultur/Kulturessentialismus + Schulkultur/Professionalisierung, 1 Call / 3k tokens / ~3 ct) und BA H3 dev (1 Container, Klafki/GCED-Spannung, 1 Call / 1.1k tokens / ~3 ct).

**Specification-Kette validiert**: FORSCHUNGSDESIGN-Pass (§4.2) liest FRAGESTELLUNG + FORSCHUNGSGEGENSTAND als Bezugsrahmen; BASIS-Output auf Habil enthält kontextuelle Sample-Kritik mit explizitem FORSCHUNGSGEGENSTAND-Bezug. Architektur trägt am Material.

**Cost-Hypothese bestätigt**: Habil-Pyramide alle 4 Schritte mit gesenkten Schwellen 18 LLM-Calls / ~44k Tokens / ~25–30 ct OpenRouter für 53 ¶ in 2 Containern; pauschales H1 wäre ~250–400k Tokens (~6–9x).

**Offen**: Container-Orchestrator (verbindet alle 4 Schichten + bindet bestehende H1-Pipeline auf diskursive ¶ ein); Schwellen-Konfigurierbarkeit im Falltyp-System; Sub-Block-Bildung an Sub-Headings für feinere Diskursiv-Granularität.

### 4.4 DURCHFUEHRUNG (`ai/h3/durchfuehrung.ts`) — **Steps 1–4 ✓**

**Mother-Setzung:** Empirieartikel sind sehr lang und enthalten zwar Schlüsse, aber wenig Argumentation. H1 auf das ganze Material wäre teuer und sinnlos. Daher: billige Regex-/Heuristik-Vorauswahl von **Befund-Hotspots**, dann selektive H1-Anwendung **nur dort**. Mother-Schätzung: 10–20% des DURCHFÜHRUNG-Materials werden tatsächlich per LLM analysiert.

**Step 1: BEFUND-Hotspot-Detection (deterministisch, kein LLM)** — komplett:

- Container-Resolution: alle Headings mit `outline_function_type='DURCHFUEHRUNG'` (kann mehrfach im Werk vorkommen — Empirie-Habilitationen haben oft mehrere DURCHFÜHRUNGS-Kapitel; LATERAL-Lookup, jeder ¶ geht an seinen nächstgelegenen DURCHFÜHRUNG-Heading).
- Closure-Marker-Regex pro ¶: 17 Marker-Klassen (zeigt_sich, befund_lemma, ergibt_sich, feststellen, lassen_sich, hervorgehen, deutlich_werden, weist_hin, deutet_hin, macht_deutlich, dokumentiert_sich, rekonstruiert_sich, kommt_zum_ausdruck, tritt_hervor, zusammenfassend, material_referenz, wird_ersichtlich). Schmale Liste bewusst — Memory `feedback_pattern_iteration_vs_simpler_heuristic`: lieber kleine Diagnostik-Liste, dann iterieren, als großer Pattern-Katalog vorab.
- Persistenz: ein `virtual_function_containers`-Eintrag pro DURCHFÜHRUNG-Outline-Container, `source_anchor_ranges` enthält nur die Hotspot-¶ (Sub-Set). Re-Run: clean-before-insert für `(case_id, document_id, outline_function_type='DURCHFUEHRUNG')`.
- **Kein** `function_constructs`-Schreiben in Step 1 — Memory `feedback_constructs_are_extracts_not_telemetry`: Hotspot-Listen sind Pre-Selektion, kein Extrakt. BEFUND-Konstrukte entstehen erst in Step 2 nach H1-Pass.
- Validiert auf BA H3 dev (1 Container, 14 ¶, Quote 7%) und Habil H3 Test (2 Container, 114 ¶, Quote 27% — befundreiches Empirie-Material).

**Step 2 ✓ (Selektive H1-Anwendung auf Hotspots)** — implementiert via `runDurchfuehrungPassStep2(caseId)`:

- Lädt Hotspot-¶ aus den `virtual_function_containers` (Step-1-Output).
- Pro Hotspot-¶ sequenziell: `runArgumentationGraphPass` → `runArgumentValidityPass`. Wiederverwendung der bestehenden H1-Tools, kein eigener Prompt.
- Idempotent durch H1-eigene Skip-Logik (argument_nodes/scaffolding_elements bereits da → AG skip; alle argument_nodes assessment ≠ NULL → Validity skip). Re-Run identisch ¶ erzeugt 0 Tokens.
- Persistenz vollständig in den H1-Tabellen (`argument_nodes`, `scaffolding_elements`, `argument_nodes.validity_assessment`). **Kein** `function_constructs`-Schreiben in Step 2 — BEFUND-Extrakt entsteht erst in Schritt 4 (nach Grounding-Lookup), Memory `feedback_constructs_are_extracts_not_telemetry`.
- Sequenziell, nicht parallel: Empirie-Container haben oft viele Folgehotspots, parallele Calls bringen kein echtes Throughput-Plus, dafür Rate-Limit-Risiko.
- Validiert auf BA H3 dev: 1 Hotspot, AG → 6 Args + 3 Scaffolding, Validity → 6 Args bewertet, 14k Tokens, 28s. Re-Run 7ms / 0 Tokens.

**Step 3 ✓ (Stellenspezifische Regex-Rückwärtssuche, deterministisches Such-Tool)** — implementiert via `runDurchfuehrungPassStep3(caseId)` und `lookupGroundingForHotspot(hotspot, container)`:

- **Pattern-Quellen aus dem Hotspot-¶**:
  1. Eigennamen / distinktive Großbuchstaben-Tokens (≥4 Zeichen) — fängt Personennamen, Akronyme (UNESCO, GCED), Empirie-Fall-IDs (Domino, Candy, Apfelkuchen) und Fachbegriffe (Vergleichshorizont, Transkriptausschnitt). Stop-Liste: deutsche Funktionswörter + akademische Container-Begriffe (Studie, Befund, Kapitel etc.).
  2. Inline-Zitate (Author-Year) — wiederverwendet via `extractInlineCitations` aus `grundlagentheorie.ts`.
- **Suchraum**: alle ¶ desselben DURCHFÜHRUNGS-Containers VOR dem Hotspot (`charStart < hotspot.charStart`). Nicht über Container-Grenzen hinaus — Mother-Setzung "bis zum Kapitelbeginn".
- **Output pro Token**: alle Vorlauf-¶ mit Treffer (sortiert), nearest (letzter Treffer vor Hotspot), first (Erst-Einführung im Container). Tokens ohne Treffer landen in `unmatched` — wertvolles Signal, dass der Verweis-Anker nicht im selben Kapitel begründet ist.
- Validiert auf BA H3 dev: 1 Hotspot, 62 Tokens, 21% Match-Quote (theoretischer Vergleich, viele neue Konzepte). Habil H3 Test: 31 Hotspots, 784 Tokens, 50% Match-Quote (Empirie mit reichlich Vorlauf-Querverweisen). Beide Läufe deterministisch, kein LLM.
- **Agentische Verwendung folgt in Schritt 4** (BEFUND-Konsolidierung): ein LLM-Pass pro Hotspot kann das Such-Tool tool-use-mäßig aufrufen, wenn das H1-Argument einen anaphorischen Verweis enthält, dessen Grounding im Hotspot-¶ fehlt. Architekturprinzip: billige On-Demand-Suchtools statt großzügigem Pre-Loading des Kontextfensters.

**Step 4 ✓ (BEFUND-Konsolidierung, 1 LLM-Call pro Hotspot)** — implementiert via `runDurchfuehrungPassStep4(caseId)`:

- Pro Hotspot ein einzelner LLM-Call. Inputs: Hotspot-¶-Text, H1-Argumente aus Step 2 (Claim + `validity_assessment.carries`), Grounding-Lookup-Treffer aus Step 3 (Token + Snippet aus dem nearest-Vorlauf-¶).
- LLM-Output (JSON-Schema): `text: string | null`, `support_argument_local_ids: string[]`, `grounding_handles: string[]`.
- Persistenz: `function_constructs.construct_kind = 'BEFUND'`, `anchor_element_ids = [hotspot_paragraph_id]`, `virtual_container_id = step1_container_id`, `content = { text, support_argument_ids: UUID[], grounding_paragraph_ids: UUID[] }`. Memory `feedback_constructs_are_extracts_not_telemetry`: nur Extrakt-Text + Bezugs-IDs (LLM-Auswahl aus existierenden Pipeline-Daten), **kein** Plausibilitäts-Score, **keine** Rationale-Felder.
- **`text: null` ist erlaubt und semantisch tragend**: das Konstrukt wird trotzdem persistiert, mit leeren `support_argument_ids` / `grounding_paragraph_ids`. So bleibt der Audit-Trail erhalten — der Reviewer sieht "Hotspot wurde geprüft, kein Befund extrahiert" statt eines stillen Verschwindens. Memory `project_critical_friend_identity`.
- Idempotent via clear-before-insert auf `(case_id, document_id, outline_function_type='DURCHFUEHRUNG', construct_kind='BEFUND')`.
- Validiert auf BA H3 dev: 1 Hotspot, BEFUND extrahiert (5 support_args, 6 grounding_¶), 4.5k in / 340 out Tokens, 4s. Re-Run idempotent.

### 4.5 EXKURS (`ai/h3/exkurs.ts`) — **implementiert, formal validiert; semantischer Test offen**

Architektur (User-Setzung 2026-05-04): EXKURS ist keine GRUNDLAGENTHEORIE-Spiegelung mit eigener Pyramide, sondern eine theoretische Wendung des Autors, die einen externen Begriff einführt und damit Begriffe des bisherigen FORSCHUNGSGEGENSTANDs in einer neuen Lesart re-spezifiziert (Beispiel: Habitus à la Bourdieu → Habitus als foucaultsche Disponierung nach Foucault-EXKURS).

Persistenz-Modell: **destruktive Modifikation des bestehenden FORSCHUNGSGEGENSTAND-Konstrukts**. EXKURS schreibt KEIN eigenes Konstrukt; statt dessen:
- `function_constructs.content` wird durch eine LLM-rekomponierte neue Version ersetzt (vollständiger neuer FG-Text + ggf. ergänzte subjectKeywords)
- `function_constructs.version_stack` bekommt einen `re_spec`-Eintrag (kind, at, source_exkurs_anchors, imported_concepts, affected_concepts, re_spec_text, content_snapshot des neuen Stands)

Konsumenten (FORSCHUNGSDESIGN, später SYNTHESE/SR/WERK_*) lesen FG ganz normal per SELECT und bekommen den re-spezifizierten Stand. Kein Aggregator-Read nötig.

Idempotenz: vor Stack-Append werden bestehende `re_spec`-Einträge mit gleichem `source_exkurs_anchors`-Set aus dem Stack entfernt. content wird via `rebuildContentFromStack` aus dem gefilterten Stack errechnet — Re-Run für gleichen EXKURS ergibt genau einen `re_spec`-Eintrag.

Sequenzialität: bei mehreren EXKURSEN im Werk läuft die Pipeline outline-sortiert; jeder EXKURS sieht den bereits re-spezifizierten Stand des vorigen.

`noRespec=true`-Pfad: bei reiner Hintergrund-Notiz (historische Notiz, Methoden-Klärung, etc.) bleibt FG unverändert; kein Stack-Wachstum.

Validierung 2026-05-04 gegen BA H3 dev mit temp-Markierung "Theoretischer Rahmen" als EXKURS:
- LLM erkennt korrekt `noRespec=true` (Klafki-Theorierahmen ist Erstexposition, keine Re-Spezifikation eines vorhandenen Begriffs)
- Stack-Tiefe 1 → 1 (kein neuer Eintrag)
- Auto-Cleanup im Test-Skript: FG-Snapshot vor Lauf, restored im finally
- Funktionaler Test mit semantisch echtem EXKURS-Container steht aus (im Bestand selten)

**V.3.0-Roadmap**: intelligenterer Stack mit LLM-detektabler transformatorischer Emergenz (Stack-Diff als Fortschritt/Regression-Indikator). Dafür müsste der LLM die Stack-Sequenz lesen und Bewegungen klassifizieren. Heute deferred — der Stack ist materialisiert, aber nicht instrumentiert.

### 4.6 SYNTHESE (`ai/h3/synthese.ts`) — **implementiert, Cross-Typ-Substrat-Erweiterung 2026-05-05 verifiziert**

Architektur (User-Setzung 2026-05-04): ein Konstrukt `construct_kind='GESAMTERGEBNIS'` mit reichem content (`gesamtergebnisText`, `fragestellungsAntwortText`, `erkenntnisIntegration[]`, `coverageRatio`, `crossTypeReads`). Werk-Aggregat: anchor = alle ¶ aller SYNTHESE-Container des Werks.

**Cross-Typ-Substrat-Erweiterung 2026-05-05** (User-Setzung "ok, mach das so!"): SYNTHESE und SR teilen sich jetzt einen gemeinsamen Substrate-Loader-Layer in `src/lib/server/ai/h3/werk-substrate.ts`. Was vorher Bruchteil des verfügbaren H3-Substrats war, fließt jetzt vollständig ein:
- **EXPOSITION**: FRAGESTELLUNG + Beurteilung (optional, sobald Qualifizierung gemerged) + MOTIVATION (optional)
- **FORSCHUNGSDESIGN**: METHODOLOGIE + METHODEN + BASIS (Triple)
- **GRUNDLAGENTHEORIE**: FORSCHUNGSGEGENSTAND (post-EXKURS via SELECT) + VERWEIS_PROFIL Werk-Aggregat (Top-Autoren/HHI/Top-1-Share/cluster-count) + GTH-Reflexion (BLOCK_WUERDIGUNG/ECKPUNKT/DISKURSIV-Verteilungen, defensive)
- **DURCHFÜHRUNG**: alle BEFUNDE mit text!=null + Audit-only-Hotspots (text=null, negatives Signal) + argument_substrate-counts
- **EXKURS**: re_spec-history aus FG.version_stack (chronologisch)

Pipeline (1 LLM-Call pro Werk, default Sonnet 4.6, **max 6000 Tokens** — vorher 2000):
- Sectioned prompt: KONTEXT / METHODISCHES SETUP / THEORIEBASIS-PROFIL / EMPIRIE-SUBSTRAT / BEFUNDE-LISTE / SYNTHESE-MATERIAL
- LLM-Aufgabe in drei Teilen: (A) GESAMTERGEBNIS 5–8 Sätze (vorher 3–5), (B) FRAGESTELLUNGS-ANTWORT 2–4 Sätze (vorher 1–3), (C) Integration-Map pro BEFUND
- Stil-Klausel im Prompt verbietet Skalen-Adjektive ("stark/schwach/lückenhaft/tragfähig") — nur deskriptive Verben (Memory `project_critical_friend_identity`)
- Server-seitig: LLM-Indices auf UUIDs gemappt, `coverageRatio = integratedCount / befundCount`

Idempotent (delete-before-insert pro Werk). Kein version_stack-Wachstum jenseits origin.

Validierung 2026-05-05 gegen BA H3 dev: GESAMTERGEBNIS benennt jetzt explizit "stark konzentrierten Rückgriff auf Wolfgang Klafki; Chu und Hermes aus dem Theoriebasis-Profil werden in der Synthese nicht erwähnt" — VERWEIS_PROFIL-HHI/Top-1-Share trägt am Material durch. Output-Substanz Faktor ~2 reicher als 2026-05-04, Token-Aufschlag ~+60%. Defensive Loaders verifiziert: fehlende GTH-Reflexion (BA H3 dev partial) → reduzierter Kontext, kein Fail. Detail in `docs/h3_synthese_status.md` §"Verifikation 2026-05-05".

### 4.7 SCHLUSSREFLEXION (`ai/h3/schlussreflexion.ts`) — **implementiert, Cross-Typ-Substrat-Erweiterung 2026-05-05 verifiziert**

Architektur (User-Setzung 2026-05-04, analog SYNTHESE): ein Konstrukt `construct_kind='GELTUNGSANSPRUCH'` mit reichem content (`geltungsanspruchText`, `grenzenText`, `anschlussforschungText`, `crossTypeReads`). Werk-Aggregat (anchor = alle ¶ aller SR-Container).

**Cross-Typ-Substrat-Erweiterung 2026-05-05**: SR und SYNTHESE teilen sich `werk-substrate.ts`. Über das SYNTHESE-Set hinaus liest SR zusätzlich (a) das **GESAMTERGEBNIS + FRAGESTELLUNGS-ANTWORT** als bereits konsolidierten Werk-Befund (SYNTHESE läuft vor SR) und (b) **rohe argument_nodes-Counts** (Werk-Total + DURCHFÜHRUNG-Subset) als Werk-Substanz-Größenordnung (Mother-Setzung: SR braucht nicht nur die kondensierten BEFUNDE, sondern auch das Volumen der dahinterliegenden Argumentation). `loadForschungsdesignTriple` ersetzt das alte SR-lokale `loadMethodenAndBasis` — METHODOLOGIE neu hinzugekommen (das alte `loadMethodenAndBasis` war Loader-Lokal in schlussreflexion.ts und las nur METHODEN/BASIS).

Pipeline (1 LLM-Call pro Werk, Sonnet 4.6, **max 5000 Tokens** — vorher 1500):
- Sectioned prompt: KONTEXT / METHODISCHES SETUP / THEORIEBASIS-PROFIL / EMPIRIE-SUBSTRAT / GESAMTERGEBNIS / SCHLUSSREFLEXION-MATERIAL
- LLM-Aufgabe in drei Teilen mit erweiterter Sätze-Anzahl: (A) GELTUNGSANSPRUCH 3–6 Sätze (vorher 1–4), (B) GRENZEN 3–6 Sätze in 4 Bullets (methodisch / Theoriebasis / empirisch / Geltungsbereich) (vorher 1–4 frei), (C) ANSCHLUSSFORSCHUNG 2–5 Sätze (vorher 1–4)
- Bei impliziten/fehlenden Komponenten: deskriptiv benennen ("Werk reflektiert keine Methoden-Grenzen explizit"), nicht weglassen.

Idempotent (delete-before-insert pro Werk). Kein version_stack-Wachstum.

**Recovery-Pfad** (User-Setzung 2026-05-04, unverändert): bei fehlendem SR-Container statt Hard-Fail das letzte Drittel des letzten Top-Level-Kapitels durchsuchen, Stage-2-Eskalation bei `needsMoreContext=true`. Persistierter `recoveryStage`-Marker. Detail in `docs/h3_schlussreflexion_status.md`.

Schlüsselwort-Vorauswahl (Mother-Idee) heute nicht als Pre-Filter implementiert — Vollkontext-Pass läuft pragmatisch.

Validierung 2026-05-05 gegen BA H3 dev: GRENZEN-Befund mit 4-Bullet-Struktur, benennt jetzt "extreme Konzentration auf Wolfgang Klafki" (VERWEIS_PROFIL Top-1-Share) + "DURCHFÜHRUNG sechs Argumentknoten" (rohes argument-substrate-count, Werk-Substanz-Signal) + "ohne methodologische Selbstreflexion" (METHODOLOGIE-Bezug — neu im Cross-Typ-Set). Output-Substanz Faktor ~2.5 reicher als 2026-05-04, Token-Aufschlag ~+80%. Defensive Loaders verifiziert (fehlende GTH-Reflexion / fehlende FRAGESTELLUNG-Beurteilung → reduzierter Kontext, kein Fail). Bug-Fix in `loadArgumentSubstrateCounts`: `argument_nodes` hat `paragraph_element_id`, kein `document_id` direkt — JOIN auf `document_elements` korrigiert. Detail in `docs/h3_schlussreflexion_status.md` §"Verifikation 2026-05-05".

### 4.8 WERK_DESKRIPTION (`ai/h3/werk-deskription.ts`) — **implementiert, Substrat-Pfad-Korrektur 2026-05-06**

Deskriptive Meta-Beschreibung des Werks (Reflexion über die anderen Konstrukte, Memory `feedback_werk_desk_gut_are_meta_analyses`). Liest die Werk-Outline + alle Funktionstyp-Konstrukte + die in §4.9 beschriebenen Werk-Aggregate. Anchor in DB ist Persist-Artefakt; UI-Ort: Outline-Tab oben analog `workSynthesis`.

### 4.9 WERK_GUTACHT (`ai/h3/werk-gutacht.ts`, Stages A/B/C) — **implementiert (Test-Mode `gatingDisabled=true`), Substrat-Pfad-Korrektur 2026-05-06**

Drei-Stage-Pipeline:
- **Stage A** — Werk im Lichte der Fragestellung
- **Stage B** — Hotspot-Würdigung
- **Stage C** — aggregiertes Gesamtbild aus a + b (Schluss-Verdikt)

Spec: Stage C ist gegated durch ein eigenes User-`review_draft` (`case_review_drafts.owner_kind='SELF'`); Critical-Friend-Identity (Memory `project_critical_friend_identity`). Aktuell läuft Stage C im Test-Mode mit `gatingDisabled=true` — das Gating ist eine separate Setzung (siehe `h3_werk_status.md`).

**Substrat-Pfad-Setzung 2026-05-06**: Werk-Aggregate (SYNTHESE/GESAMTERGEBNIS — `gesamtergebnisText`, `fragestellungsAntwortText`, `erkenntnisIntegration[]`; SCHLUSSREFLEXION/GELTUNGSANSPRUCH — `geltungsanspruchText`, `grenzenText`, `anschlussforschungText`) erreichen WERK_DESKRIPTION + WERK_GUTACHT (alle drei Stages) als **explizit typisiertes Substrat** über `loadWerkAggregateSubstrate` + `formatWerkAggregateBlock` (in `werk-shared.ts`), nicht mehr nur als `formatContent`-`key=value`-Soup. Vorher war die Schluss-Stage gegenüber `fragestellungsAntwortText` und `erkenntnisIntegration[]` doppelt verdünnt — das Szenario "Super Arbeit — hat Frage nicht beantwortet" war strukturell möglich. Detail-Befund + Implementations-Plan: `docs/h3_werk_aggregate_substrate_pfad.md`.

### 4.10 WERK_STRUKTUR — **nicht implementiert.**

Spec-Backlog. Werk-Ebene-Konstrukt (kein Heading-Container).

---

## 5. function_constructs vs. virtual_function_containers

| Tabelle | Wann |
|---------|------|
| `function_constructs` | 1:1-Mapping Funktionstyp → Konstrukt (oder nach Container-Aggregation) |
| `virtual_function_containers` | Wenn Quelle nicht 1:1 Container ist (z.B. FORSCHUNGSDESIGN cascading aus a/b/c-Quellen) — speichert source_anchor_ranges für Provenance |

`function_constructs.virtual_container_id` (SET NULL) verbindet beide.

---

## 6. Scripts (CLI-Tests)

`scripts/test-h3-exposition.ts`, `scripts/test-h3-exposition-beurteilung.ts`, `scripts/test-h3-forschungsdesign.ts`, `scripts/test-h3-forschungsgegenstand.ts`, `scripts/test-h3-grundlagentheorie.ts`, `scripts/test-h3-routing.ts`, `scripts/test-h3-reproductive.ts`, `scripts/test-h3-discursive.ts`, `scripts/test-h3-durchfuehrung.ts` (Step-Flags `--step2 --step3 --step4`) — direkte Heuristik-Aufrufe mit Brief-Konfiguration via CLI-Flags. Pipeline-Integration für H3 wartet auf Falltyp-System (Stufe 3, siehe `06-cases-briefs-falltyp.md`).

---

## 7. Was nicht in dieser Doku steht

- **Orchestrator-Anschluss von H3** (linearer Walk über Absatz-Komplexe + Werk-Aggregationen) → `src/lib/server/pipeline/h3-walk-driver.ts` und `docs/h3_orchestrator_spec.md` (Abschnitt "Walk-Modell"). Diese Doku beschreibt _was_ pro Funktionstyp implementiert ist; die Walk-Driver-Doku beschreibt _wie_ der Orchestrator die Funktionstyp-Tools sequenziell aufruft (User-Setzung 2026-05-04, Memory `feedback_no_phase_layer_orchestrator`).
- **Falltyp-Routing** zwischen H1/H2/H3 (Architekturentscheidung, nicht Heuristik) → `06-cases-briefs-falltyp.md`.
- **Brief-Flag `h3_enabled`** (Mig 047) → `06-cases-briefs-falltyp.md`.
- **Detail-Status pro H3-Phase mit Test-Cases** → `docs/h3_implementation_status.md` (266 Zeilen, autoritativ für Tagesarbeit).
- **GRUNDLAGENTHEORIE-Validierungs-Cases** → `docs/h3_grundlagentheorie_status.md` (198 Zeilen).
- **EXPOSITION-Qualifizierung-Spec** → `docs/handover_h3_exposition_qualifizierung.md`.
