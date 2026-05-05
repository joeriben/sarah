// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export der effektiven Outline (Heading-Liste mit User-Overrides,
// synthetischer Numerierung, Funktionstyp- und Granularitäts-Setzung).
// Vier Formate via Query-Param ?format=md|json|docx|pdf.
// DOCX nutzt native Word-Heading-Styles 1-6 (Word zeigt automatisch den
// Navigationsbereich), PDF nutzt native PDF-Bookmarks (PDF-Reader-
// Sidebar). Default ist md.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { loadEffectiveOutline } from '$lib/server/documents/outline.js';
import {
	renderMarkdown,
	renderJson,
	renderDocx,
	renderPdf,
	sanitizeFilename
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

	const outline = await loadEffectiveOutline(docId);
	if (!outline) throw error(404, 'outline not found');

	const safeLabel = sanitizeFilename(doc.label);
	const stamp = new Date().toISOString().slice(0, 10);
	const meta = FORMAT_META[format];
	const filename = `outline_${safeLabel}_${stamp}.${meta.ext}`;
	const headers = {
		'content-type': meta.contentType,
		'content-disposition': `attachment; filename="${filename}"`
	};

	let body: BodyInit;
	switch (format) {
		case 'md':
			body = renderMarkdown(doc.label, outline);
			break;
		case 'json':
			body = renderJson(doc.label, docId, outline);
			break;
		case 'docx': {
			const buf = await renderDocx(doc.label, outline);
			body = new Blob([new Uint8Array(buf)], { type: meta.contentType });
			break;
		}
		case 'pdf': {
			const buf = await renderPdf(doc.label, outline);
			body = new Blob([new Uint8Array(buf)], { type: meta.contentType });
			break;
		}
	}

	return new Response(body, { status: 200, headers });
};
