// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structure-aware DOCX (OOXML) parser for SARAH.
 *
 * transact-qda's plain-text path runs `mammoth` once and then splits the
 * resulting flat string with a generic regex — losing heading levels,
 * footnote anchors, and any structural metadata. SARAH analyses
 * structured academic texts; we need that structure back.
 *
 * Pipeline:
 *
 *   ZIP unwrap (yauzl)
 *      └─ word/document.xml + word/styles.xml + (optional) word/footnotes.xml
 *   XML parse (fast-xml-parser, preserveOrder)
 *      └─ TOC pre-pass: collect bookmark→level map from TOC1..TOC9 paragraphs
 *      └─ Body walk: for each w:p
 *            * heading classification (TOC bookmark match → pStyle fallback)
 *            * paragraph + sentence split (German abbrev-aware)
 *            * detect footnote markers (vertAlign superscript)
 *            * detect inline drawings → footnote textboxes (PDF-converter case)
 *
 * Output: ParsedElement tree wired against transact-qda's
 * document_elements / document_element_refs schema.
 *
 * Lifted in shape from the python-rebuild's `backend/documents/extractors/
 * docx.py`; ported to TypeScript because SARAH lives in SvelteKit.
 */

import yauzl from 'yauzl';
import { Buffer } from 'node:buffer';
import { XMLParser } from 'fast-xml-parser';
import type { ParsedElement, ParseResult, ElementRef } from './types.js';
import { splitGermanSentences } from './sentences-de.js';

// ── XML helpers ──────────────────────────────────────────────────

interface OoxmlNode {
	tag: string;                      // e.g. 'w:p', or '#text'
	attrs: Record<string, string>;
	children: OoxmlNode[];
	text?: string;
}

const ATTR_KEY = ':@';

function _convert(node: any): OoxmlNode | null {
	if (!node || typeof node !== 'object') return null;

	// Determine tag (the only non-attr key)
	const keys = Object.keys(node).filter((k) => k !== ATTR_KEY);
	if (keys.length !== 1) return null;
	const tag = keys[0];

	const attrs: Record<string, string> = {};
	const rawAttrs = node[ATTR_KEY];
	if (rawAttrs && typeof rawAttrs === 'object') {
		for (const [k, v] of Object.entries(rawAttrs)) {
			if (k.startsWith('@_')) attrs[k.slice(2)] = String(v);
		}
	}

	const value = node[tag];
	const children: OoxmlNode[] = [];
	let text: string | undefined;

	if (typeof value === 'string') {
		text = value;
	} else if (Array.isArray(value)) {
		for (const child of value) {
			if (child && typeof child === 'object') {
				if ('#text' in child) {
					// fast-xml-parser preserveOrder text node
					const t = String(child['#text']);
					if (text == null) text = t; else text += t;
				} else {
					const c = _convert(child);
					if (c) children.push(c);
				}
			}
		}
	}
	return { tag, attrs, children, text };
}

function parseXml(xml: string): OoxmlNode[] {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		preserveOrder: true,
		parseAttributeValue: false,
		allowBooleanAttributes: true,
		trimValues: false
	});
	const arr = parser.parse(xml) as any[];
	const out: OoxmlNode[] = [];
	for (const item of arr) {
		const node = _convert(item);
		if (node) out.push(node);
	}
	return out;
}

function findFirst(nodes: OoxmlNode[], tag: string): OoxmlNode | null {
	for (const n of nodes) {
		if (n.tag === tag) return n;
		const inChild = findFirst(n.children, tag);
		if (inChild) return inChild;
	}
	return null;
}

function findAll(nodes: OoxmlNode[], tag: string, out: OoxmlNode[] = []): OoxmlNode[] {
	for (const n of nodes) {
		if (n.tag === tag) out.push(n);
		findAll(n.children, tag, out);
	}
	return out;
}

// Concatenate all w:t descendants of a node, expanding tabs/breaks to spaces.
function nodeText(node: OoxmlNode): string {
	let out = '';
	function walk(n: OoxmlNode) {
		if (n.tag === 'w:t' && n.text) out += n.text;
		else if (n.tag === 'w:tab' || n.tag === 'w:br') out += ' ';
		for (const c of n.children) walk(c);
	}
	walk(node);
	return out;
}

// ── ZIP unwrap ───────────────────────────────────────────────────

function unzipDocxParts(buffer: Buffer): Promise<Record<string, string>> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err ?? new Error('zip open failed'));
			const want = new Set([
				'word/document.xml',
				'word/styles.xml',
				'word/footnotes.xml',
				'word/numbering.xml'
			]);
			const out: Record<string, string> = {};
			zipfile.on('entry', (entry) => {
				if (!want.has(entry.fileName)) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (err2, stream) => {
					if (err2 || !stream) return reject(err2 ?? new Error('read failed'));
					const chunks: Buffer[] = [];
					stream.on('data', (c) => chunks.push(c as Buffer));
					stream.on('end', () => {
						out[entry.fileName] = Buffer.concat(chunks).toString('utf-8');
						zipfile.readEntry();
					});
					stream.on('error', reject);
				});
			});
			zipfile.on('end', () => resolve(out));
			zipfile.on('error', reject);
			zipfile.readEntry();
		});
	});
}

// ── Heading-style resolution (transact-qda-style + DE custom names) ──

const HEADING_PREFIXES = ['heading ', 'überschrift ', 'ueberschrift '];

function headingLevelFromName(name: string | undefined): number | null {
	if (!name) return null;
	const n = name.trim().toLowerCase();
	for (const prefix of HEADING_PREFIXES) {
		if (n.startsWith(prefix)) {
			const tail = n.slice(prefix.length).trim();
			const level = parseInt(tail, 10);
			return Number.isFinite(level) ? level : null;
		}
	}
	return null;
}

function resolveHeadingLevelByStyleId(
	styleId: string | undefined,
	stylesXml: OoxmlNode[]
): number | null {
	if (!styleId) return null;
	const seen = new Set<string>();
	let current: string | undefined = styleId;
	while (current && !seen.has(current)) {
		seen.add(current);
		const styleNode = findAll(stylesXml, 'w:style').find(
			(s) => s.attrs['w:styleId'] === current
		);
		if (!styleNode) return null;
		const nameNode = styleNode.children.find((c) => c.tag === 'w:name');
		const name = nameNode?.attrs['w:val'];
		const level = headingLevelFromName(name);
		if (level != null) return level;
		const basedOn = styleNode.children.find((c) => c.tag === 'w:basedOn');
		current = basedOn?.attrs['w:val'];
	}
	return null;
}

// ── Body element classification ──────────────────────────────────

interface BodyParagraph {
	pStyle: string | undefined;
	bookmarks: string[];        // names of <w:bookmarkStart> within this paragraph
	anchors: string[];          // anchor attrs of <w:hyperlink> within this paragraph
	text: string;
	supMarkers: string[];       // numeric superscript markers (footnote refs)
	drawingTexts: (string | null)[];   // text content of inline <wps:txbx> drawings, or null
}

function readParagraph(p: OoxmlNode): BodyParagraph {
	const pStyle = findFirst(p.children, 'w:pStyle')?.attrs['w:val'];
	const bookmarks = findAll(p.children, 'w:bookmarkStart')
		.map((b) => b.attrs['w:name'])
		.filter(Boolean);
	const anchors = findAll(p.children, 'w:hyperlink')
		.map((h) => h.attrs['w:anchor'])
		.filter(Boolean);
	const text = nodeText(p);

	// Superscript markers in run-level rPr/vertAlign='superscript'
	const supMarkers: string[] = [];
	for (const r of findAll(p.children, 'w:r')) {
		const rPr = r.children.find((c) => c.tag === 'w:rPr');
		if (!rPr) continue;
		const vertAlign = rPr.children.find((c) => c.tag === 'w:vertAlign');
		const isSuper = vertAlign?.attrs['w:val'] === 'superscript';
		if (!isSuper) continue;
		const t = nodeText(r).trim();
		if (/^\d+$/.test(t)) supMarkers.push(t);
	}

	// Drawings: look for <wps:txbx>/<w:txbxContent> text — PDF converters render
	// footnotes as floating textboxes here.
	const drawingTexts: (string | null)[] = [];
	for (const d of findAll(p.children, 'w:drawing')) {
		const txbx = findFirst([d], 'wps:txbx') ?? findFirst([d], 'w:txbxContent');
		if (txbx) {
			const txt = nodeText(txbx).trim();
			drawingTexts.push(txt || null);
		} else {
			drawingTexts.push(null);
		}
	}

	return { pStyle, bookmarks, anchors, text, supMarkers, drawingTexts };
}

// ── Main extract ─────────────────────────────────────────────────

export async function extractDocxAcademic(buffer: Buffer): Promise<{
	fullText: string;
	result: ParseResult;
}> {
	const parts = await unzipDocxParts(buffer);
	const docXml = parts['word/document.xml'];
	if (!docXml) throw new Error('word/document.xml missing');

	const docTree = parseXml(docXml);
	const stylesTree = parts['word/styles.xml'] ? parseXml(parts['word/styles.xml']) : [];

	const document = findFirst(docTree, 'w:document');
	const body = document ? findFirst(document.children, 'w:body') : null;
	if (!body) throw new Error('w:body missing');

	// Body block elements: w:p and w:tbl, transparently passing through w:sdt.
	function* iterBlocks(node: OoxmlNode): Generator<OoxmlNode> {
		for (const c of node.children) {
			if (c.tag === 'w:p' || c.tag === 'w:tbl') {
				yield c;
			} else if (c.tag === 'w:sdt') {
				const content = c.children.find((cc) => cc.tag === 'w:sdtContent');
				if (content) yield* iterBlocks(content);
			}
			// w:sectPr etc. ignored
		}
	}

	const blocks = [...iterBlocks(body)];

	// Pass 1 — TOC: paragraphs with pStyle ∈ TOC1..TOC9
	const bookmarkToLevel = new Map<string, number>();
	const tocEntries: { text: string; level: number; anchor: string | null }[] = [];

	for (const b of blocks) {
		if (b.tag !== 'w:p') continue;
		const p = readParagraph(b);
		if (!p.pStyle?.startsWith('TOC')) continue;
		const tail = p.pStyle.slice(3);
		let level = 1;
		const fromStyle = parseInt(tail, 10);
		if (Number.isFinite(fromStyle)) level = fromStyle;

		// Strip trailing page number (TOC entries often `Methodik\t47`)
		let title = p.text.trim();
		title = title.replace(/[\s ]*\d+$/, '').trim();

		const anchor = p.anchors[0] ?? null;
		tocEntries.push({ text: title, level, anchor });
		if (anchor) bookmarkToLevel.set(anchor, level);
	}

	// Pass 2 — Body walk
	const elements: ParsedElement[] = [];
	const textBuf: string[] = [];
	let cursor = 0;
	let outlinePath: string[] = [];
	let lastWasHeading = false;
	let pendingPositionFixup: number[] = []; // indices of paragraphs that may become 'before_heading'

	const pendingFootnoteMarkers: { paragraphIndex: number; marker: string }[] = [];
	const footnoteIndices: number[] = [];

	function emit(type: string, content: string | null, properties?: Record<string, unknown>): number {
		const text = content ?? '';
		const start = cursor;
		textBuf.push(text);
		cursor += text.length;
		textBuf.push('\n');
		cursor += 1;
		const idx = elements.length;
		elements.push({
			type,
			content,
			charStart: start,
			charEnd: start + text.length,
			properties: properties ?? {}
		});
		return idx;
	}

	for (const block of blocks) {
		if (block.tag !== 'w:p') {
			if (block.tag === 'w:tbl') {
				const rows = findAll(block.children, 'w:tr');
				const cols = Math.max(0, ...rows.map((r) => findAll(r.children, 'w:tc').length));
				emit('table', null, {
					outline_path: [...outlinePath],
					rows: rows.length,
					cols
				});
				lastWasHeading = false;
			}
			continue;
		}

		const p = readParagraph(block);

		// 1) TOC entry
		if (p.pStyle && p.pStyle.startsWith('TOC')) {
			const cleanTitle = p.text.trim().replace(/[\s ]*\d+$/, '').trim();
			emit('toc_entry', cleanTitle, {
				toc_anchor: p.anchors[0] ?? null,
				toc_level: parseInt(p.pStyle.slice(3), 10) || 1
			});
			continue;
		}

		// 2) Heading via TOC bookmark
		let headingLevel: number | null = null;
		let headingSource: 'toc_bookmark' | 'pstyle' | null = null;
		for (const bm of p.bookmarks) {
			if (bookmarkToLevel.has(bm)) {
				headingLevel = bookmarkToLevel.get(bm)!;
				headingSource = 'toc_bookmark';
				break;
			}
		}

		// 3) pStyle fallback
		if (headingLevel == null) {
			const lvl = resolveHeadingLevelByStyleId(p.pStyle, stylesTree);
			if (lvl != null) {
				headingLevel = lvl;
				headingSource = 'pstyle';
			}
		}

		if (headingLevel != null) {
			const text = p.text.trim();
			if (!text) continue;
			outlinePath = outlinePath.slice(0, headingLevel - 1);
			outlinePath.push(text);
			emit('heading', text, {
				level: headingLevel,
				heading_source: headingSource,
				outline_path: [...outlinePath],
				bookmarks: p.bookmarks
			});
			lastWasHeading = true;
			for (const fixIdx of pendingPositionFixup) {
				(elements[fixIdx].properties as any).position_role = 'before_heading';
			}
			pendingPositionFixup = [];
			continue;
		}

		// 4) Plain paragraph (with optional drawings/footnotes from textboxes)
		const text = p.text.trim();
		if (!text && p.drawingTexts.every((dt) => !dt)) continue;

		let paragraphIdx: number | null = null;
		if (text) {
			const positionRole = lastWasHeading ? 'after_heading' : 'mid';
			const props: Record<string, unknown> = {
				outline_path: [...outlinePath],
				position_role: positionRole,
				has_drawing: p.drawingTexts.length > 0
			};
			if (p.supMarkers.length) props.footnote_markers = p.supMarkers;
			paragraphIdx = emit('paragraph', text, props);
			lastWasHeading = false;
			pendingPositionFixup.push(paragraphIdx);

			// Sentence split (German-aware), char offsets relative to paragraph start
			const paragraphStart = elements[paragraphIdx].charStart;
			const sents = splitGermanSentences(text, paragraphStart);
			for (const s of sents) {
				const idx = elements.length;
				elements.push({
					type: 'sentence',
					content: s.text,
					charStart: s.start,
					charEnd: s.end,
					properties: {}
				});
				// Track parent via children-array: we'll attach later in flatten
				if (!elements[paragraphIdx].children) elements[paragraphIdx].children = [];
				elements[paragraphIdx].children!.push(elements[idx]);
			}

			// Track sup-markers for footnote_at refs
			for (const marker of p.supMarkers) {
				pendingFootnoteMarkers.push({ paragraphIndex: paragraphIdx, marker });
			}
		}

		// Drawings as footnote-textboxes (PDF-converter rendering)
		for (const drawingText of p.drawingTexts) {
			if (drawingText) {
				const idx = emit('footnote', drawingText, { outline_path: [...outlinePath] });
				footnoteIndices.push(idx);
			} else {
				emit('figure', null, { outline_path: [...outlinePath] });
			}
			lastWasHeading = false;
		}
	}

	// Refs: footnote_at by paired body order (super-marker N → footnote N)
	const refs: ElementRef[] = [];
	for (let i = 0; i < pendingFootnoteMarkers.length && i < footnoteIndices.length; i++) {
		const fn = pendingFootnoteMarkers[i];
		// Wire as ref on the paragraph element, pointing to footnote
		const paragraph = elements[fn.paragraphIndex];
		if (!paragraph.refs) paragraph.refs = [];
		paragraph.refs.push({
			toIndex: footnoteIndices[i],
			refType: 'footnote_at',
			properties: { footnote_match: 'order_heuristic', marker: fn.marker }
		});
	}

	// Refs: toc_entry_for (toc_entry → heading), resolved by bookmark name
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i];
		if (el.type !== 'toc_entry') continue;
		const anchor = (el.properties as any)?.toc_anchor;
		if (!anchor) continue;
		// Find heading whose bookmarks include this anchor
		for (let j = 0; j < elements.length; j++) {
			const h = elements[j];
			if (h.type !== 'heading') continue;
			const bms = (h.properties as any)?.bookmarks as string[] | undefined;
			if (bms && bms.includes(anchor)) {
				if (!el.refs) el.refs = [];
				el.refs.push({ toIndex: j, refType: 'toc_entry_for' });
				break;
			}
		}
	}

	const fullText = textBuf.join('');

	// We've been building elements as a flat array, but using children for
	// paragraph→sentence nesting. Promote those children into a top-level
	// tree by removing the duplicate flat sentence entries and keeping them
	// only inside the paragraph's children array.
	const childIds = new Set<ParsedElement>();
	for (const el of elements) {
		if (el.children) for (const c of el.children) childIds.add(c);
	}
	const topLevel = elements.filter((e) => !childIds.has(e));

	return {
		fullText,
		result: { elements: topLevel, format: 'docx-academic' }
	};
}
