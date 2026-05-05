// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Werk-Reflexions-Export. Inhalt = exakt das, was der User im Outline-Tab
// der Document-View sieht (Werk-Synthese, Kapitelverlauf, Werk-Beschreibung,
// Werk-Gutachten, Heading-Synthesen). Vier Formate via ?format=md|json|
// docx|pdf. DOCX nutzt native Word-Heading-Styles, PDF nutzt native PDF-
// Bookmarks — Word-Navigationsbereich bzw. PDF-Reader-Sidebar zeigen die
// Werk-Reflexions-Hierarchie. Default = md.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { loadEffectiveOutline } from '$lib/server/documents/outline.js';
import {
	renderMarkdown,
	renderJson,
	renderDocx,
	renderPdf,
	sanitizeFilename,
	type WerkReflexionExport
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

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401, 'unauthorized');
	const { projectId, docId } = params;
	if (!projectId || !docId) throw error(400, 'projectId and docId required');

	const formatParam = (url.searchParams.get('format') ?? 'md').toLowerCase();
	if (!isExportFormat(formatParam)) {
		throw error(400, "format must be 'md', 'json', 'docx', or 'pdf'");
	}
	const format: ExportFormat = formatParam;

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

	const outline = await loadEffectiveOutline(docId);
	if (!outline) throw error(404, 'outline not found');

	// Werk-Synthese (memo_type=kontextualisierend, scope_level=work).
	// Pattern aus +page.server.ts:350-365.
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

	// Kapitelverlauf (memo_type=kapitelverlauf, scope_level=work).
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

	// Heading-Synthesen (subchapter|chapter, kontextualisierend) → Map nach
	// scope_element_id, sodass beim Outline-Walk der passende Eintrag pro
	// Heading-Element nachgeschlagen werden kann.
	const synthRows = (
		await query<{ scope_element_id: string; content: string }>(
			`SELECT mc.scope_element_id, mc.content
			 FROM memo_content mc
			 JOIN document_elements de ON de.id = mc.scope_element_id
			 WHERE de.document_id = $1
			   AND mc.memo_type = 'kontextualisierend'
			   AND mc.scope_level IN ('subchapter', 'chapter')
			   AND mc.scope_element_id IS NOT NULL`,
			[docId]
		)
	).rows;
	const synthByHeadingId = new Map<string, string>();
	for (const r of synthRows) synthByHeadingId.set(r.scope_element_id, r.content);

	// Werk-Konstrukte (function_constructs, ofts ∈ {WERK_DESKRIPTION,
	// WERK_GUTACHT}). Joinen wir nicht über cases — function_constructs
	// hat document_id direkt und wird so case-frei selektiert. Falls kein
	// Case existiert, gibt es eh keine Konstrukte.
	const constructRows = caseRow
		? (
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
					[docId, caseRow.id]
				)
			).rows
		: [];

	const werkBeschreibung: WerkReflexionExport['werkBeschreibung'] = [];
	const werkGutachten: WerkReflexionExport['werkGutachten'] = [];
	for (const c of constructRows) {
		if (c.outline_function_type === 'WERK_DESKRIPTION') {
			const text = pickText(c.content, 'werkBeschreibungText', 'text');
			if (text) werkBeschreibung.push({ id: c.id, content: text });
		} else if (c.outline_function_type === 'WERK_GUTACHT') {
			const aText = pickText(c.content, 'aText');
			const bText = pickText(c.content, 'bText');
			const cText = pickText(c.content, 'cText');
			const gatingDisabled = c.content.gatingDisabled === true;
			if (aText || bText || cText) {
				werkGutachten.push({ id: c.id, aText, bText, cText, gatingDisabled });
			}
		}
	}

	// Outline für die Heading-Synthesen-Navigation: nur sichtbare Knoten,
	// in Dokument-Reihenfolge, jeweils ggf. mit Synthese-Text.
	const outlineForExport: WerkReflexionExport['outline'] = outline.headings
		.filter((h) => !h.excluded)
		.map((h) => ({
			elementId: h.elementId,
			level: h.effectiveLevel,
			numbering: h.effectiveNumbering,
			text: h.effectiveText,
			synthesis: synthByHeadingId.get(h.elementId) ?? null
		}));

	const data: WerkReflexionExport = {
		documentLabel: doc.label,
		documentId: docId,
		caseName: caseRow?.name ?? null,
		briefName: caseRow?.brief_name ?? null,
		workSynthesis: workRow ? { content: workRow.content } : null,
		chapterFlow: flowRow ? { content: flowRow.content } : null,
		werkBeschreibung,
		werkGutachten,
		outline: outlineForExport
	};

	const safeLabel = sanitizeFilename(doc.label);
	const stamp = new Date().toISOString().slice(0, 10);
	const meta = FORMAT_META[format];
	const filename = `werk_reflexion_${safeLabel}_${stamp}.${meta.ext}`;
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
