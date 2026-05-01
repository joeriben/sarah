// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pipeline-Status-Endpoint für die Doc-Page.
// Liefert pro hermeneutischem Pass den Erfüllungs-Stand des zentralen Dokuments
// eines Case PLUS den aktiven Run-State (oder den jüngsten terminalen Run).
// Status wird aus memo_content / argument_nodes abgeleitet — es gibt keine
// zentrale runs-Tabelle für die Atom-Stände, nur pipeline_runs für den
// Orchestrator-State (laufend/pausiert/abgeschlossen).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { getActiveRun, getLatestRun } from '$lib/server/pipeline/orchestrator.js';

interface PassStatus {
	completed: number;
	total: number | null;
	last_run: string | null;
}

interface PipelineStatus {
	case_id: string;
	document_id: string | null;
	brief: { id: string; name: string; argumentation_graph: boolean } | null;
	total_paragraphs: number;
	passes: {
		argumentation_graph: PassStatus & { enabled: boolean };
		subchapter: PassStatus;
		chapter: PassStatus;
		work: PassStatus;
		paragraph_synthetic: PassStatus;
	};
	run: {
		id: string;
		status: string;
		current_phase: string | null;
		current_index: number;
		total_in_phase: number | null;
		last_step_label: string | null;
		options: { include_synthetic?: boolean; cost_cap_usd?: number | null };
		cancel_requested: boolean;
		error_message: string | null;
		accumulated_input_tokens: number;
		accumulated_output_tokens: number;
		accumulated_cache_read_tokens: number;
		started_at: string;
		paused_at: string | null;
		completed_at: string | null;
	} | null;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { caseId } = params;
	if (!caseId) error(400, 'caseId required');

	const caseRow = await queryOne<{
		id: string;
		central_document_id: string | null;
		brief_id: string | null;
		brief_name: string | null;
		argumentation_graph: boolean | null;
	}>(
		`SELECT c.id, c.central_document_id, c.assessment_brief_id AS brief_id,
		        b.name AS brief_name, b.argumentation_graph
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.id = $1`,
		[caseId]
	);

	if (!caseRow) error(404, 'Case not found');

	const docId = caseRow.central_document_id;
	const useAg = caseRow.argumentation_graph === true;

	const empty: PassStatus = { completed: 0, total: null, last_run: null };

	const activeRun = await getActiveRun(caseId);
	const latestRun = activeRun ?? (await getLatestRun(caseId));
	const runDto = latestRun
		? {
				id: latestRun.id,
				status: latestRun.status,
				current_phase: latestRun.current_phase,
				current_index: latestRun.current_index,
				total_in_phase: latestRun.total_in_phase,
				last_step_label: latestRun.last_step_label,
				options: latestRun.options ?? {},
				cancel_requested: latestRun.cancel_requested,
				error_message: latestRun.error_message,
				accumulated_input_tokens: Number(latestRun.accumulated_input_tokens) || 0,
				accumulated_output_tokens: Number(latestRun.accumulated_output_tokens) || 0,
				accumulated_cache_read_tokens: Number(latestRun.accumulated_cache_read_tokens) || 0,
				started_at: latestRun.started_at,
				paused_at: latestRun.paused_at,
				completed_at: latestRun.completed_at,
			}
		: null;

	if (!docId) {
		const result: PipelineStatus = {
			case_id: caseId,
			document_id: null,
			brief: caseRow.brief_id
				? { id: caseRow.brief_id, name: caseRow.brief_name ?? '', argumentation_graph: useAg }
				: null,
			total_paragraphs: 0,
			passes: {
				argumentation_graph: { ...empty, enabled: useAg },
				subchapter: empty,
				chapter: empty,
				work: empty,
				paragraph_synthetic: empty,
			},
			run: runDto,
		};
		return json(result);
	}

	const totalsRow = await queryOne<{ total_paragraphs: number; total_l1: number }>(
		`SELECT
		   (SELECT COUNT(*)::int FROM document_elements
		     WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main') AS total_paragraphs,
		   (SELECT COUNT(*)::int FROM document_elements de
		     LEFT JOIN heading_classifications hc ON hc.element_id = de.id
		    WHERE de.document_id = $1
		      AND de.element_type = 'heading'
		      AND de.section_kind = 'main'
		      AND COALESCE(hc.excluded, false) = false
		      AND COALESCE(hc.user_level, (de.properties->>'level')::int) = 1) AS total_l1`,
		[docId]
	);

	const totalParagraphs = totalsRow?.total_paragraphs ?? 0;
	const totalL1 = totalsRow?.total_l1 ?? 0;

	const memoStats = await query<{
		scope_level: string;
		memo_type: string;
		completed: number;
		last_run: string | null;
	}>(
		`SELECT mc.scope_level, mc.memo_type,
		        COUNT(*)::int AS completed,
		        MAX(n.created_at) AS last_run
		 FROM memo_content mc
		 JOIN namings n ON n.id = mc.naming_id
		 LEFT JOIN document_elements de ON de.id = mc.scope_element_id
		 WHERE (de.document_id = $1)
		    OR (mc.scope_level = 'work' AND mc.naming_id IN (
		         SELECT naming_id FROM appearances
		          WHERE properties->>'document_id' = $1::text))
		 GROUP BY mc.scope_level, mc.memo_type`,
		[docId]
	);

	const find = (level: string, type: string): PassStatus => {
		const row = memoStats.rows.find((r) => r.scope_level === level && r.memo_type === type);
		return {
			completed: row?.completed ?? 0,
			total: null,
			last_run: row?.last_run ?? null,
		};
	};

	const synthPass = find('paragraph', 'interpretierend');
	synthPass.total = totalParagraphs;

	const subchapterPass = find('subchapter', 'kontextualisierend');

	const chapterPass = find('chapter', 'kontextualisierend');
	chapterPass.total = totalL1 || null;

	const workPass = find('work', 'kontextualisierend');
	workPass.total = 1;

	let agPass: PassStatus = { completed: 0, total: totalParagraphs, last_run: null };
	if (useAg) {
		// "Done" für AG-Pass: arg_nodes ODER scaffolding_elements (kongruent
		// zu listAtomsForPhase im Orchestrator, der dieselbe Skip-Bedingung
		// wie runArgumentationGraphPass übernehmen muss). Ein Absatz mit nur
		// scaffolding (z.B. rein stützender ¶ ohne eigenes Argument) ist
		// abgearbeitet, würde aber bei einer args-only-Zählung als pending
		// erscheinen — das verwirrt den User.
		const agRow = await queryOne<{ completed: number; last_run: string | null }>(
			`SELECT COUNT(DISTINCT de.id)::int AS completed,
			        MAX(GREATEST(an_max.created_at, scaff_max.created_at)) AS last_run
			 FROM document_elements de
			 LEFT JOIN LATERAL (
			   SELECT MAX(created_at) AS created_at
			   FROM argument_nodes WHERE paragraph_element_id = de.id
			 ) an_max ON true
			 LEFT JOIN LATERAL (
			   SELECT MAX(created_at) AS created_at
			   FROM scaffolding_elements WHERE paragraph_element_id = de.id
			 ) scaff_max ON true
			 WHERE de.document_id = $1
			   AND de.element_type = 'paragraph'
			   AND de.section_kind = 'main'
			   AND (an_max.created_at IS NOT NULL OR scaff_max.created_at IS NOT NULL)`,
			[docId]
		);
		agPass = {
			completed: agRow?.completed ?? 0,
			total: totalParagraphs,
			last_run: agRow?.last_run ?? null,
		};
	}

	const result: PipelineStatus = {
		case_id: caseId,
		document_id: docId,
		brief: caseRow.brief_id
			? { id: caseRow.brief_id, name: caseRow.brief_name ?? '', argumentation_graph: useAg }
			: null,
		total_paragraphs: totalParagraphs,
		passes: {
			argumentation_graph: { ...agPass, enabled: useAg },
			subchapter: subchapterPass,
			chapter: chapterPass,
			work: workPass,
			paragraph_synthetic: synthPass,
		},
		run: runDto,
	};
	return json(result);
};
