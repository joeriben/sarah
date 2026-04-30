-- Migration 031: assessment_briefs.include_formulierend toggle
--
-- The formulierend memo (textnahe Verdichtung — what is said, faithfully
-- reduced) is by default not produced anymore: the interpretierend memo,
-- when prompted to lead with a brief content-anchor, carries the gist
-- implicitly, and dropping the second memo cuts ~40% of output tokens.
--
-- But the textnahe Verdichtung is sometimes wanted — e.g. when the
-- reviewer wants an audit trail independent of the interpretation, or
-- when the use case favours a content-near reading column.
--
-- Toggle lives on the brief (not the case) because the choice is part of
-- the evaluation style, not of the individual case. A brief that says
-- "include_formulierend" produces both memos per paragraph and pays the
-- extra tokens; a brief that doesn't, gets the lean version.

ALTER TABLE assessment_briefs
  ADD COLUMN include_formulierend BOOLEAN NOT NULL DEFAULT false;
