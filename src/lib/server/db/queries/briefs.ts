// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne } from '../index.js';

export const WORK_TYPES = [
	'habilitation',
	'dissertation',
	'master_thesis',
	'bachelor_thesis',
	'article',
	'peer_review',
	'corpus_analysis'
] as const;

export type WorkType = (typeof WORK_TYPES)[number];

export interface AssessmentBrief {
	id: string;
	name: string;
	work_type: WorkType;
	criteria: string;
	persona: string;
	include_formulierend: boolean;
	argumentation_graph: boolean;
	validity_check: boolean;
	output_schema_version: number;
	created_at: string;
	created_by: string | null;
}

export interface AssessmentBriefRow extends AssessmentBrief {
	case_count: number;
}

export async function listBriefs(): Promise<AssessmentBriefRow[]> {
	const r = await query<AssessmentBriefRow>(
		`SELECT b.*,
		        (SELECT COUNT(*)::int FROM cases c WHERE c.assessment_brief_id = b.id) AS case_count
		 FROM assessment_briefs b
		 ORDER BY b.created_at DESC`
	);
	return r.rows;
}

export async function getBrief(briefId: string): Promise<AssessmentBrief | null> {
	return queryOne<AssessmentBrief>(
		`SELECT * FROM assessment_briefs WHERE id = $1`,
		[briefId]
	);
}

export interface CreateBriefInput {
	name: string;
	work_type: WorkType;
	criteria?: string;
	persona?: string;
	include_formulierend?: boolean;
	argumentation_graph?: boolean;
	validity_check?: boolean;
}

export async function createBrief(
	userId: string,
	input: CreateBriefInput
): Promise<AssessmentBrief> {
	const r = await query<AssessmentBrief>(
		`INSERT INTO assessment_briefs
		   (name, work_type, criteria, persona, include_formulierend, argumentation_graph,
		    validity_check, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING *`,
		[
			input.name,
			input.work_type,
			input.criteria ?? '',
			input.persona ?? '',
			input.include_formulierend ?? false,
			input.argumentation_graph ?? true,
			input.validity_check ?? false,
			userId
		]
	);
	return r.rows[0];
}

export interface UpdateBriefInput {
	name?: string;
	work_type?: WorkType;
	criteria?: string;
	persona?: string;
	include_formulierend?: boolean;
	argumentation_graph?: boolean;
	validity_check?: boolean;
}

export async function updateBrief(
	briefId: string,
	patch: UpdateBriefInput
): Promise<AssessmentBrief | null> {
	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) continue;
		fields.push(`${k} = $${i++}`);
		values.push(v);
	}
	if (fields.length === 0) {
		return getBrief(briefId);
	}
	values.push(briefId);
	const r = await query<AssessmentBrief>(
		`UPDATE assessment_briefs SET ${fields.join(', ')}
		 WHERE id = $${i++}
		 RETURNING *`,
		values
	);
	return r.rows[0] ?? null;
}

export async function deleteBrief(briefId: string): Promise<{ deleted: boolean; case_count: number }> {
	const usage = await queryOne<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM cases WHERE assessment_brief_id = $1`,
		[briefId]
	);
	const caseCount = parseInt(usage?.count ?? '0');
	if (caseCount > 0) {
		return { deleted: false, case_count: caseCount };
	}
	const r = await query(
		`DELETE FROM assessment_briefs WHERE id = $1`,
		[briefId]
	);
	return { deleted: (r.rowCount ?? 0) > 0, case_count: 0 };
}
