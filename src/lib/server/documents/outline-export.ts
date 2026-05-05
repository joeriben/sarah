// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Renderer für den Werk-Synthese-Export. Ein Export pro Heuristik (H1/H2/H3),
// Inhalt = exakt das, was in der entsprechenden Spalte des Synthesen-Tabs
// rendert. Vier Formate: md, json, docx, pdf.
//
//   H1: Werk-Synthese (kontextualisierend/work/graph) + Kapitelverlauf
//   H2: Werk-Synthese (kontextualisierend/work/synthetic, ohne Auffälligkeiten)
//   H3: Werk-Beschreibung (WERK_DESKRIPTION) + Werk-Gutachten (WERK_GUTACHT a/b/c)

import {
	Document,
	Packer,
	Paragraph,
	HeadingLevel,
	TextRun,
	AlignmentType
} from 'docx';
import PDFDocument from 'pdfkit';

// ── Datentyp ─────────────────────────────────────────────────────────

export type HeuristicScope = 'h1' | 'h2' | 'h3';

export interface ExportSubsection {
	title: string;
	content: string;
}

export interface ExportSection {
	title: string;
	label: string | null;
	content: string | null;
	subsections?: ExportSubsection[];
}

export interface WerkSyntheseExport {
	heuristic: HeuristicScope;
	heuristicTitle: string;
	documentLabel: string;
	documentId: string;
	caseName: string | null;
	briefName: string | null;
	sections: ExportSection[];
}

export const HEURISTIC_TITLE: Record<HeuristicScope, string> = {
	h1: 'H1 · Analytische Werk-Synthese',
	h2: 'H2 · Synthetisch-hermeneutische Werk-Synthese',
	h3: 'H3 · Werk-Beschreibung & Werk-Gutachten'
};

// ── Markdown ─────────────────────────────────────────────────────────

export function renderMarkdown(data: WerkSyntheseExport): string {
	const lines: string[] = [];
	lines.push(`# ${data.heuristicTitle} — ${data.documentLabel}`);
	lines.push('');
	const meta: string[] = [];
	if (data.caseName) meta.push(`Case: ${data.caseName}`);
	if (data.briefName) meta.push(`Brief: ${data.briefName}`);
	if (meta.length > 0) {
		lines.push(`> ${meta.join(' · ')}`);
		lines.push('');
	}
	lines.push('---');
	lines.push('');

	for (const section of data.sections) {
		lines.push(`## ${section.title}`);
		if (section.label) {
			lines.push(`*${section.label}*`);
		}
		lines.push('');
		if (section.content) {
			lines.push(section.content.trim());
			lines.push('');
		}
		if (section.subsections) {
			for (const sub of section.subsections) {
				lines.push(`### ${sub.title}`);
				lines.push('');
				lines.push(sub.content.trim());
				lines.push('');
			}
		}
	}

	lines.push('---');
	lines.push('');
	lines.push(`*Exportiert am ${new Date().toLocaleString('de-DE')}*`);
	lines.push('');
	return lines.join('\n');
}

// ── JSON ─────────────────────────────────────────────────────────────

export function renderJson(data: WerkSyntheseExport): string {
	return JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			heuristic: data.heuristic,
			heuristicTitle: data.heuristicTitle,
			document: { id: data.documentId, label: data.documentLabel },
			case: data.caseName ? { name: data.caseName, brief: data.briefName } : null,
			sections: data.sections
		},
		null,
		2
	);
}

// ── DOCX ─────────────────────────────────────────────────────────────

function docxBodyParagraphs(text: string): Paragraph[] {
	const blocks = text.split(/\n\s*\n/);
	return blocks
		.map((b) => b.trim())
		.filter((b) => b.length > 0)
		.map((b) => new Paragraph({ children: [new TextRun({ text: b })] }));
}

export async function renderDocx(data: WerkSyntheseExport): Promise<Buffer> {
	const children: Paragraph[] = [];

	children.push(
		new Paragraph({
			heading: HeadingLevel.TITLE,
			alignment: AlignmentType.LEFT,
			children: [new TextRun({ text: `${data.heuristicTitle} — ${data.documentLabel}` })]
		})
	);
	const metaBits: string[] = [];
	if (data.caseName) metaBits.push(`Case: ${data.caseName}`);
	if (data.briefName) metaBits.push(`Brief: ${data.briefName}`);
	if (metaBits.length > 0) {
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: metaBits.join(' · '), italics: true, color: '6B7280' })
				]
			})
		);
	}
	children.push(new Paragraph({ text: '' }));

	for (const section of data.sections) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: section.title })]
			})
		);
		if (section.label) {
			children.push(
				new Paragraph({
					children: [
						new TextRun({ text: section.label, italics: true, color: '6B7280', size: 18 })
					]
				})
			);
		}
		if (section.content) {
			children.push(...docxBodyParagraphs(section.content));
		}
		if (section.subsections) {
			for (const sub of section.subsections) {
				children.push(
					new Paragraph({
						heading: HeadingLevel.HEADING_2,
						children: [new TextRun({ text: sub.title })]
					})
				);
				children.push(...docxBodyParagraphs(sub.content));
			}
		}
		children.push(new Paragraph({ text: '' }));
	}

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
		title: `${data.heuristicTitle} — ${data.documentLabel}`,
		sections: [{ children }]
	});
	return await Packer.toBuffer(doc);
}

// ── PDF ──────────────────────────────────────────────────────────────

interface PdfBookmarkNode {
	level: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	node: any;
}

export async function renderPdf(data: WerkSyntheseExport): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		const doc = new PDFDocument({
			size: 'A4',
			margins: { top: 60, bottom: 60, left: 60, right: 60 },
			info: {
				Title: `${data.heuristicTitle} — ${data.documentLabel}`,
				Creator: 'SARAH'
			}
		});

		const chunks: Buffer[] = [];
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const root: any = (doc as any).outline;
		const bookmarkStack: PdfBookmarkNode[] = [{ level: 0, node: root }];

		function pushBookmark(level: number, title: string) {
			while (
				bookmarkStack.length > 1 &&
				bookmarkStack[bookmarkStack.length - 1].level >= level
			) {
				bookmarkStack.pop();
			}
			const parent = bookmarkStack[bookmarkStack.length - 1].node;
			const item = parent.addItem(title);
			bookmarkStack.push({ level, node: item });
		}

		function writeSectionHeading(title: string, label: string | null) {
			pushBookmark(1, title);
			doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827').text(title);
			if (label) {
				doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280').text(label);
			}
			doc.moveDown(0.4);
		}

		function writeSubHeading(title: string) {
			pushBookmark(2, title);
			doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(title);
			doc.moveDown(0.25);
		}

		function writeBody(text: string) {
			const blocks = text.split(/\n\s*\n/);
			doc.font('Helvetica').fontSize(10.5).fillColor('#1f2937');
			for (const b of blocks) {
				const trimmed = b.trim();
				if (!trimmed) continue;
				doc.text(trimmed, { align: 'left' });
				doc.moveDown(0.4);
			}
		}

		// Title
		doc
			.font('Helvetica-Bold')
			.fontSize(20)
			.fillColor('#111827')
			.text(`${data.heuristicTitle} — ${data.documentLabel}`);

		const metaBits: string[] = [];
		if (data.caseName) metaBits.push(`Case: ${data.caseName}`);
		if (data.briefName) metaBits.push(`Brief: ${data.briefName}`);
		if (metaBits.length > 0) {
			doc
				.font('Helvetica-Oblique')
				.fontSize(10)
				.fillColor('#6B7280')
				.text(metaBits.join(' · '));
		}
		doc.moveDown(0.6);
		const sepY = doc.y;
		doc
			.strokeColor('#E5E7EB')
			.lineWidth(0.5)
			.moveTo(60, sepY)
			.lineTo(doc.page.width - 60, sepY)
			.stroke();
		doc.moveDown(0.6);

		for (const section of data.sections) {
			writeSectionHeading(section.title, section.label);
			if (section.content) {
				writeBody(section.content);
			}
			if (section.subsections) {
				for (const sub of section.subsections) {
					writeSubHeading(sub.title);
					writeBody(sub.content);
				}
			}
		}

		doc.moveDown(0.6);
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
			.replace(/\.[a-zA-Z0-9]{1,5}$/u, '')
			.replace(/[^a-zA-Z0-9_\- ]+/gu, '_')
			.replace(/\s+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '')
			.slice(0, 80) || 'werk'
	);
}
