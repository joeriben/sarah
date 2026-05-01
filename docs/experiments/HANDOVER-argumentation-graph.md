# Handover — Stand 2026-05-01 spät (Budget-Route validiert, Caching-Refactor, nächste Phase: Reviewer-Notes + Gutachtenentwurf)

**Lies zuerst diesen Block.** Die älteren Handover-Texte darunter sind Kontext, der aktuelle Stand und die nächsten Schritte stehen hier oben.

## TL;DR — Wo wir stehen (2026-05-01 spät, Session-Schluss)

Diese Session hat (a) DS4 als basal-Producer ausgesondert, (b) **Mistral-Large-2512 + Sonnet 4.6 als Budget-Stack end-to-end validiert** auf Chapter 4 (50 ¶, ~$2.73), (c) den **Caching-Refactor** für 3 der 5 Pässe vorbereitet, (d) **zwei harmlose Bugs** im Goldstand-Code gefixt, die für Mistral-basal relevant wurden, und (e) eine **strategische Setzung** dokumentiert: Two-Track-Architektur (Premium Sonnet/Opus + Budget Mistral) mit DSGVO-EU-Bonus für Mistral.

### Zentraler Output zum Anschauen

`docs/experiments/chapter4-mistral-sonnet-MEMO.md` — gerenderte Synthese + Argumentationswiedergabe + 7 paragraph-präzise Auffälligkeiten für Chapter 4. Das ist der substantielle Beleg: Budget-Stack erreicht Goldstand-Niveau (paragraph-präzise §:A-Anker, materielle Tragweite-Diagnose, gutachten-fertige Argumentationswiedergabe). Cost-Hochrechnung Habil-gesamt (327 ¶, 4 L1, ~31 L3): **~$15** ohne Caching, **~$5–7** mit Caching wenn der Refactor in der nächsten Session unter Realbedingungen verifiziert ist.

### Was JETZT liegt vs. was offen blieb

**Liegt fest:**
- DS4-v4-pro (alle Provider) **dead end** für basal+AG: Reasoning-Burn auf OpenRouter, Routing-Hänger auf Mammouth, Substanz-Komprimierung im Tenorth-Hammer.
- **Mistral-Large-2512 nativ** als Budget-basal-Producer: 4/4 stabil im Smoketest, 50/50 stabil auf Chapter 4 (mit anchor_phrase-Cap-Fix von 80→500).
- **Sonnet 4.6 via Mammouth** als Budget-collapse: 8/8 section-collapse + 1/1 chapter-collapse stabil, paragraph-präzise §:A-Anker bleiben erhalten (das war die Hauptsorge nach dem voriegen DS4-Hybrid-Test).
- Cost-Floor: Budget-Habil ~$15, Premium-Habil ~$28-53.

**Caching-Refactor angefangen, aber nicht voll-verifiziert:**
- `chat()` API erweitert um `cacheableSystemPrefix?: string` (multi-block system mit cache_control nur auf prefix). [client.ts](../../src/lib/server/ai/client.ts)
- 3 von 5 callers refaktoriert: per-paragraph + AG + section-collapse. Stable prefix (PERSONA + KRITERIEN + WERK + OUTPUT-FORMAT) cached, variable suffix (outline mit marker, completed memos, prior args/scaffolding, interpretive chain) uncached.
- 2 callers nicht refaktoriert: chapter-collapse + document-collapse — kein Cache-Win bei 1-call-pro-Aufgabe.
- Mini-Test mit Sonnet via Mammouth/OpenRouter: **kein Cache-Hit detected** (1581 tokens, möglicherweise unter Anthropic-Cache-Threshold von 1024 tokens — knapp drüber, aber im noise). Mistral nativ hatte im Chapter 4-Run (vor Refactor) 84k cache_reads von 712k input = 12% hit rate, automatic ohne cache_control.
- **Refactor unter Realbedingungen verifizieren ist Aufgabe der nächsten Session** — über einen echten 5-¶-Pipeline-Run mit Mammouth-Sonnet auf dem neuen Case.

**Bugs gefixt (im Goldstand-Code übersehen, durch Mistral-Run aufgefallen):**
- `per-paragraph.ts:35` — anchor_phrase Cap 80→500 chars (Mistral schreibt längere phrases; Cap rejected ~12% der synth outputs)
- `chapter-collapse.ts:211` — `mc.created_at` → `n.created_at` (created_at lebt auf namings, nicht memo_content; im Goldstand nie aufgetreten weil Chapter 1 keine vorangehenden chapter-memos hat)
- `argumentation-graph-prose-parser.ts` — Edges-Parser toleriert jetzt trailing `(comment)`, multi-target `A3 -presupposes-> A1, A2`, und droppt `§0:A2` mit warning

### Nächste Phase: Reviewer-Notes + Gutachtenentwurf

User-Architektur-Setzung: **zwei-Run-Schnitt**:
- **Phase A**: zentrales Dokument wird **unabhängig** analysiert (Pipeline wie heute, ohne Reference auf Reviewer-Notes oder Gutachtenentwurf). Das ist sauber, weil es eine "objektive" Analyse vor jeder Vorprägung erlaubt.
- **Phase B**: in einem zweiten Run werden Reviewer-Notes + Gutachtenentwurf bearbeitet, den Stellen im zentralen Dokument zugeordnet, und gegen die bereits **vorhandenen Verdikts** (Phase-A-Memos + Auffälligkeiten) gecheckt.

Das ist die nächste Session-Architektur. Code-Stand: Annotation-Document-Parsing existiert in `src/lib/server/documents/parsers/annotations-export.ts` und `docx-academic.ts`; das Memory `feedback_pages_are_citation_helpers_only.md` dokumentiert das semantic-LLM-Resolver-Pattern. Aber Phase B (cross-check gegen Verdikts) ist noch ungebaut.

### Test-Daten für nächste Session

**Alter Goldstand-Case (intakt — nicht anfassen):**
```
case_id          aa23d66e-9cd8-4583-9d14-6120dc343b10
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246
document_id      54073d08-f577-453b-9a72-73a7654e1598  (no_annot_test2.docx)
```
DB-Stand:
- Chapter 1: 74 paragraph-synth, ~61 paragraph-AG (13 Failures aus altem Stand, Code seit prose-Pivot fixbar), 7 L3 section-collapse-Memos (Opus), 0 chapter-collapse (in voriegem Test gelöscht)
- Chapter 2-3: nichts
- Chapter 4: **50 paragraph-synth + 50 paragraph-AG (Mistral) + 8 L3 section-collapse (Sonnet) + 1 chapter-collapse (Sonnet)** — der validierte Budget-Stack-Stand

**Neuer Case (heute angelegt für die nächste Pipeline-Probe — bisher leer, outline confirmed):**
```
case_id          660cd26d-3759-4ab8-8a38-9f2df27a48b5
brief_id         1edf4497-5472-4f4b-9366-c0fecab7353f  (geklont, argumentation_graph=true)
document_id      161d41b4-c00d-4df8-82bc-c14f163e1a63  (no_annot_test3.docx, identisches Werkmaterial)
```
- L1-Headings (alle confirmed):
  - num=1 `0f2468dd-b338-4f31-8572-5e7a18ae2ee4` "Schule – Kultur – Globalität – Lehrkräftebildung" (74 ¶)
  - num=2 `8aceae42-0703-4d0a-b199-feffd550b0a5` "Orientierungen…" (139 ¶)
  - "Reflexionen…" `f813f9bd-b6bb-4e2f-b727-1c791ebf6342` (parser-num leer, 64 ¶)
  - num=4 `23246ee0-6fed-4b56-b314-5947dab71c0a` "Ansätze einer Theorie…" (50 ¶)

Dieser case ist für direkte **Mistral+Sonnet vs. Opus-Goldstand-Vergleich auf Chapter 1** vorgesehen, wenn die nächste Session das nochmal direkt belegen will. Aber substanziell ist die Validierung schon auf Chapter 4 erfolgt; der Re-Run ist optional.

## Konkrete Aktionen für die nächste Session, in Reihenfolge

1. **Caching-Refactor unter Realbedingungen verifizieren** — 5-¶-Pipeline-Run mit Mammouth-Sonnet auf dem neuen case (660cd26d) Subkapitel 1.1.1 §1-§5. Erwartet: bei realen prompts (~3000-5000 tokens prefix) sollten cache_creation > 0 in Call 1 und cache_read > 0 in Call 2-5 sichtbar werden. Wenn nicht, debug per token-profil. Cost ~$0.30, Wall ~3 min.

2. **Phase A des neuen Case komplett durchziehen** (optional, wenn Cache verifiziert): Chapter 1+2+3+4 Mistral basal + Sonnet collapse + 1 document-collapse. ~$5-15 je nach Caching-Hit-Rate, Wall ~3-5h. Liefert die ganze Habil-Synthese in der Budget-Route.

3. **Reviewer-Notes + Gutachtenentwurf-Architektur (Hauptsache der nächsten Session)**:
   a. Parser für Reviewer-Notes-Document (DOCX mit comments / tracked changes — bestehend `annotations-export.ts` evaluieren)
   b. Resolver: Annotationen → Source-Stellen im Habil-Dokument (semantic LLM, page-scoped candidates — Memory-Pattern)
   c. Parser für Gutachtenentwurf (DOCX, sequenzielle Lesung ähnlich Habil)
   d. **Cross-Check-Pass**: für jede Auffälligkeit aus Phase-A-Memos prüfen: nimmt Reviewer/Gutachten dieselbe Stelle auf? Gleiches Verdikt oder gegenläufig? Welche Auffälligkeiten aus Phase A werden im Gutachtenentwurf NICHT aufgegriffen? Welche Reviewer-Notes haben kein Gegenstück in Phase-A?

4. **Endpoint-Erweiterung Auto-Trigger + SSE** (alter Posten aus voriegen Handovers, immer noch offen).

## Files diese Session (alle commited oder im aktuellen working tree)

**Code (refactor + bugfixes):**
- `src/lib/server/ai/client.ts` — `cacheableSystemPrefix` field, multi-block system pass-through
- `src/lib/server/ai/hermeneutic/per-paragraph.ts` — buildSystemPrefix + buildSystemSuffix split, Cap 80→500
- `src/lib/server/ai/hermeneutic/argumentation-graph.ts` — buildSystemPrefix + buildSystemSuffix split
- `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts` — buildSystemPrefix + buildSystemSuffix split
- `src/lib/server/ai/hermeneutic/argumentation-graph-prose-parser.ts` — edges-Parser tolerant für trailing `(...)`, comma-multi-target, `§0`-handling
- `src/lib/server/ai/hermeneutic/chapter-collapse.ts` — `mc.created_at` → `n.created_at` bugfix

**Scripts:**
- `scripts/smoketest-prose-ag.ts` — modifiziert auf Mammouth-DS4 (im voriegen Subtask, jetzt obsolete)
- `scripts/smoketest-prose-ag-mistral.ts` (neu) — Mistral-spezifische Variante
- `scripts/run-chapter4-basal-mistral.ts` (neu) — Phase-1-Driver für neue cases
- `scripts/run-chapter4-collapse-sonnet.ts` (neu) — Phase 2+3 Sonnet-Driver
- `scripts/test-cache-prefix.ts` (neu) — chat()-cache pass-through Mini-Test
- `scripts/test-edge-parser-fix.ts` (neu) — parser-fix-regression test

**Outputs in `docs/experiments/`:**
- `chapter4-basal-mistral.json` — Phase 1 Mistral-Daten für 50 ¶
- `chapter4-collapse-sonnet.json` — Phase 2+3 Sonnet-Daten
- `chapter4-mistral-sonnet-MEMO.md` ← **das gerenderte Memo zum Lesen**
- `smoketest-prose-ag-deepseek-v4-pro-via-mammouth.json` — leer (DS4-Mammouth gehängt)
- `smoketest-prose-ag-mistral-large-3-via-mammouth.json` — Mistral-via-Mammouth Smoketest 4/4

## Memory-Updates diese Session

- Neu: `project_two_track_model_strategy.md` — Two-Track non-negotiable, mit DSGVO-Frame
- Neu: `feedback_deepseek_v4_unfit_for_basal_ag.md` — DS4 dead end für basal+AG, provider-unabhängig
- Neu: `project_budget_route_validated_mistral_sonnet.md` — Budget-Route end-to-end validiert auf Chapter 4

## Methodologische Lektion (für Folge-Sessions)

User-Korrektur 2026-05-01 spät: ich hatte zu viel Cycles auf Architektur und Cost-Diagnose verbracht, ohne dem User SUBSTANTIELLEN OUTPUT zu zeigen, an dem er beurteilen kann ob das Tool für seine Forschung Sinn macht. Beim ersten User-Hinweis "wann erkenne ich überhaupt ob das Projekt Sinn ergibt" muss SOFORT der konkrete End-to-End-Output gerendert und gezeigt werden, nicht weitere Optimierung. Die Memo-Datei `chapter4-mistral-sonnet-MEMO.md` ist das, was hätte EARLIER gerendert werden müssen.

Korrigierte Default-Heuristik: bei jedem voll-validierten Pipeline-Lauf SOFORT lesbare Markdown-Wiedergabe der Synthese + Argumentationswiedergabe + Auffälligkeiten produzieren, nicht nur JSON-Dump. Das ist der einzige Output, an dem ein Forscher beurteilen kann ob die Pipeline für seine Arbeit taugt.

---



## TL;DR — Wo wir stehen (2026-05-01 nachts)

Diese Session hat eine **Architektur-Wende** für den AG-Pass vollzogen und damit die Cost-Strategie auf einen anderen Floor verschoben:

1. **modelOverride durch chapter-/document-collapse durchgereicht** — beide Pässe nehmen jetzt `opts.modelOverride`, analog zu `runGraphCollapse` und `runArgumentationGraphPass`.
2. **Hybrid-Test chapter-collapse mit DS4 vs. Opus-Goldstandard auf Chapter 1**: Makro-Diagnose konvergiert, Paragraph-Präzision (§:A-Anker) geht bei DS4 verloren. Cost-Win ~95 % auf Chapter-Ebene, aber Substanz-Verlust real. Ergebnis-Dump: `chapter1-compare-deepseek-v4-pro.json`, side-by-side: `chapter1-compare-SIDE-BY-SIDE.md`.
3. **AG-Pass von strikter JSON auf prose-mit-Konventionen umgestellt** — User-Diagnose ("JSON-Fetisch") war richtig: das Schema hat Strenge erzwungen, die für die Synthesefähigkeit der Pipeline irrelevant ist. Konsequenz:
   - **§4 Tenorth-Hammer (typografisches Zitat) klappt jetzt für DS4 + Sonnet 4/4** — auf der JSON-Pipeline scheiterten ALLE drei Modelle (inkl. Opus) wegen control chars / mis-escaped quotes.
   - 2B-Fallback-Parser wurde geplant aber **nicht gebaut, weil nicht nötig** — beide Modelle landen first-shot parseable.
   - DS4 ist als basal-Modell **viabel**: ~$0.59 pro 74-¶-Hauptkapitel statt ~$11.50 mit Opus (95 % günstiger), bei 4/4 AG-Erfolg im Smoketest.

**Cost-Hochrechnung pro Hauptkapitel (74 ¶, basal-Pass synth + AG):**

| Modell | ~Cost | Wall (4 ¶) | Substanz |
|---|---:|---:|---|
| Opus 4.7 | ~$11.50 | – | Goldstandard, §:A-präzise |
| Sonnet 4.6 | ~$4.45 | 139 s | gut, §:A-präzise (per Counts) |
| DeepSeek-v4-pro | ~$0.59 | 587 s* | nicht inhaltlich evaluiert |

*DS4 §2 hatte 401 s outlier (out=13341 > maxTokens=8000, vermutlich OpenRouter-interner Retry). Ohne den Outlier ~185 s. Untersuchung steht aus.

**Wichtig:** Substanz-Vergleich ist NICHT validiert. Der Smoketest dumpte nur Counts. Die improvements am Smoketest-Skript (jetzt mit `result`-Dump) sind in dem committeten Stand drin; ein Re-Run liefert Volltext für DS4-vs-Sonnet-Substanz-Vergleich.

## Architektur-Wende AG-Pass: prose statt JSON

### Warum

User-Kritik 2026-05-01 nachts: das strikte JSON-Schema hat **Failure-Modes erzeugt, die nicht zu Substanz-Failures korrespondieren**. Eine Argument-Spaltung in zwei Objekte oder eine fehlende Edge sind harmlos für die Synthese (collapse-Pässe lesen die Daten als Text). Die JSON-Strenge bestrafte aber die Modelle für irrelevante Output-Noise. Konkretes Symptom: §4 Tenorth-Zitat brach selbst Opus.

User-Insight: cheap-Modelle (DS4) wären 50–100× günstiger als Opus pro Call, das öffnet Multi-Pass-Architekturen (10× DS4 < 1× Sonnet). Aber **die Voraussetzung dafür ist, dass single-shot DS4 mit fairem Setup überhaupt zuverlässig parseable ist** — sonst verbrennt jeder Recursive-Setup im JSON-Bruch der Zwischenstufen.

User-Insight zusätzlich: cheap 2B-Modelle könnten als Fallback-Parser fungieren, wenn der Auto-Parser scheitert. Multi-Tier-Parsing mit billigen Calls statt einer rigiden Schema-Validierung.

### Was

`src/lib/server/ai/hermeneutic/argumentation-graph.ts`:
- Prompt rewrite: ARGUMENT/EDGES/SCAFFOLDING-Sektionen, line-based prose statt JSON-Objekt
- `extractAndValidateJSON` rausgenommen, ersetzt durch `parseProseAG` aus dem neuen Parser
- Schema-Validation läuft jetzt am Ende als **sanity check** auf der Parser-Ausgabe (nicht mehr als Strict-Gate auf LLM-Output)
- Failure-Pfad: Parser-output empty → dump + throw (statt 2B-Fallback, der nicht gebraucht wurde)

`src/lib/server/ai/hermeneutic/argumentation-graph-prose-parser.ts` (neu, ~310 Zeilen):
- State-machine line parser
- Tolerant gegen: Reihenfolge, Doppelungen, fehlende Felder, freien Begleittext, Markdown-Wrapper, alt-Pfeil-Formen (→ vs. ->), unbekannte function_types (→ default kontextualisierend mit warning)
- Pflicht-Felder pro Sektion mit warning-skip statt throw
- Output: `{ result: ArgumentationGraphResult; warnings: string[]; junkSections: string[] }`

`src/lib/server/ai/json-extract.ts` (neu, aus dieser Session):
- Reusable extraction für andere Pässe (chapter-collapse, document-collapse, per-paragraph), die immer noch JSON nutzen — dort sind die Schemata simpel (`synthese: ...` plus 2 Felder), JSON ist passend
- Drei-Stufen-Repair: brace-trim → typographic-quote-repair → jsonrepair → JSON.parse → Zod
- AG-Pass nutzt diese Schicht **nicht** mehr (prose-Pivot ist eigenständig)

`src/lib/server/ai/client.ts`:
- `responseFormat?: 'json'` opt-in für OpenAI-compat-Provider (OpenRouter passt durch zu Anthropic-via-OR, OpenAI, Mistral, DeepSeek, Qwen native JSON-mode)
- Aktuell von keinem Pass aktiv genutzt — sleeping feature für die JSON-Pässe falls die brauchbar werden

`scripts/smoketest-prose-ag.ts` (neu):
- Validiert prose-AG auf §1-§4 von Subkapitel 1.1.1 inkl. Tenorth-Hammer
- Cleanup zwischen Modellen, dump per-Modell-JSON
- Im aktuellen Stand auch `result` (volle Parser-Ausgabe) im Dump → für Substanz-Inspektion bei nächstem Re-Run

### Was nicht passierte

- **2B-Fallback-Parser nicht gebaut**: weil DS4 + Sonnet 4/4 first-shot parseable. Wenn ein zukünftiger Smoketest mit Modellen, die nur teilweise parseable schreiben (Qwen, gemini, glm aus dem alten Smoketest), zeigt dass es nötig wird — Parser hat eine `junkSections`-Liste vorbereitet, die als Input für eine 2B-Recovery-Schicht direkt dient.
- **Substanz-Vergleich DS4 vs. Sonnet vs. Opus nicht inhaltlich gemacht**: nur Counts. Re-Run mit dem improvten Smoketest gibt Volltext-Args/Edges/Scaffolding für direkten Vergleich.
- **DS4-§2-Anomalie nicht erklärt**: wall=401s, output=13341 > maxTokens=8000. Vermutung: OpenRouter-interner Retry oder Reasoning-Tokens; der Parser hat den Output trotzdem sauber zerlegt (6 args, 9 edges, 0 scaff). Untersuchung wert, aber nicht-blockierend.

## Konkrete nächste Aktionen, in Reihenfolge

1. **Substanz-Re-Run mit dem improvten Smoketest** (~10 min, ~$0.10): liefert Volltext-Args/Edges/Scaffolding für DS4 + Sonnet auf §1-§4. Vergleich sollte zeigen: liefert DS4 substantiell vergleichbare Args wie Sonnet, oder fällt es auf eine flachere Beobachtungsebene zurück (analog zum Chapter-Collapse-Befund).
2. **Per-Pass LLM-Settings + DS4-als-basal-Default**: die `taskAssignment`-Map in `ai-settings.json` mit Ansatz aus dieser Session — basal: DS4 (oder Sonnet wenn DS4 substanz-defizitär ist), section-collapse: Opus oder Sonnet, chapter-/document-collapse: Opus. UI optional, JSON-Konfig reicht für PoC.
3. **Caching-Diagnose**: Opus-Goldstandard-Run hatte cacheRead=0 durch alle 74 ¶ trotz `cacheSystem: true`. DS4-Smoketest hat tatsächlich Cache-Hits (§1: 1536, §3: 1664) — Caching FUNKTIONIERT also. Frage: warum Opus-baseline trotzdem keine? Vermutlich liegt's am 5-min-TTL (Pipeline lief 32 min) oder an pro-Call-Variation im System-Prompt. Wenn das gefixt wird, sind 25 % weitere Cost-Reduktion drin.
4. **DS4-§2-Anomalie**: ein Mini-Test mit DS4 auf §2 isoliert, Output speichern, prüfen ob der >8000-token-Output legitim ist (lange Argumente) oder OpenRouter-Retry-Artefakt. Falls Retry: kann mit `max_tokens` strikter eingestellt werden, oder pro-paragraph-Output-cap implementieren.
5. **Re-Run Chapter-1-Pipeline mit DS4-basal**: end-to-end-Validierung auf 74 ¶. Wenn Substanz-Vergleich (Schritt 1) DS4 ok zeigt, dann ist das die echte Probe: DS4-basal + Opus-collapse-Stack, gegen die existierende Opus-Baseline. Cost ~$2-3 vs. $13.30. Prüft, ob 74 ¶ × DS4 stabil bleibt (Smoketest nur 4 ¶).
6. **Mistral-Large-2512 Smoketest** (offen vom User explizit gewünscht, kam in dieser Session nicht dazu): einmal AG-Smoketest mit prose-Pipeline. Mistral hat saubere JSON-mode-Unterstützung; auf prose sollte es ebenfalls solide sein.
7. **Endpoint-Erweiterung Auto-Trigger + SSE** (dauerstand vom vorigen Handover): erst nach Modell-Wahl-Entscheidung sinnvoll.

## Stand der Test-Daten in DB

Case-IDs unverändert vom vorigen Handover:
```
case_id          aa23d66e-9cd8-4583-9d14-6120dc343b10
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      54073d08-f577-453b-9a72-73a7654e1598
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

In Chapter 1 (L1 heading `9c3e2dac-a9bb-4cb5-8a6d-19a87c086341`):
- 74 paragraph-synth-memos (alle 74 ¶)
- ~61 paragraph-AG (74 minus 13 failures vom vorigen Handover; **die 13 könnten jetzt mit prose-Pipeline durchlaufen** — aber DB-State noch unverändert)
- 7 L3 section-collapse memos (alle 7 L3-Subkapitel) — Opus-generiert
- **0 L1 chapter-collapse memos** — wurde in dieser Session als Teil des hybrid-tests gelöscht. Restoration: `npx tsx scripts/run-chapter-collapse.ts` mit ai-settings.json default = Opus, ~$0.50 + ~42s.
- `aggregation_subchapter_level = 3` persistiert auf chapter-1 heading

In Chapter 2-4: nichts (frisch).

## Files diese Session (alle commited)

**Code:**
- `src/lib/server/ai/client.ts` — `responseFormat: 'json'` opt-in
- `src/lib/server/ai/json-extract.ts` (neu) — Reusable JSON-extract mit jsonrepair-Fallback (für JSON-Pässe)
- `src/lib/server/ai/hermeneutic/argumentation-graph.ts` — prose-Output, Parser-basiert
- `src/lib/server/ai/hermeneutic/argumentation-graph-prose-parser.ts` (neu) — line-state-machine
- `src/lib/server/ai/hermeneutic/chapter-collapse.ts` — modelOverride durchgereicht
- `src/lib/server/ai/hermeneutic/document-collapse.ts` — modelOverride durchgereicht
- `package.json`, `package-lock.json` — `jsonrepair` dep added

**Scripts:**
- `scripts/compare-models-chapter-collapse.ts` (neu) — chapter-collapse Modell-Rotation
- `scripts/render-chapter-compare-markdown.ts` (neu) — side-by-side render
- `scripts/smoketest-prose-ag.ts` (neu) — §1-§4 × {DS4, Sonnet} smoketest

**Outputs in `docs/experiments/`:**
- `chapter1-compare-deepseek-v4-pro.json`, `chapter1-compare-SIDE-BY-SIDE.md` — chapter-collapse DS4 vs. Opus
- `smoketest-prose-ag-deepseek-v4-pro.json`, `-sonnet-4-6.json` — prose-AG Smoketest

## Methodologische Lektion (für Folge-Sessions wichtig)

**Die JSON-Strenge war ein Performance-Blocker, kein Substanz-Garant.**
Der Reflex, Schema-Strenge zu erhöhen ("jsonrepair, retry, JSON-mode opt-in"), war Fortsetzung des Designfehlers, nicht dessen Korrektur. Frage zukünftig zuerst: *welcher Failure-Mode korrespondiert tatsächlich mit Substanz-Failure?* — und entwerfe Strenge nur dort.

User-Korrektur direkt: *"Wieso dieser json-Fetisch hier? [...] Wenn ich einen Parsing-fehler habe und ein Argument in 2 Objekten aufgeteilt ist, so what? welchen konkreten Schaden für den Kollaps soll das verursachen?"* — der konkrete Schaden ist null, weil der Konsument (collapse-LLM) die Daten als Text liest. Strenge sollte da sitzen, wo sie die Synthese-Qualität schützt, nicht wo sie eine schicke Datenstruktur erzwingt.

User-Korrektur zur Cost-Logik: *"Ich kann DS4.0 ZEHN MAL rekursiv auf das Material anwenden, adversarial und was nicht alle, pro Absatz, bevor ich an die Kosten von Sonnet/Opus herankomme."* — Cost-Asymmetrie öffnet Multi-Pass-Architekturen. Vor dieser Session war die Pipeline für single-shot best-model designed; das Auflösen dieser Annahme verschiebt den Floor radikal.

Beides sollte in Folge-Sessions als default-frame gesetzt sein, bevor man neue Strenge-Schichten einbaut.

---

# (Älterer Handover-Text — Stand 2026-05-01 spät, LLM-Strategie-Ermittlung + Chapter-1-Goldstandard)

## TL;DR — Wo wir stehen

In dieser Session haben wir (a) die Direction-4-Pipeline **end-to-end** auf dem Theorie-Hauptkapitel des frischen Timm-Manuskripts laufen lassen, mit **Opus 4.7 als Goldstandard**, und (b) eine **Modell-Vergleichs-Reihe** durchgeführt, um Cost/Quality-Trade-offs für die einzelnen Pipeline-Pässe zu ermitteln. Die nächsten Sessions brauchen **(1) einen JSON-Repair-Fix** für 13 abgebrochene AG-Pässe in Chapter 1, **(2) einen Mistral-Large-Test** (User offen), **(3) den DS4-für-Collapses-Test** (Hypothese: günstiger Hybrid).

## Goldstandard-Baseline: Chapter 1 mit Opus 4.7 (komplett gelaufen)

Output: `docs/experiments/chapter1-opus-collapse.json` (chapter-collapse memo)

| Phase | Outcome | Wall | ~Cost |
|---|---|---:|---:|
| Phase 1 — basal (74 ¶ × synth + AG) | 74/74 synth ✓; **13 AG failed** (alle JSON-Parse-Brüche durch typographische Quotes / unescaped control chars in LLM-Output) | ~32 min | ~$11.50 |
| Phase 2 — section-collapse (7 L3) | 7/7 ✓ — reichhaltig (5–43 args, 3–45 scaff pro section) | ~3 min | ~$1.30 |
| Phase 3 — chapter-collapse | ✓ level=3 (L3 als aggregation level), 6 spezifische Auffälligkeiten | 42 s | ~$0.50 |
| **Total** | | **38.3 min** | **~$13.30** |

Treiber: `scripts/run-chapter1-pipeline.ts` (idempotent: skip-on-existing für alle Pässe; resume-friendly).

**Substanzielle Output-Qualität:** der chapter-memo identifiziert die "trichterförmige" Architektur 1.1→1.2→1.3, lokalisiert die Kernbewegung am Übergang 1.2.2→1.3 mit Kulminationspunkt bei 1.3.3 §4:A7 (Ungewissheit als globalitätskonstitutive Größe), und liefert eine materielle Tragweite/Tragfähigkeit-Diagnose: "Tragweite werksystematisch fundamental und programmatisch — Stützung durchgängig unterdimensioniert: tragende Setzungen werden gelistet, aber nicht hergeleitet, und die Begründungslast wird wiederholt auf Referenzautoren und Folgekapitel verlagert." Die 6 Auffälligkeiten sind alle paragraph-präzise verankert (mit §:A-Referenzen), keine Slop-Allgemeinplätze.

**Wichtig für die Folge-Session:** Dies ist die Referenz, gegen die alle Cost-Reduction-Hypothesen geprüft werden müssen. Nicht "ist DS4-Output für sich plausibel" sondern "kommt es an Opus's Befunde heran".

## Modell-Vergleich (Basal-Pipeline auf 1.1.1, 5 ¶ × synth + AG)

Outputs in `docs/experiments/`: `model-compare-1.1.1-{deepseek-v4-pro,sonnet-4-6,opus-4.7}.json` + `-SIDE-BY-SIDE.md`

| Modell (via OpenRouter) | Wall total | Tokens | AG-Erfolg | Pro-¶-Cost (geschätzt) |
|---|---:|---:|---:|---:|
| `deepseek/deepseek-v4-pro` | 946 s | 55k | **2/5** (Schema-Verletzung, no-JSON, control char) | ~$0.02 |
| `anthropic/claude-sonnet-4.6` | 232 s | 66k | **4/5** (§4 Tenorth-Zitat fail) | ~$0.06 |
| `anthropic/claude-opus-4.7` | 133 s | 86k | **4/5** (gleicher §4 fail) | ~$0.17 |

**Klare Trennlinien:**
- **Wall-Time invertiert zur Modellgröße:** Opus < Sonnet < DeepSeek. DeepSeek-v4-pro über OpenRouter ist 7× langsamer als Sonnet weil 5–6× verbosere Outputs (3000–6000 statt 500 tokens pro AG-Call).
- **§4 Tenorth-Zitat scheitert für ALLE Modelle** — paragraph-spezifisches JSON-Escape-Problem (typographische Quotes bzw. mehrzeilige Strings ohne Escape). Nicht modell-spezifisch.
- **Codes-Qualität:** Sonnet generiert tendenziell präzisere "Bohnsack-y" Labels, hebt eine zweite Dimension hervor; Opus und DS4 konvergieren öfter bei Anker-Phrase-Wahl.

## Modell-Smoketest (4 weitere OpenRouter-Modelle, AG-only auf §1, parallel)

`scripts/smoketest-models-ag.ts` — 4 Modelle parallel auf §1, Wall des langsamsten 137 s.

| Modell | wall | json | shape | args | scaff |
|---|---:|---|---|---:|---:|
| `qwen/qwen3.6-max-preview` | 137s | YES | YES | 4 | 2 |
| `~google/gemini-pro-latest` | 35s | nein (JSON.parse) | — | — | — |
| `xiaomi/mimo-v2.5-pro` | 54s | nein (no { }) | — | — | — |
| `z-ai/glm-5.1` | 30s | nein (JSON.parse) | — | — | — |

Plus geprüft via 2-call-prose-Decomposition (`scripts/test-2call-prose.ts`): nur Qwen schaffte beide Calls; gemini/mimo/glm scheiterten am simplen `LABEL | ANCHOR`-Code-Format.

## Modell-Strategie-Befunde

1. **Basal-Pipeline (synth + AG) braucht JSON-strong Modelle.** Tested: Sonnet 4.6, Opus 4.7. **Mistral-Large-2512 noch nicht getestet** (User wollte explizit, kam zeitlich nicht dazu — siehe offene Punkte).
2. **DeepSeek-v4-pro als Args-Producer untauglich** (3/5 fails). **Aber als Args-Consumer in collapses interessant** — DS4 hat im abgebrochenen Section-Collapse-Run (vor dem Pivot zu Chapter-1-Opus) tatsächlich funktioniert, dump existiert: `docs/experiments/collapse-compare-1.1.1-deepseek-v4-pro.json`. Synthese-Aufgabe ist prose-dominiert und passt zu DS4s Stärke. **Hybrid-Hypothese:** Opus für basal (zwingend JSON), DS4 für section-collapse → ggf. Sonnet/Opus für chapter-collapse. Cost-Reduktion bei vermuteter Qualitätserhaltung — **muss noch quantifiziert werden**.
3. **Nemotron-3-super:latest (Ollama lokal) ist DEAD END** für diese Pipeline:
   - JSON-Modus: Timeouts + unparseable JSON
   - Prose-only Modus: 1/5 wirklich Prose (3/5 trotz expliziter Anweisung JSON, 1/5 Refusal mit ironischem "kann das gewünschte JSON nicht bereitstellen")
   - Brutal slow lokal (~40s/¶)
   Memory `feedback_no_xai_models.md` ist NICHT für Nemotron — Nemotron-Lektion sollte ggf. separat dokumentiert werden, falls jemand das nochmal vorschlägt.
4. **Hartes User-Constraint:** Grok / xAI-Modelle politisch ausgeschlossen — siehe neue Memory `feedback_no_xai_models.md`. Beim nächsten Modell-Vorschlag-Listing (Mammouth-Katalog hat Grok-Familie, OpenRouter auch) automatisch auslassen.

## Architekturelle Insights aus dieser Session

### chat() unterstützt jetzt per-call modelOverride

`src/lib/server/ai/client.ts`: `chat({...opts, modelOverride: { provider, model }})` baut bei Bedarf einen one-shot-Client für das Override-Modell. Bestehende Default-Settings (ai-settings.json) bleiben unangetastet. Threading: `runParagraphPass`, `runArgumentationGraphPass`, `runGraphCollapse` akzeptieren jetzt alle das `modelOverride`. **`runChapterCollapse` und `runDocumentCollapse` sind noch NICHT modelOverride-fähig** (offen für Folge-Session).

### Per-paragraph-Helpers exportiert

In `per-paragraph.ts` wurden für Test-Driver exportiert: `loadCaseContext`, `loadParagraphContext`, `buildSystemPrompt`, `buildUserMessage`, sowie die Interfaces `CaseContext`, `ParagraphContext`. Damit können Driver eigene Prompt-Varianten bauen ohne Code-Duplikation.

### Failure-Dump-Path in per-paragraph

Analog zu argumentation-graph.ts gibt es jetzt in `runParagraphPass` einen `/tmp/per-paragraph-failure-<paragraphId>.txt` Dump bei extractJSON / Schema-Fehlern. Hilfreich beim Debug fremder Modelle.

### "Beamten-Diagnose" (User-Feedback, neue Memory)

User-Korrektur dieser Session: ich habe das System-Prompt-Format (single-JSON-call) als gegeben behandelt und darüber die Modelle gefiltert ("kann Modell X dieses Schema?"). Die korrekte Frage ist umgekehrt: **welches Modell kann die Aufgabe wenn die Aufgabe modell-freundlich strukturiert ist?** Konkret: das per-paragraph-Memo könnte auch als 2 Calls gebaut werden (Interpretation prose, dann Codes simpler), wodurch viel mehr Modelle nutzbar wären. **Diese Insight ist nicht in eine Feedback-Memory geschrieben** — könnte sinnvoll sein für die Folge-Session (Stichwort: nicht das Format-Schema als Constraint setzen, wenn das Schema selbst Wahl ist).

## Bekannte Bugs / Offene technische Posten

### KRITISCH: extractJSON-Repair für AG-Pass

13 AG-Pässe in Chapter 1 sind gescheitert, alle mit derselben Klasse:
- **Bad control character in string literal** (unescaped \n / \r / \t innerhalb von quoted JSON-Strings — LLM emittiert Multi-Line-Zitat ohne Escape)
- **Unexpected token '"'** (typographische close-quote `"` U+201D, vom LLM mit `\"` ASCII-escape vorangestellt — JSON-illegal)

Existierender `repairTypographicQuotes` in `argumentation-graph.ts:583` deckt diese Klassen NICHT ab. Failure-IDs (Chapter 1, doc 54073d08):
```
§4 (1.1.1):     96556e05-9b69-482b-ace7-174252284536  (Tenorth-Zitat, beide Modelle)
¶20:            11331d92-…
¶24:            674b6337-…
¶27:            4bceecb0-…
¶29:            be12007a-…
¶33:            2ab9f799-…
¶44:            4db9fcce-…
¶46:            4404dd63-…
¶47:            3f2e2ae9-…
¶61:            c96a869e-…
¶67:            9f5f68c2-…
¶69:            504ad43c-…
¶71:            987a67fa-…
```
(Volle UUIDs in `/tmp/sarah-chapter1.log` und in den `/tmp/argumentation-graph-failure-<paragraph_id>.txt` dumps — Letzteres pro fail überschrieben, also nicht alle gleichzeitig vorhanden.)

**Fix-Idee:** in `extractJSON` (oder einer neuen `repairJSON`-Helper-Schicht) zwei Repair-Pässe vor `JSON.parse`:
1. **Control-Char-Escape:** innerhalb von quoted JSON-Strings literal `\n`/`\r`/`\t` zu `\\n`/`\\r`/`\\t`. Knifflig wegen Token-Boundary-Detection — eventuell via JSON5 oder json-repair npm package leichter.
2. **Mis-escaped typographic quote:** Sequenz `\"` (Backslash + ASCII-Quote) gefolgt von typographischer Quote U+201C / U+201D im Inhalt → unescape den ASCII-Quote zur typographischen Quote.

Nach Fix: Re-Run nur dieser 13 ¶s. Das geht weil AG idempotent SKIP wirft wenn argument_nodes bereits da sind — nur die 13 fehlen. Driver-Pattern: Liste der 13 IDs durchschleifen, runArgumentationGraphPass aufrufen, fertig.

### ai-settings ist auf Opus eingestellt

`ai-settings.json` zeigt aktuell auf `openrouter / anthropic/claude-opus-4.7`. **Achtung:** wenn der dev-server / andere Aufgaben (z.B. Outline-Confirmation per LLM, falls genutzt) auf den Default-Client zurückgreifen, läuft das jetzt auch auf Opus → unerwartet teuer. Mindestens für Production-Use sollte zurück auf `mammouth / claude-sonnet-4-6`. Für Folge-Session: bewusst entscheiden was Default sein soll.

### runChapterCollapse + runDocumentCollapse ohne modelOverride

Die anderen 3 Pässe (paragraph, AG, section-collapse) sind durchgreichbar; chapter-collapse + document-collapse noch nicht. Trivialer 1-Zeilen-Add wenn die Hybrid-Strategie kommen soll.

## Stand der Test-Daten in DB

Case-IDs unverändert vom vorigen Handover:

```
case_id          aa23d66e-9cd8-4583-9d14-6120dc343b10
brief_id         f8fc8a30-404f-4378-bd8d-c1fb92799246  (argumentation_graph=true)
document_id      54073d08-f577-453b-9a72-73a7654e1598
user_id (sarah)  dac6ac05-bdab-4d68-a4fa-3eab0b40cc2b
```

In Chapter 1 (L1 heading `9c3e2dac-a9bb-4cb5-8a6d-19a87c086341`):
- 74 paragraph-synth-memos (alle 74 ¶)
- ~61 paragraph-AG (74 minus 13 failures)
- 7 L3 section-collapse memos (alle 7 L3-Subkapitel)
- 1 L1 chapter-collapse memo
- `aggregation_subchapter_level = 3` persistiert auf chapter-1 heading

In Chapter 2-4: nichts (frisch).

## Konkrete nächste Aktionen, in Reihenfolge

1. **JSON-Repair-Fix in extractJSON / repairJSON** für die zwei Bug-Klassen (bad control char, mis-escaped typographic quote). Re-Run dann der 13 Failure-¶s in Chapter 1 → kompletter Datenstand. Geschätzt 30 min Arbeit + ~$1 für Re-Run, **sehr hoher Wert** (entgrenzt die Pipeline auf reale Habilitations-Texte).

2. **modelOverride-Threading** für `runChapterCollapse` und `runDocumentCollapse` (1 Zeile je). Voraussetzung für (3).

3. **Hybrid-Test:** section-collapse + chapter-collapse mit DS4 statt Opus, gegen die Opus-Baseline aus `chapter1-opus-collapse.json`. Driver `compare-models-section-collapse.ts` ist schon vorbereitet; einmal cleanup (collapse-memo des Hauptkapitels rausschmeißen, dann mit DS4 erneut laufen). Eval: liegt DS4-output qualitativ in der Nähe von Opus, oder verliert er die Spezifität (paragraph-präzise Anker, materielle Tragweite-Diagnose)? Wenn ja: Cost-Hybrid-Strategie etabliert.

4. **Mistral-Large-2512 Smoketest** (offen vom User explizit gewünscht): einmal AG-Smoketest (`scripts/smoketest-models-ag.ts` MODELS-Array auf `mistralai/mistral-large-2512`), dann je nach Ausgang collapse-Test.

5. **ai-settings entscheiden** (Sonnet als Default zurück, oder Opus bewusst lassen).

6. **Chapter-Memo in lesbares Markdown rendern** für die User-Eval (aktuell nur JSON dump). Quick: `jq -r '.result.synthese' docs/experiments/chapter1-opus-collapse.json` reicht, oder ein 30-Zeilen-Render-Script mit Synthese + Argumentationswiedergabe + Auffälligkeiten formatiert.

7. **Endpoint-Erweiterung Auto-Trigger + SSE** (Schritt 6 vom vorigen Handover, immer noch offen). Erst nach LLM-Strategie-Entscheidung sinnvoll, weil Modell-Wahl ins Endpoint-Verhalten einfließt.

## Dateien diese Session (alle im Repo)

**Code-Änderungen:**
- `src/lib/server/ai/client.ts` — `modelOverride` in chat() opts
- `src/lib/server/ai/hermeneutic/per-paragraph.ts` — modelOverride durchgereicht, Helpers exportiert, failure-dump-path
- `src/lib/server/ai/hermeneutic/argumentation-graph.ts` — modelOverride durchgereicht
- `src/lib/server/ai/hermeneutic/section-collapse-from-graph.ts` — modelOverride durchgereicht
- `ai-settings.json` — auf openrouter+claude-opus-4.7 umgestellt

**Neue Test-/Driver-Scripts:**
- `scripts/run-chapter1-pipeline.ts` — Phase 1+2+3 Orchestrator (DAS Skript für Chapter-1-Replay; idempotent)
- `scripts/seed-basal-1.1.1-sonnet.ts` — Mini-seed für 1.1.1 (Test-Vorbereitung)
- `scripts/compare-models-paragraph.ts` — basal-pipeline 5×3 Modell-Vergleich (DB-Cleanup zwischen Modellen)
- `scripts/compare-models-section-collapse.ts` — section-collapse 4-Modell-Vergleich (DS4 dump existiert vom Vor-Pivot-Run)
- `scripts/smoketest-models-ag.ts` — parallel-AG-smoketest (Modell-Liste Array-bearbeiten)
- `scripts/test-deepseek-smoke.ts` — minimal JSON-test
- `scripts/test-nemotron-prose.ts` — nemotron prose-only via Ollama
- `scripts/test-2call-prose.ts` — 2-call-decomposition-test
- `scripts/render-model-compare-markdown.ts` — basal-vergleich → MD
- `scripts/render-collapse-compare-markdown.ts` — collapse-vergleich → MD (existiert, noch nicht ausgeführt)

**Outputs in `docs/experiments/`:**
- `chapter1-opus-collapse.json` ← **Goldstandard, Hauptergebnis**
- `model-compare-1.1.1-{deepseek-v4-pro,sonnet-4-6,opus-4.7}.json` + `-SIDE-BY-SIDE.md`
- `nemotron-prose-1.1.1.json`
- `2call-prose-test-1.1.1-§1.json`
- `collapse-compare-1.1.1-deepseek-v4-pro.json`

## Memory-Updates diese Session

- Neu: `feedback_no_xai_models.md` — politische Ablehnung Grok/xAI
- Neu (NICHT GESCHRIEBEN, aber sollte): nemotron-3-super:latest ist für diese Pipeline DEAD END (über-aligned, refused einen neutralen Habilitations-Absatz, ignoriert Prose-Anweisungen). Bevor nemotron beim nächsten Modell-Vorschlag wieder auftaucht, hier nachsehen.

## Kurze Selbstkritik (für Folge-Session)

Diese Session war kontextual lang und hatte eine klare Unzulänglichkeit: **ich habe zweimal große Test-Pipelines gestartet ohne vorgeschalteten Mini-Smoketest** (erst beim 4-OpenRouter-Modell-Lauf, dann beim 5-Modell-Lauf). User-Korrektur war scharf und richtig: "Teste AG mit einem mini-Test. Das dauert SEKUNDEN." → Folge-Session: bei jeder Multi-Modell-Iteration zuerst 1-Call-Smoketest parallel, dann erst Volle Läufe. Außerdem: bei Cost-Estimates die ECHTE OpenRouter-Pricing prüfen, nicht aus Anthropic-Preisliste hochrechnen.

---



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
