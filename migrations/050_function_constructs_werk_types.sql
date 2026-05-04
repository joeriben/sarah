-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 050: function_constructs.outline_function_type um Werk-Aggregat-
-- Typen erweitern. WERK_DESKRIPTION und WERK_GUTACHT sind keine Heading-
-- Funktionstypen (h3-vocabulary.ts unverändert), sondern werk-aggregierte
-- Konstrukte — daher werden sie nur in dieser Tabelle, nicht in
-- heading_classifications.outline_function_type benötigt.
--
-- Setzung 2026-05-04 (User): WERK_DESKRIPTION + WERK_GUTACHT (a/b/c) als
-- finale H3-Phasen werden implementiert; WERK_GUTACHT-c läuft heute mit
-- deaktiviertem Gating für Testung (review_draft-Upload kommt mit
-- UI-Roadmap-Stufe 4).
--
-- TO REVERT:
--   ALTER TABLE function_constructs DROP CONSTRAINT function_constructs_outline_function_type_check;
--   ALTER TABLE function_constructs ADD CONSTRAINT function_constructs_outline_function_type_check
--     CHECK (outline_function_type IN (
--       'EXPOSITION', 'GRUNDLAGENTHEORIE', 'FORSCHUNGSDESIGN', 'DURCHFUEHRUNG',
--       'EXKURS', 'SYNTHESE', 'SCHLUSSREFLEXION', 'WERK_STRUKTUR'
--     ));

ALTER TABLE function_constructs DROP CONSTRAINT function_constructs_outline_function_type_check;

ALTER TABLE function_constructs ADD CONSTRAINT function_constructs_outline_function_type_check
  CHECK (outline_function_type IN (
    'EXPOSITION',
    'GRUNDLAGENTHEORIE',
    'FORSCHUNGSDESIGN',
    'DURCHFUEHRUNG',
    'EXKURS',
    'SYNTHESE',
    'SCHLUSSREFLEXION',
    'WERK_STRUKTUR',
    'WERK_DESKRIPTION',
    'WERK_GUTACHT'
  ));
