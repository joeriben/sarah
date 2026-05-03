-- Migration 043: function_constructs — persistente H3-Konstrukte mit Werk-Ankern
--
-- Konzeptioneller Hintergrund: docs/h3_implementation_plan.md +
-- Memory project_three_heuristics_architecture.md.
--
-- Die kontextadaptive Heuristik H3 produziert pro Funktionstyp eines Werkes
-- (EXPOSITION, GRUNDLAGENTHEORIE, FORSCHUNGSDESIGN, DURCHFÜHRUNG, EXKURS,
-- SYNTHESE, SCHLUSSREFLEXION, WERK_STRUKTUR) **Konstrukte** — z.B. eine
-- FRAGESTELLUNG in der EXPOSITION, eine ERKENNTNIS in DURCHFÜHRUNG, eine
-- METHODOLOGIE im FORSCHUNGSDESIGN. Diese Konstrukte sind später die Anker
-- des aggregierenden WERK_GUTACHT-Outputs und werden im Reader sichtbar.
--
-- Jedes Konstrukt ist:
--   * dem Funktionstyp und einem konkreten Werk zugeordnet,
--   * an ein oder mehrere ¶/Heading-Anker im Dokument gebunden
--     (anchor_element_ids referenziert document_elements; FK ist
--     bewusst nicht auf Array-Element-Ebene erzwingbar — Konsistenz
--     liegt in der Application-Schicht, parallel zu argument_nodes-
--     Anchors aus Migration 032),
--   * versionsfähig via version_stack (CCS-Designation-Stack):
--     Re-Spec-Akte aus EXKURS-Heuristik werden als zusätzliche
--     Stack-Einträge angefügt — append-only, kein Overwrite.
--
-- version_stack-Form (JSONB array, mind. 1 Eintrag):
--   [
--     {
--       "kind": "origin" | "re_spec",
--       "at": "<ISO timestamp>",
--       "by_user_id": "<UUID>" | null,
--       "source_run_id": "<UUID>" | null,
--       "source_construct_id": "<UUID>" | null,   -- nur bei re_spec
--       "content_snapshot": { ... }               -- frozen Inhalt zur Stack-Tiefe
--     },
--     ...
--   ]
-- Das aktive Inhalts-Feld ist `content` (immer letzter Stand); der Stack
-- bewahrt die Designation-Historie. Reader-UI kollabiert den Stack via
-- collapseAt-Logik (siehe CLAUDE.md Perspectival Collapse).
--
-- outline_function_type: TEXT mit CHECK statt Enum, konsistent mit Migration
-- 029 (cases.work_type) und 033 (scaffolding_elements.function_type) —
-- TEXT+CHECK erlaubt additive Erweiterung ohne ALTER TYPE-Migration.
-- Der Spaltenname ist bewusst NICHT `function_type` gewählt, um
-- Verwechslung mit scaffolding_elements.function_type (Migration 033) zu
-- vermeiden — letzteres kategorisiert Layer-2-Argumentations-Funktionen
-- ('textorganisatorisch'/...) und hat semantisch nichts mit Werkstruktur-
-- Funktionstypen zu tun. Konsistente Benennung über alle H3-Tabellen
-- hinweg (function_constructs, heading_classifications,
-- virtual_function_containers): outline_function_type.
--
-- construct_kind: TEXT ohne CHECK — die Heuristik-Liste erweitert sich
-- pro Phase, harte Constraints würden für jede neue Heuristik eine
-- Folge-Migration erzwingen. Application-Layer pflegt eine zentrale
-- Konstanten-Liste, die in Code-Reviews überprüft wird.
--
-- Backward-Compat:
--   * Tabelle ist neu — kein bestehender H1/H2-Pfad konsumiert sie.
--   * H1/H2 schreiben ihre Outputs weiterhin in argument_nodes/memo_content.
--   * H3-Konstrukte stehen daneben und können von H1/H2 perspektivisch
--     als Lese-Quelle hinzugenommen werden, ohne dass die Schreibwege brechen.
--
-- TO REVERT (falls H3 grundsätzlich verworfen würde):
--   DROP TABLE function_constructs;

CREATE TABLE function_constructs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  outline_function_type TEXT NOT NULL CHECK (outline_function_type IN (
    'EXPOSITION',
    'GRUNDLAGENTHEORIE',
    'FORSCHUNGSDESIGN',
    'DURCHFUEHRUNG',
    'EXKURS',
    'SYNTHESE',
    'SCHLUSSREFLEXION',
    'WERK_STRUKTUR'
  )),

  construct_kind TEXT NOT NULL,

  -- Anker an document_elements (¶ oder Heading). Mind. 1 Element-ID.
  -- Auf DB-Ebene UUID[] ohne FK-Constraint pro Element; Cleanup bei
  -- ON DELETE CASCADE muss in der Application erfolgen, falls je
  -- ein Anker-Element gelöscht wird (in der Praxis löscht das nur
  -- ein reparseDocument, der ohnehin alle abhängigen Strukturen
  -- invalidiert).
  anchor_element_ids UUID[] NOT NULL,

  -- Aktiver Inhalt — letzter Stand des Stacks.
  content JSONB NOT NULL,

  -- CCS-Designation-Stack als append-only History.
  version_stack JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Optional: virtueller Container, dem dieses Konstrukt zugeordnet ist
  -- (FK wird in Migration 045 nachgezogen, hier als TEXT-Spalte angelegt
  -- wäre ungeschickt; daher NULLable UUID ohne FK in dieser Migration —
  -- Migration 045 fügt den FK über ALTER TABLE nach).
  virtual_container_id UUID,

  source_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (cardinality(anchor_element_ids) >= 1)
);

CREATE INDEX idx_function_constructs_case ON function_constructs(case_id);
CREATE INDEX idx_function_constructs_document ON function_constructs(document_id);
CREATE INDEX idx_function_constructs_type ON function_constructs(document_id, outline_function_type);
CREATE INDEX idx_function_constructs_kind ON function_constructs(document_id, construct_kind);
