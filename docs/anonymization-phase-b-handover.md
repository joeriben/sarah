# Anonymisierung Phase B — Handover (LLM-assistiert, Peer-Review)

**Status**: Phase A (deterministisch) ist implementiert und verifiziert. Phase B (LLM-assistiert) ist Endpoint-Stub und sonst offen. Dieses Dokument fasst alles zusammen, was eine neue Session braucht, um Phase B zu bauen, ohne zurück in alte Konversationen zu greifen.

## Kontext: Was Phase B bedeutet

Phase B ist der **zweite** Anonymisierungs-Pfad, separat von Phase A. Beide leben nebeneinander, geroutet wird später (Stufe 3, Falltyp-System).

| Aspekt | Phase A (UC1) | Phase B (UC2) |
|---|---|---|
| Trigger | Qualifikationsarbeiten — DSGVO-Vorbereitung | Peer-Review-Artikel — Blind-Review |
| Threat-Modell | Legal: PII darf System nicht verlassen | Wissenschaftlich: inferentielle Anonymität |
| Strategie | **spaCy-NER (lokal) + Regex** für Email/Matrikel/Phone | LLM-assistiert (semantisches Verständnis) |
| Umfang | Personen + explizite Identifier (Mailadresse, Matrikel, Phone) | Zusätzlich **Kontextketten**: Selbstzitate, eigene Forschungsprojekte, methodische/regionale/institutionelle Marker |
| Run-Pfad | **Vollständig lokal (spaCy de_core_news_lg ~545 MB)** — kein LLM-Call, kein API-Call | Läuft über DSGVO-Provider (Mammouth/Sonnet — Volltext-Input ist klartext) |

**Architektur-Pivot 2026-05-02**: Phase A nutzt jetzt spaCy-NER statt der ursprünglichen Regex-Frontmatter-Heuristik. Begründung: Regex war zu fragil bei DOCX-Layout-Variationen (Single-Paragraph-Frontpages, Umlaut-Splitting an Run-Boundaries, fehlende "Vorgelegt-von"-Labels). spaCy fängt PER-Entitäten zuverlässig auch in unstrukturiertem Text. Bleibt 100 % DSGVO-konform — kein Netzwerk-Call.

**User-Setzung 2026-05-02**: Budget-Track (Mistral) ist für Phase B nicht ausreichend (Kontextketten-Erkennung braucht Sonnet-Niveau). Premium-Track only.

## Phase A — was schon steht (Phase B baut darauf auf)

### Datenbank (Migration 041 + 042)
- `document_content.anonymization_status` ∈ `{applied, skipped_already_redacted, no_candidates, failed, NULL}`
- `document_content.anonymized_at`, `original_filename`
- `document_pii_seeds` Tabelle — Pro Doc N Einträge mit `category`, `role`, `value`, `variants`, `replacement`, `source`. UNIQUE auf `(document_id, category, value)`.
- Kategorien: `person_name`, `email`, `matrikel`, `student_id`, `phone`, `institution`, `project`, `self_citation`. Die letzten drei sind für Phase B reserviert (in Phase A nicht produziert).
- Sources: `ner_spacy` (Phase-A-Hauptpfad), `regex_email`, `regex_matrikel`, `regex_student_id`, `regex_phone`, `frontmatter_label`, **`llm_assisted`** ← für Phase B vorgesehen.

### Failsafe-Tripwire (gemeinsam genutzt)
- [src/lib/server/ai/failsafe.ts](../src/lib/server/ai/failsafe.ts): `assertSafeForExternal(payload, documentIds, provider)`. Lädt aktive Seeds, scannt Payload, wirft `AnonymizationFailsafeError`.
- Verdrahtet in [src/lib/server/ai/client.ts](../src/lib/server/ai/client.ts) via neuem `documentIds?`-Parameter auf `chat()`. Greift nur bei Non-DSGVO-Providern (`anthropic`, `openai`, `openrouter`); bei DSGVO-Providern wird nie gescant.
- **Konsequenz für Phase B**: der LLM-assistierte Anonymisierungs-Lauf SELBST muss über DSGVO-Provider laufen (Mammouth/Sonnet), weil zum Zeitpunkt des Calls der Klartext noch nicht anonymisiert ist. Das ist konsistent mit dem Failsafe — der scant sowieso nur Non-DSGVO-Outbound.

### Orchestrator-Pattern (Phase A)
- [src/lib/server/documents/anonymize/index.ts](../src/lib/server/documents/anonymize/index.ts): `anonymizeDocumentDeterministic(documentId)` läuft in **einer Transaktion**:
  1. Volltext + Inscription per `FOR UPDATE` lesen.
  2. Skip-Check (`already-redacted.ts`).
  3. Seeds bauen (`seeds.ts`) — **spaCy-NER für Personen + Regex für Email/Matrikel/Phone**. NER-Subprocess wird via [`ner.ts`](../src/lib/server/documents/anonymize/ner.ts) gespawnt, ruft [`scripts/ner_titlepage.py`](../scripts/ner_titlepage.py) auf.
  4. Verifikations-Pass: `findEdits()` → wenn Skip-Pfad UND keine Treffer → wirklich skippen.
  5. Sonst: `applyEdits()` auf full_text, `recomputeElementSlice()` auf jedes `document_elements`-Offset.
  6. Filename rewrite via `buildSyntheticFilename()` mit Title-Hint aus NER-MISC-Entity oder "Titel:"-Label.
  7. Seeds mit `ON CONFLICT … DO UPDATE` persistieren (idempotent).
  8. `anonymization_status = 'applied'`, `anonymized_at = now()`, `original_filename` einmalig setzen.

- **Reset/Re-Anonymize**: `reAnonymizeFromOriginal(documentId)` lädt das Original-DOCX aus dem File-Storage neu, re-extrahiert Volltext, re-parsed in Elements, löscht alte Seeds und ruft `anonymizeDocumentDeterministic` neu auf. Wichtig nach Heuristik-Updates. Endpoint: `POST /api/projects/[id]/documents/[id]/anonymize?mode=reset`.

- Phase B muss das **gleiche Schema** befüllen — gleiche Spalten, gleiches Seed-Schema. Caller-Code (Failsafe, UI-Tag, Pipeline-Gate) bleibt unverändert.

### Setup für Phase A (spaCy)
```bash
pip3 install spacy
python3 -m spacy download de_core_news_lg
python3 -m spacy download en_core_web_sm
```
Modell-Load ~3 s pro NER-Aufruf. Pro Dokument-Anonymisierung 1× plus 1× im `extractTitleHint` (also 2 spawns). Daemon-Modus wäre optimierbar, ist aktuell aber überflüssig.

### Endpoint-Stub
- `POST /api/projects/[projectId]/documents/[docId]/anonymize?mode=peer-review` antwortet aktuell mit `501 Not Implemented`.
- File: [src/routes/api/projects/[projectId]/documents/[docId]/anonymize/+server.ts](../src/routes/api/projects/%5BprojectId%5D/documents/%5BdocId%5D/anonymize/+server.ts).

## Phase B — Implementierungs-Plan

### B.1 Neuer Modul-Entry
Datei: `src/lib/server/documents/anonymize/llm-assisted.ts`

Signatur:
```ts
export async function anonymizeDocumentLlmAssisted(
  documentId: string,
  opts?: { provider?: 'mammouth' | 'anthropic'; model?: string }
): Promise<AnonymizationResult>
```

Default-Provider: `mammouth` (DSGVO + Sonnet). Override für Tests.

### B.2 Prompt-Design

**System-Prompt (cacheable prefix)** — stable über Calls:
```
ROLLE: Anonymisierungs-Assistent für Blind-Peer-Review.

Du bekommst einen wissenschaftlichen Artikel-Volltext. PERSONENNAMEN
und MAILADRESSEN sind bereits durch [NAME_xxx]/[EMAIL_xxx]-Token ersetzt
(spaCy-NER hat das in Phase A erledigt). DEINE Aufgabe ist die SEMANTISCHE
Schicht — Stellen, die einem Reviewer den Autor verraten würden, ohne
selbst ein direkter Identifier zu sein:

1. Selbstzitate: "wie ich in [Author 2023] gezeigt habe", "in our previous
   work …", indirekt über Zitierketten.
2. Eigene Forschungsprojekte: Projekt-Namen, Förderkennzeichen, eigene
   methodische Apparate, eigene Datasets.
3. Institutionelle Marker: "an unserer Hochschule X", "im Institut Y",
   "Förderung durch Z".
4. Methodische Signaturen, die einen kleinen Kreis identifizieren würden
   (sehr spezielle Methoden-Tools, regionale Datenerhebungen).

DIREKTE Identifier (Personennamen, Mailadressen) sind aus Phase A schon
weg — falls du eine übersehen hast, melde sie als category='person_name'
zurück (Phase-B-Lauf ergänzt dann den Phase-A-Output).

OUTPUT-FORMAT: Ausschließlich JSON. Schema:
{
  "findings": [
    {
      "category": "person_name" | "institution" | "project" | "self_citation" | "other",
      "value": "Originalstring im Text",
      "rationale": "kurze Begründung",
      "confidence": "high" | "medium" | "low"
    }
  ]
}
```

**User-Prompt** — variable Tail:
```
ARTIKEL:
<volltext hier — chunked falls > Context-Window>
```

Chunking: Sonnet hat 200k Token Context. Volltext einer typischen Habil
(~250k Zeichen, ~50k Tokens) passt rein. Bei größerem Volltext: an
Section-Grenzen splitten (`section_kind` aus `document_elements`),
pro Chunk extra LLM-Call, Findings mergen.

### B.3 Output-Validierung

Zod-Schema (zod ist bereits Dep):
```ts
const FindingSchema = z.object({
  category: z.enum(['person_name', 'email', 'institution', 'project', 'self_citation', 'other']),
  value: z.string().min(1),
  rationale: z.string(),
  confidence: z.enum(['high', 'medium', 'low'])
});
const ResponseSchema = z.object({ findings: z.array(FindingSchema) });
```

Bei Validierungsfehler: einmal Retry mit `responseFormat: 'json'` + expliziter Fehlermeldung im Prompt-Tail. Zweiter Fehlschlag → `status='failed'`.

### B.4 Mapping LLM-Findings → ReplacementSeed

```ts
function findingsToSeeds(findings: Finding[], existingCounters: Record<SeedCategory, number>): ReplacementSeed[]
```

- `category='other'` → mappen auf `'self_citation'` (das ist der Catch-All in Phase B).
- `category='project'` → `'project'`.
- `category='institution'` → `'institution'`.
- Die übrigen mappen 1:1.
- Replacement-Schema:
  - `[NAME_NNN]`, `[EMAIL_NNN]` (gleich wie Phase A)
  - `[INSTITUTION_NNN]`, `[PROJECT_NNN]`, `[CITATION_NNN]` (Counter pro Doc)
- `source = 'llm_assisted'`.
- `variants` für Phase B leer lassen (kein klares Variants-Modell für Selbstzitate). Failsafe-Scan greift dann nur auf den exakten Wert.

### B.5 Edit-Anwendung

Hier ist die wichtigste Designentscheidung:
- **Variante α — Nutze Phase-A-Engine**: `findEdits()` aus `apply.ts` baut non-overlapping Edits. Funktioniert für `person_name`/`email`/`institution`/`project` analog zu Phase A. Für `self_citation` problematisch, weil Citations oft mehrzeilige Strings mit Variabilität sind.
- **Variante β — LLM gibt Char-Offsets zurück**: Der Prompt verlangt `{ start: number, end: number }` zusätzlich zu `value`. Dann ist die Edit-Liste direkt ableitbar, kein Substring-Match nötig. Robust für Selbstzitate.

**Empfehlung**: Variante β. Grund: Selbstzitate sind oft formuliert in Varianten, die exakter Substring-Match nicht trifft ("wie wir gezeigt haben" vs. "wie wir an anderer Stelle gezeigt haben"). Sonnet kann Char-Offsets ausgeben; die müssen dann gegen den Original-Volltext validiert werden (`text.slice(start, end) === value`), bei Mismatch: Fallback auf Substring-Match (Variante α).

### B.6 Orchestrator-Workflow

In einer Transaktion:
1. Volltext + Inscription per `FOR UPDATE` lesen.
2. **Optional**: Phase-A-Resultate mitnehmen — wenn `anonymization_status='applied'` schon, sind Personennamen/E-Mails/Matrikel bereits ersetzt durch `[NAME_NNN]` etc. Phase B sucht dann zusätzlich nur noch Kontextketten. Das ist sauberer als Phase A zu wiederholen.
3. LLM-Call(s) → Findings → Seeds.
4. `findEdits()` (Variante α) ODER direkte Char-Range-Edits (Variante β).
5. `applyEdits()` auf full_text.
6. `recomputeElementSlice()` für jedes Element.
7. `persistSeeds()` (idempotent über UNIQUE-Constraint — Phase-A-Seeds bleiben erhalten, Phase-B-Seeds kommen dazu).
8. `anonymization_status = 'applied'` (überschreibt ggf. `'no_candidates'` oder `'skipped_already_redacted'` aus Phase A).
9. `anonymization_metadata` ist heute nicht persistiert — Migration 041 hat das Feld bewusst weggelassen, alles relevante steht in `document_pii_seeds.source`. Wenn Phase-B-spezifische Run-Daten gebraucht werden (Token-Verbrauch, Provider, Confidence-Histogramm), separate Migration mit `anonymization_run_metadata JSONB` erwägen.

### B.7 Endpoint aktivieren

In [src/routes/api/projects/[projectId]/documents/[docId]/anonymize/+server.ts](../src/routes/api/projects/%5BprojectId%5D/documents/%5BdocId%5D/anonymize/+server.ts) den `mode === 'peer-review'`-Branch durch echten Aufruf ersetzen:
```ts
if (mode === 'peer-review') {
  const result = await anonymizeDocumentLlmAssisted(docId);
  return json(result);
}
```

### B.8 UI-Erweiterung

Aktuell in [+page.svelte](../src/routes/projects/%5BprojectId%5D/documents/%5BdocId%5D/+page.svelte) gibt es einen "Jetzt anonymisieren"-Button (Phase A). Für Phase B ergänzen: zweiter Button "Peer-Review-Anonymisierung" der `?mode=peer-review` postet. Sichtbar nur, wenn entweder:
- Status = `applied` (Phase A war schon, Peer-Review als Aufstockung möglich)
- ODER Brief vom Typ `peer_review` (sobald Falltyp-System steht).

## Risiken & offene Fragen

1. **LLM-Halluzination**: Sonnet könnte "Findings" produzieren, die im Text nicht existieren. Variante-β-Validierung (`text.slice(start, end) === value`) fängt das ab — bei Mismatch: Finding verwerfen, nicht einfach als Seed übernehmen. **Logging-Pflicht** für solche Mismatches, damit Prompt-Drift sichtbar wird.

2. **False Positives bei Selbstzitaten**: Sonnet identifiziert evtl. Bezugnahmen auf bekannte Forscher der eigenen Schule als "Selbstzitat". Confidence-Filter: standardmäßig nur `high`-Findings übernehmen, `medium` mit User-Review (= zukünftige UI), `low` verwerfen. Im MVP: nur `high` automatisch.

3. **Token-Kosten**: Sonnet via Mammouth bei ~50k Token Volltext + ~5k Output → grob $0.15-0.30 pro Anonymisierungs-Lauf. Bei einem typischen Peer-Review (1 Artikel) marginal; bei Backfill auf vielen Artikeln planen. Cache-Prefix nutzen (`cacheableSystemPrefix`) damit der System-Prompt nur einmal voll bezahlt wird.

4. **Was passiert, wenn Phase A schon `applied` ist und Phase B nochmal läuft?** Aktueller Plan: Phase-A-Seeds bleiben, Phase-B-Seeds kommen dazu. Volltext wird nochmal über `findEdits` gejagt — Phase-A-Replacements (`[NAME_001]` etc.) sind dann schon Tokens, die LLM kann sie nicht mehr fälschlich als PII flaggen. Das ist gewollt.

5. **Mehrsprachige Artikel**: Sonnet handhabt Mehrsprachigkeit nativ. Prompt bleibt englisch/deutsch gemischt — kein Sprach-Routing nötig.

## Test-Strategie

1. **Algorithm-Smoketest** analog zu [scripts/test-anonymize.ts](../scripts/test-anonymize.ts), aber mit echtem Sonnet-Call. Konsistenz-Check: Mehrfachläufe auf demselben Artikel müssen vergleichbare Seed-Sets liefern (Determinismus über Temperature=0).

2. **DB-End-to-end** analog zu [scripts/test-anonymize-db.ts](../scripts/test-anonymize-db.ts): Wegwerf-Doc mit konstruiertem Selbstzitat, Lauf, Verifikation dass Selbstzitat ersetzt UND Failsafe-Scan auf neuem Volltext 0 Hits liefert.

3. **Failsafe-Integration**: nach Phase-B-Lauf einen Mock-`chat()`-Call mit `provider='openrouter'` + Phase-B-Doc-ID + Volltext, der Original-Selbstzitate enthält. Erwartet: `AnonymizationFailsafeError`.

## Quick-Start für die nächste Session

```bash
# Repo
cd /Users/joerissen/ai/sarah

# DB
psql "postgresql://joerissen@localhost:5432/sarah" -c "\d document_pii_seeds"

# Phase A verifizieren (sollte grün laufen)
npx tsx scripts/test-anonymize-db.ts

# Phase B Implementierung beginnen
touch src/lib/server/documents/anonymize/llm-assisted.ts
# … (Plan oben)

# Endpoint anpassen
# src/routes/api/projects/[projectId]/documents/[docId]/anonymize/+server.ts
# Den `mode === 'peer-review'` Branch durch echten Aufruf ersetzen.

# UI-Button ergänzen
# src/routes/projects/[projectId]/documents/[docId]/+page.svelte
```

## Was Phase B NICHT machen soll

- **Kein Falltyp-Routing**: der Endpoint bleibt `?mode=peer-review`-getriggert. Falltyp-System (Stufe 3) wählt später, welcher Mode für welches Dokument default ist.
- **Keine Phase-A-Refaktorisierung**: Phase A bleibt unangetastet. Phase B ist additiv.
- **Kein eigenes Provider-Routing**: hardcoded auf Mammouth/Sonnet. Erst wenn echte Performance-Daten zeigen, dass ein anderer Provider gleichgut ist, parametrisieren.
- **Keine User-Review-Schleife** im MVP. Wenn nötig, Phase B.5 — aber erst wenn Phase B in Praxis tatsächlich False Positives produziert.
