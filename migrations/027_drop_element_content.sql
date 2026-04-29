-- SARAH migration 027: drop document_elements.content
--
-- The text of any element is its slice of the document's full_text:
--   substring(document_content.full_text FROM e.char_start + 1
--             FOR e.char_end - e.char_start)
--
-- Storing it in document_elements.content was a pure duplication and
-- forced container elements (paragraph, table, figure) into a
-- "content IS NULL by convention" anti-pattern. Dropping the column
-- removes the duplication and the conditional-NULL smell in one step.
--
-- Surviving consumers were updated to load substring against full_text
-- (parsers, embed-elements, embedding-queries, status route, document
-- list/detail loaders, upload count).

ALTER TABLE document_elements DROP COLUMN content;
