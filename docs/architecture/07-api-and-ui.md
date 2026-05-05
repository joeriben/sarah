# 07 — API + UI

**Stand: 2026-05-03** · Endpoint-Inventar, UI-Routes, Komponenten, Shared-Module.

SvelteKit. Routes unter `src/routes/`, API unter `src/routes/api/`.

---

## 1. API-Endpoints

### 1.1 Auth (`/api/auth/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/auth/login` | POST | Login (Username/Passwort), setzt Session-Cookie |
| `/api/auth/logout` | POST | Cookie löschen |
| `/api/auth/register` | POST | User anlegen |
| `/api/auth/change-password` | POST | Passwort ändern (auth required) |

### 1.2 Projects (`/api/projects/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/projects` | POST | Projekt anlegen (creator wird owner) |
| `/api/projects/[projectId]` | DELETE | Soft-Delete |
| `/api/projects/[projectId]/settings` | GET/PATCH | Projekt-Settings |

### 1.3 Documents (`/api/projects/[projectId]/documents/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/upload` | POST | File-Upload → Save → Parse → Store-Elements → Anonymisieren (deferred). Returns docId |
| `/api/projects/[projectId]/documents/[docId]` | PATCH/DELETE | Rename / Soft-Delete |
| `/api/projects/[projectId]/documents/[docId]/status` | GET | Parse-/Embed-/Anon-Status |
| `/api/projects/[projectId]/documents/[docId]/parse` | POST | Re-Parse (deletes elements, re-anchors classifications, resets outline_status='pending') |
| `/api/projects/[projectId]/documents/[docId]/embed` | POST | Embedding-Trigger für Leaf-Elements |

### 1.4 Outline (`/api/projects/[projectId]/documents/[docId]/outline/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `…/outline` | GET | EffectiveOutline (parser+user merged + synthetisierte Numerierung) |
| `…/outline/[headingId]` | PATCH | Update single heading_classification (text, level, excluded, notes, outline_function_type, granularity_level) |
| `…/outline/insert` | POST | Synthetisches Heading einfügen |
| `…/outline/confirm` | POST | `outline_status='confirmed'`, setzt `outline_confirmed_at/by` |
| `…/outline/reopen` | POST | zurück auf `pending` |
| `…/outline/suggest-function-types` | POST | H3-Pre-Heuristik (Funktionstyp-Vorschläge) |
| `…/outline/export?format=md\|json\|docx\|pdf` | GET | Werk-Reflexion-Export (Werk-Synthese, Kapitelverlauf, Werk-Beschreibung, Werk-Gutachten, Heading-Synthesen). DOCX nutzt native `Heading1-6`-Styles, PDF native Bookmark-Tree — Word-Navigationsbereich bzw. PDF-Reader-Sidebar greifen. Trigger: Export-Bar im Outline-Tab der Document-View |

### 1.5 Anonymization (`/api/projects/[projectId]/documents/[docId]/anonymize`)

| Endpoint | Methode + Query | Zweck |
|----------|-----------------|-------|
| `…/anonymize` | GET | Persisted Seeds + Status |
| `…/anonymize?mode=deterministic` | POST | Phase A (spaCy + regex), idempotent |
| `…/anonymize?mode=peer-review` | POST | Phase B (LLM-assisted) — **501 Not Implemented** |

### 1.6 Cases (`/api/cases/*` + `/api/projects/[projectId]/cases/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/projects/[projectId]/cases` | POST | Case anlegen |
| `/api/cases/[caseId]/brief` | PATCH | `cases.assessment_brief_id` setzen |
| `/api/cases/[caseId]/pipeline` | GET | Pipeline-Definition (Phasen + Gates für Brief-Konfig) |
| `/api/cases/[caseId]/pipeline-status` | GET | Aktueller Run (Phase, Progress, Errors) |
| `/api/cases/[caseId]/pipeline/run` | POST/GET/DELETE | Start / Detail / Cancel |
| `/api/cases/[caseId]/chapter-flow-summary` | POST | Kapitelverlauf-Memo generieren |
| `/api/cases/[caseId]/hermeneutic/paragraph` | GET | H1/H2-Daten für alle ¶ |
| `/api/cases/[caseId]/hermeneutic/paragraph/[paragraphId]` | POST | Per-¶-Annotation speichern |
| `/api/cases/[caseId]/paragraph-arguments/[paragraphId]` | GET | AG-Argumente pro ¶ |

### 1.7 Briefs (`/api/briefs/*`) — system-weit

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/briefs` | GET / POST | Liste / Anlegen |
| `/api/briefs/[briefId]` | GET / PATCH / DELETE | CRUD (Delete blockt bei Cases-Referenz) |

### 1.8 Memos (`/api/projects/[projectId]/memos/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `…/memos` | GET / POST | Liste / Anlegen |
| `…/memos/[memoId]` | GET / PATCH | Lesen / Update |
| `…/memos/[memoId]/status` | GET | Status (active/presented/discussed/…) |

### 1.9 Settings (`/api/settings/*`)

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/settings/ai` | GET / POST | Provider, Modell, Rate-Limits |
| `/api/settings/ai/test` | POST | Connectivity / Billing-Test |
| `/api/settings/usage` | GET | Token-Verbrauch pro Provider/Modell |

### 1.10 Status / Admin

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/embed-status` | GET | Embedding-Modell-Status (idle / downloading / ready / error) |
| `/api/db-status` | GET | DB-Connection-Status |
| `/api/admin/reparse-documents?projectId=X&documentIds=Y,Z` | POST | Bulk-Reparse |

---

## 2. UI-Routes

| Route | Inhalt | Daten-Deps |
|-------|--------|------------|
| `/login` | Login-Form | POST `/api/auth/login` |
| `/projects` | Projekt-Liste (für eingeloggten User) | `+page.server.ts` lädt projects |
| `/projects/[projectId]` | Projekt-Dashboard | layout.server lädt project + members |
| `/projects/[projectId]/cases` | Cases-Liste | server-loaded |
| `/projects/[projectId]/cases/new` | Case anlegen | POST `/api/projects/.../cases` |
| `/projects/[projectId]/documents` | Dokument-Liste | server-loaded |
| `/projects/[projectId]/documents/[docId]` | Detail (Parse/Anon/Embed-Status, File-Link) | `…/status` API |
| `/projects/[projectId]/documents/[docId]/outline` | Outline-Editor (Headings, Funktionstyp, Confirm-Button) | Outline-APIs |
| `/projects/[projectId]/memos` | Memo-Liste | server-loaded |
| `/projects/[projectId]/memos/[memoId]` | Memo-Editor | server-loaded |
| `/settings` | Settings-Tabs (AI, Usage) | API `/api/settings/*` |
| `/settings/briefs` | Brief-Library-Liste (system-weit) | `/api/briefs` |
| `/settings/briefs/new` | Brief anlegen | POST `/api/briefs` |
| `/settings/briefs/[briefId]` | Brief editieren | PATCH `/api/briefs/[id]` |

---

## 3. Komponenten + Shared

**`src/lib/components/`:**
- `BriefEditor.svelte` — WYSIWYG für Brief-Felder (work_type, criteria, persona, Flags).

**`src/lib/shared/`:**
- `constants.ts` — `SESSION_COOKIE`, magische Strings.
- `validation.ts` — Zod-Schemas (loginSchema, projectSchema, …).
- `h3-vocabulary.ts` — Funktionstyp + Granularity Enums + Display-Labels (siehe `05-pipeline-h3 §2`).
- `types/` — TypeScript-Interfaces, geteilt zwischen Client und Server.

---

## 4. Server-Module-Struktur (Übersicht)

```
src/lib/server/
├── auth/          ← Session-Cookie, Hashing, Middleware
├── db/            ← pg pool + queries/{namings, memos, briefs, ai, events}.ts
├── files/         ← saveFile, resolveFilePath (relative Pfade)
├── documents/     ← Parsing, Anonymisierung, Embeddings, Outline (siehe 02-documents.md)
├── ai/            ← client.ts, failsafe.ts, json-extract.ts
│   ├── h3/        ← exposition.ts, forschungsdesign.ts, grundlagentheorie.ts (siehe 05)
│   └── hermeneutic/ ← AG, validity, section/chapter/document collapse, per-paragraph (siehe 04)
└── pipeline/      ← orchestrator.ts, function-type-assignment.ts (siehe 04 + 05)
```

---

## 5. Hooks + Layout

- `src/hooks.server.ts` — Auth-Middleware (Session-Cookie → User in `event.locals.user`).
- `src/routes/+layout.server.ts` — lädt `event.locals.user` + global Settings.
- `src/routes/projects/[projectId]/+layout.server.ts` — lädt Projekt + Membership-Check.

---

## 6. Häufige Pitfalls

- **Kein direkter Zugriff auf `document_elements.content`** — Spalte existiert nicht (Mig 027). Substring von `document_content.full_text`.
- **Outline muss confirmed sein** bevor Pipeline-Run startet — sonst 409.
- **Brief-Delete wirft Conflict** wenn Cases referenzieren — UI muss vorher Bindings auflösen.
- **Pipeline-Run-Konflikt**: maximum 1 running/paused pro Case (DB-Constraint, 23505).
- **Anonymisierung-Failsafe blockt** Outbound-Calls zu non-DSGVO-Providern wenn PII im Payload — `documentIds` korrekt übergeben.
