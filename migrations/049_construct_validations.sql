-- Migration 049: construct_validations — User-Schutz für H3-Konstrukte
--
-- Konzeptioneller Hintergrund: docs/h3_orchestrator_spec.md #3.
--
-- Im Orchestrator gilt clean-vor-insert pro Phase, ABER mit Schutz
-- validierter Stände: hat der User ein H3-Konstrukt explizit validiert,
-- darf ein Re-Run dieser Phase es nicht überschreiben. Diese Tabelle
-- speichert die Validierungs-Marker.
--
-- Curation-Metadaten werden bewusst von der Substanz getrennt: Memory
-- feedback_constructs_are_extracts_not_telemetry.md hält fest, dass
-- function_constructs.content nur Extrakte enthält. Validierung als
-- Curation-Akt gehört in eine eigene Tabelle.
--
-- Granularität: per construct, nicht per Phase. Der Orchestrator
-- entscheidet auf Basis dieser Marker, ob eine ganze Phase übersprungen
-- wird (typisch: Phase übersprungen, sobald ihr primäres Output-Konstrukt
-- validiert ist — Mapping siehe orchestrator-Code).
--
-- Bis das Validierungs-UI (Interface-Phase, später) existiert, werden
-- Marker manuell via SQL gesetzt.
--
-- TO REVERT:
--   DROP TABLE construct_validations;

CREATE TABLE IF NOT EXISTS construct_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    construct_id UUID NOT NULL REFERENCES function_constructs(id) ON DELETE CASCADE,

    validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NULL,

    -- Eine Validierung pro Konstrukt: Re-Validierung überschreibt den
    -- Marker (UPSERT-Verhalten am Aufrufer). Audit-Historie kann später
    -- in eine Log-Tabelle wandern, wenn das UI-Workflow das verlangt.
    CONSTRAINT uniq_construct_validation UNIQUE (construct_id)
);

CREATE INDEX IF NOT EXISTS idx_construct_validations_construct
    ON construct_validations(construct_id);

CREATE INDEX IF NOT EXISTS idx_construct_validations_validated_at
    ON construct_validations(validated_at DESC);
