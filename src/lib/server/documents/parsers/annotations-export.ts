// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for PDF-annotation summary exports
 * (Adobe Acrobat / Foxit / similar — header line begins with
 * "Zusammenfassung der Anmerkungen in <filename>.pdf").
 *
 * The export is a plain-text file laid out as:
 *
 *   Zusammenfassung der Anmerkungen in <filename>.pdf.
 *
 *   <chapter heading from the source PDF>
 *
 *   Hervorheben [Seite N]: <verbatim quote from source>
 *
 *   Notiz [Seite N]: <reviewer's comment text, may wrap multiple lines>
 *
 *   <next chapter heading>
 *
 *   …
 *
 * Five annotation types appear:
 *
 *   citing (text after the colon is verbatim from source):
 *     - Hervorheben      (highlight)
 *     - Unterstreichen   (underline)
 *     - Wellenlinie      (squiggle)
 *
 *   commenting (text after the colon is the reviewer's own text):
 *     - Notiz            (sticky note with comment)
 *     - Text             (short marginal label, often a question / cue)
 *     - Rechteck         (rectangle drawn around source content; the
 *                        message itself usually comes via an adjacent Notiz)
 *
 * Parser output: one `annotation` element per entry, plus `heading`
 * elements for the chapter context lines. Each annotation carries:
 *   pageFrom = pageTo = the explicit page from "[Seite N]"
 *     (single-page constraint: PDF readers don't allow annotations
 *     spanning page breaks — the range degenerates to a point)
 *   properties = {
 *     type:            'Hervorheben'|'Notiz'|'Wellenlinie'|...,
 *     semantic:        'citing'|'commenting',
 *     chapter_context: string|null,
 *     paired_with_index: int|null   // for commenting: index of the
 *                                   // most recent citing annotation;
 *                                   // weak hint only — Notiz/Text can
 *                                   // sit pages away from any prior
 *                                   // markup. The annotates-resolver
 *                                   // is an LLM task with page-scoped
 *                                   // candidates, not a positional rule.
 *   }
 *
 * Cross-document refs (`annotates` from annotation→sentence) are
 * resolved in a separate pass after both documents are loaded, by
 * matching the citing annotation's content against the central
 * document's full_text. Not done in this parser.
 */

import type { ParsedElement, ParseResult } from './types.js';

const HEADER_RE = /^Zusammenfassung der Anmerkungen in (.+?)\.(pdf|PDF)\.?\s*$/;
const ANNOTATION_RE =
	/^(Hervorheben|Wellenlinie|Unterstreichen|Notiz|Text|Rechteck) \[Seite (\d+)\]: ?(.*)$/;
const CITING_TYPES = new Set(['Hervorheben', 'Wellenlinie', 'Unterstreichen']);

/** Detect format by inspecting the first non-empty line. */
export function isAnnotationsExport(text: string): boolean {
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	return HEADER_RE.test(firstLine);
}

interface Heading {
	text: string;
	level: number;  // derived from numbering depth, default 1
}

/**
 * Parse a chapter heading line. Lines may start with a numbering
 * prefix ("1", "1.3.3", "2.1.1"); without prefix, level defaults to 1.
 */
function classifyHeading(line: string): Heading {
	const trimmed = line.trim();
	const m = trimmed.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
	if (!m) return { text: trimmed, level: 1 };
	const dots = (m[1].match(/\./g) || []).length;
	return { text: trimmed, level: dots + 1 };
}

export function parseAnnotationsExport(text: string): ParseResult {
	const lines = text.split(/\r?\n/);
	const elements: ParsedElement[] = [];
	const buf: string[] = [];
	let cursor = 0;

	function emitLeaf(
		type: string,
		content: string,
		properties: Record<string, unknown>,
		page: number | null = null
	): number {
		const start = cursor;
		buf.push(content);
		cursor += content.length;
		buf.push('\n');
		cursor += 1;
		const idx = elements.length;
		elements.push({
			type,
			content,
			charStart: start,
			charEnd: start + content.length,
			pageFrom: page,
			pageTo: page,
			properties
		});
		return idx;
	}

	// First line: header. If the header is missing we still try to parse
	// (caller already used isAnnotationsExport for dispatch); skip the
	// header line if present.
	let i = 0;
	if (i < lines.length && HEADER_RE.test(lines[i])) i++;

	let chapterContext: string | null = null;
	let lastCitingIdx: number | null = null;

	while (i < lines.length) {
		const line = lines[i];
		const stripped = line.trim();

		// Skip blank lines.
		if (!stripped) { i++; continue; }

		// Skip lone numeric lines (page-number footers from the PDF).
		if (/^\d+$/.test(stripped)) { i++; continue; }

		// Annotation entry?
		const m = stripped.match(ANNOTATION_RE);
		if (m) {
			const [, type, pageStr, firstLineText] = m;
			const page = parseInt(pageStr, 10);

			// Collect continuation lines until blank or next annotation.
			// (Notiz/Text comments often wrap across multiple lines.)
			const textLines = firstLineText ? [firstLineText] : [];
			let j = i + 1;
			while (j < lines.length) {
				const nl = lines[j];
				if (!nl.trim()) break;
				if (ANNOTATION_RE.test(nl.trim())) break;
				textLines.push(nl);
				j++;
			}
			const content = textLines.join('\n').trim();
			const semantic: 'citing' | 'commenting' =
				CITING_TYPES.has(type) ? 'citing' : 'commenting';

			const properties: Record<string, unknown> = {
				type,
				semantic,
				chapter_context: chapterContext
			};
			if (semantic === 'commenting' && lastCitingIdx != null) {
				properties.paired_with_index = lastCitingIdx;
			}

			const idx = emitLeaf('annotation', content, properties, page);
			if (semantic === 'citing') lastCitingIdx = idx;

			i = j;
			continue;
		}

		// Otherwise: chapter heading. Becomes the running context for
		// subsequent annotations and is emitted as a structural element
		// so the reader can show the same outline as the source.
		const h = classifyHeading(stripped);
		chapterContext = h.text;
		emitLeaf('heading', h.text, {
			level: h.level,
			heading_source: 'annotation_chapter'
		});
		i++;
	}

	return { elements, format: 'annotations-export' };
}

/** Linearized text, useful when callers want the canonical full_text
 *  to persist (so `substring(full_text, char_start, char_end)` works). */
export function annotationsExportFullText(text: string): string {
	const result = parseAnnotationsExport(text);
	const buf: string[] = [];
	for (const el of result.elements) {
		buf.push(el.content ?? '');
		buf.push('\n');
	}
	return buf.join('');
}
