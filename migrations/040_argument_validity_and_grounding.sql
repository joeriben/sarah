-- Migration 040: Argument-Validity + Referential-Grounding
--
-- Ergänzt zwei Argument-Qualitätsachsen, die bewusst NICHT durch die
-- Synthese-Schicht aufgehoben werden, weil sie argument-intrinsisch sind:
--
--   referential_grounding (default-on im AG-Pass)
--     Wie wird das Argument im Text textbasiert belegt?
--       'none'         — keine Referenzen.
--       'namedropping' — nur Namensnennung ohne Werkbezug.
--       'abstract'     — Werk/Theorie genannt, aber abstrakt referenziert.
--       'concrete'     — konkrete Stelle/Zitat (Autor Jahr, S. X) o.ä.
--     Pure Textanalyse, niedriges Halluzinationsrisiko, daher als
--     Pflichtfeld in den AG-Pass-Prompt integriert. Marginale Token-Kosten.
--
--   validity_assessment (opt-in via brief.validity_check)
--     Charity-First: aktiver Tragfähigkeitsnachweis (deduktiv/induktiv/
--     abduktiv) + Rationale. NUR wenn der Nachweis nicht erbracht werden
--     kann, springt das System auf die Fallacy-Auswahl um (Whitelist im
--     Prompt). JSONB-Form:
--       {
--         "carries": true|false,
--         "inference_form": "deductive"|"inductive"|"abductive"|null,
--         "rationale": "...",
--         "fallacy": null | { "type": "metabasis_eis_allo_genos", "target_premise": "P2", "explanation": "..." }
--       }
--     Hintergrund: Fallacies sind argument-intern, NICHT durch die Synthese-
--     Schicht (subchapter/chapter/work-collapse) aufgehoben — diese bewertet
--     Bewegung, nicht Schluss-Validität. Das Charity-Prinzip (positiv-
--     rekonstruktiv vor negativ-suchend) reduziert False-Positive-Risiko
--     deutlich gegenüber direkter Fallacy-Suche.
--
-- Brief-Flag validity_check steuert den optionalen separaten Pass
-- argument_validity, der NACH argumentation_graph und VOR section_collapse
-- läuft (Reihenfolge: AG → validity → section → chapter → document).
--
-- TO REVERT:
--   ALTER TABLE assessment_briefs DROP COLUMN IF EXISTS validity_check;
--   ALTER TABLE argument_nodes    DROP COLUMN IF EXISTS validity_assessment;
--   ALTER TABLE argument_nodes    DROP COLUMN IF EXISTS referential_grounding;

ALTER TABLE argument_nodes
  ADD COLUMN IF NOT EXISTS referential_grounding TEXT
    CHECK (referential_grounding IS NULL
        OR referential_grounding IN ('none', 'namedropping', 'abstract', 'concrete'));

ALTER TABLE argument_nodes
  ADD COLUMN IF NOT EXISTS validity_assessment JSONB;

ALTER TABLE assessment_briefs
  ADD COLUMN IF NOT EXISTS validity_check BOOLEAN NOT NULL DEFAULT false;

-- Index für die opt-in Pass-Done-Berechnung: Argumente eines ¶ ohne
-- validity_assessment finden. NULL-Filter macht den Index extrem schmal,
-- weil opt-in: bei deaktiviertem validity_check ist alles NULL.
CREATE INDEX IF NOT EXISTS idx_argument_nodes_validity_pending
  ON argument_nodes (paragraph_element_id)
  WHERE validity_assessment IS NULL;
