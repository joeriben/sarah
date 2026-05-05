// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Renderer für Outline-Export. Vier Formate:
//   - md   Markdown (lesbar, einfache Struktur)
//   - json EffectiveOutline raw (maschinell verarbeitbar)
//   - docx Word-Dokument mit nativen Heading-Styles 1-6 (Heading 7-9
//          fallen auf Heading 6 zurück; Word unterstützt im Standard-
//          Style-Set nur 6 Heading-Ebenen). Word zeigt automatisch den
//          Navigationsbereich.
//   - pdf  PDF mit nativen Outline-Bookmarks (PDF-Reader-Sidebar). Die
//          visuelle Liste folgt der Heading-Hierarchie via Einrückung.

import {
	Document,
	Packer,
	Paragraph,
	HeadingLevel,
	TextRun,
	AlignmentType
} from 'docx';
import PDFDocument from 'pdfkit';
import type { EffectiveOutline, EffectiveHeading } from './outline.js';
import {
	OUTLINE_FUNCTION_TYPE_LABELS,
	GRANULARITY_LEVEL_LABELS,
	isOutlineFunctionType,
	isGranularityLevel
} from '../../shared/h3-vocabulary.js';

// ── Stat-Helpers ─────────────────────────────────────────────────────

function computeStats(outline: EffectiveOutline) {
	const visible = outline.headings.filter((h) => !h.excluded).length;
	const edited = outline.headings.filter(
		(h) => h.userLevel !== null || h.userText !== null || h.excluded
	).length;
	const functionTyped = outline.headings.filter(
		(h) => !h.excluded && h.outlineFunctionType !== null
	).length;
	return {
		total: outline.headings.length,
		visible,
		edited,
		functionTyped
	};
}

function statusLine(outline: EffectiveOutline): string {
	const s = outline.outlineStatus === 'confirmed' ? 'bestätigt' : 'unbestätigt';
	if (outline.outlineConfirmedAt) {
		const d = new Date(outline.outlineConfirmedAt).toLocaleString('de-DE');
		return `Status: ${s} (bestätigt am ${d})`;
	}
	return `Status: ${s}`;
}

function metaParts(h: EffectiveHeading): string[] {
	if (h.excluded) return [];
	const parts: string[] = [];

	if (h.outlineFunctionType !== null) {
		const ftLabel = isOutlineFunctionType(h.outlineFunctionType)
			? OUTLINE_FUNCTION_TYPE_LABELS[h.outlineFunctionType]
			: h.outlineFunctionType;
		parts.push(ftLabel);
	}
	if (h.granularityLevel !== null) {
		const glLabel = isGranularityLevel(h.granularityLevel)
			? GRANULARITY_LEVEL_LABELS[h.granularityLevel]
			: h.granularityLevel;
		parts.push(glLabel);
	}
	if (h.outlineFunctionType !== null) {
		if (h.outlineFunctionTypeUserSet) {
			parts.push('User-Setzung');
		} else {
			const conf = h.outlineFunctionTypeConfidence;
			parts.push(
				conf !== null ? `Vorschlag · Conf. ${Math.round(conf * 100)}%` : 'Vorschlag'
			);
		}
	}

	if (h.hasNoNumberingFromParser) parts.push('parser ohne num');
	if (h.hasNumberingMismatch) parts.push('num mismatch');
	if (h.userLevel !== null && h.userLevel !== h.parserLevel) parts.push('level edit');
	if (h.userText !== null) parts.push('text edit');

	return parts;
}

function metaLineString(h: EffectiveHeading): string | null {
	const parts = metaParts(h);
	return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Markdown ─────────────────────────────────────────────────────────

function escapeMd(text: string): string {
	return text.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}

export function renderMarkdown(docLabel: string, outline: EffectiveOutline): string {
	const stats = computeStats(outline);
	const lines: string[] = [];
	lines.push(`# Inhaltsverzeichnis — ${docLabel}`);
	lines.push('');
	lines.push(`> ${statusLine(outline)}`);
	lines.push(
		`> ${stats.visible} sichtbare Headings · ${stats.edited} bearbeitet · ${stats.total} total`
	);
	lines.push(`> Funktionstyp gesetzt: ${stats.functionTyped} / ${stats.visible}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	for (const h of outline.headings) {
		const indent = '  '.repeat(Math.max(0, h.effectiveLevel - 1));
		const num = h.effectiveNumbering ?? '—';
		const text = escapeMd(h.effectiveText);
		if (h.excluded) {
			lines.push(`${indent}- ~~${num} ${text}~~ *(ausgeschlossen)*`);
		} else {
			lines.push(`${indent}- **${num}** ${text}`);
			const meta = metaLineString(h);
			if (meta) lines.push(`${indent}  *${meta}*`);
		}
	}

	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push(`*Exportiert am ${new Date().toLocaleString('de-DE')}*`);
	lines.push('');
	return lines.join('\n');
}

// ── JSON ─────────────────────────────────────────────────────────────

export function renderJson(
	docLabel: string,
	docId: string,
	outline: EffectiveOutline
): string {
	return JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			document: { id: docId, label: docLabel },
			outline
		},
		null,
		2
	);
}

// ── DOCX ─────────────────────────────────────────────────────────────

const DOCX_HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
	1: HeadingLevel.HEADING_1,
	2: HeadingLevel.HEADING_2,
	3: HeadingLevel.HEADING_3,
	4: HeadingLevel.HEADING_4,
	5: HeadingLevel.HEADING_5,
	6: HeadingLevel.HEADING_6
};

function docxHeadingFor(level: number) {
	return DOCX_HEADING_BY_LEVEL[Math.min(Math.max(level, 1), 6)];
}

export async function renderDocx(
	docLabel: string,
	outline: EffectiveOutline
): Promise<Buffer> {
	const stats = computeStats(outline);
	const children: Paragraph[] = [];

	children.push(
		new Paragraph({
			heading: HeadingLevel.TITLE,
			alignment: AlignmentType.LEFT,
			children: [new TextRun({ text: `Inhaltsverzeichnis — ${docLabel}` })]
		})
	);
	children.push(
		new Paragraph({
			children: [
				new TextRun({ text: statusLine(outline), italics: true, color: '6B7280' })
			]
		})
	);
	children.push(
		new Paragraph({
			children: [
				new TextRun({
					text: `${stats.visible} sichtbare Headings · ${stats.edited} bearbeitet · ${stats.total} total · Funktionstyp gesetzt: ${stats.functionTyped} / ${stats.visible}`,
					italics: true,
					color: '6B7280'
				})
			]
		})
	);
	children.push(new Paragraph({ text: '' }));

	for (const h of outline.headings) {
		const num = h.effectiveNumbering ?? '—';
		const baseText = `${num}  ${h.effectiveText}`;

		if (h.excluded) {
			children.push(
				new Paragraph({
					children: [
						new TextRun({ text: baseText, strike: true, color: '6B7280' }),
						new TextRun({ text: '   (ausgeschlossen)', italics: true, color: '6B7280' })
					]
				})
			);
		} else {
			children.push(
				new Paragraph({
					heading: docxHeadingFor(h.effectiveLevel),
					children: [new TextRun({ text: baseText })]
				})
			);
			const meta = metaLineString(h);
			if (meta) {
				children.push(
					new Paragraph({
						children: [
							new TextRun({ text: meta, italics: true, color: '6B7280', size: 18 })
						]
					})
				);
			}
		}
	}

	children.push(new Paragraph({ text: '' }));
	children.push(
		new Paragraph({
			children: [
				new TextRun({
					text: `Exportiert am ${new Date().toLocaleString('de-DE')}`,
					italics: true,
					color: '8B9199',
					size: 16
				})
			]
		})
	);

	const doc = new Document({
		creator: 'SARAH',
		title: `Inhaltsverzeichnis — ${docLabel}`,
		sections: [{ children }]
	});
	return await Packer.toBuffer(doc);
}

// ── PDF ──────────────────────────────────────────────────────────────

export async function renderPdf(
	docLabel: string,
	outline: EffectiveOutline
): Promise<Buffer> {
	const stats = computeStats(outline);

	return new Promise<Buffer>((resolve, reject) => {
		const doc = new PDFDocument({
			size: 'A4',
			margins: { top: 60, bottom: 60, left: 60, right: 60 },
			info: {
				Title: `Inhaltsverzeichnis — ${docLabel}`,
				Creator: 'SARAH'
			}
		});

		const chunks: Buffer[] = [];
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		// Title
		doc
			.font('Helvetica-Bold')
			.fontSize(18)
			.fillColor('#1f2937')
			.text(`Inhaltsverzeichnis — ${docLabel}`);
		doc.moveDown(0.4);

		doc
			.font('Helvetica-Oblique')
			.fontSize(9)
			.fillColor('#6B7280')
			.text(statusLine(outline));
		doc.text(
			`${stats.visible} sichtbare Headings · ${stats.edited} bearbeitet · ${stats.total} total · Funktionstyp gesetzt: ${stats.functionTyped} / ${stats.visible}`
		);
		doc.moveDown(0.6);

		// Trennlinie
		const sepY = doc.y;
		doc
			.strokeColor('#E5E7EB')
			.lineWidth(0.5)
			.moveTo(60, sepY)
			.lineTo(doc.page.width - 60, sepY)
			.stroke();
		doc.moveDown(0.6);

		// Outline-Bookmarks: Stack hält die parent-Items pro Level
		// Root ist doc.outline (PDFKit-typed als any).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const root: any = (doc as any).outline;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const stack: Array<{ level: number; node: any }> = [{ level: 0, node: root }];

		for (const h of outline.headings) {
			const num = h.effectiveNumbering ?? '—';
			const indent = (h.effectiveLevel - 1) * 14;
			const x = 60 + indent;
			const headingFontSize = Math.max(9, 14 - (h.effectiveLevel - 1) * 1);

			// Pre-text page break check: PDFKit handles auto-pagination but we
			// must add the bookmark AFTER text() so the bookmark resolves to
			// the correct page.
			doc.fillColor(h.excluded ? '#9CA3AF' : '#111827');
			doc.font(h.effectiveLevel <= 2 ? 'Helvetica-Bold' : 'Helvetica');
			doc.fontSize(headingFontSize);

			const lineText = h.excluded
				? `${num}  ${h.effectiveText}   (ausgeschlossen)`
				: `${num}  ${h.effectiveText}`;
			doc.text(lineText, x, doc.y);

			if (!h.excluded) {
				// Pop stack until we find a level strictly less than current
				while (stack.length > 1 && stack[stack.length - 1].level >= h.effectiveLevel) {
					stack.pop();
				}
				const parent = stack[stack.length - 1].node;
				const itemTitle = `${num}  ${h.effectiveText}`;
				const item = parent.addItem(itemTitle);
				stack.push({ level: h.effectiveLevel, node: item });

				const meta = metaLineString(h);
				if (meta) {
					doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6B7280');
					doc.text(meta, x + 14, doc.y);
				}
			}

			doc.moveDown(0.25);
		}

		doc.moveDown(0.8);
		doc
			.font('Helvetica-Oblique')
			.fontSize(8)
			.fillColor('#8B9199')
			.text(`Exportiert am ${new Date().toLocaleString('de-DE')}`);

		doc.end();
	});
}

// ── Filename-Sanitizer ───────────────────────────────────────────────

export function sanitizeFilename(label: string): string {
	return (
		label
			.normalize('NFKD')
			.replace(/[^\w\s.-]/g, '')
			.replace(/\s+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^[._-]+|[._-]+$/g, '')
			.slice(0, 80) || 'document'
	);
}
