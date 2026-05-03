# 06 — Cases, Briefs, Falltyp-System, UI-Roadmap

**Stand: 2026-05-03** · Wo Forschungsmaterial, Konfiguration und Pipeline zusammenkommen.

---

## 1. Project → Case → Document (Anlege-Reihenfolge ist gesetzt)

Memory `project_no_caseless_docs`: **Caseless Docs sind unmöglich.** Anlege-Reihenfolge:

```
Project (Container)
  ↓
Case (Forschungseinheit, optional default_case_type_id wenn Falltyp-System läuft)
  ↓
Documents (central + 0..1 annotation + 0..N review_drafts)
```

Existing caseless Docs sind Legacy, **nicht** gewollter Zustand. Doc-Upload-Flow muss zukünftig Case-gebunden werden (Stufe 2/3-Roadmap).

---

## 2. Case-Triade (Mig 029, erweitert via Mig 046)

Memory `project_case_document_triad`: **NICHT generisch multi-Document.** Genaue Kardinalität pro Case:

| Slot | Tabelle / Feld | Kardinalität |
|------|----------------|--------------|
| Zentrales Dokument | `cases.central_document_id` (UNIQUE, RESTRICT) | **genau 1** |
| Annotation-Dokument | `cases.annotation_document_id` (nullable) | 0..1 |
| Review-Drafts | `case_review_drafts` (List-Modell, Mig 046) | 0..N (genau 1× owner_kind='SELF', beliebig viele SECOND_REVIEWER/EXTERNAL) |

**Legacy:** `cases.review_draft_document_id` ist durch backfill aus Mig 046 abgedeckt, aber noch nicht entfernt — siehe Drift-Liste in `01-data-model §5`.

---

## 3. Briefs — system-weite Library (Mig 037)

Memory `project_briefs_systemwide`: Briefs sind **keine** per-project-Konfiguration mehr. Sie liegen in einer system-weiten Library.

| Aspekt | Wert |
|--------|------|
| Tabelle | `assessment_briefs` (kein `project_id`) |
| UI | `/settings?tab=briefs` |
| API | `/api/briefs[/[briefId]]` |
| System-Marker | `created_by = NULL` (5 Standard-Vorlagen) |
| Bindung | `cases.assessment_brief_id` (SET NULL, optional pro Case) |

**Brief-Felder (Pipeline-relevant):**

| Feld | Wirkung |
|------|---------|
| `work_type` | Default-Funktionstyp-Vorschläge (bislang nicht aktiv) |
| `criteria` | Bewertungs-/Begutachtungs-Kriterien |
| `persona` | Persona für LLM-Prompts |
| `include_formulierend` (031) | aktiviert per-¶ formulierend in synthetischer Pipeline-Phase |
| `argumentation_graph` (032/034, default true) | aktiviert analytische Hauptlinie (AG-Erstellung) |
| `validity_check` (040) | aktiviert Phase 2 (Validity + Grounding) |
| `h3_enabled` (047) | aktiviert H3-Funktionstyp-Konstrukt-Extraktion |
| `output_schema_version` | Versionierung der Ausgabe-Struktur |

---

## 4. Falltyp-System (Stufe 3 — geplant, nicht implementiert)

Memory `project_falltyp_architecture`: ersetzt die harte Triade durch konfigurierbare Falltypen.

**Zielarchitektur:**

```
case_types (Tabelle, system-weit)
  - id, name, slug, default_brief_id?, doc_slot_config JSONB
case_documents (Tabelle, ersetzt harte Triade-FKs)
  - case_id, slot ('central' | 'annotation' | 'review_draft' | <custom>), document_id, owner_kind
projects.default_case_type_id (Container behält bewußt schwache Bindung)
```

**Vorgesehene Falltypen (3 + 1):**

| Falltyp | Zweck | Heuristik-Routing |
|---------|-------|-------------------|
| `qualification_review` | BA / MA / Diss / Habil-Begutachtung | H3 voll (alle Funktionstyp-Konstrukte) |
| `peer_review` | Artikel-Peer-Review | H1 + H2 (analytisch + synthetisch), kein H3 |
| `cumulative_dissertation_review` | kumulative Dissertationen | Hybrid: H3 für Mantel, H2 für eingebundene Artikel — **mit Kollegialitäts-Respekt** für bereits publizierte Teilarbeiten |

Diese Falltyp-Konfiguration entscheidet zukünftig die Heuristik-Wahl — **nicht** ein Run-Setup-Toggle. Siehe Memory `feedback_features_before_interface`: keine UI/Toggle-Bauten für Features, die noch nicht existieren.

---

## 5. Pipeline-Run-Orchestrator-Bezug (Stufe 2 ✓)

Memory `project_pipeline_run_orchestrator`: Mig 038 + Master-Run-UI ist abgeschlossen.

- Analytische Hauptlinie AG → L3 → L1 → L0 ist die **default-Pflicht-Reihe**.
- Synthetisches Per-¶-Memo ist explizit **Addendum** (`options.include_synthetic`), nicht Eingang in Section-Collapse.
- Pause/Resume via `cancel_requested` + Idempotenz-Filter pro Phase (siehe `04-pipeline-h1-h2 §2`).

---

## 6. 4-Stufen-Roadmap Forscher-UI (Memory `project_sarah_ui_roadmap_stage_plan`)

Genehmigt 2026-05-02.

| Stufe | Inhalt | Status |
|-------|--------|--------|
| **1** | Brief-Library (system-weit, `/settings?tab=briefs`) | ✓ (Mig 037) |
| **2** | Doc-Page mit Pipeline / Outline / Reader (Master-Run-UI, Outline-Editor, Reader-Komponente) | ✓ (Mig 038, Outline-API komplett) |
| **3** | Falltyp-System (`case_types`, `case_documents`, default_case_type pro Project) | **geplant**, nicht implementiert |
| **4** | Demo-Gutachten-Rekonstruktion (End-to-End-Showcase mit existierenden Cases) | offen |

**Was Stufe 3 ablöst:** harte Triade-FKs auf `cases`, hard-coded Triade-UI, fehlende Heuristik-Routing-Konfiguration.

**Was Stufe 4 zeigen soll:** vollständiger Lauf eines Habil-Gutachtens als Demo-Output mit allen drei Heuristiken zusammenwirkend.

---

## 7. Critical-Friend-Identität (Memory `project_critical_friend_identity`)

Auf jeder UI-Ebene sichtbar: **SARAH ist Analyse-Werkzeug + Critical Friend zum eigenen Urteil des Users.** Keine Beurteilungs-Automatisierung.

Konsequenz für H3:
- `H3:WERK_GUTACHT-c` (Gutachten-Synthese-Komponente) ist gated durch ein eigenes `case_review_drafts.owner_kind='SELF'`. Ohne eigenen Reviewer-Draft → keine Synthese-Empfehlung.
- Synthesen werden als "Vorschlag des Werkzeugs" markiert, nicht als "Bewertung".
- `b/c+d/e/f`-Gates verhindern Komponenten ohne entsprechende User-Fundierung.
