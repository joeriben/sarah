-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 053: paragraph_einwand_iterations — Audit-Persistenz für die
-- selbstkorrigierende H4-Heuristik (Einwand-Schleife zwischen H1- und
-- H2-Tools, siehe docs/architecture/10-pipeline-h4.md).
--
-- Konzept (kurz):
-- H4 ist eine eigenständige Heuristik (parallel zu H1/H2/H3), die H1- und
-- H2-Pass-Funktionen als Tools per Verweis aufruft. Pro Hauptlinien-¶ läuft
-- nach H1 (argumentation_graph + argument_validity) und H2 (paragraph_synthetic,
-- v1) ein Trigger-Check auf den H1-Argumenten. Bei Trigger fires
-- (validity.carries=false ∨ referential_grounding ∈ {namedropping, abstract}
-- ∨ contradicts-Edge im ¶) formuliert H2 einen Einwand an H1, H1 reevaluiert
-- stateless, ggf. mit Mini-Stufe-3-Recherche durch H2 vorab (simulated_expert-
-- Slot). Schleife max 3 Iterationen.
--
-- Diese Tabelle persistiert jede Iteration tief: vollständiger Einwand-Text,
-- Simulated-Expert-Q/A (falls H2 Mini-Stufe-3 konsultiert hat), H1's revidierte
-- Felder + Begründung, Status der Iteration. Tiefe Persistenz dient Debugging
-- und empirischer Auswertung der Schleife (Konvergenz-Quoten, häufige
-- Trigger-Cluster, Mini-Stufe-3-Hit-Rate, Stand-off-Pattern).
--
-- Status-Semantik pro Iteration:
--   'pending'    — Iteration begonnen, H1-Response noch nicht vorliegend
--                  oder noch nicht ausgewertet
--   'resolved'   — H1 hat reevaluiert, Trigger feuert nicht mehr nach dieser
--                  Iteration → Schleife endet hier (oder ist bereits beendet)
--   'unresolved' — H1 hat reevaluiert, Trigger feuert weiter; entweder
--                  nächste Iteration kommt (counter < 3) oder Loop bricht
--                  mit Cap (counter == 3, Iteration_n == 3)
--
-- Das Per-¶-Aggregat „letzter Status" entspricht dem Status der höchsten
-- iteration_n-Zeile pro (run_id, paragraph_element_id). Keine eigene
-- Aggregat-Tabelle — der Loop in Phase B persistiert iteration-level, der
-- per-¶-Status wird beim Reader/Indikator aus MAX(iteration_n) abgeleitet.
--
-- iteration_n ist 1-basiert (1, 2, 3). Initial-H2-Run und finaler fresh-
-- H2-Re-Run sind keine Iterationen und stehen nicht in dieser Tabelle.
--
-- trigger_clusters: JSONB-Array von Strings, z.B.
--   ["namedropping"], ["validity_failure", "contradiction"]
-- Bekannte Cluster: validity_failure, namedropping, abstract, contradiction.
-- Neue Cluster bedürfen keiner Schema-Änderung.
--
-- h1_revised_fields: JSONB-Snapshot der nach Iteration revidierten
-- argument_nodes-Felder, keyed nach argument_nodes.id oder arg_local_id.
-- Form: { "<argId>": { "referential_grounding": "concrete", "validity_…": …}}.
-- NULL falls H1 nichts revidiert hat (gleiches Ergebnis wie vorher).
--
-- simulated_expert_q/a: NULL wenn H2 in dieser Iteration keine Mini-Stufe-3-
-- Recherche aufgerufen hat. Beide gemeinsam gesetzt oder beide NULL.
-- „simulated_expert" ist bewusst ehrlich gewählt: das ist eine LLM-Antwort,
-- keine echte Fachexpertise — halluzinationsanfällig wie jede andere Modell-
-- Antwort, mit den Vor-/Nachteilen des konfigurierten Modells.
--
-- TO REVERT:
--   DROP TABLE paragraph_einwand_iterations;

CREATE TABLE paragraph_einwand_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    paragraph_element_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
    iteration_n INTEGER NOT NULL CHECK (iteration_n >= 1 AND iteration_n <= 3),

    trigger_clusters JSONB NOT NULL,

    einwand_text TEXT NOT NULL,
    simulated_expert_q TEXT,
    simulated_expert_a TEXT,

    h1_revised_fields JSONB,
    h1_begruendung TEXT,

    status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'unresolved')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    -- Pro Run+¶+Iterationsnummer eindeutig. Idempotenz beim Resume:
    -- ein bereits geschriebener (run_id, ¶, n)-Eintrag wird nicht doppelt.
    UNIQUE (run_id, paragraph_element_id, iteration_n),

    -- Q und A immer paarweise: entweder beide NULL oder beide gesetzt.
    CONSTRAINT simulated_expert_q_a_paired CHECK (
        (simulated_expert_q IS NULL AND simulated_expert_a IS NULL)
        OR (simulated_expert_q IS NOT NULL AND simulated_expert_a IS NOT NULL)
    )
);

CREATE INDEX idx_einwand_iter_run ON paragraph_einwand_iterations(run_id);
CREATE INDEX idx_einwand_iter_paragraph ON paragraph_einwand_iterations(paragraph_element_id, iteration_n);
