-- Migration 028: page_from / page_to / section_kind on document_elements
--
-- page_from / page_to: page-range an element occupies in the source document.
-- DOCX path derives these from `page_marker` siblings (footer convention:
-- a textbox-rendered numeric page footer closes its own page; everything
-- between the prior marker and this one is on this marker's page).
-- annotations-export path sets page_from = page_to = the explicit page
-- number from "[Seite N]". Both columns are NULL for elements that precede
-- any page_marker (typically Roman-numbered or unnumbered front matter).
--
-- Role: pages are a citation helper for human-readable references and a
-- candidate-scoping filter for the LLM annotation resolver. They are NEVER
-- the primary anchor for matching annotations to source content — that is
-- a semantic LLM task with page/paragraph/sentence granularity.
--
-- section_kind: structural segmentation of the source document into
-- 'front_matter', 'main', 'bibliography', 'appendix'. Derived in the DOCX
-- parser from a heading-level state machine (FRONT_MATTER_RE keeps the
-- state, BIBLIOGRAPHY_RE / APPENDIX_RE switch into terminal apparatus
-- states, the first non-apparatus heading promotes front_matter → main).
-- Lets the hermeneutics pipeline filter to the main body without dragging
-- title pages, TOC, and bibliographies into per-paragraph LLM analysis.

ALTER TABLE document_elements ADD COLUMN page_from INT;
ALTER TABLE document_elements ADD COLUMN page_to   INT;
ALTER TABLE document_elements ADD COLUMN section_kind TEXT;

CREATE INDEX idx_elements_page_from
  ON document_elements(document_id, page_from)
  WHERE page_from IS NOT NULL;

CREATE INDEX idx_elements_section_kind
  ON document_elements(document_id, section_kind)
  WHERE section_kind IS NOT NULL;
