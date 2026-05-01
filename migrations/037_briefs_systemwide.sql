-- Migration 037: Briefs werden systemweite Konfiguration
--
-- Korrektur einer Architektur-Setzung aus Migration 029:
--
-- Dort waren assessment_briefs an ein Projekt gebunden (project_id NOT NULL,
-- ON DELETE CASCADE). Die Lesart: jedes Projekt hält seine eigene Brief-
-- Library.
--
-- In der Praxis ist das die falsche Verortung: Briefs sind systemweite
-- Konfiguration (analog zu Provider-Settings, Personas, Bewertungsmaßstäben).
-- Sie werden vom Forscher einmal kuratiert und projektübergreifend benutzt.
-- Das Projekt ist demgegenüber nur ein organisatorischer Container für Cases
-- und vererbt allenfalls Defaults (siehe nachfolgende Falltyp-Architektur in
-- einer späteren Migration).
--
-- Konsequenzen dieser Migration:
--   - assessment_briefs.project_id wird gedroppt, der Index ebenfalls.
--   - Existierende Briefs bleiben inhaltlich unverändert; ihre Case-Bindung
--     über cases.assessment_brief_id ist von der Spalte project_id nicht
--     betroffen, der Goldstand-Habil-Brief samt Pipeline-Validität läuft
--     weiter.
--   - Das ON DELETE CASCADE auf project_id verschwindet. Wenn ein Projekt
--     gelöscht wird, bleiben Briefs erhalten (sie werden global gehalten).
--     Cases im gelöschten Projekt verlieren ihre Brief-Verbindung über das
--     bereits bestehende ON DELETE CASCADE auf cases.project_id (Migration
--     029) — die Briefs selbst aber überleben.

ALTER TABLE assessment_briefs DROP CONSTRAINT IF EXISTS assessment_briefs_project_id_fkey;
DROP INDEX IF EXISTS idx_assessment_briefs_project;
ALTER TABLE assessment_briefs DROP COLUMN IF EXISTS project_id;
