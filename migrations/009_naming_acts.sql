-- Unify naming_inscriptions + naming_designations into a single multi-dimensional stack.
-- A naming IS its stack of acts. Each act can carry changes across multiple dimensions:
-- inscription, designation, mode, valence. NULL = unchanged in that dimension.
-- The current state = latest non-NULL value per dimension.
--
-- This replaces the two separate append-only tables with one unified stack,
-- enabling mode/valence changes to be first-class naming acts alongside
-- inscription and designation changes.

------------------------------------------------------------
-- 1. CREATE naming_acts
------------------------------------------------------------

CREATE TABLE naming_acts (
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  seq BIGSERIAL,
  by UUID NOT NULL REFERENCES namings(id),  -- who/what acted: a naming, not a user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dimensions (NULL = unchanged)
  inscription TEXT,
  designation TEXT CHECK (designation IS NULL OR designation IN (
    'cue', 'characterization', 'specification'
  )),
  mode TEXT,       -- entity, relation, silence, etc.
  valence TEXT,    -- structural type for relations

  -- Context
  memo_text TEXT,
  linked_naming_ids UUID[],

  PRIMARY KEY (naming_id, seq)
);

CREATE INDEX idx_na_naming ON naming_acts(naming_id);
CREATE INDEX idx_na_by ON naming_acts(by);
CREATE INDEX idx_na_naming_seq ON naming_acts(naming_id, seq);

------------------------------------------------------------
-- 2. MIGRATE data: interleave inscriptions + designations by created_at
------------------------------------------------------------

INSERT INTO naming_acts (naming_id, by, created_at, inscription, designation)
SELECT
  naming_id, by, created_at,
  inscription,  -- inscription dimension
  NULL          -- designation unchanged
FROM naming_inscriptions
UNION ALL
SELECT
  naming_id, by, created_at,
  NULL,         -- inscription unchanged
  designation   -- designation dimension
FROM naming_designations
ORDER BY created_at, naming_id;

------------------------------------------------------------
-- 3. DROP old tables
------------------------------------------------------------

DROP TABLE naming_inscriptions;
DROP TABLE naming_designations;
