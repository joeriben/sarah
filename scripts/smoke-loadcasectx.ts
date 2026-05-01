// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke test for migration 037: loadCaseContext should still load the brief
// completely after assessment_briefs.project_id was dropped.

import { loadCaseContext } from '../src/lib/server/ai/hermeneutic/per-paragraph.js';
import { pool } from '../src/lib/server/db/index.js';

const GOLDSTAND_CASE = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';

async function main() {
	const ctx = await loadCaseContext(GOLDSTAND_CASE);
	console.log('case_id:', ctx.caseId);
	console.log('central_doc_id:', ctx.centralDocumentId);
	console.log('brief.name:', ctx.brief.name);
	console.log('brief.work_type:', ctx.brief.work_type);
	console.log('brief.persona length:', ctx.brief.persona.length);
	console.log('brief.criteria length:', ctx.brief.criteria.length);
	console.log('brief.includeFormulierend:', ctx.brief.includeFormulierend);
	console.log('OK — loadCaseContext lädt brief vollständig nach migration 037.');
	await pool.end();
}

main().catch((e) => {
	console.error('FAIL:', e);
	pool.end();
	process.exit(1);
});
