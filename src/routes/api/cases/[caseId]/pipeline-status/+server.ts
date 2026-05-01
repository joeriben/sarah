// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pipeline-Status-Endpoint für die Doc-Page (Stufe 2b).
// Liefert pro hermeneutischem Pass den Erfüllungs-Stand des zentralen Dokuments
// eines Case. Status wird aus memo_content / argument_nodes abgeleitet — es
// gibt keine zentrale runs-Tabelle.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';

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
		paragraph: PassStatus;
		argumentation_graph: PassStatus & { enabled: boolean };
		subchapter: PassStatus;
		chapter: PassStatus;
		work: PassStatus;
	};
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

	if (!docId) {
		const empty: PassStatus = { completed: 0, total: null, last_run: null };
		const result: PipelineStatus = {
			case_id: caseId,
			document_id: null,
			brief: caseRow.brief_id
				? { id: caseRow.brief_id, name: caseRow.brief_name ?? '', argumentation_graph: useAg }
				: null,
			total_paragraphs: 0,
			passes: {
				paragraph: empty,
				argumentation_graph: { ...empty, enabled: useAg },
				subchapter: empty,
				chapter: empty,
				work: empty,
			},
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

	const paragraphPass = find('paragraph', 'interpretierend');
	paragraphPass.total = totalParagraphs;

	const subchapterPass = find('subchapter', 'kontextualisierend');

	const chapterPass = find('chapter', 'kontextualisierend');
	chapterPass.total = totalL1 || null;

	const workPass = find('work', 'kontextualisierend');
	workPass.total = 1;

	let agPass: PassStatus = { completed: 0, total: totalParagraphs, last_run: null };
	if (useAg) {
		const agRow = await queryOne<{ completed: number; last_run: string | null }>(
			`SELECT COUNT(DISTINCT an.paragraph_element_id)::int AS completed,
			        MAX(an.created_at) AS last_run
			 FROM argument_nodes an
			 JOIN document_elements de ON de.id = an.paragraph_element_id
			 WHERE de.document_id = $1`,
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
			paragraph: paragraphPass,
			argumentation_graph: { ...agPass, enabled: useAg },
			subchapter: subchapterPass,
			chapter: chapterPass,
			work: workPass,
		},
	};
	return json(result);
};
