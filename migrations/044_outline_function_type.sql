-- Migration 044: heading_classifications-Extension — Funktionstyp + Granularität
--
-- Konzeptioneller Hintergrund: docs/h3_implementation_plan.md +
-- Memory project_three_heuristics_architecture.md (Vor-Heuristik
-- FUNKTIONSTYP_ZUWEISEN).
--
-- Die Vor-Heuristik der H3-Pipeline weist jedem Outline-Knoten einen
-- Funktionstyp (EXPOSITION, GRUNDLAGENTHEORIE, ...) und eine
-- Granularitäts-Ebene (KAPITEL, UNTERKAPITEL, ABSCHNITT) zu. Beides ist
-- inferenzarm bestimmbar (Position im Werk + Heading-Marker-Regex +
-- Falltyp-Default), kann aber im Outline-Confirm-UI vom User
-- überschrieben werden.
--
-- Beide Spalten sind NULL-able mit Default NULL — bestehende Outline-
-- Klassifikationen bleiben unverändert, H1/H2 ignorieren die Spalten,
-- und H3 aktiviert sich nur, wenn die Werte gesetzt sind.
--
-- Wertelisten kongruent zu function_constructs.outline_function_type
-- (Migration 043) — Konsistenz erlaubt späteren Self-Join über
-- (document_id, outline_function_type) zur Atom-Listung in der
-- H3-Pipeline. Spaltenname `outline_function_type` (statt nur
-- `function_type`) zur Disambiguierung gegen
-- scaffolding_elements.function_type (Migration 033, Layer-2-
-- Argumentations-Funktion mit anderer Werteliste).
--
-- granularity_level-Werte:
--   * KAPITEL      — Top-Level-Strukturelement (typischerweise L1)
--   * UNTERKAPITEL — Sub-Strukturelement (L2/L3, je nach Werk-Tiefe)
--   * ABSCHNITT    — sub-pStyle-Granularität, heute noch nicht durch
--                    den DOCX-Parser exponiert; Spalte wird Phase-1-
--                    konform vorgehalten, Konsumenten in späteren
--                    Phasen.
--
-- Backward-Compat:
--   * Bestehende Konsumenten (orchestrator.listSubchapterAtoms,
--     listChapterAtoms, pipeline-status COALESCE über user_level)
--     ignorieren NULL automatisch — sie filtern auf user_level/
--     parser-level, nicht auf outline_function_type.
--   * H1/H2 sind nicht betroffen.
--
-- TO REVERT:
--   ALTER TABLE heading_classifications DROP COLUMN outline_function_type;
--   ALTER TABLE heading_classifications DROP COLUMN granularity_level;
--   ALTER TABLE heading_classifications DROP COLUMN outline_function_type_confidence;
--   ALTER TABLE heading_classifications DROP COLUMN outline_function_type_user_set;

ALTER TABLE heading_classifications
  ADD COLUMN outline_function_type TEXT
    CHECK (outline_function_type IS NULL OR outline_function_type IN (
      'EXPOSITION',
      'GRUNDLAGENTHEORIE',
      'FORSCHUNGSDESIGN',
      'DURCHFUEHRUNG',
      'EXKURS',
      'SYNTHESE',
      'SCHLUSSREFLEXION',
      'WERK_STRUKTUR'
    ));

ALTER TABLE heading_classifications
  ADD COLUMN granularity_level TEXT
    CHECK (granularity_level IS NULL OR granularity_level IN (
      'KAPITEL',
      'UNTERKAPITEL',
      'ABSCHNITT'
    ));

-- Confidence der Vor-Heuristik (0.0–1.0). NULL = nicht heuristisch
-- gesetzt (z.B. nach reinem User-Override). Das Feld existiert primär
-- für UI-Hinweise ("schwacher heuristischer Vorschlag, bitte prüfen")
-- und für spätere Telemetrie.
ALTER TABLE heading_classifications
  ADD COLUMN outline_function_type_confidence NUMERIC(3, 2)
    CHECK (outline_function_type_confidence IS NULL
        OR (outline_function_type_confidence >= 0 AND outline_function_type_confidence <= 1));

-- Marker, ob der aktuelle Funktionstyp-Wert vom User explizit gesetzt
-- wurde (true) oder nur heuristisch vorgeschlagen ist (false). UI nutzt
-- den Marker, um Vorschläge optisch von bestätigten Werten zu trennen.
ALTER TABLE heading_classifications
  ADD COLUMN outline_function_type_user_set BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_heading_class_outline_function_type
  ON heading_classifications(document_id, outline_function_type)
  WHERE outline_function_type IS NOT NULL;
