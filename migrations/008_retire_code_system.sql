-- Rename code-system perspective role to grounding-workspace.
-- The grounding workspace holds orphan in-vivo codes and annotation relations.
-- It is infrastructure, not a separate analytical domain.

UPDATE appearances
SET properties = jsonb_set(properties, '{role}', '"grounding-workspace"')
WHERE naming_id = perspective_id
  AND mode = 'perspective'
  AND properties->>'role' = 'code-system';
