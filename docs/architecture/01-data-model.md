# 01 — Datenmodell

**Stand: 2026-05-03** · 48 Migrationen, 32 Tabellen aktiv. PostgreSQL + pgvector + tsvector.

Dev-DB-Connection: `postgresql://joerissen@localhost:5432/sarah` (nativ; `docker-compose.yml` ist SACAnEv-Altlast und **nicht** die Dev-DB).

---

## 1. Migrationsindex (001–048)

Eine Zeile pro Migration. Alles im Verzeichnis `migrations/`. Reihenfolge ist kanonisch.

```
001 initial: users, sessions, projects, events, elements, document_content, annotations, memos
002 transaktionale Ontologie: DROP events/elements; ADD namings, participations, appearances
003 designation process: naming_designations (CCS), researcher_namings
004 inscription history: naming_inscriptions (append-only)
005 ai_namings (KI als Naming-Identität pro Projekt)
005b ai_system_user (Sentinel-UUID)
006 phase_memberships (append-only)
007 topology_snapshots (Canvas-Layout-Versions)
008 RETIRE 'code-system' role → 'grounding-workspace' (Codes werden derived view)
009 naming_acts: vereinheitlicht inscriptions+designations; DROP alte Tabellen
010 memo status enum {active, presented, discussed, acknowledged, promoted, dismissed}
011 cascade FKs (naming_acts.by, appearances.directed_*, phase_memberships.by)
012 relative file paths (strip absolute Pfade)
013 ai usage details (input/output tokens, provider)
014 coach library (coach_references + coach_chunks)
015 coach index (indexed_at, summary, questions, key_concepts, relevance)
016 ai_tickets (persona ∈ aidele/cairrie/raichel — später korrigiert)
017 RENAME aidele → coach
018 document_elements (paragraph/sentence/turn-Hierarchie) + document_element_refs
019 embeddings: ADD vector(768) + HNSW
020 fix persona constraint → {coach, cowork, autonomous}
021 document_coding_runs counter
022 RENAME phase → cluster (wird in 026 zurückgenommen)
023 primary sitmap markieren
024 project properties JSONB
025 must_change_password
026 REVERT cluster → phase
027 DROP document_elements.content (redundant zur full_text-Substring)
028 element pages + section_kind {front_matter, main, bibliography, appendix}
029 cases + assessment_briefs (Triade central+annotation+review_draft pro Case)
030 hermeneutic memos (memo_type) + code_anchors (in-vivo-Codes)
031 brief option include_formulierend
032 argumentation graph experiment: argument_nodes, argument_edges + Brief-Flag
033 scaffolding_elements + scaffolding_anchors
034 argumentation_graph default true
035 heading_classifications: User-Outline-Layer + outline_status-Gate
036 heading_classifications.aggregation_subchapter_level
037 BRIEFS SYSTEMWEIT: DROP assessment_briefs.project_id
038 pipeline_runs (Orchestrator-State, pause/resume, idempotency)
039 memo_type 'kapitelverlauf'
040 argument validity (referential_grounding, validity_assessment) + Brief-Flag validity_check
041 anonymization: document_pii_seeds + document_content.anonymization_status / original_filename
042 PII source extension (ner_spacy, regex_phone)
043 function_constructs (H3 Funktionstyp-Werk-Konstrukte mit Versionsstack)
044 outline_function_type + granularity_level auf heading_classifications
045 virtual_function_containers (Aggregation für nicht-1:1-Funktionstypen)
046 case_review_drafts (List-Modell mit owner_kind ∈ SELF/SECOND_REVIEWER/EXTERNAL)
047 brief.h3_enabled
048 bibliography_entries (deterministisch extrahiert; Werk-Bibliographie für H3:GRUNDLAGENTHEORIE)
```

---

## 2. Aktuelle Tabellen (gruppiert nach Domäne)

### 2.1 Auth + Projekt

| Tabelle | PK | Wichtige FKs / Felder |
|---------|----|-----------------------|
| `users` | id | username, email, password_hash, role, must_change_password |
| `sessions` | id | user_id, token (UNIQUE), expires_at |
| `project_members` | (project_id, user_id) | role |
| `projects` | id | name, created_by (SET NULL), properties JSONB |

### 2.2 Transaktionale Ontologie (Kern)

| Tabelle | PK | Notizen |
|---------|----|---------|
| `namings` | id | project_id (CASCADE), inscription, deleted_at (soft), seq BIGSERIAL |
| `participations` | id | naming_id, participant_id; UNIQUE (naming, participant); ungerichtet |
| `appearances` | (naming_id, perspective_id) | mode, directed_from/to, valence, properties JSONB |
| `naming_acts` | (naming_id, seq) | append-only; inscription/designation/mode/valence (alle nullable) |
| `researcher_namings` | (user_id, project_id) | naming_id |
| `ai_namings` | project_id | naming_id, model |

### 2.3 Cases + Briefs

| Tabelle | PK | Notizen |
|---------|----|---------|
| `cases` | id | project_id, central_document_id (UNIQUE, RESTRICT), annotation_document_id (nullable), review_draft_document_id (nullable, **Legacy**), assessment_brief_id (SET NULL) |
| `case_review_drafts` | id | case_id (CASCADE), document_id (CASCADE), owner_kind ∈ {SELF, SECOND_REVIEWER, EXTERNAL}, label, seq; partial UNIQUE auf SELF |
| `assessment_briefs` | id | name, work_type, criteria, persona, include_formulierend, argumentation_graph (DEFAULT true), validity_check, h3_enabled, output_schema_version, created_by; **kein project_id** (037) |

### 2.4 Document Storage

| Tabelle | PK | Notizen |
|---------|----|---------|
| `document_content` | naming_id | full_text (autoritativ), file_path (relativ), mime_type, coding_runs INT, **outline_status ∈ {pending, confirmed}** (Gate), outline_confirmed_at/by, anonymization_status, original_filename (anon), anonymized_at |
| `document_elements` | id | document_id (CASCADE), element_type, parent_id, seq, char_start/char_end, page_from/to, section_kind, properties JSONB, **embedding vector(768)** + HNSW |
| `document_element_refs` | (from_id, to_id, ref_type) | properties JSONB |
| `heading_classifications` | id | document_id (CASCADE), element_id (SET NULL nach reparse), heading_text_normalized + approx_char_start (Soft-Anchor), user_text/user_level/excluded, outline_function_type (nullable), granularity_level (nullable), aggregation_subchapter_level, outline_function_type_user_set |
| `document_pii_seeds` | id | document_id, category ∈ {person_name, email, matrikel, student_id, institution, project, self_citation, phone}, role, value, variants TEXT[], replacement, source, active; UNIQUE (doc, category, value) |
| `bibliography_entries` | id | case_id, document_id, paragraph_element_id (SET NULL), char_start/end, raw_text, first_author_lastname, year, year_suffix |

### 2.5 Pipeline + Memos

| Tabelle | PK | Notizen |
|---------|----|---------|
| `memo_content` | naming_id | content TEXT, status (s. Mig 010), memo_type ∈ {formulierend, interpretierend, kontextualisierend, kapitelverlauf}, scope_element_id (CASCADE), scope_level ∈ {paragraph, subchapter, chapter, work} |
| `code_anchors` | id | code_naming_id, element_id, char_start/end |
| `pipeline_runs` | id | case_id (CASCADE), document_id (CASCADE), started_by_user_id (RESTRICT), status, current_phase/index/total_in_phase, options JSONB (include_synthetic, cost_cap_usd, only_phases), accumulated_*_tokens, accumulated_cost_usd, **cancel_requested**, error_message, started_at/paused_at/resumed_at/completed_at; partial UNIQUE auf running/paused pro Case |

### 2.6 Argumentations-Graph (H1/H2)

| Tabelle | PK | Notizen |
|---------|----|---------|
| `argument_nodes` | id | paragraph_element_id (CASCADE), arg_local_id, claim, premises JSONB, anchor_phrase, anchor_char_start/end, position_in_paragraph, **referential_grounding** ∈ {none, namedropping, abstract, concrete} (nullable), **validity_assessment** JSONB (nullable) |
| `argument_edges` | id | from_node_id, to_node_id (different), kind ∈ {supports, refines, contradicts, presupposes}, scope ∈ {inter_argument, prior_paragraph} |
| `scaffolding_elements` | id | paragraph_element_id, element_local_id, excerpt, function_type ∈ {textorganisatorisch, didaktisch, kontextualisierend, rhetorisch}, anchor_phrase + char_start/end |
| `scaffolding_anchors` | id | scaffolding_id, argument_id; M:N (≥1 Argument-Anchor verpflichtend) |

### 2.7 H3 Funktionstyp-Konstrukte

| Tabelle | PK | Notizen |
|---------|----|---------|
| `function_constructs` | id | case_id, document_id, outline_function_type (CHECK), construct_kind, anchor_element_ids UUID[] (≥1), content JSONB (**nur Extrakt — keine Telemetrie!**), version_stack JSONB (CCS-append-only), virtual_container_id (SET NULL), source_run_id |
| `virtual_function_containers` | id | case_id, document_id, outline_function_type (CHECK), granularity_level, label, source_anchor_ranges JSONB |

### 2.8 AI-Logging + Coach + Tickets + Topology

| Tabelle | Zweck |
|---------|-------|
| `ai_interactions` | Comprehensive Call-Log (input/output tokens, provider, accepted) — derzeit **nicht** an `pipeline_runs` gebunden |
| `coach_references` + `coach_chunks` | Installation-weite Coach-AI-Referenz-Library (functional, aber **nicht aktiv pipeline-gewired**) |
| `ai_tickets` | Op-Tracking (gitignored, außerhalb Project-Datenraum) |
| `topology_snapshots` | Canvas-Layout-Versions (autobuffer + manual saves) |

---

## 3. Query-Layer (`src/lib/server/db/queries/`)

| Datei | Domain |
|-------|--------|
| `index.ts` (`db/`) | `pool`, `query`, `queryOne`, `transaction`, withRetry-Wrapper |
| `namings.ts` | Transaktionale Ontologie (Naming, Appearance, Participation, History) — ~700 LOC |
| `memos.ts` | Memo-Naming + content + participations + Discussion |
| `briefs.ts` | system-weite Briefs (CRUD, case_count, Delete-Block bei Referenz) |
| `events.ts` | Re-Export von `getHistory` aus namings (Namings = Events) |
| `ai.ts` | `getOrCreateAiNaming`, `logAiInteraction` |

**Lücke:** `cases`, `case_review_drafts`, `document_elements`, `heading_classifications`, `argument_nodes`, `pipeline_runs`, `function_constructs`, `virtual_function_containers`, `bibliography_entries` haben **keine** dedizierten Query-Module. SQL liegt inline in `pipeline/orchestrator.ts`, `ai/hermeneutic/*.ts`, `ai/h3/*.ts`. Funktional ok, aber Refactor-Backlog für API-Erweiterung.

---

## 4. Invarianten (von DB-Constraints erzwungen)

1. **Genau ein zentrales Dokument pro Case** (`cases.central_document_id` UNIQUE, ON DELETE RESTRICT).
2. **Genau ein SELF-Review-Draft pro Case** (partial UNIQUE auf `case_review_drafts WHERE owner_kind='SELF'`).
3. **Max ein aktiver Pipeline-Run pro Case** (partial UNIQUE auf `pipeline_runs WHERE status IN (running, paused)`).
4. **Outline-Confirm gated jede Pipeline** (`document_content.outline_status='pending'` blockiert downstream).
5. **Briefs system-weit** (kein `project_id`, ab 037).
6. **PII-Seeds bleiben nach Anonymisierung erhalten** (Failsafe-Tripwire bleibt aktiv).
7. **`participations` ungerichtet im Storage** — Richtung emergiert nur in `appearances.mode='relation'` mit `directed_from/to`.
8. **`naming_acts` immutable** — append-only; current value = letzter non-NULL pro Dimension.
9. **`scaffolding_elements` brauchen ≥1 Argument-Anchor** (sonst Fallback auf Paragraph-Level).

---

## 5. Drift / Altspuren (lebendig im Schema, kontextualisieren)

| Migration(en) | Was passierte | Status heute |
|---------------|---------------|--------------|
| 008 | `code-system` → `grounding-workspace` | Codes sind derived view von Map-Anchors. Keine UI mehr, Spalte filtered. |
| 022→026 | phase ↔ cluster Hin und Her | Kein Schema-Residual. "Phase" ist final. |
| 027 | DROP `document_elements.content` | Alle Konsumenten lesen Substring von `document_content.full_text`. |
| 017 | aidele → coach | Sauberer Rename. |
| 037 | DROP `assessment_briefs.project_id` | Briefs system-weit. UI unter `/settings?tab=briefs`. |
| 032→034 | argumentation_graph Flag default false → true | Sauberer Toggle. |
| 046 | `case_review_drafts` als Liste | `cases.review_draft_document_id` ist Legacy (durch backfill abgedeckt), aber noch nicht entfernt. |

Wenn du eines dieser Felder siehst und unsicher bist: hier nachschlagen, **nicht** einen alten Decision-Pfad rekonstruieren.
