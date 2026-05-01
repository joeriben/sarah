-- Migration 038: pipeline_runs — State-Persistenz für orchestrierte Pipeline-Läufe
--
-- Bisher wurden Pipeline-Pässe (per-Absatz-Hermeneutik, Argumentations-Graph,
-- Section-/Chapter-/Document-Collapse) entweder ad hoc per CLI-Skript
-- (`scripts/run-*.ts`) oder per Einzelaufruf an
-- `/api/cases/[caseId]/hermeneutic/paragraph/<id>` angestoßen. Es gab keinen
-- orchestrierenden UI-Pfad, der einen kompletten Lauf in der korrekten
-- Reihenfolge durchziehen, anhalten oder fortsetzen kann.
--
-- Diese Migration legt die State-Tabelle für Pipeline-Läufe an. Die Tabelle
-- hält für jeden Case-Run einen einzelnen Status-Datensatz (sequentiell, ein
-- aktiver Run pro Case max.) und persistiert genug Information, dass:
--
--   * der Run nach UI-Disconnect oder Server-Restart fortgesetzt werden kann,
--   * eine User-getriggerte Pause graceful im nächsten Step-Check greift,
--   * der Status auch ohne SSE-Stream (Polling-Fallback / Page-Reload)
--     ablesbar bleibt.
--
-- Idempotenz der unterliegenden Pässe (skip-on-existing in
-- per-paragraph.ts / argumentation-graph.ts / section-collapse-from-graph.ts /
-- chapter-collapse.ts / document-collapse.ts) ist die Grundlage des
-- Resume-Mechanismus: ein abgebrochener Run wird durch einen neuen Run
-- fortgesetzt, indem der Orchestrator dieselbe Phase-Reihenfolge nochmal
-- durchläuft und je Atom überspringt, was schon persistiert ist.
--
-- Phasen (in Reihenfolge):
--   1. argumentation_graph — alle ¶ des zentralen Dokuments
--   2. section_collapse    — alle Subkapitel (Aggregations-Level adaptiv L2/L3)
--   3. chapter_collapse    — alle Hauptkapitel (L1)
--   4. document_collapse   — Werk-Synthese (L0)
--
-- Optional als parallel/separat angefordertes Addendum:
--   5. paragraph_synthetic — additiv-synthetisch-hermeneutische Per-¶-Memos
--      Diese Phase ist KEIN Input für die Aggregations-Pässe; sie ist ein
--      separates Addendum-Memo pro Absatz (formulierend + interpretierend),
--      das im Reader-Modal angezeigt wird, aber nicht in die analytische
--      Aggregations-Linie einfließt. Wird nur ausgeführt, wenn der Run mit
--      `options.include_synthetic = true` gestartet wurde.
--
-- Felder:
--   status:
--     'running'   — Step-Loop aktiv
--     'paused'    — User-Cancel; Resume durch erneuten Start möglich
--     'completed' — alle Phasen abgeschlossen
--     'failed'    — irrecoverabler Fehler; error_message gesetzt
--   current_phase / current_index / total_in_phase:
--     Anzeige- und Resume-Information. current_index ist 0-basiert; bei
--     Resume zählt der Orchestrator die schon erledigten Atome neu (per
--     Skip-on-existing), also dient dieser Wert primär der UI-Anzeige
--     beim ersten Reconnect, nicht als verbindlicher Resume-Pointer.
--   options:
--     JSONB { include_synthetic: bool, cost_cap_usd: number | null,
--             only_phases: string[] | null }
--   accumulated_tokens / accumulated_cost_usd:
--     laufende Aggregation aus den Pass-Returns (tokens.{input,output,
--     cacheRead}). Nicht zwingend deckungsgleich mit ai_interactions
--     (das in dieser Pipeline derzeit nicht verkabelt ist — siehe Handover).
--   cancel_requested:
--     Pause-Signal vom Client (DELETE-Endpoint setzt). Der Orchestrator
--     prüft das Flag vor jedem atomaren Step; bei true → status='paused',
--     paused_at gesetzt, Loop verlassen.
--
-- Pro Case max. 1 nicht-terminaler Run gleichzeitig: zwei aktive Runs auf
-- demselben Case würden idempotent dieselben Atome bearbeiten, aber das
-- ist Verschwendung; UI verhindert das, ein partial-unique-Index
-- erzwingt es DB-seitig.

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
    started_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed')),
    current_phase TEXT NULL,
    current_index INTEGER NOT NULL DEFAULT 0,
    total_in_phase INTEGER NULL,
    last_step_label TEXT NULL,

    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    error_message TEXT NULL,

    accumulated_input_tokens BIGINT NOT NULL DEFAULT 0,
    accumulated_output_tokens BIGINT NOT NULL DEFAULT 0,
    accumulated_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    accumulated_cost_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paused_at TIMESTAMPTZ NULL,
    resumed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_case ON pipeline_runs(case_id, started_at DESC);

-- Genau ein nicht-terminaler Run pro Case. Erlaubt aber beliebig viele
-- terminale Runs (completed/failed) für die Historie.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pipeline_runs_case_active
    ON pipeline_runs(case_id)
    WHERE status IN ('running', 'paused');
