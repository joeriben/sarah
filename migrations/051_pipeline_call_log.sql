-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 051: pipeline_call_log — Telemetrie für Self-Healing-JSON/Prose-
-- Pipeline. Jeder LLM-Call durch runJsonCallWithRepair oder runProseCallWithRepair
-- protokolliert hier seine Repair-Stages, Retries und Token-Usage. Damit lässt
-- sich nachträglich auswerten:
--   - welches Modul wie oft Layer-A-Repair greift (typographic-quote,
--     jsonrepair, brace-trim)
--   - welches Modul wie oft Layer-B-Retry braucht (LLM repariert sich selbst
--     nach Fehlerfeedback)
--   - ob bestimmte Modelle oder Quelltext-Patterns Korrelate sind
--
-- Insert ist non-blocking (fire-and-forget mit catch-and-warn) — Telemetrie
-- darf den Pipeline-Call niemals blockieren.
--
-- TO REVERT:
--   DROP TABLE IF EXISTS pipeline_call_log;

CREATE TABLE pipeline_call_log (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	module          text NOT NULL,            -- 'section-collapse', 'per-paragraph', etc
	model_key       text NOT NULL,            -- e.g. 'claude-sonnet-4.6'
	provider        text NOT NULL,            -- e.g. 'openrouter'
	parse_strategy  text NOT NULL CHECK (parse_strategy IN ('json', 'prose')),
	stages_used     jsonb NOT NULL,           -- ['brace-trim','jsonrepair','retry-1:JSON.parse-fail',...]
	stages_per_attempt jsonb NOT NULL,        -- [[stages-attempt-0], [stages-attempt-1], ...]
	retries         int NOT NULL DEFAULT 0,
	attempts        int NOT NULL DEFAULT 1,
	success         boolean NOT NULL,
	wall_seconds    numeric NOT NULL,
	tokens          jsonb NOT NULL,           -- { input, output, cacheRead, cacheCreation, total }
	case_id         uuid,                     -- optional context, nullable
	paragraph_id    uuid,                     -- optional context, nullable
	error_stage     text,                     -- only populated on failure
	error_message   text,                     -- only populated on failure
	created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_call_log_module_created ON pipeline_call_log (module, created_at DESC);
CREATE INDEX idx_pipeline_call_log_success ON pipeline_call_log (success, created_at DESC);
CREATE INDEX idx_pipeline_call_log_case ON pipeline_call_log (case_id) WHERE case_id IS NOT NULL;
