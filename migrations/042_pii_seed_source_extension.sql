-- Migration 042: PII-Seed-Source erweitern um 'ner_spacy' und 'regex_phone'
--
-- Architektur-Setzung 2026-05-02 (User): Personen-Erkennung läuft
-- jetzt über lokale spaCy-NER (de_core_news_lg), nicht mehr über
-- Regex-Frontmatter-Label-Heuristik. Außerdem extrahieren wir jetzt
-- Telefonnummern als eigene Kategorie.
--
-- TO REVERT:
--   ALTER TABLE document_pii_seeds DROP CONSTRAINT document_pii_seeds_source_check;
--   ALTER TABLE document_pii_seeds ADD CONSTRAINT document_pii_seeds_source_check
--     CHECK (source IN ('frontmatter_label','regex_email','regex_matrikel',
--                       'regex_student_id','llm_assisted'));
--   ALTER TABLE document_pii_seeds DROP CONSTRAINT document_pii_seeds_category_check;
--   ALTER TABLE document_pii_seeds ADD CONSTRAINT document_pii_seeds_category_check
--     CHECK (category IN ('person_name','email','matrikel','student_id',
--                         'institution','project','self_citation'));

ALTER TABLE document_pii_seeds DROP CONSTRAINT IF EXISTS document_pii_seeds_source_check;
ALTER TABLE document_pii_seeds ADD CONSTRAINT document_pii_seeds_source_check CHECK (
  source IN (
    'ner_spacy',
    'regex_email',
    'regex_matrikel',
    'regex_student_id',
    'regex_phone',
    'frontmatter_label',
    'llm_assisted'
  )
);

ALTER TABLE document_pii_seeds DROP CONSTRAINT IF EXISTS document_pii_seeds_category_check;
ALTER TABLE document_pii_seeds ADD CONSTRAINT document_pii_seeds_category_check CHECK (
  category IN (
    'person_name',
    'email',
    'matrikel',
    'student_id',
    'institution',
    'project',
    'self_citation',
    'phone'
  )
);
