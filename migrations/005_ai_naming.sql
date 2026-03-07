-- AI as naming in the data space.
-- Parallel to researcher_namings: bridges the AI system to a naming identity.
-- The AI's acts (suggestions, analyses) are naming acts with by = ai_naming_id.
-- One AI naming per project, auto-created on first AI act.

CREATE TABLE ai_namings (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id)
);
