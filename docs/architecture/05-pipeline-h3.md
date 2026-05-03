# 05 — Pipeline H3 (Funktionstyp-Heuristiken)

**Stand: 2026-05-03** · Drei-Heuristiken-Architektur, Funktionstyp-Zuweisung, per-Funktionstyp-Implementierungs-Stand.

H3 ist nicht "tiefer als H2", sondern eine **dritte Heuristik gleichrangig zu H1/H2** (Memory `project_three_heuristics_architecture`). Routing zwischen H1/H2/H3 ist **Falltyp-deterministisch** (siehe `06-cases-briefs-falltyp.md`), **nicht** User-Toggle.

Eintrittspunkt: `src/lib/server/pipeline/function-type-assignment.ts` (Pre-Heuristik) + `src/lib/server/ai/h3/*.ts` (Per-Funktionstyp).

---

## 1. Drei-Heuristiken-Übersicht

| Heuristik | Skalierung | Rolle |
|-----------|-----------|-------|
| **H1** | Werk-skaliert (paragraph→subchapter→chapter→work) | analytische Hauptlinie (siehe `04-pipeline-h1-h2.md`) |
| **H2** | per-Paragraph synthetisch | formulierend + interpretierend, ergänzend |
| **H3** | per-Funktionstyp (Werk-strukturell) | Funktionstyp-spezifische Konstrukte (FRAGESTELLUNG, METHODOLOGIE, VERWEIS_PROFIL, …) |

H3 läuft **nach** Outline-Confirm und setzt korrekt klassifizierte Funktionstypen voraus.

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

### 4.3 GRUNDLAGENTHEORIE (`ai/h3/grundlagentheorie.ts`) — **Step 1 ✓, Step 2 spec-ready, Steps 3–4 unresolved**

**Step 1: VERWEIS_PROFIL (deterministisch, kein LLM)** — komplett:

- Container-Resolution via `outline_function_type='GRUNDLAGENTHEORIE'`.
- Bibliographie-Extraktion (Werk-Ende, Fallback Heading-Match) → `bibliography_entries` (Mig 048).
- Inline-Citation-Extraktion (narrative `Author/Year` + Bracket-Blöcke).
- Cross-Ref Inline → Bibliographie (author + year match; orphans tracked).
- Aggregation: `byAuthor`, `byParagraph` (density / dominant / consecutive), HHI, Top-1-Share, consecutive-cluster, coverage (resolved/orphan).
- Persistenz: `function_constructs` VERWEIS_PROFIL pro Container.

**Validierung 2026-05-03**: 3 Test-Cases. BA H3 dev: HHI=0.64 (mono-reprod). BA TM: HHI=0.09 (mixed). Habil: HHI=0.012 (dispersed).

**Refactor-Versuch 2026-05-03 (Klammer-zentrierte Citation-Heuristik) — verworfen.** Bracket-Pattern-Konzept war valide, aber Sub-Block-Split zu lose; verlor 28 wahre Citations im Habil-Test (Net-Recall schlechter). Author-Pattern-Heuristik wiederhergestellt. Detail in `docs/h3_grundlagentheorie_status.md`.

**Step 2: ROUTING — spec ready, nicht implementiert.** Verdachts-Blöcke (lange citation-freie Strecken, repetitive Author-Dominanz) → `WIEDERGABE_PRÜFEN` (cheap block-level LLM-confirm) → Routing zu H2 (Wiedergabe bestätigt) oder H1 §-AG (dichte Diskussion).

**Steps 3a/3b/4: ECKPUNKT_CHECK, DISKURSIV_BEZUG_PRÜFEN, FORSCHUNGSGEGENSTAND_REKONSTRUIEREN — architektonisch unresolved.** Subkomponente vs. Querschnittsmodul vs. obsolet — User-Klärung nötig.

### 4.4 DURCHFUEHRUNG (`ai/h3/durchfuehrung.ts`) — **Step 1 ✓ (Hotspot-Detection), Steps 2–3 pending**

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

**Step 3 (pending): Stellenspezifische Regex-Rückwärtssuche** als Auxiliär-Tool für H1, wenn das referentielle Grounding (Methoden-/Gegenstandsbezug) im Hotspot-¶ fehlt: vom ¶ aus rückwärts bis Kapitelbeginn, **nicht stur alle Absätze, sondern per Regex mit Pattern der gerade untersuchten Stelle** (Mother-Setzung). Architekturprinzip: billige On-Demand-Suchtools statt großzügigem Pre-Loading des Kontextfensters.

### 4.5 EXKURS, SYNTHESE, SCHLUSSREFLEXION, WERK_STRUKTUR — **nicht implementiert.**

Spec-Backlog. Heading-Marker-Regex erkennt SCHLUSSREFLEXION/SYNTHESE bereits (Pre-Heuristik), aber keine eigene Konstrukt-Extraktion.

### 4.6 WERK_GUTACHT (a/b/c+d/e/f gated) — **nicht implementiert.**

Spec: `WERK_GUTACHT-c` (Synthese-Komponente) ist gegated durch ein eigenes User-`review_draft` (`case_review_drafts.owner_kind='SELF'`). Critical-Friend-Identity (Memory `project_critical_friend_identity`).

---

## 5. function_constructs vs. virtual_function_containers

| Tabelle | Wann |
|---------|------|
| `function_constructs` | 1:1-Mapping Funktionstyp → Konstrukt (oder nach Container-Aggregation) |
| `virtual_function_containers` | Wenn Quelle nicht 1:1 Container ist (z.B. FORSCHUNGSDESIGN cascading aus a/b/c-Quellen) — speichert source_anchor_ranges für Provenance |

`function_constructs.virtual_container_id` (SET NULL) verbindet beide.

---

## 6. Scripts (CLI-Tests)

`scripts/test-h3-exposition.ts`, `scripts/test-h3-forschungsdesign.ts`, `scripts/test-h3-grundlagentheorie.ts` — direkte Heuristik-Aufrufe mit Brief-Konfiguration via CLI-Flags. Pipeline-Integration für H3 wartet auf Falltyp-System (Stufe 3, siehe `06-cases-briefs-falltyp.md`).

---

## 7. Was nicht in dieser Doku steht

- **Falltyp-Routing** zwischen H1/H2/H3 (Architekturentscheidung, nicht Heuristik) → `06-cases-briefs-falltyp.md`.
- **Brief-Flag `h3_enabled`** (Mig 047) → `06-cases-briefs-falltyp.md`.
- **Detail-Status pro H3-Phase mit Test-Cases** → `docs/h3_implementation_status.md` (266 Zeilen, autoritativ für Tagesarbeit).
- **GRUNDLAGENTHEORIE-Validierungs-Cases** → `docs/h3_grundlagentheorie_status.md` (198 Zeilen).
- **EXPOSITION-Qualifizierung-Spec** → `docs/handover_h3_exposition_qualifizierung.md`.
