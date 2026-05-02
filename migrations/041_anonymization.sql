-- Migration 041: Document-Anonymisierung
--
-- Zwei Use Cases laut project_anonymization.md:
--   UC1 (alles außer Peer-Review) — deterministisch, algorithmisch.
--   UC2 (Peer-Review-Artikel)     — LLM-assistiert.
-- Beide Pfade nutzen dieselbe Persistenz-Schicht.
--
-- Architektur-Prinzip (User-Setzung 2026-05-02):
--   Failsafe ZUERST, dann harte Anonymisierung.
--   "Wenn da noch Klarnamen in der DB sind, ist immer unklar, ob die wirklich
--    wirksam gegen das LLM geschützt sind."
--
-- Konsequenz:
--   document_content.full_text und document_elements.content werden bei
--   anonymization_status='applied' DESTRUKTIV überschrieben. Originale
--   verbleiben ausschließlich in der Quelldatei im File-Storage (DOCX), die
--   für externe LLM-Calls nicht mehr herangezogen wird.
--
--   namings.inscription wird ebenfalls überschrieben (Pattern
--   {Type}_{YYYY-MM-DD}_{TitleWord}.{ext}); der originale Dateiname landet
--   in document_content.original_filename als lokale Referenz.
--
-- document_pii_seeds bleibt DAUERHAFT bestehen, auch nach abgeschlossener
-- Überschreibung — die Seeds sind die Tripwire-Grundlage des Failsafe-
-- Wrappers in src/lib/server/ai/failsafe.ts: vor jedem Outbound-Call an
-- einen Non-DSGVO-Provider werden alle aktiven Seeds gegen die Payload
-- gescant; ein Treffer blockt den Call.
--
-- TO REVERT:
--   DROP TABLE IF EXISTS document_pii_seeds;
--   ALTER TABLE document_content DROP COLUMN IF EXISTS original_filename;
--   ALTER TABLE document_content DROP COLUMN IF EXISTS anonymized_at;
--   ALTER TABLE document_content DROP COLUMN IF EXISTS anonymization_status;

ALTER TABLE document_content
  ADD COLUMN IF NOT EXISTS anonymization_status TEXT
    CHECK (anonymization_status IS NULL
        OR anonymization_status IN ('applied', 'skipped_already_redacted', 'no_candidates', 'failed')),
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_filename TEXT;

-- Persistente PII-Seed-Liste pro Dokument. Tabellen-Form (statt JSONB-
-- Spalte) gewählt wegen:
--   – CASCADE-Cleanup bei Dokument-Delete kommt automatisch
--   – Audit-fähige Einzelzeilen mit Source-Annotation und Created-Timestamp
--   – Index auf document_id für schnellen Per-Doc-Lookup im Failsafe-Wrapper
CREATE TABLE IF NOT EXISTS document_pii_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  -- Klassifikation des Seeds — bestimmt Replacement-Schema und ggf. Skip-
  -- Verhalten (z.B. eigener Forschungsprojekt-Name in UC2).
  category TEXT NOT NULL CHECK (category IN (
    'person_name',
    'email',
    'matrikel',
    'student_id',
    'institution',
    'project',
    'self_citation'
  )),

  -- Rolle der Person (nur bei category='person_name' relevant).
  role TEXT CHECK (role IS NULL OR role IN (
    'author',
    'supervisor',
    'examiner',
    'subject',
    'other'
  )),

  -- Originalwert wie im Dokument gefunden. Bleibt nach harter
  -- Überschreibung erhalten, weil er ausschließlich hier persistent ist
  -- und nicht mehr in full_text/element.content zu finden sein darf.
  value TEXT NOT NULL,

  -- Normalisierte Schreibvarianten, die der Failsafe ebenfalls scannen muss.
  -- Beispiel: value='Max Mustermann' →
  --   variants={'Mustermann, Max', 'M. Mustermann', 'Mustermann'}
  variants TEXT[] NOT NULL DEFAULT '{}',

  -- Vergebener Platzhalter im überschriebenen Text, z.B. '[NAME_001]'.
  replacement TEXT NOT NULL,

  -- Wo wurde dieser Seed extrahiert? Erlaubt later debugging /
  -- Heuristik-Tuning.
  source TEXT NOT NULL CHECK (source IN (
    'frontmatter_label',
    'regex_email',
    'regex_matrikel',
    'regex_student_id',
    'llm_assisted'
  )),

  -- Aktiv-Flag für den Failsafe. Aktuell immer true; reserviert für
  -- spätere User-Überschreibung ("dieser Seed war ein False-Positive").
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pii_seeds_document
  ON document_pii_seeds(document_id);

-- Verhindert Duplikate beim Re-Run der Anonymisierung: gleiches Doc +
-- gleicher Wert in gleicher Kategorie ⇒ ein Eintrag.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pii_seeds_doc_category_value
  ON document_pii_seeds(document_id, category, value);
