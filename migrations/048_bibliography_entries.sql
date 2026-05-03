-- Migration 048: bibliography_entries — strukturierte Werk-Bibliografie
--
-- Konzeptioneller Hintergrund: docs/h3_grundlagentheorie_parsing_strategy.md.
--
-- Die GRUNDLAGENTHEORIE-Heuristik braucht eine kanonische Werk-Liste am
-- Werk-Ende, gegen die Inline-Citations aus den Theorie-Containern
-- aufgelöst werden können. Cross-Referenz Author+Jahr ergibt Coverage-
-- Befunde (orphan citations = im Text zitiert, nicht im Verzeichnis) und
-- erlaubt, primäre vs. sekundäre Verweise auf Bibliografie-Ebene
-- nachzuhalten.
--
-- Befüllung erfolgt deterministisch (Heading-Text-Match auf
-- "Literaturverzeichnis|Literatur|Bibliografie|…" + Eintrags-Split +
-- Author/Year-Regex). KEIN LLM in dieser Stufe — Werk-Typ-Klassifikation
-- (Buch/Aufsatz/Dissertation/online) ist explizit NICHT Aufgabe dieser
-- Tabelle, sondern eines separaten Quellenverzeichnis-Passes (anderes
-- Feature, andere Roadmap-Position).
--
-- paragraph_element_id verlinkt den DOCX-Paragraph, dem der Eintrag
-- entspringt — Erstwurf-Annahme: ein Paragraph = ein Eintrag. Falls
-- mehrere Paragraphs zu einem Eintrag zusammengezogen werden müssen
-- (z.B. Zeilenumbrüche in der Vorlage), nimmt der Extractor das erste
-- als Anker, raw_text trägt den vollen Eintrag.
--
-- first_author_lastname und year sind NULLable: wenn der deterministische
-- Parser einen Eintrag nicht zerlegen kann, bleibt der Rohtext erhalten
-- und ist als "unparsed entry" sichtbar — Coverage-Befund später möglich.
--
-- Backward-Compat: neue Tabelle, kein bestehender Pfad konsumiert sie.
--
-- TO REVERT:
--   DROP TABLE bibliography_entries;

CREATE TABLE bibliography_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  paragraph_element_id UUID REFERENCES document_elements(id) ON DELETE SET NULL,
  char_start INT NOT NULL,
  char_end INT NOT NULL,
  raw_text TEXT NOT NULL,

  -- Deterministische Felder, NULLable wenn Parser den Eintrag nicht zerlegt.
  first_author_lastname TEXT,
  year TEXT,
  year_suffix TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bibliography_entries_case ON bibliography_entries(case_id);
CREATE INDEX idx_bibliography_entries_document ON bibliography_entries(document_id);
CREATE INDEX idx_bibliography_entries_author_year ON bibliography_entries(first_author_lastname, year);
