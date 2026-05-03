-- Migration 047: assessment_briefs.h3_enabled — H3-Pipeline opt-in pro Brief
--
-- Konzeptioneller Hintergrund: docs/h3_implementation_plan.md +
-- Memory project_three_heuristics_architecture.md (drei gleichrangige
-- Pipeline-Heuristiken H1/H2/H3) + project_pipeline_run_orchestrator.md
-- (phasesForRun-Konfiguration).
--
-- Die H3-Phasen aktivieren sich nur, wenn der Brief des Cases das Flag
-- h3_enabled=true gesetzt hat — analog zu argumentation_graph (Migration
-- 032/034) und validity_check (Migration 040).
--
-- Default false: alle bestehenden Briefs laufen unverändert mit H1
-- (+ optional H2 als synthetisches Addendum). H3 wird brief-pro-brief
-- aktiviert, wenn die zugehörigen Heuristiken implementiert und
-- validiert sind (Phase 3+).
--
-- Konsumiert wird das Flag von der zukünftigen Erweiterung in
-- src/lib/server/pipeline/orchestrator.ts (phasesForRun) — die Phase-1-
-- Implementation berührt diesen Code nicht; das Flag liegt nur als
-- Voraussetzung bereit. Bestehende phasesForRun-Logik (PHASE_ORDER_
-- ANALYTICAL + include_validity + include_synthetic) bleibt unverändert
-- und ignoriert das neue Flag automatisch.
--
-- TO REVERT:
--   ALTER TABLE assessment_briefs DROP COLUMN h3_enabled;

ALTER TABLE assessment_briefs
  ADD COLUMN h3_enabled BOOLEAN NOT NULL DEFAULT false;
