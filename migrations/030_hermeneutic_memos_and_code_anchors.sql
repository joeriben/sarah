-- Migration 030: Hermeneutic memo typology and in-vivo code anchors
--
-- Extends memo_content with the operation typology and the structural scope
-- needed by the sequential hermeneutic pipeline. Adds code_anchors to bind
-- in-vivo code namings to precise char ranges in document_elements.
--
-- The three memo types correspond to the three operations of the per-paragraph
-- pass and the section-level synthesis:
--
--   formulierend     — semantic compression: what the paragraph says.
--                      Anchored at paragraph scope.
--
--   interpretierend  — position-aware reflection: what the paragraph DOES
--                      against the backdrop of the subchapter's progression
--                      so far. Cumulative within the subchapter; the chain
--                      of prior interpretierende memos is the interpretive
--                      context for the next paragraph.
--                      Anchored at paragraph scope.
--
--   kontextualisierend — section-level synthesis: contribution of the
--                        subchapter / chapter / whole work to the parent
--                        unit's argumentative arc. Produced by a collapse
--                        pass when sequential reading crosses a section
--                        boundary. Anchored at subchapter / chapter / work
--                        scope.
--
-- scope_element_id ties each memo to the document_element it analyzes.
-- scope_level is redundant with the element's role but indexed for fast
-- scope-typed retrieval ("all kontextualisierend memos at chapter level").
--
-- code_anchors carries the precise char-range cuts for in-vivo codes.
-- A code is itself a naming (kind via inscription/properties); the memo↔code
-- relationship rides on the existing participations table; only the textual
-- anchor lives here. A code can have multiple anchors (the same in-vivo
-- formulation occurring in several places).

ALTER TABLE memo_content ADD COLUMN memo_type TEXT
  CHECK (memo_type IN ('formulierend', 'interpretierend', 'kontextualisierend'));

ALTER TABLE memo_content ADD COLUMN scope_element_id UUID
  REFERENCES document_elements(id) ON DELETE CASCADE;

ALTER TABLE memo_content ADD COLUMN scope_level TEXT
  CHECK (scope_level IN ('paragraph', 'subchapter', 'chapter', 'work'));

CREATE INDEX idx_memo_content_scope_element
  ON memo_content(scope_element_id)
  WHERE scope_element_id IS NOT NULL;

CREATE INDEX idx_memo_content_type_level
  ON memo_content(memo_type, scope_level)
  WHERE memo_type IS NOT NULL;

CREATE TABLE code_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  element_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
  char_start INT NOT NULL,
  char_end INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_end >= char_start)
);

CREATE INDEX idx_code_anchors_code ON code_anchors(code_naming_id);
CREATE INDEX idx_code_anchors_element ON code_anchors(element_id);
