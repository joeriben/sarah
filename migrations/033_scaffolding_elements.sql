-- Migration 033: Scaffolding elements — text-organisational / didactic /
-- contextualising / rhetorical fragments registered IN SERVICE OF arguments.
--
-- EXPERIMENTAL — extension of the argumentation_graph experiment (032).
--
-- Background: the per-paragraph analytical pass (032) returns args=[] for
-- paragraphs that are not primarily argumentative — transitions, recaps,
-- citation strings, didactic illustrations. The user's framing distinguishes
-- two evaluation layers:
--
--   Layer 1 — argumentative-scientific stringency (arguments + edges).
--   Layer 2 — textual / didactic clarity (transitions, recaps, citations,
--             rhetorical asides, contextualising remarks).
--
-- Layer 2 is registered as **scaffolding_elements** but anchored *zwingend*
-- to at least one Layer-1 argument. This enforces the user's principle that
-- text-organisational quality is not evaluable on its own — only as service
-- to argumentative substance ("transition X is suitable to make A1 → A2 → A3
-- more comprehensible").
--
-- Concretely: a scaffolding entry registers a text excerpt with
--   function_type — one of the four user umbrella categories
--   function_description — narrative ("Beleg von §3:A2", "Übergang zu §4")
--   assessment — narrative evaluation in light of the served arguments
-- and is linked many-to-many to argument_nodes via scaffolding_anchors.
--
-- Anchored arguments must already exist at extraction time — the pass runs
-- in subchapter forward order, so anchors point to args in the same paragraph
-- or in earlier paragraphs of the same subchapter. Forward references would
-- require the FFN/Backprop-style retrograde pass (Direction 1), not yet built.
--
-- TO REMOVE if the experiment is not adopted, write a reverse migration:
--   DROP TABLE scaffolding_anchors;
--   DROP TABLE scaffolding_elements;

-- ── Scaffolding elements ──────────────────────────────────────────
CREATE TABLE scaffolding_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paragraph_element_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
  element_local_id TEXT NOT NULL,           -- "S1", "S2", ... unique within paragraph
  excerpt TEXT NOT NULL,                    -- the actual text fragment (verbatim or trimmed quote)
  function_type TEXT NOT NULL CHECK (function_type IN (
    'textorganisatorisch',
    'didaktisch',
    'kontextualisierend',
    'rhetorisch'
  )),
  function_description TEXT NOT NULL,       -- "Beleg von §3:A2", "Übergang zu §4", etc.
  assessment TEXT NOT NULL,                 -- "bedingt plausibel", "klar wirksam", etc.
  anchor_phrase TEXT NOT NULL DEFAULT '',   -- short verbatim substring for char-binding (≤ excerpt)
  anchor_char_start INT NOT NULL,           -- falls back to whole-paragraph if anchor_phrase empty / unmatched
  anchor_char_end INT NOT NULL,
  position_in_paragraph INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (paragraph_element_id, element_local_id),
  CHECK (anchor_char_end >= anchor_char_start),
  CHECK (position_in_paragraph >= 1)
);

CREATE INDEX idx_scaffolding_paragraph ON scaffolding_elements(paragraph_element_id);

-- ── Scaffolding anchors (m:n to argument_nodes) ───────────────────
-- Pflicht-Anker: the application layer enforces ≥ 1 anchor per scaffolding
-- element (via the run-time validator). DB level cannot enforce a min-1
-- relation cleanly, so the loader rejects orphans before insert.
CREATE TABLE scaffolding_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scaffolding_id UUID NOT NULL REFERENCES scaffolding_elements(id) ON DELETE CASCADE,
  argument_id    UUID NOT NULL REFERENCES argument_nodes(id)        ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scaffolding_id, argument_id)
);

CREATE INDEX idx_scaffolding_anchors_scaffolding ON scaffolding_anchors(scaffolding_id);
CREATE INDEX idx_scaffolding_anchors_argument    ON scaffolding_anchors(argument_id);
