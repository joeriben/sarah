// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * German-aware sentence splitter.
 *
 * Replaces transact-qda's plain-text regex (which mangles `vgl.`,
 * `Costa & Weselek, 2023).` and similar). Two-stage approach:
 *
 * 1. Mark abbreviation periods as protected (replace with U+E000) so they
 *    don't trigger sentence boundaries.
 * 2. Split on `[.?!][)\]"'»]*` followed by whitespace and an uppercase
 *    letter or digit-start.
 * 3. Restore protected periods after splitting.
 *
 * Output: array of { text, start, end } where offsets are relative to the
 * caller's `baseOffset` argument (typically the paragraph's char_start).
 *
 * Abbreviation list curated for German academic prose. Add domain terms
 * as they show up. Initials with single letter + dot (`H. Müller`) are
 * caught by a separate regex that requires the next character to be a
 * lowercase letter or another initial.
 */

const PROTECT = ''; // private-use char, never appears in real text

// German academic-prose abbreviations. Match case-insensitively as whole-token.
// Listing covers: hint/reference (vgl./bspw./z.B.), section/page (S./Bd./
// Nr./Abs./Aufl./Hrsg./Jg./Kap.), illustrations (Abb./Tab.), units (ca./
// etwa), generic (u.a./u.Ä./d.h./bzw./ggf./evtl./ca./inkl./exkl./
// jhr./Mio./Mrd.), academic (et al./e.g./i.e./cf./vol./pp./fig./ed.).
const ABBREVS: ReadonlyArray<string> = [
	// reference / pointer
	'vgl', 'siehe', 'bspw', 'z\\.B', 'zB', 'i\\.S\\.v', 'i\\.S\\.d',
	// generic
	'u\\.a', 'u\\.\\u00C4', 'd\\.h', 'd\\.\\u00C4', 'bzw', 'ggf', 'evtl', 'ca',
	'inkl', 'exkl', 'sog', 'i\\.d\\.R', 'i\\.A',
	// section / structure
	'S', 'Bd', 'Nr', 'Abs', 'Art', 'Aufl', 'Hrsg', 'Jg', 'Kap',
	'Anh', 'Abschn',
	// illustrations
	'Abb', 'Tab', 'Fig', 'Bsp',
	// quantities
	'Mio', 'Mrd', 'Mill',
	// academic English (often appears in German bibliographies)
	'et al', 'e\\.g', 'i\\.e', 'cf', 'vol', 'pp', 'fig', 'ed', 'eds', 'ibid',
	'op\\. cit', 'vgl\\.\\s+a',
	// titles
	'Prof', 'Dr', 'Dipl', 'Mag', 'PhD'
];

// Build one regex that matches any abbreviation followed by `.` (the period
// is captured separately so we know what to restore). `\b` before the abbrev
// requires a word boundary so we don't mangle `vgl` inside `vergleichbar`.
const ABBREV_RE = new RegExp(`\\b(${ABBREVS.join('|')})\\.`, 'gi');

// Single-letter initials followed by `.` and another letter (e.g. `H. Müller`,
// `J.-P. Sartre`). These periods are NOT sentence boundaries either.
const INITIAL_RE = /\b([A-ZÄÖÜ])\.(?=[\s ]?[A-ZÄÖÜ\-])/g;

// Sentence boundary: terminator + optional closing punctuation + whitespace
// + opener (uppercase letter, digit, or quote).
const SENTENCE_BOUNDARY_RE = /([.?!…][)\]"'»”]*)\s+(?=["'»„“A-ZÄÖÜ0-9])/g;

export interface SplitSentence {
	text: string;
	start: number; // inclusive, relative to baseOffset
	end: number;   // exclusive
}

export function splitGermanSentences(text: string, baseOffset = 0): SplitSentence[] {
	if (!text) return [];

	// Step 1: protect abbreviation periods + initial periods.
	// Replace the literal `.` with PROTECT so we can restore later.
	const protectIndices: number[] = [];
	let protectedText = text.replace(ABBREV_RE, (m, _abbr, offset: number) => {
		protectIndices.push(offset + m.length - 1);
		return m.slice(0, -1) + PROTECT;
	});
	protectedText = protectedText.replace(INITIAL_RE, (m, _letter, offset: number) => {
		protectIndices.push(offset + 1);
		return m[0] + PROTECT;
	});

	// Step 2: walk sentence boundaries against the protected text. Boundary
	// offsets in `protectedText` map 1:1 to offsets in original `text`
	// (we replaced single chars with single chars).
	const out: SplitSentence[] = [];
	let cursor = 0;

	SENTENCE_BOUNDARY_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SENTENCE_BOUNDARY_RE.exec(protectedText)) !== null) {
		const splitAt = m.index + m[1].length;
		// Trim leading whitespace within [cursor, splitAt)
		let s = cursor;
		while (s < splitAt && /\s/.test(text[s])) s++;
		let e = splitAt;
		while (e > s && /\s/.test(text[e - 1])) e--;
		if (e > s) {
			out.push({
				text: text.slice(s, e),
				start: baseOffset + s,
				end: baseOffset + e
			});
		}
		cursor = splitAt;
		while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
	}

	// Tail
	let s = cursor;
	while (s < text.length && /\s/.test(text[s])) s++;
	let e = text.length;
	while (e > s && /\s/.test(text[e - 1])) e--;
	if (e > s) {
		out.push({
			text: text.slice(s, e),
			start: baseOffset + s,
			end: baseOffset + e
		});
	}

	return out;
}
