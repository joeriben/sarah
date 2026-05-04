// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telemetrie-Hook für Self-Healing JSON/Prose-Pipeline. Wird von
// runJsonCallWithRepair und runProseCallWithRepair aufgerufen.
// Fire-and-forget: ein Insert-Fehler darf den Pipeline-Call niemals blockieren.

import { query } from '../db/index.js';
import type { TokenUsage } from './json-extract.js';
import type { Provider } from './client.js';

export interface PipelineCallLogEntry {
	module: string;
	modelKey: string;
	provider: Provider;
	parseStrategy: 'json' | 'prose';
	stagesUsed: string[];
	stagesPerAttempt: string[][];
	retries: number;
	attempts: number;
	success: boolean;
	wallSeconds: number;
	tokens: TokenUsage;
	caseId?: string | null;
	paragraphId?: string | null;
	errorStage?: string | null;
	errorMessage?: string | null;
}

export function logPipelineCall(entry: PipelineCallLogEntry): void {
	// Fire-and-forget. Catch all errors and log a warning — telemetry must never
	// break the pipeline call.
	query(
		`INSERT INTO pipeline_call_log
			(module, model_key, provider, parse_strategy, stages_used, stages_per_attempt,
			 retries, attempts, success, wall_seconds, tokens, case_id, paragraph_id,
			 error_stage, error_message)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)`,
		[
			entry.module,
			entry.modelKey,
			entry.provider,
			entry.parseStrategy,
			JSON.stringify(entry.stagesUsed),
			JSON.stringify(entry.stagesPerAttempt),
			entry.retries,
			entry.attempts,
			entry.success,
			entry.wallSeconds,
			JSON.stringify(entry.tokens),
			entry.caseId ?? null,
			entry.paragraphId ?? null,
			entry.errorStage ?? null,
			entry.errorMessage ? entry.errorMessage.slice(0, 2000) : null,
		]
	).catch((err) => {
		console.warn(
			`[pipeline-call-log] insert failed for module=${entry.module}: ${err instanceof Error ? err.message : String(err)}`
		);
	});
}
