# 02 — Dokumentverarbeitung

**Stand: 2026-05-03** · Upload → Text → Parse → Outline-Confirm → (Embeddings, Anonymisierung).

`document_content.full_text` ist die **autoritative** Textquelle. `document_elements` haben **kein** eigenes Content-Feld (Migration 027); Slice via `substring(full_text, char_start, char_end)`.

---

## 1. Upload-Flow

```
POST /api/upload
  ↓
detectMimeType()
  ↓
extractText(buffer, mime)
   - DOCX → mammoth raw extraction
   - PDF  → pdf-parse  (PDF wurde verworfen — siehe Memory project_docx_only)
   - HTML → Strip-Tags
   - txt  → pass-through
  ↓
parseAndStore(client, docId, fullText, mime, bytes?)
  ↓
selectFormat(mime, fullText) → parser-Router (siehe §2)
  ↓
ParsedElement-Tree (parent/child + element_type + char-Range + section_kind)
  ↓
INSERT document_elements + document_element_refs (transaktional)
  ↓
[Deferred, außerhalb Tx] embedDocumentElements(docId)
[Deferred, außerhalb Tx] anonymizeDocumentDeterministic(docId)
```

**Files-Layout:** `projekte/[slug]/files/[uuid].ext` (Slug = umlautsicher). Pfad in DB ist relativ (Mig 012).

---

## 2. Parser-Router (`src/lib/server/documents/parsers/index.ts`)

| Routing-Kriterium | Parser | Datei |
|-------------------|--------|-------|
| MIME = `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `docx-academic` | `docx-academic.ts` |
| Text beginnt mit `Zusammenfassung der Anmerkungen…` | `annotations-export` | `annotations-export.ts` (PDF-Annotation-Export) |
| sonst | `plain-text` | `plain-text.ts` (regex sentence-split, German abbrev-aware via `sentences-de.ts`) |

`types.ts` definiert: ParsedElement, ElementRef, ParseResult. Element-Typen: `paragraph`, `sentence`, `heading`, `footnote`, `caption`, `toc_entry`, `turn`, `bibliography_entry`.

### 2.1 docx-academic (Heading-Detection)

DOCX = ZIP. Pipeline:

1. `yauzl` entpackt → liest `word/document.xml`, `word/styles.xml`, `word/footnotes.xml`.
2. `fast-xml-parser` (preserveOrder).
3. **TOC-Pre-Pass**: sammelt `bookmark→level`-Map aus `TOC1..TOC9`-Paragraphen.
4. Body-Walk pro `w:p`:
   - **Heading-Klassifikation**: TOC-Bookmark-Match → fallback auf `w:pStyle` (`Heading1` etc.). Niemals Line-Heuristik.
   - Sentence-Split (Deutsch, abbrev-sicher).
   - Footnote-Marker via `vertAlign='superscript'`.
   - Inline-Drawings → Footnote-Textboxes (PDF-Konverter-Fall).
5. Output: ParsedElement-Tree mit element_type, parent_id, seq, char_start/char_end, page_from/to (aus floating textboxes), section_kind ∈ `{front_matter, main, bibliography, appendix}`.

**Section-Detection:** Heuristisch nach Heading-Text (z.B. `Literaturverzeichnis` → `bibliography`). Wirkt auf alle nachfolgenden Elemente bis zum nächsten Section-Wechsel.

---

## 3. Re-Parse (`reparseDocument`)

Wenn die Parser-Logik sich verbessert (oder nach Anonymisierung Re-Parsen nötig wird):

1. `DELETE document_elements WHERE document_id = $1` (CASCADE auf Refs).
2. Re-Parse → neue Elements einfügen.
3. `heading_classifications.element_id` wird via Soft-Anchor (`heading_text_normalized` + `approx_char_start`) re-anchored — User-Override-Layer überlebt.
4. `outline_status='pending'` zurücksetzen → User muss neu confirmen.

Entry: `POST /api/projects/:projectId/documents/:docId/parse` oder Admin: `POST /api/admin/reparse-documents?projectId=X&documentIds=...`.

---

## 4. Outline (`src/lib/server/documents/outline.ts`)

`heading_classifications` ist der **User-Override-Layer** auf Parser-Headings. Felder:

- Parser-Werte (in `document_elements.properties`): `parserText`, `parserLevel`, `parserNumbering`.
- User-Werte (`heading_classifications`): `userText`, `userLevel`, `excluded`, `notes`, `outline_function_type`, `granularity_level`, `aggregation_subchapter_level`, `outline_function_type_user_set`.

`loadEffectiveOutline(docId)` → mergt Parser + User; berechnet `effectiveText`, `effectiveLevel`, **synthetisiert effectiveNumbering** aus Position + Level (User entscheidet Level, Numerierung folgt automatisch). `excluded=true` → kein effectiveNumbering.

**Outline-Confirm-Gate:**

| Status | Wirkung |
|--------|---------|
| `outline_status='pending'` | Pipeline (H1/H2/H3) blockiert. UI zeigt "bitte erst Outline bestätigen". |
| `outline_status='confirmed'` | Pipeline-Run möglich. `outline_confirmed_at`, `outline_confirmed_by` gesetzt. |

Re-Parse setzt zurück auf `pending`.

**Why das Gate kein Bug ist:** Outline-Korrektheit ist Vorbedingung für Funktionstyp-Zuweisung (H3) und für Subchapter-Aggregation (Section-Collapse). Falsche Outline → falsche Synthesen.

---

## 5. Embeddings (`src/lib/server/documents/embeddings.ts`)

| Aspekt | Wert |
|--------|------|
| Modell | `nomic-ai/nomic-embed-text-v1.5` (768 Dim) |
| Runtime | `@huggingface/transformers` (onnxruntime-node) — **rein lokal**, keine API |
| Cache | `.model-cache/` (gitignored) |
| Singleton | lazy-loaded; Preload via `preloadEmbedModel()` beim Server-Start |
| API | `embed(text)` → Float32Array(768); `embedBatch(texts)`; `toPgVector()` für `[…]`-Literal |
| Index | HNSW auf `document_elements.embedding` (Mig 019) |

**Embedded werden Leaf-Elemente** (sentence, heading, footnote, caption, toc_entry, turn) ohne bestehendes Embedding. Trigger: `embedDocumentElements(docId)` als deferred Task nach Parse.

**Aktuelle Verwendung:** `findSimilarToElement(...)` in `embedding-queries.ts` — semantischer Ctrl+F. Nicht (yet) in Pipeline-Heuristiken eingebaut.

---

## 6. Anonymisierung Phase A (deterministisch, DSGVO-safe)

**Use-Case 1:** DSGVO-Pre-Processing für Qualifizierungsarbeiten — entfernt PII *bevor* überhaupt ein non-DSGVO-Provider gefragt wird. Use-Case 2 (Peer-Review-Anon, LLM-assisted) ist **stub** (siehe Memory `project_anonymization`).

### 6.1 Pipeline (`anonymize/index.ts` `anonymizeDocumentDeterministic`)

Einzelne Transaktion mit `FOR UPDATE`:

1. Load `full_text + original_filename + inscription`.
2. **Skip-Check**: `isAuthorAlreadyRedacted(text)` — wenn manuelle Redaction sichtbar, Status `skipped_already_redacted`, aber Seeds trotzdem extrahieren (Failsafe-Tripwire bleibt).
3. **Build seeds** (`buildSeeds(fullText)`):
   - `runNer(frontmatter, lang)` → spaCy `de_core_news_lg` / `en_core_web_sm` Subprozess (Python). Returns Entities (PER, ORG, LOC, MISC).
   - Regex: `extractEmails`, `extractMatrikels`, `extractStudentIds`, `extractPhones`.
   - Frontmatter-Window via `extractFrontmatter(text, maxChars=10000)` — stoppt am ersten Chapter-Heading.
4. **Verify**: `findEdits(text, seeds)` — wenn skipped UND keine Hits → wirklich überspringen.
5. **Apply**: `applyEdits(text, edits)` + `recomputeElementSlice(...)` für jedes `document_element` (char_start/end neu berechnen).
6. **Filename rewrite**: `buildSyntheticFilename(seeds, titleHint)`.
7. **Upsert seeds** in `document_pii_seeds` (idempotent via `ON CONFLICT (doc, category, value)`).
8. Setze `anonymization_status='applied'`, `anonymized_at=now()`, `original_filename` (nur einmal).

**Idempotent:** zweiter Call findet nichts mehr (Klartext weg) → Status `no_candidates`. Persistierte Seeds bleiben → Failsafe schützt weiter.

### 6.2 Schema-Bezug

| Tabelle / Feld | Inhalt |
|----------------|--------|
| `document_pii_seeds` | category, role, value, variants[], replacement, source ∈ {ner_spacy, regex_email, regex_matrikel, regex_student_id, regex_phone, frontmatter_label, llm_assisted}, active |
| `document_content.anonymization_status` | applied / no_candidates / skipped_already_redacted / pending |
| `document_content.original_filename` | Klartext-Filename (vor Rewrite) |
| `document_content.anonymized_at` | Timestamp |

### 6.3 Failsafe (separates Modul, siehe `03-ai-infrastructure §3`)

Vor jedem Outbound-Call zu non-DSGVO-Provider scannt `assertSafeForExternal()` den Payload gegen aktive Seeds. Hit → harter Throw `AnonymizationFailsafeError`. DSGVO-Provider (Mistral, Mammouth, Ionos) bypassen Scan (dürfen Klartext sehen).

Detail-Doku: `docs/anonymization-phase-b-handover.md` (243 Zeilen, autoritativ).
