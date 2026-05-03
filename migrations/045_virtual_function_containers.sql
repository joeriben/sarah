-- Migration 045: virtual_function_containers — generische Aggregations-Container
--
-- Konzeptioneller Hintergrund: docs/h3_implementation_plan.md +
-- Memory project_three_heuristics_architecture.md
-- ("Heuristik-Container ≠ Outline-Knoten").
--
-- Funktionstyp-Heuristiken brauchen Aggregations-Einheiten, die nicht
-- 1:1 auf Outline-Knoten passen:
--   * EXPOSITION kann ein Aggregat aus mehreren Eingangs-¶ sein, die
--     keinen eigenen Heading haben.
--   * SYNTHESE kann ein Aggregat aus dem Schluss-Block eines Kapitels
--     ohne eigenen Heading sein.
--   * EXKURS kann ein Sub-Bereich innerhalb eines Kapitels sein,
--     der nicht durch einen pStyle markiert ist.
--
-- Ein virtueller Container hat:
--   * eine eigene Identität (id),
--   * einen Funktionstyp (outline_function_type),
--   * eine geordnete Liste von ¶-Bereichen (source_anchor_ranges),
--   * die zusammen den Container-Inhalt definieren.
--
-- source_anchor_ranges-Form (JSONB array, mind. 1 Eintrag):
--   [
--     { "element_id": "<UUID>", "start_seq": <int>, "end_seq": <int> },
--     ...
--   ]
-- element_id zeigt typischerweise auf einen Heading; start_seq/end_seq
-- klammern den Bereich der ¶ bzw. Sub-Headings, die zum Container
-- gehören. Mehrere Einträge erlauben diskontinuierliche Bereiche
-- (selten, aber notwendig z.B. für EXPOSITION = "Vorwort + Einleitung").
--
-- Verhältnis zu Outline-Knoten:
--   * Wenn ein Funktionstyp 1:1 auf einen Outline-Knoten passt, wird
--     der Funktionstyp direkt an heading_classifications.outline_function_type
--     gesetzt (Migration 044) — KEIN virtueller Container nötig.
--   * Virtuelle Container kommen nur dort, wo der Funktionstyp NICHT
--     auf einen Outline-Knoten passt (Aggregat, Sub-Bereich, mehrere
--     Outline-Knoten).
--
-- Verhältnis zu function_constructs (Migration 043):
--   function_constructs.virtual_container_id ist die Rückreferenz —
--   ein Konstrukt kann optional einem Container zugeordnet sein
--   (statt direkt einem Outline-Knoten via anchor_element_ids).
--   FK wird in dieser Migration nachgezogen.
--
-- Backward-Compat / Abstraction-Layer:
--   * Tabelle ist neu — H1/H2 lesen sie heute nicht.
--   * Perspektivisch (siehe BC-Präzisierung in
--     docs/h3_implementation_status.md) kann ein gemeinsamer
--     Abstraction-Layer in der Pipeline-Atom-Listung Outline-Knoten
--     UND virtuelle Container vereinheitlichen, sodass H1/H2/H3
--     auf derselben generischen Atom-Schnittstelle laufen. Das ist
--     keine Phase-1-Änderung, aber das Schema ermöglicht sie.
--
-- TO REVERT:
--   ALTER TABLE function_constructs
--     DROP CONSTRAINT function_constructs_virtual_container_fkey;
--   DROP TABLE virtual_function_containers;

CREATE TABLE virtual_function_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  outline_function_type TEXT NOT NULL CHECK (outline_function_type IN (
    'EXPOSITION',
    'GRUNDLAGENTHEORIE',
    'FORSCHUNGSDESIGN',
    'DURCHFUEHRUNG',
    'EXKURS',
    'SYNTHESE',
    'SCHLUSSREFLEXION',
    'WERK_STRUKTUR'
  )),

  granularity_level TEXT
    CHECK (granularity_level IS NULL OR granularity_level IN (
      'KAPITEL',
      'UNTERKAPITEL',
      'ABSCHNITT'
    )),

  -- Optionale Bezeichnung (UI-Label) — z.B. "Einleitung + Vorwort"
  -- für einen aus mehreren Quellen aggregierten EXPOSITION-Container.
  label TEXT,

  -- Geordnete ¶-/Heading-Bereiche, die den Container ausmachen.
  -- Validierung der inneren Struktur erfolgt im Application-Layer
  -- (Schema-Check beim Insert).
  source_anchor_ranges JSONB NOT NULL,

  source_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (jsonb_typeof(source_anchor_ranges) = 'array'),
  CHECK (jsonb_array_length(source_anchor_ranges) >= 1)
);

CREATE INDEX idx_virtual_containers_case ON virtual_function_containers(case_id);
CREATE INDEX idx_virtual_containers_document ON virtual_function_containers(document_id);
CREATE INDEX idx_virtual_containers_type
  ON virtual_function_containers(document_id, outline_function_type);

-- Rückreferenz function_constructs → virtual_function_containers nachziehen.
-- In Migration 043 wurde die Spalte ohne FK angelegt, weil die Ziel-Tabelle
-- erst hier entsteht. ON DELETE SET NULL: ein gelöschter Container hebt das
-- Konstrukt nicht auf — das Konstrukt verbleibt mit seinen direkten
-- anchor_element_ids im Werk.
ALTER TABLE function_constructs
  ADD CONSTRAINT function_constructs_virtual_container_fkey
    FOREIGN KEY (virtual_container_id)
    REFERENCES virtual_function_containers(id)
    ON DELETE SET NULL;
