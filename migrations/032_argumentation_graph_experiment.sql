-- Migration 032: Argumentation-Graph experiment (opt-in, parallel to memos)
--
-- EXPERIMENTAL — explicitly NOT part of the transactional ontology.
--
-- Background: the validated per-paragraph hermeneutic pass produces a
-- *synthetic* interpretierend memo per paragraph (cumulative within the
-- subchapter, position-aware). The user's logician-side wants to test
-- probeweise whether a more *analytical* per-paragraph Argumentations-Graph
-- yields a clearer assessment surface — at the known cost of losing the
-- forward-gestural quality the synthetic memo carries.
--
-- This is a side-track, not a redesign. It runs PARALLEL to the existing
-- memos (the interpretierend memo is not touched) and is gated by an
-- opt-in brief flag. If the experiment fails, drop these two tables and
-- the brief column — no harm done elsewhere.
--
-- Why flat tables (and not namings/appearances/participations as the
-- foundations note "transactional ontology" would require): this is an
-- experimental side-track that should be cheap to remove. Wiring arguments
-- as namings would entangle them in the rest of the data graph and make
-- the rip-out painful.
--
-- TO REMOVE if the experiment is not adopted, write Migration 03X with:
--   ALTER TABLE assessment_briefs DROP COLUMN argumentation_graph;
--   DROP TABLE argument_edges;
--   DROP TABLE argument_nodes;

-- ── Brief flag ────────────────────────────────────────────────────
-- Default false → existing briefs unaffected. Flip per brief to enable
-- the additive pass.
ALTER TABLE assessment_briefs
  ADD COLUMN argumentation_graph BOOLEAN NOT NULL DEFAULT false;

-- ── Argument nodes ────────────────────────────────────────────────
-- One row per argument extracted from a paragraph. arg_local_id ("A1",
-- "A2", ...) is unique only within the paragraph; the (paragraph,
-- arg_local_id) pair is the natural key. position_in_paragraph reflects
-- the LLM-emitted ordering (1, 2, ...).
--
-- premises is a typed JSONB list:
--   [
--     { "type": "stated",     "text": "..." },
--     { "type": "carried",    "text": "...", "from_paragraph": <pos-in-subchapter> },
--     { "type": "background", "text": "..." }
--   ]
-- The typology is essential diagnostic instrumentation: if most premises
-- come back as "background", the LLM did theory-mining instead of
-- argument-extraction, and the experiment learns from that.
--
-- anchor_phrase is an optional verbatim substring of the paragraph used
-- for char-level binding; when no clean substring exists, anchor_phrase
-- stays empty and the anchor falls back to the whole paragraph (same
-- pattern as code_anchors).
CREATE TABLE argument_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paragraph_element_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
  arg_local_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  premises JSONB NOT NULL DEFAULT '[]'::jsonb,
  anchor_phrase TEXT NOT NULL DEFAULT '',
  anchor_char_start INT NOT NULL,
  anchor_char_end INT NOT NULL,
  position_in_paragraph INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paragraph_element_id, arg_local_id),
  CHECK (anchor_char_end >= anchor_char_start),
  CHECK (position_in_paragraph >= 1)
);

CREATE INDEX idx_argument_nodes_paragraph ON argument_nodes(paragraph_element_id);

-- ── Argument edges ────────────────────────────────────────────────
-- Two scopes:
--   inter_argument  — edge between two arguments in the SAME paragraph.
--                     Allowed kinds: supports, refines, contradicts.
--   prior_paragraph — edge to an argument in an EARLIER paragraph of the
--                     same subchapter. Allowed kinds: supports, refines,
--                     contradicts, presupposes.
--
-- presupposes is intentionally restricted to prior_paragraph: intra-
-- paragraph, "A presupposes B" is almost always redundant with the
-- premise modelling on A. Across paragraphs, it is the structural marker
-- the experiment most needs to detect carry-over.
CREATE TABLE argument_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id UUID NOT NULL REFERENCES argument_nodes(id) ON DELETE CASCADE,
  to_node_id   UUID NOT NULL REFERENCES argument_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  CHECK (scope IN ('inter_argument', 'prior_paragraph')),
  CHECK (
    (scope = 'inter_argument'  AND kind IN ('supports', 'refines', 'contradicts')) OR
    (scope = 'prior_paragraph' AND kind IN ('supports', 'refines', 'contradicts', 'presupposes'))
  )
);

CREATE INDEX idx_argument_edges_from ON argument_edges(from_node_id);
CREATE INDEX idx_argument_edges_to   ON argument_edges(to_node_id);
