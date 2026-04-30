-- Migration 035: User-Validierung der Heading-Hierarchie
--
-- Der DOCX-Parser leitet die Heading-Hierarchie aus numPr/ilvl + pStyle ab
-- (Migration 034) und berechnet eine synthetische Numerierung. Bei
-- PDF→DOCX-Konvertierungen kommen aber regelmäßig Edge-Cases vor — Headings
-- ohne <w:hyperlink anchor>, gequetschte ilvl, fehlende TOC-Einträge — die
-- in heuristischer Form nicht generell robust gefixt werden können.
--
-- Statt heuristischer Reparatur in der Parser-Schicht wandert die
-- Hierarchie-Klärung in eine User-Validierungs-Schicht: vor dem Pipeline-Start
-- bestätigt oder korrigiert der User die Outline. Korrekturen leben in
-- heading_classifications und überleben Re-Imports (über soft-anchor auf
-- normalisierten Heading-Text + ungefährer char_start), weil reparseDocument
-- alle document_elements per CASCADE löscht.
--
-- Werk-Level-Status outline_status auf document_content gateway-blockiert
-- alle weiteren Pipeline-Schritte (per-Paragraph, Subkapitel-Collapse,
-- Chapter-Collapse), bis der User die Outline bestätigt hat.

CREATE TABLE heading_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  -- Hard binding: aktuelles document_element. SET NULL bei Re-Import,
  -- danach via re-anchor (heading_text_normalized + approx_char_start) neu
  -- gesetzt.
  element_id UUID REFERENCES document_elements(id) ON DELETE SET NULL,

  -- Soft anchor — überlebt Re-Imports.
  heading_text_normalized TEXT NOT NULL,  -- collapse whitespace + casefold
  approx_char_start INT NOT NULL,

  -- Override-Felder. NULL = Parser-Wert akzeptiert.
  user_level INT CHECK (user_level >= 1 AND user_level <= 9),
  user_text TEXT,                         -- editierter Heading-Text
  user_position INT,                      -- ordnet innerhalb derselben Level-Ebene; null = Reihenfolge nach char_start
  excluded BOOLEAN NOT NULL DEFAULT false, -- "als Nicht-Hauptkapitel markieren"

  -- Slot für Direction-3 (chapter_type) — UI später; Spalte jetzt anlegen
  -- vermeidet Migration 036 für dieselbe Logik-Ebene.
  user_chapter_type TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (document_id, heading_text_normalized, approx_char_start)
);

CREATE INDEX idx_heading_class_document ON heading_classifications(document_id);
CREATE INDEX idx_heading_class_element ON heading_classifications(element_id)
  WHERE element_id IS NOT NULL;

ALTER TABLE document_content
  ADD COLUMN outline_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (outline_status IN ('pending', 'confirmed'));

ALTER TABLE document_content
  ADD COLUMN outline_confirmed_at TIMESTAMPTZ;

ALTER TABLE document_content
  ADD COLUMN outline_confirmed_by UUID REFERENCES users(id);
