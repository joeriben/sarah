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
import type { ParsedElement, ParseResult, ElementRef, SectionKind } from './types.js';
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

interface SuperMarker {
	marker: string;     // marker text (typically a numeric digit string)
	atOffset: number;   // char index in the cleaned paragraph text where the
	                    // marker would have appeared inline (i.e. after the
	                    // preceding non-superscript text). Used to assign
	                    // the marker to the sentence whose range contains
	                    // this offset.
}

/**
 * Walk a `<w:p>` and concatenate ALL text (including superscripted
 * footnote-reference numbers — they belong to the sentence). Record
 * the offset of each numeric superscript so we can wire a cross-ref
 * from the containing sentence to the corresponding footnote element.
 *
 * `superStyleIds` is the set of styleId values resolved by walking
 * styles.xml (basedOn chain). Empty set → only inline vertAlign considered.
 */
function paragraphTextAndMarkers(
	p: OoxmlNode,
	superStyleIds: Set<string>
): { text: string; markers: SuperMarker[] } {
	let out = '';
	const markers: SuperMarker[] = [];

	function isSuperRun(r: OoxmlNode): boolean {
		const rPr = r.children.find((c) => c.tag === 'w:rPr');
		if (!rPr) return false;
		const vertAlign = rPr.children.find((c) => c.tag === 'w:vertAlign');
		if (vertAlign?.attrs['w:val'] === 'superscript') return true;
		const rStyle = rPr.children.find((c) => c.tag === 'w:rStyle');
		const sid = rStyle?.attrs['w:val'];
		if (sid && superStyleIds.has(sid)) return true;
		return false;
	}

	function walk(n: OoxmlNode, inSuperRun: boolean) {
		if (n.tag === 'w:r') {
			const sup = inSuperRun || isSuperRun(n);
			if (sup && !inSuperRun) {
				// Top-level superscript run — emit text AND record marker.
				const startOffset = out.length;
				for (const c of n.children) walk(c, true);
				const text = out.slice(startOffset).trim();
				if (/^\d+$/.test(text)) {
					markers.push({ marker: text, atOffset: startOffset });
				}
				return;
			}
			for (const c of n.children) walk(c, sup);
			return;
		}
		if (n.tag === 'w:t' && n.text) out += n.text;
		else if (n.tag === 'w:tab' || n.tag === 'w:br') out += ' ';
		else for (const c of n.children) walk(c, inSuperRun);
	}
	for (const c of p.children) walk(c, false);
	return { text: out, markers };
}

/**
 * Resolve every styleId in styles.xml whose effective rPr has
 * vertAlign='superscript' (directly or via the basedOn chain).
 * Used to detect named-style superscript runs (PDF converters often
 * render footnote refs via a custom 'FootnoteReference' style).
 */
function resolveSuperscriptStyleIds(stylesTree: OoxmlNode[]): Set<string> {
	const direct = new Map<string, boolean>();
	const basedOn = new Map<string, string | undefined>();
	for (const styleNode of findAll(stylesTree, 'w:style')) {
		const sid = styleNode.attrs['w:styleId'];
		if (!sid) continue;
		const rPr = styleNode.children.find((c) => c.tag === 'w:rPr');
		let isSuper = false;
		if (rPr) {
			const vertAlign = rPr.children.find((c) => c.tag === 'w:vertAlign');
			if (vertAlign?.attrs['w:val'] === 'superscript') isSuper = true;
		}
		direct.set(sid, isSuper);
		const base = styleNode.children.find((c) => c.tag === 'w:basedOn');
		basedOn.set(sid, base?.attrs['w:val']);
	}
	function resolve(sid: string | undefined, seen: Set<string>): boolean {
		if (!sid || seen.has(sid) || !direct.has(sid)) return false;
		if (direct.get(sid)) return true;
		seen.add(sid);
		return resolve(basedOn.get(sid), seen);
	}
	const out = new Set<string>();
	for (const sid of direct.keys()) {
		if (resolve(sid, new Set())) out.add(sid);
	}
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

// Caption-like prefixes used to identify figure/table caption paragraphs
// when no explicit pStyle="Caption" is set (PDF→DOCX converters often
// drop the style). Conservative: only treat short paragraphs (< 300
// chars) starting with one of these as caption candidates.
const CAPTION_PREFIX_RE = /^(abb(?:\.|ildung)|tab(?:\.|elle)|fig(?:\.|ure)|schaubild|diagramm)\s*\d/i;

// Numeric-only textbox content is almost certainly a page-number footer
// from a PDF→DOCX rendering (running footer pulled into a floating
// textbox). Emit as `page_marker` rather than `footnote`.
const PAGE_NUMBER_RE = /^\s*\d{1,5}\s*$/;

// Headings whose title matches this regex open a bibliography section.
// Subsequent paragraphs are emitted as element_type='bibliography_entry'
// (one entry per paragraph, no sentence split) until the next heading at
// the same or shallower level.
//
// Resilient German + English coverage:
//   Literatur, Literaturverzeichnis, Literaturliste, Literaturhinweise,
//   Literaturangaben, Bibliografie, Bibliographie, Schrifttum,
//   Quellen, Quellenverzeichnis, Quellenangaben,
//   Bibliography, References, Reference list, Works Cited, Cited Works.
//   Optional prefixes: "Verwendete ", "Zitierte ", "Ausgewählte ",
//   "Verzeichnis der ".
//
// Word-boundary at the end prevents false matches like "Literaturwissen-
// schaft", "Literarisch", "Bibliographische Einführung", etc.
const BIBLIOGRAPHY_RE = new RegExp(
	'^' +
		'(?:verwendete\\s+|zitierte\\s+|ausgew(?:ä|ae)hlte\\s+|verzeichnis\\s+der\\s+)?' +
		'(?:' +
			'literatur(?:verzeichnis|liste|hinweise|angaben|nachweise)?' +
			'|bibliogra(?:fie|phie|phy)' +
			'|reference(?:s|\\s+list)?' +
			'|works\\s+cited' +
			'|cited\\s+works' +
			'|quellen(?:verzeichnis|angaben|nachweise)?' +
			'|schrifttum' +
		')' +
		'\\b',
	'i'
);

// Front-matter heading anchors. These titles appear in the introductory
// apparatus of a qualification work (before the main body). When section
// state is still 'front_matter', a heading matching this regex KEEPS the
// state at front_matter (it does not promote to main) — that's the only
// reason this regex exists. Mid-document occurrences (e.g. a final
// "Zusammenfassung" chapter) leave the state alone, so they end up
// classified by the surrounding state (typically 'main').
const FRONT_MATTER_RE = new RegExp(
	'^' +
		'(?:' +
			'vorwort' +
			'|geleitwort' +
			'|widmung' +
			'|danksagung' +
			'|abstract' +
			'|zusammenfassung' +
			'|kurzfassung' +
			'|kurzzusammenfassung' +
			'|executive\\s+summary' +
			'|preface' +
			'|foreword' +
			'|acknowledg(?:e)?ments?' +
			'|dedication' +
			'|inhaltsverzeichnis' +
			'|inhalt' +
			'|table\\s+of\\s+contents' +
			'|abbildungsverzeichnis' +
			'|tabellenverzeichnis' +
			'|abk(?:ü|ue)rzungsverzeichnis' +
			'|formelverzeichnis' +
			'|verzeichnis\\s+der\\s+(?:abbildungen|tabellen|abk(?:ü|ue)rzungen|formeln)' +
			'|list\\s+of\\s+(?:figures|tables|abbreviations|symbols)' +
			'|eidesstattliche\\s+erkl(?:ä|ae)rung' +
			'|selbst(?:st)?(?:ä|ae)ndigkeitserkl(?:ä|ae)rung' +
		')' +
		'\\b',
	'i'
);

// Appendix / back-matter heading anchors. Switches section state into
// 'appendix' (a terminal state — the only legal exit is into 'bibliography'
// for works that place Anhang before Literaturverzeichnis, handled by
// BIBLIOGRAPHY_RE running after this check).
const APPENDIX_RE = new RegExp(
	'^' +
		'(?:' +
			'anhang(?:\\s+[a-z0-9])?' +
			'|anh(?:ä|ae)nge' +
			'|anlage(?:n|\\s+[a-z0-9])?' +
			'|appendi(?:x|ces)(?:\\s+[a-z0-9])?' +
			'|nachwort' +
			'|epilog' +
		')' +
		'\\b',
	'i'
);

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
	supMarkers: SuperMarker[];  // numeric superscript markers with text-offset
	drawingTexts: (string | null)[];   // text content of inline <wps:txbx> drawings, or null
	hasInlineImage: boolean;    // <w:drawing> without textbox content present (true figure)
}

function readParagraph(p: OoxmlNode, superStyleIds: Set<string>): BodyParagraph {
	const pStyle = findFirst(p.children, 'w:pStyle')?.attrs['w:val'];
	const bookmarks = findAll(p.children, 'w:bookmarkStart')
		.map((b) => b.attrs['w:name'])
		.filter(Boolean);
	const anchors = findAll(p.children, 'w:hyperlink')
		.map((h) => h.attrs['w:anchor'])
		.filter(Boolean);
	const { text, markers: supMarkers } = paragraphTextAndMarkers(p, superStyleIds);

	// Drawings: look for <wps:txbx>/<w:txbxContent> text — PDF converters render
	// footnotes / floating headers / annotations as textboxes here. A drawing
	// without textbox content is an actual inline image (true figure).
	const drawingTexts: (string | null)[] = [];
	let hasInlineImage = false;
	for (const d of findAll(p.children, 'w:drawing')) {
		const txbx = findFirst([d], 'wps:txbx') ?? findFirst([d], 'w:txbxContent');
		if (txbx) {
			const txt = nodeText(txbx).trim();
			drawingTexts.push(txt || null);
		} else {
			drawingTexts.push(null);
			hasInlineImage = true;
		}
	}

	return { pStyle, bookmarks, anchors, text, supMarkers, drawingTexts, hasInlineImage };
}

// Caption detection: pStyle-based first (most reliable), then text-prefix
// fallback for converters that drop the style.
const CAPTION_PSTYLE_RE = /^(caption|beschriftung|bildunterschrift|tabellen?(?:beschriftung|titel))\b/i;
function isCaptionByStyle(pStyle: string | undefined): boolean {
	return !!pStyle && CAPTION_PSTYLE_RE.test(pStyle);
}
function isCaptionByText(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 300) return false;
	return CAPTION_PREFIX_RE.test(t);
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

	const rawBlocks = [...iterBlocks(body)];

	// Pre-compute styleIds whose effective rPr is superscript so footnote
	// reference markers rendered via a named style are excluded from text.
	const superStyleIds = resolveSuperscriptStyleIds(stylesTree);

	/**
	 * Merge consecutive plain `<w:p>` blocks where the first one does not
	 * end with a sentence-terminator. PDF→DOCX converters (and some Word
	 * writers) introduce spurious paragraph breaks at line-wraps, so the
	 * sentence "Auch internationale Programme legte einen" + "Schwerpunkt
	 * auf Mädchen…" arrives as two `<w:p>` even though it is one sentence.
	 *
	 * Rules:
	 * - Both blocks must be plain paragraphs (not headings, TOC, tables,
	 *   etc. — those are detected via pStyle / non-w:p tag).
	 * - First block's text must end with anything OTHER than `. ? ! … :`
	 *   (after trimming trailing whitespace).
	 * - First block's text must be non-empty (empty paragraphs are visual
	 *   spacers and are not merge candidates either).
	 *
	 * Merging concatenates child arrays so subsequent paragraph reading
	 * (text, markers, drawings) sees the joined run sequence.
	 */
	const TERMINATORS = /[.?!…:][)\]"'»”]*\s*$/;
	function isProseParagraph(b: OoxmlNode): boolean {
		if (b.tag !== 'w:p') return false;
		const pStyleEl = findFirst(b.children, 'w:pStyle');
		const sid = pStyleEl?.attrs['w:val'];
		if (!sid) return true;
		if (sid.startsWith('TOC')) return false;
		// Headings (TOC-bookmark or pStyle) — same heuristic check would be
		// expensive here; skip merge if the style resolves to a heading level.
		if (resolveHeadingLevelByStyleId(sid, stylesTree) != null) return false;
		return true;
	}

	const blocks: OoxmlNode[] = [];
	for (const b of rawBlocks) {
		const last = blocks.length ? blocks[blocks.length - 1] : null;
		if (
			last &&
			isProseParagraph(last) &&
			isProseParagraph(b) &&
			!last.attrs['__sarah_no_merge']
		) {
			const lastText = paragraphTextAndMarkers(last, superStyleIds).text;
			if (lastText.trim() && !TERMINATORS.test(lastText)) {
				// Merge: append b's children into last's children, drop b.
				// Insert a soft-space between to avoid run collisions.
				last.children.push(
					{ tag: 'w:r', attrs: {}, children: [{ tag: 'w:t', attrs: {}, children: [], text: ' ' }] }
				);
				for (const c of b.children) last.children.push(c);
				continue;
			}
		}
		blocks.push(b);
	}

	// Pass 1 — TOC: paragraphs with pStyle ∈ TOC1..TOC9
	const bookmarkToLevel = new Map<string, number>();
	const tocEntries: { text: string; level: number; anchor: string | null }[] = [];

	for (const b of blocks) {
		if (b.tag !== 'w:p') continue;
		const p = readParagraph(b, superStyleIds);
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

	// Footnote refs originate from the SENTENCE that carries the marker,
	// not from the surrounding paragraph (the footnote refers to that
	// specific sentence). Order-paired against footnote elements appearing
	// later in body order.
	const pendingFootnoteRefs: { sentence: ParsedElement; marker: string }[] = [];
	const footnoteElements: ParsedElement[] = [];

	// Bibliography section detection. When the body walk hits a heading
	// whose title matches BIBLIOGRAPHY_RE, every subsequent paragraph is
	// emitted as element_type='bibliography_entry' (no sentence split, no
	// footnote pairing). The bibliography section ends at the next heading
	// of the same or shallower level, or at end of document.
	let inBibliography = false;
	let bibliographyHeadingLevel: number | null = null;

	function emitLeaf(type: string, content: string, properties?: Record<string, unknown>): number {
		const start = cursor;
		textBuf.push(content);
		cursor += content.length;
		textBuf.push('\n');
		cursor += 1;
		const idx = elements.length;
		elements.push({
			type,
			content,
			charStart: start,
			charEnd: start + content.length,
			properties: properties ?? {}
		});
		return idx;
	}

	/**
	 * Emit a container element (paragraph, table, figure). Stores
	 * `content = null` per schema convention — the container's text is
	 * the concatenation of its leaf descendants, not its own column. The
	 * `virtualText` is still appended to the linearized full_text and
	 * advances the cursor so subsequent elements have correct offsets.
	 */
	function emitContainer(type: string, virtualText: string, properties?: Record<string, unknown>): number {
		const start = cursor;
		textBuf.push(virtualText);
		cursor += virtualText.length;
		textBuf.push('\n');
		cursor += 1;
		const idx = elements.length;
		elements.push({
			type,
			content: null,
			charStart: start,
			charEnd: start + virtualText.length,
			properties: properties ?? {}
		});
		return idx;
	}

	for (const block of blocks) {
		if (block.tag !== 'w:p') {
			if (block.tag === 'w:tbl') {
				const rows = findAll(block.children, 'w:tr');
				const cols = Math.max(0, ...rows.map((r) => findAll(r.children, 'w:tc').length));
				emitContainer("table", "", {
					outline_path: [...outlinePath],
					rows: rows.length,
					cols
				});
				lastWasHeading = false;
			}
			continue;
		}

		const p = readParagraph(block, superStyleIds);

		// 1) TOC entry
		if (p.pStyle && p.pStyle.startsWith('TOC')) {
			const cleanTitle = p.text.trim().replace(/[\s ]*\d+$/, '').trim();
			emitLeaf("toc_entry", cleanTitle, {
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

			// Bibliography section state machine: opens here if the title
			// matches; closes when we encounter a heading at the same or
			// shallower level than the bibliography heading itself.
			const isBibliographyHeading = BIBLIOGRAPHY_RE.test(text);
			if (
				inBibliography &&
				bibliographyHeadingLevel != null &&
				headingLevel <= bibliographyHeadingLevel &&
				!isBibliographyHeading
			) {
				inBibliography = false;
				bibliographyHeadingLevel = null;
			}

			const headingProps: Record<string, unknown> = {
				level: headingLevel,
				heading_source: headingSource,
				outline_path: [...outlinePath],
				bookmarks: p.bookmarks
			};
			if (isBibliographyHeading) {
				headingProps.is_bibliography_section = true;
				inBibliography = true;
				bibliographyHeadingLevel = headingLevel;
			}
			emitLeaf('heading', text, headingProps);
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

		// 4a) Bibliography section: emit each non-empty paragraph as a
		//      single bibliography_entry. No sentence split (entries are
		//      records, not prose), no footnote-marker pairing.
		if (inBibliography && text) {
			emitLeaf('bibliography_entry', text, {
				outline_path: [...outlinePath]
			});
			lastWasHeading = false;
			continue;
		}

		let paragraphIdx: number | null = null;
		if (text) {
			const positionRole = lastWasHeading ? 'after_heading' : 'mid';
			const props: Record<string, unknown> = {
				outline_path: [...outlinePath],
				position_role: positionRole,
				has_drawing: p.drawingTexts.length > 0
			};
			// Container: content=NULL by schema convention. virtualText
			// (the paragraph's plain text) is still appended to the
			// linearized full_text so subsequent char-offsets line up.
			paragraphIdx = emitContainer('paragraph', text, props);
			lastWasHeading = false;
			pendingPositionFixup.push(paragraphIdx);

			// Sentence split (German-aware), char offsets relative to paragraph start.
			// Note: text was trimmed before sentence-split, but supMarkers' atOffset
			// indices are against the UNTRIMMED text. Compute the offset shift caused
			// by the leading trim so we can map markers into the trimmed text.
			const leadingTrim = p.text.length - p.text.trimStart().length;
			const paragraphStart = elements[paragraphIdx].charStart;
			const sents = splitGermanSentences(text, paragraphStart);
			const sentenceElems: ParsedElement[] = [];
			for (const s of sents) {
				const sentEl: ParsedElement = {
					type: 'sentence',
					content: s.text,
					charStart: s.start,
					charEnd: s.end,
					properties: {}
				};
				elements.push(sentEl);
				sentenceElems.push(sentEl);
				if (!elements[paragraphIdx].children) elements[paragraphIdx].children = [];
				elements[paragraphIdx].children!.push(sentEl);
			}

			// Bind each marker to the sentence whose paragraph-relative range
			// contains the marker's offset (with a 1-char tolerance so a marker
			// sitting exactly on a sentence boundary attaches to the preceding
			// sentence). Falls back to the last sentence if the marker is past
			// the end of the trimmed text (rare but possible).
			for (const m of p.supMarkers) {
				const offsetInTrimmed = m.atOffset - leadingTrim;
				const docOffset = paragraphStart + Math.max(0, offsetInTrimmed);
				let bound: ParsedElement | null = null;
				// Prefer the sentence whose [start, end] strictly contains the offset.
				for (const s of sentenceElems) {
					if (docOffset >= s.charStart && docOffset <= s.charEnd) {
						bound = s;
						break;
					}
				}
				// Otherwise: the sentence whose end is closest to the marker offset
				// (typically: marker comes immediately after a terminator).
				if (!bound && sentenceElems.length) {
					let best = sentenceElems[0];
					for (const s of sentenceElems) {
						if (s.charEnd <= docOffset && s.charEnd >= best.charEnd) best = s;
					}
					bound = best;
				}
				if (bound) {
					pendingFootnoteRefs.push({ sentence: bound, marker: m.marker });
				}
			}
		}

		// Drawings: classify each drawing in the paragraph.
		//   - <w:drawing> with no textbox  → 'figure' (true inline image)
		//   - textbox with pure-numeric    → 'page_marker' (PDF page-number footer)
		//   - textbox with other text      → 'footnote' (default; PDF converters
		//                                    render real footnotes here)
		// The figure index is tracked so a following caption can attach.
		let lastFigureOrTableIdx: number | null = null;
		for (const drawingText of p.drawingTexts) {
			if (drawingText) {
				if (PAGE_NUMBER_RE.test(drawingText)) {
					emitLeaf('page_marker', drawingText.trim(), {
						outline_path: [...outlinePath],
						kind: 'page_number'
					});
				} else {
					const idx = emitLeaf('footnote', drawingText, {
						outline_path: [...outlinePath]
					});
					footnoteElements.push(elements[idx]);
				}
			} else {
				const figIdx = emitContainer('figure', '', {
					outline_path: [...outlinePath]
				});
				lastFigureOrTableIdx = figIdx;
			}
			lastWasHeading = false;
		}
		// Caption pairing: if THIS paragraph itself is a caption candidate
		// (by pStyle or text-prefix), the just-emitted paragraph element
		// is reclassified as 'caption' and linked via caption_of to the
		// preceding figure/table. We can't reclassify after-the-fact in
		// the existing element rows array, so we track this by adding
		// a ref. For paragraphs that are captions to a FOLLOWING figure,
		// we keep `pendingCaptionIdx` and resolve on the next emit.
		if (paragraphIdx != null) {
			const isCaption = isCaptionByStyle(p.pStyle) || isCaptionByText(text);
			if (isCaption) {
				// Mark the paragraph as a caption via properties, plus
				// record a ref to the preceding figure/table if any.
				(elements[paragraphIdx].properties as Record<string, unknown>).is_caption = true;
				if (lastFigureOrTableIdx != null) {
					if (!elements[paragraphIdx].refs) elements[paragraphIdx].refs = [];
					elements[paragraphIdx].refs!.push({
						toIndex: lastFigureOrTableIdx,
						refType: 'caption_of'
					});
				}
			}
		}
	}

	// Refs: footnote_at, FROM the sentence that carries the marker TO the
	// matching footnote element (paired by body order).
	for (let i = 0; i < pendingFootnoteRefs.length && i < footnoteElements.length; i++) {
		const { sentence, marker } = pendingFootnoteRefs[i];
		const footnote = footnoteElements[i];
		const toIndex = elements.indexOf(footnote);
		if (toIndex < 0) continue;
		if (!sentence.refs) sentence.refs = [];
		sentence.refs.push({
			toIndex,
			refType: 'footnote_at',
			properties: { footnote_match: 'order_heuristic', marker }
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

	// Pass 3 — assign section_kind and page_from/page_to to every element.
	// Runs over the flat array (still includes sentence children at this
	// point) so paragraphs and their sentences get the same labels.
	//
	// section_kind state machine — driven by heading text:
	//   • start: 'front_matter'
	//   • BIBLIOGRAPHY_RE  → 'bibliography' (chapter-level bibliographies
	//     close again on a heading at same/shallower level than the bib
	//     heading itself; mirrors the `inBibliography` logic above)
	//   • APPENDIX_RE      → 'appendix'
	//   • FRONT_MATTER_RE  → no transition (anchor; prevents the next
	//     non-apparatus heading from promoting front_matter → main)
	//   • any other heading → if state is 'front_matter', promote to 'main';
	//     otherwise the state is sticky.
	//
	// page_from / page_to — footer convention: a `page_marker` element with
	// numeric content N closes its own page. Every element emitted since the
	// previous page_marker (or since document start, for the leading run) is
	// assigned page_from = page_to = N. Elements before the very first
	// page_marker are left NULL — typically Roman-numbered or unnumbered
	// front matter where Arabic page numbers do not yet apply.
	{
		let sectionKind: SectionKind = 'front_matter';
		let bibSectionLevel: number | null = null;
		let pendingForPage: ParsedElement[] = [];

		for (const el of elements) {
			if (el.type === 'heading') {
				const text = (el.content ?? '').trim();
				const level =
					typeof (el.properties as any)?.level === 'number'
						? ((el.properties as any).level as number)
						: 1;
				const isBib = BIBLIOGRAPHY_RE.test(text);
				const isAppendix = APPENDIX_RE.test(text);
				const isFront = FRONT_MATTER_RE.test(text);

				// Close a bibliography section on a same- or shallower-level
				// heading that is not itself a bib heading.
				let exitedBib = false;
				if (
					sectionKind === 'bibliography' &&
					bibSectionLevel != null &&
					level <= bibSectionLevel &&
					!isBib
				) {
					exitedBib = true;
					bibSectionLevel = null;
				}

				if (isBib) {
					sectionKind = 'bibliography';
					bibSectionLevel = level;
				} else if (isAppendix) {
					sectionKind = 'appendix';
				} else if (isFront) {
					// anchor: keep state
				} else if (exitedBib) {
					// post-bib regular heading: drop back to main (not appendix —
					// APPENDIX_RE already would have caught Anhang etc. above).
					sectionKind = 'main';
				} else if (sectionKind === 'front_matter') {
					sectionKind = 'main';
				}
			}
			el.sectionKind = sectionKind;

			if (el.type === 'page_marker') {
				const pageNum = parseInt((el.content ?? '').trim(), 10);
				if (Number.isFinite(pageNum)) {
					for (const p of pendingForPage) {
						p.pageFrom = pageNum;
						p.pageTo = pageNum;
					}
					el.pageFrom = pageNum;
					el.pageTo = pageNum;
				}
				pendingForPage = [];
			} else {
				pendingForPage.push(el);
			}
		}
		// Trailing elements after the last page_marker keep pageFrom/pageTo
		// undefined → stored as NULL.
	}

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
