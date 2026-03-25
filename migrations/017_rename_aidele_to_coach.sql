-- Rename aidele tables + indexes to coach (persona rename)
ALTER TABLE aidele_references RENAME TO coach_references;
ALTER TABLE aidele_chunks RENAME TO coach_chunks;

-- Rename indexes (PostgreSQL auto-renames constraints but not indexes)
ALTER INDEX IF EXISTS aidele_chunks_reference_id_idx RENAME TO coach_chunks_reference_id_idx;
ALTER INDEX IF EXISTS aidele_chunks_relevance_idx RENAME TO coach_chunks_relevance_idx;

-- Rename the library directory reference in any stored paths
-- (file_path column uses relative paths starting with the library dir name)
UPDATE coach_references SET text_file = REPLACE(text_file, 'aidele-library/', 'coach-library/')
WHERE text_file LIKE 'aidele-library/%';
