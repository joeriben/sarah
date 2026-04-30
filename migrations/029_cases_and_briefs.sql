-- Migration 029: Cases (Begutachtungsfälle) and assessment briefs
--
-- Layered on top of the transactional ontology to encode the SARAH-specific
-- "review case" concept. Each case has an exact triadic document structure:
--   1 zentrales Dokument (the work being reviewed)
--   0..1 Annotationsdokument (reviewer's marginalia)
--   0..1 Gutachten-Rohentwurf (the review draft)
--
-- Assessment briefs carry work-type, evaluation criteria, and assessor persona.
-- They feed the cached prefix of the per-paragraph hermeneutic pipeline.
--
-- Why explicit tables rather than encoding via namings/participations:
-- the cardinality (exactly one central, at most one of each companion) is
-- a hard constraint that belongs at the schema level. Enforcing it through
-- the generic transactional layer would push it into application-side
-- validation that the database cannot guarantee. Pragmatic platform.
--
-- Cardinality:
--   1 project : N cases    — typically 1, but corpus analysis allows N
--   1 case    : 1 brief    — the brief drives the LLM pipeline for that case
--   1 project : N briefs   — a project can hold a library of briefs

CREATE TABLE assessment_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  work_type TEXT NOT NULL CHECK (work_type IN (
    'habilitation',
    'dissertation',
    'master_thesis',
    'bachelor_thesis',
    'article',
    'peer_review',
    'corpus_analysis'
  )),
  criteria TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  output_schema_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_assessment_briefs_project ON assessment_briefs(project_id);

CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,

  central_document_id UUID NOT NULL UNIQUE
    REFERENCES namings(id) ON DELETE RESTRICT,
  annotation_document_id UUID UNIQUE
    REFERENCES namings(id) ON DELETE SET NULL,
  review_draft_document_id UUID UNIQUE
    REFERENCES namings(id) ON DELETE SET NULL,

  assessment_brief_id UUID
    REFERENCES assessment_briefs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_cases_project ON cases(project_id);
CREATE INDEX idx_cases_brief ON cases(assessment_brief_id);
