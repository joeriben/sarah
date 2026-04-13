-- Add a JSONB properties bag to projects for per-project settings:
-- AI modes (cowork reactive on/off, autonoma enabled), feature toggles,
-- anything that doesn't deserve its own column yet. Same pattern we use
-- on appearances and elsewhere.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}';
