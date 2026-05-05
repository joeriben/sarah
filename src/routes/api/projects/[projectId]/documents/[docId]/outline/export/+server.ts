// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Werk-Synthese-Export pro Heuristik. Pflicht-Param `heuristic` ∈ {h1,h2,h3}.
// Inhalt = exakt das, was in der entsprechenden Spalte des Synthesen-Tabs
// rendert (siehe outline-export.ts für die Section-Composition pro Heuristik).

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import {
	renderMarkdown,
	renderJson,
	renderDocx,
	renderPdf,
	sanitizeFilename,
	HEURISTIC_TITLE,
	type WerkSyntheseExport,
	type ExportSection,
	type HeuristicScope
} from '$lib/server/documents/outline-export.js';

const FORMAT_META = {
	md: { contentType: 'text/markdown; charset=utf-8', ext: 'md' },
	json: { contentType: 'application/json; charset=utf-8', ext: 'json' },
	docx: {
		contentType:
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		ext: 'docx'
	},
	pdf: { contentType: 'application/pdf', ext: 'pdf' }
} as const;

type ExportFormat = keyof typeof FORMAT_META;

function isExportFormat(v: string): v is ExportFormat {
	return v === 'md' || v === 'json' || v === 'docx' || v === 'pdf';
}

function isHeuristic(v: string): v is HeuristicScope {
	return v === 'h1' || v === 'h2' || v === 'h3';
}

function pickText(
	content: Record<string, unknown>,
	...keys: string[]
): string | null {
	for (const k of keys) {
		const v = content[k];
		if (typeof v === 'string' && v.trim().length > 0) return v;
	}
	return null;
}

async function loadH1Sections(docId: string): Promise<ExportSection[]> {
	const sections: ExportSection[] = [];

	const workRow = await queryOne<{ content: string }>(
		`SELECT mc.content
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
		   AND mc.scope_level = 'work'
		   AND mc.memo_type = 'kontextualisierend'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 ORDER BY n.created_at DESC
		 LIMIT 1`,
		[docId]
	);
	if (workRow) {
		sections.push({
			title: 'Werk-Synthese',
			label: 'H1 · Gesamtverdikt',
			content: workRow.content
		});
	}

	const flowRow = await queryOne<{ content: string }>(
		`SELECT mc.content
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kapitelverlauf/work]%'
		   AND mc.scope_level = 'work'
		   AND mc.memo_type = 'kapitelverlauf'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 ORDER BY n.created_at DESC
		 LIMIT 1`,
		[docId]
	);
	if (flowRow) {
		sections.push({
			title: 'Kapitelverlauf',
			label: 'H1 · Argumentationsbewegung über die Kapitelfolge',
			content: flowRow.content
		});
	}

	return sections;
}

async function loadH2Sections(docId: string): Promise<ExportSection[]> {
	const row = await queryOne<{ content: string }>(
		`SELECT mc.content
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.inscription LIKE '[kontextualisierend/work/synthetic]%'
		   AND mc.scope_level = 'work'
		   AND mc.memo_type = 'kontextualisierend'
		   AND a.properties->>'document_id' = $1
		   AND n.deleted_at IS NULL
		 ORDER BY n.created_at DESC
		 LIMIT 1`,
		[docId]
	);
	if (!row) return [];
	return [
		{
			title: 'Werk-Synthese (synthetisch-hermeneutisch)',
			label: 'H2 · Synthetisches Verdikt',
			content: row.content
		}
	];
}

async function loadH3Sections(
	docId: string,
	caseId: string | null
): Promise<ExportSection[]> {
	if (!caseId) return [];
	const rows = (
		await query<{
			id: string;
			outline_function_type: string;
			content: Record<string, unknown>;
		}>(
			`SELECT id, outline_function_type, content
			 FROM function_constructs
			 WHERE document_id = $1
			   AND case_id = $2
			   AND outline_function_type IN ('WERK_DESKRIPTION', 'WERK_GUTACHT')
			 ORDER BY created_at ASC`,
			[docId, caseId]
		)
	).rows;

	const sections: ExportSection[] = [];
	for (const c of rows) {
		if (c.outline_function_type === 'WERK_DESKRIPTION') {
			const text = pickText(c.content, 'werkBeschreibungText', 'text');
			if (text) {
				sections.push({
					title: 'Werk-Beschreibung',
					label: 'H3 · Beschreibung',
					content: text
				});
			}
		} else if (c.outline_function_type === 'WERK_GUTACHT') {
			const aText = pickText(c.content, 'aText');
			const bText = pickText(c.content, 'bText');
			const cText = pickText(c.content, 'cText');
			const gatingDisabled = c.content.gatingDisabled === true;
			const subsections = [];
			if (aText) subsections.push({ title: 'a · Werk im Lichte der Fragestellung', content: aText });
			if (bText) subsections.push({ title: 'b · Hotspot-Würdigung', content: bText });
			if (cText) {
				subsections.push({
					title: gatingDisabled
						? 'c · Fazit (Gating zur Test-Phase deaktiviert)'
						: 'c · Fazit',
					content: cText
				});
			}
			if (subsections.length > 0) {
				sections.push({
					title: 'Werk-Gutachten',
					label: 'H3 · Würdigung (Critical Friend)',
					content: null,
					subsections
				});
			}
		}
	}
	return sections;
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { projectId, docId } = params;
	if (!projectId || !docId) throw error(400, 'projectId and docId required');

	const formatParam = (url.searchParams.get('format') ?? 'md').toLowerCase();
	if (!isExportFormat(formatParam)) {
		throw error(400, "format must be 'md', 'json', 'docx', or 'pdf'");
	}
	const format: ExportFormat = formatParam;

	const heuristicParam = (url.searchParams.get('heuristic') ?? '').toLowerCase();
	if (!isHeuristic(heuristicParam)) {
		throw error(400, "heuristic must be 'h1', 'h2', or 'h3'");
	}
	const heuristic: HeuristicScope = heuristicParam;

	const doc = await queryOne<{ label: string }>(
		`SELECT n.inscription AS label
		 FROM namings n
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);
	if (!doc) throw error(404, 'document not found');

	const caseRow = await queryOne<{
		id: string;
		name: string;
		brief_name: string | null;
	}>(
		`SELECT c.id, c.name, b.name AS brief_name
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.central_document_id = $1`,
		[docId]
	);

	let sections: ExportSection[];
	switch (heuristic) {
		case 'h1':
			sections = await loadH1Sections(docId);
			break;
		case 'h2':
			sections = await loadH2Sections(docId);
			break;
		case 'h3':
			sections = await loadH3Sections(docId, caseRow?.id ?? null);
			break;
	}

	const data: WerkSyntheseExport = {
		heuristic,
		heuristicTitle: HEURISTIC_TITLE[heuristic],
		documentLabel: doc.label,
		documentId: docId,
		caseName: caseRow?.name ?? null,
		briefName: caseRow?.brief_name ?? null,
		sections
	};

	const safeLabel = sanitizeFilename(doc.label);
	const stamp = new Date().toISOString().slice(0, 10);
	const meta = FORMAT_META[format];
	const filename = `werk_synthese_${heuristic}_${safeLabel}_${stamp}.${meta.ext}`;
	const headers = {
		'content-type': meta.contentType,
		'content-disposition': `attachment; filename="${filename}"`
	};

	let body: BodyInit;
	switch (format) {
		case 'md':
			body = renderMarkdown(data);
			break;
		case 'json':
			body = renderJson(data);
			break;
		case 'docx': {
			const buf = await renderDocx(data);
			body = new Blob([new Uint8Array(buf)], { type: meta.contentType });
			break;
		}
		case 'pdf': {
			const buf = await renderPdf(data);
			body = new Blob([new Uint8Array(buf)], { type: meta.contentType });
			break;
		}
	}

	return new Response(body, { status: 200, headers });
};
