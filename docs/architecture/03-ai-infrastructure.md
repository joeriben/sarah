# 03 — AI-Infrastruktur

**Stand: 2026-05-05** · Provider-Abstraktion, Two-Track-Strategie, PII-Failsafe, Self-Healing-Repair (JSON + Prose).

Eintrittspunkt: `src/lib/server/ai/client.ts` (`chat()`-Funktion). Failsafe in `failsafe.ts`. JSON-Extraction in `json-extract.ts`. Prose-Extraction in `prose-extract.ts`. Self-Healing-Repair-Wrapper + Telemetrie in beiden Modulen, Log-Tabelle `pipeline_call_log` (Mig 051).

---

## 1. Provider-Tabelle

| Provider | Region | DSGVO-safe? | Default-Use |
|----------|--------|-------------|-------------|
| `ollama` | lokal | ✓ | dev / test, **nicht** für Pipeline-Läufe (siehe Memory `feedback_local_ollama_unfit_for_pipeline`) |
| `mistral` | EU (FR) | ✓ | **Budget-Route basal** (analytische Hauptlinie L4 AG) |
| `ionos` | EU (Berlin) | ✓ | optional |
| `mammouth` | EU | ✓ | **Budget-Route collapse** (proxy zu Sonnet, EU-vermittelt) |
| `anthropic` | US | ✗ | Premium-Route direkt (Sonnet/Opus) |
| `openai` | US | ✗ | derzeit ungenutzt |
| `openrouter` | US | ✗ | Premium-Route via Proxy zu Anthropic + anderen |

Default-Settings in `ai-settings.json`. Per-Call-Override via `modelOverride` in `chat({...})`.

**SDK-Struktur:**
- Anthropic-Provider: native Anthropic-SDK (für Prompt-Caching mit `cache_control: {type: 'ephemeral'}`).
- Alle anderen: OpenAI-kompatible API (verschiedene `baseURL`s).

**Cache-Verhalten:**
- Anthropic-nativ: vollständiges Prompt-Caching (5-min TTL).
- OpenRouter / Mammouth: Pass-Through-Cache-Header (proxyt Anthropic-Cache).
- Andere: kein Caching.

---

## 2. Two-Track-Strategie (Memory `project_two_track_model_strategy`)

**Premium-Route** (Goldstandard) und **Budget-Route** (Cost-Ziel <<$1 / Textseite) **koexistieren**.

| Phase | Premium | Budget (validiert 2026-05-02 für Chapter 4 BA) |
|-------|---------|----------------|
| Argumentation Graph (per ¶) | Sonnet | **Mistral** (nativ EU, ~Goldstand-Niveau) |
| Section / Chapter / Document Collapse | Sonnet / Opus | **Sonnet via Mammouth** (EU-Vermittlung, Klartext akzeptabel weil DSGVO-safe-Channel) |
| Validity-Check / Grounding | Sonnet | Sonnet |
| H3 Heuristiken | Sonnet | (noch nicht budget-validiert) |

**Validierter Budget-Stack:** Mistral (basal) + Sonnet via Mammouth (collapse) → Goldstand-Niveau bei ~$15/Habil bei vollständigem End-to-End-Lauf. Paragraph-präzise §:A-Anker bleiben erhalten.

**Verboten:**
- xAI/Grok-Modelle vorschlagen (Memory `feedback_no_xai_models`).
- Lokale 9B-Klasse für Pipeline (Memory `feedback_local_ollama_unfit_for_pipeline`).
- DeepSeek-v4-pro für basal+AG (Memory `feedback_deepseek_v4_unfit_for_basal_ag`).

Routing-Architektur ist **frei pro Phase**. Es gibt keine globale Premium/Budget-Switch — die Wahl ist datei-/funktionsweise konfiguriert.

---

## 3. Failsafe — PII-Pre-Call-Check (`failsafe.ts`)

**Architektur:** harter Pre-Call-Block für **alle** Outbound-Calls zu **non-DSGVO**-Providern.

```
chat({ messages, modelOverride, documentIds })
  ↓
provider lookup
  ↓
provider.dsgvo === false?
  ├─ ja  → assertSafeForExternal(payload, documentIds, provider)
  │         ├─ Lade aktive document_pii_seeds für documentIds
  │         ├─ Substring-Match (case-insensitive) auf seed.value + variants
  │         ├─   - Wortgrenze-Lookaround für ≤3-Char-Werte
  │         ├─ Hit → throw AnonymizationFailsafeError (Sample + Kontext)
  │         └─ Kein Hit → return ok
  └─ nein → bypass (provider darf Klartext sehen)
  ↓
provider-dispatch
```

**Caller-Verantwortung:** `documentIds`-Array übergeben — was steht alles im Payload? Leeres Array = kein Check (Misuse möglich, daher: **immer übergeben**).

Der Failsafe greift auch dann, wenn die Anonymisierung schon gelaufen ist und im Klartext nichts mehr stehen sollte — denn die Seeds bleiben aktiv, und der Scan-Wrapper schützt gegen Re-Imports oder versehentliches Neuladen alter Versionen.

---

## 4. Output-Extraction — zwei Formate, ein Self-Healing-Pattern

LLMs liefern Strukturen selten spec-rein. SARAH unterstützt zwei Output-Formate, beide mit demselben Self-Healing-Wrapper-Pattern.

### 4a. JSON-Extraction (`json-extract.ts`)

Für Outputs mit eindeutig **strukturiertem Charakter** (Argument-Graphen, Validity-Checks, H3-Konstrukt-Listen). Drei-Tier-Repair:

1. **Brace-Trim** — finde `{...}`-Bounds.
2. **Typographic-Quote-Repair** — `„..."` → `"..."` (deutsche Anführungszeichen, JSON-valid).
3. **Direct parse** + Zod-Schema-Validierung.
4. **Fallback: `jsonrepair`** (npm) — control chars, single quotes, trailing commas, unquoted keys, partial truncation.
5. **Final parse + validate**.

API: `extractAndValidateJSON<T>({raw, schema})` → `ExtractSuccess<T> | ExtractFailure` mit Staged-Breadcrumb-Trail.

### 4b. Prose-Extraction (`prose-extract.ts`)

Für Outputs mit **prosa-shaped Charakter** (Synthese-Memos, interpretierende Memos, kontextualisierende Memos — typischerweise mit eingebetteten Listen-Containern wie `auffaelligkeiten[]` oder `codes[]`). Prosa in JSON zu pressen ist ein Kategorienfehler — Section-Headered-Prose ist das ehrlichere Format.

**Format:** `## NAME` (Singleton) und `## NAME N` (Listen-Element) mit `key: value` (oneline) oder `key:` + body (multiline). Beispiel:

```
## SYNTHESE
<freier Prosa-Block>

## AUFFAELLIGKEITEN 1
scope: §3
observation:
<freier Prosa-Block>
```

Caller deklariert Format via `SectionSpec`:

```ts
{
  singletons: { SYNTHESE: 'multiline' },
  lists: { AUFFAELLIGKEITEN: { fields: { scope: 'oneline', observation: 'multiline' } } }
}
```

API: `parseStructuredProse(raw, spec)` → `ParseProseSuccess | ParseProseFailure`. Section-Namen werden lowercase auf Schema-Keys gemappt (Konvention: Plural-Section-Name = Plural-Schema-Key). `describeProseFormat(spec)` rendert die verbindlichen Format-Anweisungen für den System-Prompt.

### 4c. Self-Healing-Repair-Wrapper (Layer B)

Beide Pipelines werden vom selben Layer-B-Pattern umschlossen:

- `runJsonCallWithRepair<T>({chatOpts, schema, label})` — JSON-Variante.
- `runProseCallWithRepair<T>({chatOpts, schema, spec, label})` — Prose-Variante.

Bei Parse- oder Schema-Failure folgt ein **Self-Repair-Retry**: Modell sieht den fehlgeschlagenen Output zurück + strukturiertes Feedback (welches Feld fehlt, welcher Header ist unbekannt) und korrigiert. Default `maxAttempts=2`. Erschöpfte Versuche werfen `RepairCallExhaustedError` mit `lastRawText` + `stagesPerAttempt` für Diagnose.

Telemetrie pro Aufruf nach `pipeline_call_log` (Mig 051): `attempts`, `parseStrategy='json'|'prose'`, `outcome`, Token-Breakdown — getrennt von `ai_interactions`, da run-gebunden.

**Welt-3-Module verwenden Prose** (per-paragraph + 5 Collapse-Module): die LLM erzeugt dort Memo-Prosa mit Auffälligkeits-/Code-Listen. **Welt-4-Module (Argumentation Graph, Validity, H3-Konstrukte) bleiben JSON.**

---

## 5. AI-Logging

`ai_interactions` (Mig 013) loggt: `request_type, model, input_context JSONB, response JSONB, input_tokens, output_tokens, provider, accepted, naming_id, project_id`.

**Lücke:** Nicht an `pipeline_runs` gebunden (kein `run_id` FK). Kosten-Tracking läuft über `pipeline_runs.accumulated_*_tokens` und `accumulated_cost_usd` — separat von `ai_interactions`. Refactor-Backlog.

---

## 6. CLI-Test-Scripts

Für Heuristik-Tests außerhalb des Pipeline-Orchestrators existieren `scripts/test-h3-*.ts`-Scripts. Diese rufen direkt `runExpositionPass()` / `runForschungsdesignPass()` etc. auf. Brief-Konfiguration wird per CLI-Flag injected. Pipeline-Integration für H3 wartet auf das Falltyp-System (siehe `06-cases-briefs-falltyp.md`).
