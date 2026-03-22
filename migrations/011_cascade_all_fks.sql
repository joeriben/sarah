-- Fix FK constraints that prevent project deletion via CASCADE.
-- All namings-referencing FKs need ON DELETE CASCADE so that
-- DELETE FROM projects WHERE id = X cascades cleanly through all tables.

-- naming_acts.by → namings (researcher/AI who performed the act)
ALTER TABLE naming_acts DROP CONSTRAINT naming_acts_by_fkey;
ALTER TABLE naming_acts ADD CONSTRAINT naming_acts_by_fkey
  FOREIGN KEY (by) REFERENCES namings(id) ON DELETE CASCADE;

-- appearances.directed_from → namings
ALTER TABLE appearances DROP CONSTRAINT appearances_directed_from_fkey;
ALTER TABLE appearances ADD CONSTRAINT appearances_directed_from_fkey
  FOREIGN KEY (directed_from) REFERENCES namings(id) ON DELETE CASCADE;

-- appearances.directed_to → namings
ALTER TABLE appearances DROP CONSTRAINT appearances_directed_to_fkey;
ALTER TABLE appearances ADD CONSTRAINT appearances_directed_to_fkey
  FOREIGN KEY (directed_to) REFERENCES namings(id) ON DELETE CASCADE;

-- phase_memberships.by → namings
ALTER TABLE phase_memberships DROP CONSTRAINT phase_memberships_by_fkey;
ALTER TABLE phase_memberships ADD CONSTRAINT phase_memberships_by_fkey
  FOREIGN KEY (by) REFERENCES namings(id) ON DELETE CASCADE;

-- ai_interactions.naming_id → namings (nullable, but should cascade)
ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_naming_id_fkey;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_naming_id_fkey
  FOREIGN KEY (naming_id) REFERENCES namings(id) ON DELETE CASCADE;

-- namings.created_by → users (SET NULL on user deletion, not block)
ALTER TABLE namings DROP CONSTRAINT namings_created_by_fkey;
ALTER TABLE namings ADD CONSTRAINT namings_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- projects.created_by → users (SET NULL on user deletion)
ALTER TABLE projects DROP CONSTRAINT projects_created_by_fkey;
ALTER TABLE projects ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
