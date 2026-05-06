# H3 — Werk-Aggregat-Substrat-Pfad zum Schluss-Verdikt

Eigenständige Status-Doku (parallel zu `h3_synthese_status.md`, `h3_schlussreflexion_status.md`, `h3_werk_status.md`).

Stand: 2026-05-06 — Architektur-Setzung, Implementation in Arbeit.

---

## Architektur-Befund (User-Setzung 2026-05-06)

Das Schluss-Verdikt im H3-Stack (WERK_GUTACHT, insbesondere Stage c) muss **alle Werk-Aggregat-Substrate** sehen — einschließlich der Information, **inwieweit die Fragestellung beantwortet wurde**. Heute (Stand 2026-05-05) erreicht dieser Pivot die Schluss-Stage nur doppelt verdünnt.

### Drei konkrete Lücken im aktuellen Substrat-Pfad

**Lücke 1 — `formatContent()` in `werk-shared.ts:282` filtert Arrays raus.**
Die Funktion serialisiert jedes Konstrukt-`content`-Objekt als `key=value | key=value`-Soup, nimmt aber nur String-Felder. Damit gehen verloren:
- `erkenntnisIntegration[]` aus `SYNTHESE/GESAMTERGEBNIS` — das Coverage-Audit über nicht in die Synthese integrierte BEFUNDE. Die Information *"Befund X bleibt unverbunden"* erreicht weder WERK_DESKRIPTION noch WERK_GUTACHT.
- Generell: alle strukturierten Felder, sobald sie kein flacher String sind.

**Lücke 2 — `key=value`-Soup verwischt die Akzentuierung.**
Selbst die String-Felder (`gesamtergebnisText`, `fragestellungsAntwortText`, `geltungsanspruchText`, `grenzenText`, `anschlussforschungText`) werden als gleichberechtigte Schnipsel neben Telemetrie-Feldern (`crossTypeReads`, `recoveryStage`, `containerOverview`) gerendert. Der LLM sieht keine Hierarchie zwischen *"das ist die Antwort auf die Fragestellung"* und *"das ist eine Cross-Read-Liste".*

**Lücke 3 — `WERK_GUTACHT.extractStageC` bekommt keinen `constructsBlock`.**
Stage C — das aggregierende Gesamtbild aus a + b, das im Vollausbau das gegate Fazit ist — bekommt nur `aText`, `bAxes`, `werkBeschreibungText`, `fragestellungText`. Die Werk-Aggregate (`fragestellungsAntwortText`, `geltungsanspruchText`, `grenzenText`, `anschlussforschungText`, `erkenntnisIntegration`) erreichen Stage C **ausschließlich über die werkBeschreibungText-Brücke** — und der WERK_DESKRIPTION-Pass selbst hat sie nur als `formatContent`-Soup gesehen. Doppelte Verdünnung.

### Konsequenz

Strukturell ist das Szenario *"Super Arbeit — hat die Frage nicht beantwortet"* möglich: Stage C kann das Werk gegen die Fragestellung würdigen, ohne die direkte Antwort der Synthese auf die Fragestellung jemals akzentuiert gesehen zu haben. Die SYNTHESE-eigene Werk-Antwort und die SCHLUSSREFLEXION-eigene Geltungsbeurteilung werden im Schluss-Verdikt-Pfad wie generische Konstrukt-Schnipsel behandelt — obwohl sie die *Verdichtungen sind, auf die die Würdigung sich beziehen müsste*.

---

## Setzung (User 2026-05-06)

Werk-Aggregate (SYNTHESE/GESAMTERGEBNIS + SCHLUSSREFLEXION/GELTUNGSANSPRUCH) werden den nachgelagerten Werk-Stages **explizit als typisiertes, akzentuiertes Substrat** übergeben — nicht als `key=value`-Soup über `loadAllConstructs` + `formatContent`.

Konkret:

1. **Neuer Loader** `loadWerkAggregateSubstrate(caseId, documentId)` in `werk-shared.ts` — liest die persistierten SYNTHESE- und SCHLUSSREFLEXION-Konstrukte typisiert aus.
2. **Neuer Formatter** `formatWerkAggregateBlock(substrate)` — produziert einen strukturierten Prompt-Block mit klaren Sektionen:
   - WERK-ANTWORT AUF DIE FRAGESTELLUNG (`fragestellungsAntwortText`)
   - WERK-GESAMTERGEBNIS (`gesamtergebnisText`)
   - BEFUND-INTEGRATION (Coverage aus `erkenntnisIntegration[]`: integriert/nicht-integriert mit Hinweisen)
   - GELTUNGSANSPRUCH (`geltungsanspruchText`)
   - GRENZEN (`grenzenText`)
   - ANSCHLUSSFORSCHUNG (`anschlussforschungText`)
3. **Konsumenten** bekommen den Block zusätzlich zur (bestehenden) `constructsBlock`-Soup:
   - `WERK_DESKRIPTION` — sieht die Werk-Aggregate akzentuiert, statt sie aus der Soup zu rekonstruieren
   - `WERK_GUTACHT` Stage A (Werk-im-Lichte-der-Fragestellung) — sieht die Antwort der Synthese auf die Fragestellung direkt
   - `WERK_GUTACHT` Stage B (Hotspot-Würdigung) — sieht Geltungsanspruch + Grenzen + Befund-Integration als Hotspot-Quelle
   - `WERK_GUTACHT` Stage C (aggregiertes Gesamtbild) — bekommt den Block direkt (nicht mehr nur via `werkBeschreibungText`-Verdünnung)

### Was *nicht* geändert wird

- Die Erzeugung von SYNTHESE/GESAMTERGEBNIS und SCHLUSSREFLEXION/GELTUNGSANSPRUCH selbst bleibt unverändert. `synthese.ts` und `schlussreflexion.ts` produzieren weiterhin die gleichen Felder im gleichen Schema (Setzung 2026-05-05 unverändert).
- `loadAllConstructs` + `buildConstructsBlock` bleiben — sie liefern die Base-Konstrukte (EXPOSITION, GRUNDLAGENTHEORIE, FORSCHUNGSDESIGN, DURCHFUEHRUNG, EXKURS), für die die Soup-Form ausreicht. Werk-Aggregate werden im constructsBlock ausgeklammert (Skip-Liste erweitern), damit sie nicht doppelt erscheinen.
- Stage C bleibt im Test-Modus mit `gatingDisabled=true`. Das Gating durch `review_draft` ist eine andere Setzung (siehe `h3_werk_status.md`).

---

## Implementations-Plan

| Datei | Änderung |
|---|---|
| `src/lib/server/ai/h3/werk-shared.ts` | Neue Typen `WerkAggregateSubstrate` + `ErkenntnisIntegrationItem` (read-side, weniger strict als Pipeline-Schemas, akzeptiert Legacy-Daten); Loader `loadWerkAggregateSubstrate`; Formatter `formatWerkAggregateBlock`; SKIP-Liste in `buildConstructsBlock` um `GESAMTERGEBNIS` + `GELTUNGSANSPRUCH` erweitern (Werk-Aggregate werden nur via `formatWerkAggregateBlock` gerendert). |
| `src/lib/server/ai/h3/werk-deskription.ts` | `extractWerkBeschreibung` bekommt `werkAggregateBlock: string \| null`; im Prompt zwischen `outlineSummary` und `constructsBlock` als eigene Sektion ("Werk-Aggregate:"). |
| `src/lib/server/ai/h3/werk-gutacht.ts` | Stage A/B/C-Inputs bekommen `werkAggregateBlock: string \| null`. Stage C lädt zusätzlich via Pipeline (statt ausschließlich `aText` + `bAxes`). System-Prompt-Hinweis in Stage C: *"Die Werk-Aggregate (Antwort, Geltungsanspruch, Grenzen, Befund-Integration) liegen direkt vor — du beziehst dich auf sie, statt durch werkBeschreibungText hindurch."* |
| `docs/architecture/05-pipeline-h3.md` §4.8/§4.9 | Hinweis auf Substrat-Pfad-Setzung mit Verweis auf dieses Memo. |

Persistenz und Schemas: keine DB-Änderungen, keine Migration. Reine Substrat-Pfad-Korrektur.

---

## Re-Run-Konsequenz

Bestehende WERK_DESKRIPTION + WERK_GUTACHT-Konstrukte sind nach diesem Fix *konzeptionell veraltet*, weil sie unter dem alten dünnen Substrat erzeugt wurden. Pro Case mit existierendem H3-Werk-Run:

1. WERK_DESKRIPTION + WERK_GUTACHT neu laufen lassen (Idempotenz: clear-vor-insert greift).
2. SYNTHESE + SCHLUSSREFLEXION müssen *nicht* neu laufen — ihre Outputs sind durch diesen Fix unbeeinflusst.

Im UI: Slot A der Synthesen-Spalte (Documents-Page → Outline-Tab) zeigt die vier Werk-Aggregate jetzt in der Reihenfolge des Substrat-Pfades:

1. **Synthese — Gesamtergebnis** (`SYNTHESE/GESAMTERGEBNIS`): Antwort auf die Fragestellung, Gesamtergebnis, Erkenntnis-Integration mit ✓/✗ pro BEFUND (Coverage-Audit) und expliziter Hotspot-Markierung für nicht-integrierte BEFUNDE.
2. **Schlussreflexion — Geltungsanspruch** (`SCHLUSSREFLEXION/GELTUNGSANSPRUCH`): Geltungsanspruch, Grenzen, Anschlussforschung als drei separat akzentuierte Sub-Blöcke.
3. **Werk-Beschreibung** (`WERK_DESKRIPTION`): deskriptive Meta-Reflexion über die anderen Konstrukte.
4. **Werk-Gutachten** (`WERK_GUTACHT`): Critical-Friend-Würdigung in drei Stages — a (Werk im Lichte der Fragestellung) als Fließtext, b (Hotspot-Würdigung pro Funktionstyp-Achse) als strukturierte Liste mit `axisName` + Indikator (rot/gelb/neutral) + Rationale, c (Fazit) als Fließtext.

Die ersten beiden Karten sind direkte Werk-Texte; 3+4 reflektieren über sie. Damit ist der Substrat-Pfad nicht nur backend-seitig, sondern auch in der User-Sicht akzentuiert: Der User sieht zuerst die Werk-Antwort und das Coverage-Audit, dann den Werk-Geltungsanspruch, dann die Critical-Friend-Reflexion darüber.

---

## Verifikation 2026-05-06 (BA H3 dev)

Backend-Validierung mammouth/claude-sonnet-4-6 auf BA H3 dev (c42e2d8f). 1 BEFUND, 1 GESAMTERGEBNIS, 1 GELTUNGSANSPRUCH als Vorlauf, frische WERK_DESK/GUTACHT (kein Vorzustand).

**WERK_DESKRIPTION** (4951 in / 914 out / 18s):
- "dieser Befund wird in der Synthese nicht aufgegriffen" — `erkenntnisIntegration[]` Coverage durchgereicht
- "diese Grenzen werden als konzeptionelle Differenzen formuliert, nicht als Limitationen der eigenen Studie" — `grenzenText` Critical-Friend-Lesart
- "Werk enthält keine eigenständige Einordnung der Befund-Integration" — Meta-Beobachtung über die Reflexionslücke

**WERK_GUTACHT** (3 Stages, 19922 in / 3117 out / 67s gesamt):
- Stage A: "Werk-Antwort positioniert GCED und Klafki als komplementäre Konzepte ... die in der Fragestellung angelegte evaluative Zuspitzung wird in der Synthese nicht binär aufgelöst" — direkter Bezug auf `fragestellungsAntwortText`, das genau die "Super Arbeit — hat Frage nicht beantwortet"-Asymmetrie aufdeckt
- Stage B DURCHFUEHRUNG-Qualität: "vollständig nicht aufgegriffen (0 von 1 Befunden integriert)" — `erkenntnisIntegration[]` als Hotspot-Quelle wirkt
- Stage B SCHLUSSREFLEXION-Legitimiertheit: "Grenzen des eigenen Vorgehens werden in der Schlussreflexion nicht explizit adressiert" — `grenzenText`-Meta-Reflexion
- Stage C: zentrale Beobachtung über Aggregat-Befund-Inkohärenz, ohne Verdikt

Substrat-Pfad-Korrektur trägt am Material. Critical-Friend-Stil eingehalten (deskriptive Verben, keine Skala-Adjektive).

---

## Pflicht-Lektüre

- `h3_synthese_status.md` — wer produziert `gesamtergebnisText`, `fragestellungsAntwortText`, `erkenntnisIntegration[]`
- `h3_schlussreflexion_status.md` — wer produziert `geltungsanspruchText`, `grenzenText`, `anschlussforschungText`
- `h3_werk_status.md` — Mother-Setzung für WERK_DESKRIPTION + WERK_GUTACHT, Stage-Aufschlüsselung
- `project_critical_friend_identity.md` — Kontext: warum Konsistenz zwischen Antwort und Würdigung architektonisch wichtig ist (kein "Super Arbeit — hat Frage nicht beantwortet")
