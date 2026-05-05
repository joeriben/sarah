// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Renderer für den Werk-Reflexions-Export. Was hier exportiert wird, ist
// genau das, was der User im Outline-Tab der Document-View sieht — die
// Analyse-Ergebnisse, NICHT die TOC-Klassifikator-Telemetrie:
//
//   1. Werk-Synthese      (memo_type=kontextualisierend, scope_level=work)
//   2. Kapitelverlauf     (memo_type=kapitelverlauf,    scope_level=work)
//   3. Werk-Beschreibung  (function_constructs, ofts=WERK_DESKRIPTION)
//   4. Werk-Gutachten     (function_constructs, ofts=WERK_GUTACHT, a/b/c)
//   5. Heading-Synthesen  (memo_type=kontextualisierend, scope_level=
//                          subchapter|chapter, anchor=heading_element_id)
//
// Vier Formate: md, json, docx, pdf. DOCX/PDF nutzen native Heading-Styles
// bzw. PDF-Bookmarks als Navigations-Anker, damit das exportierte Doc im
// Word-Navigationsbereich / PDF-Reader-Sidebar genauso navigierbar ist
// wie der Outline-Tab in der App.

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

export interface WerkReflexionExport {
	documentLabel: string;
	documentId: string;
	caseName: string | null;
	briefName: string | null;

	workSynthesis: { content: string } | null;
	chapterFlow: { content: string } | null;

	werkBeschreibung: Array<{ id: string; content: string }>;
	werkGutachten: Array<{
		id: string;
		aText: string | null;
		bText: string | null;
		cText: string | null;
		gatingDisabled: boolean;
	}>;

	outline: Array<{
		elementId: string;
		level: number;
		numbering: string | null;
		text: string;
		synthesis: string | null;
	}>;
}

// ── Markdown ─────────────────────────────────────────────────────────

function escapeMd(text: string): string {
	return text.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}

function mdHeadingPrefix(level: number): string {
	return '#'.repeat(Math.min(Math.max(level, 1), 6));
}

export function renderMarkdown(data: WerkReflexionExport): string {
	const lines: string[] = [];
	lines.push(`# Werk-Reflexion — ${data.documentLabel}`);
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

	if (data.workSynthesis) {
		lines.push('## Werk-Synthese');
		lines.push('*H1 · Gesamtverdikt*');
		lines.push('');
		lines.push(data.workSynthesis.content.trim());
		lines.push('');
	}

	if (data.chapterFlow) {
		lines.push('## Kapitelverlauf');
		lines.push('*H1 · Argumentationsbewegung über die Kapitelfolge*');
		lines.push('');
		lines.push(data.chapterFlow.content.trim());
		lines.push('');
	}

	for (const wb of data.werkBeschreibung) {
		lines.push('## Werk-Beschreibung');
		lines.push('*H3 · Beschreibung*');
		lines.push('');
		lines.push(wb.content.trim());
		lines.push('');
	}

	for (const wg of data.werkGutachten) {
		lines.push('## Werk-Gutachten');
		lines.push('*H3 · Würdigung (Critical Friend)*');
		lines.push('');
		if (wg.aText) {
			lines.push('### a · Werk im Lichte der Fragestellung');
			lines.push('');
			lines.push(wg.aText.trim());
			lines.push('');
		}
		if (wg.bText) {
			lines.push('### b · Hotspot-Würdigung');
			lines.push('');
			lines.push(wg.bText.trim());
			lines.push('');
		}
		if (wg.cText) {
			const cTitle = wg.gatingDisabled
				? 'c · Fazit (Gating zur Test-Phase deaktiviert)'
				: 'c · Fazit';
			lines.push(`### ${cTitle}`);
			lines.push('');
			lines.push(wg.cText.trim());
			lines.push('');
		}
	}

	if (data.outline.length > 0) {
		lines.push('## Heading-Synthesen');
		lines.push('*Hierarchische Synthesen-Navigation, eine kontextualisierende Synthese pro Outline-Knoten falls erzeugt.*');
		lines.push('');
		for (const h of data.outline) {
			const lvl = Math.min(h.level + 2, 6);
			const num = h.numbering ? `${h.numbering}  ` : '';
			lines.push(`${mdHeadingPrefix(lvl)} ${num}${escapeMd(h.text)}`);
			lines.push('');
			if (h.synthesis) {
				lines.push(h.synthesis.trim());
			} else {
				lines.push('*— keine Synthese erzeugt —*');
			}
			lines.push('');
		}
	}

	lines.push('---');
	lines.push('');
	lines.push(`*Exportiert am ${new Date().toLocaleString('de-DE')}*`);
	lines.push('');
	return lines.join('\n');
}

// ── JSON ─────────────────────────────────────────────────────────────

export function renderJson(data: WerkReflexionExport): string {
	return JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			document: { id: data.documentId, label: data.documentLabel },
			case: data.caseName ? { name: data.caseName, brief: data.briefName } : null,
			werkReflexion: {
				workSynthesis: data.workSynthesis,
				chapterFlow: data.chapterFlow,
				werkBeschreibung: data.werkBeschreibung,
				werkGutachten: data.werkGutachten,
				headingSyntheses: data.outline
			}
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

function docxBodyParagraphs(text: string): Paragraph[] {
	// Memo-/Konstrukt-Inhalte sind freier Prosatext mit Leerzeilen-Absätzen.
	// In DOCX ein Paragraph pro Block, leere Zeilen werden zu visueller Pause.
	const blocks = text.split(/\n\s*\n/);
	return blocks
		.map((b) => b.trim())
		.filter((b) => b.length > 0)
		.map((b) => new Paragraph({ children: [new TextRun({ text: b })] }));
}

export async function renderDocx(data: WerkReflexionExport): Promise<Buffer> {
	const children: Paragraph[] = [];

	children.push(
		new Paragraph({
			heading: HeadingLevel.TITLE,
			alignment: AlignmentType.LEFT,
			children: [new TextRun({ text: `Werk-Reflexion — ${data.documentLabel}` })]
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

	if (data.workSynthesis) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: 'Werk-Synthese' })]
			})
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: 'H1 · Gesamtverdikt', italics: true, color: '6B7280', size: 18 })
				]
			})
		);
		children.push(...docxBodyParagraphs(data.workSynthesis.content));
		children.push(new Paragraph({ text: '' }));
	}

	if (data.chapterFlow) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: 'Kapitelverlauf' })]
			})
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({
						text: 'H1 · Argumentationsbewegung über die Kapitelfolge',
						italics: true,
						color: '6B7280',
						size: 18
					})
				]
			})
		);
		children.push(...docxBodyParagraphs(data.chapterFlow.content));
		children.push(new Paragraph({ text: '' }));
	}

	for (const wb of data.werkBeschreibung) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: 'Werk-Beschreibung' })]
			})
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: 'H3 · Beschreibung', italics: true, color: '6B7280', size: 18 })
				]
			})
		);
		children.push(...docxBodyParagraphs(wb.content));
		children.push(new Paragraph({ text: '' }));
	}

	for (const wg of data.werkGutachten) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: 'Werk-Gutachten' })]
			})
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({
						text: 'H3 · Würdigung (Critical Friend)',
						italics: true,
						color: '6B7280',
						size: 18
					})
				]
			})
		);
		if (wg.aText) {
			children.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_2,
					children: [new TextRun({ text: 'a · Werk im Lichte der Fragestellung' })]
				})
			);
			children.push(...docxBodyParagraphs(wg.aText));
		}
		if (wg.bText) {
			children.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_2,
					children: [new TextRun({ text: 'b · Hotspot-Würdigung' })]
				})
			);
			children.push(...docxBodyParagraphs(wg.bText));
		}
		if (wg.cText) {
			const cTitle = wg.gatingDisabled
				? 'c · Fazit (Gating zur Test-Phase deaktiviert)'
				: 'c · Fazit';
			children.push(
				new Paragraph({
					heading: HeadingLevel.HEADING_2,
					children: [new TextRun({ text: cTitle })]
				})
			);
			children.push(...docxBodyParagraphs(wg.cText));
		}
		children.push(new Paragraph({ text: '' }));
	}

	if (data.outline.length > 0) {
		children.push(
			new Paragraph({
				heading: HeadingLevel.HEADING_1,
				children: [new TextRun({ text: 'Heading-Synthesen' })]
			})
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({
						text: 'Hierarchische Synthesen-Navigation, eine kontextualisierende Synthese pro Outline-Knoten falls erzeugt.',
						italics: true,
						color: '6B7280',
						size: 18
					})
				]
			})
		);
		for (const h of data.outline) {
			const num = h.numbering ? `${h.numbering}  ` : '';
			children.push(
				new Paragraph({
					heading: docxHeadingFor(h.level + 1),
					children: [new TextRun({ text: `${num}${h.text}` })]
				})
			);
			if (h.synthesis) {
				children.push(...docxBodyParagraphs(h.synthesis));
			} else {
				children.push(
					new Paragraph({
						children: [
							new TextRun({
								text: '— keine Synthese erzeugt —',
								italics: true,
								color: '8B9199',
								size: 18
							})
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
		title: `Werk-Reflexion — ${data.documentLabel}`,
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

export async function renderPdf(data: WerkReflexionExport): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		const doc = new PDFDocument({
			size: 'A4',
			margins: { top: 60, bottom: 60, left: 60, right: 60 },
			info: {
				Title: `Werk-Reflexion — ${data.documentLabel}`,
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
			doc
				.font('Helvetica-Bold')
				.fontSize(15)
				.fillColor('#111827')
				.text(title);
			if (label) {
				doc
					.font('Helvetica-Oblique')
					.fontSize(9)
					.fillColor('#6B7280')
					.text(label);
			}
			doc.moveDown(0.4);
		}

		function writeSubHeading(title: string, level: number) {
			pushBookmark(level, title);
			const fontSize = Math.max(10, 14 - (level - 2));
			doc
				.font('Helvetica-Bold')
				.fontSize(fontSize)
				.fillColor('#111827')
				.text(title);
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

		function writeBodyMissing() {
			doc
				.font('Helvetica-Oblique')
				.fontSize(9)
				.fillColor('#9CA3AF')
				.text('— keine Synthese erzeugt —');
			doc.moveDown(0.3);
		}

		// Title
		doc
			.font('Helvetica-Bold')
			.fontSize(20)
			.fillColor('#111827')
			.text(`Werk-Reflexion — ${data.documentLabel}`);

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

		if (data.workSynthesis) {
			writeSectionHeading('Werk-Synthese', 'H1 · Gesamtverdikt');
			writeBody(data.workSynthesis.content);
		}

		if (data.chapterFlow) {
			writeSectionHeading('Kapitelverlauf', 'H1 · Argumentationsbewegung über die Kapitelfolge');
			writeBody(data.chapterFlow.content);
		}

		for (const wb of data.werkBeschreibung) {
			writeSectionHeading('Werk-Beschreibung', 'H3 · Beschreibung');
			writeBody(wb.content);
		}

		for (const wg of data.werkGutachten) {
			writeSectionHeading('Werk-Gutachten', 'H3 · Würdigung (Critical Friend)');
			if (wg.aText) {
				writeSubHeading('a · Werk im Lichte der Fragestellung', 2);
				writeBody(wg.aText);
			}
			if (wg.bText) {
				writeSubHeading('b · Hotspot-Würdigung', 2);
				writeBody(wg.bText);
			}
			if (wg.cText) {
				const cTitle = wg.gatingDisabled
					? 'c · Fazit (Gating zur Test-Phase deaktiviert)'
					: 'c · Fazit';
				writeSubHeading(cTitle, 2);
				writeBody(wg.cText);
			}
		}

		if (data.outline.length > 0) {
			writeSectionHeading(
				'Heading-Synthesen',
				'Hierarchische Synthesen-Navigation, eine pro Outline-Knoten falls erzeugt.'
			);
			for (const h of data.outline) {
				const num = h.numbering ? `${h.numbering}  ` : '';
				const title = `${num}${h.text}`;
				writeSubHeading(title, h.level + 1);
				if (h.synthesis) {
					writeBody(h.synthesis);
				} else {
					writeBodyMissing();
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
			.normalize('NFKD')
			.replace(/[^\w\s.-]/g, '')
			.replace(/\s+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^[._-]+|[._-]+$/g, '')
			.slice(0, 80) || 'document'
	);
}
