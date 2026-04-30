// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Resolved heading hierarchy for a document.
//
// The DOCX-Parser stores synthetic numbering ("1", "1.2", "1.2.2") in
// document_elements.properties.numbering; the heading level follows from
// the dot-count + 1. Edge cases (PDF→DOCX with broken TOC anchors) leave
// the numbering NULL and require user_level overrides via
// heading_classifications. The user-validation gate
// (document_content.outline_status='confirmed') is the contract that no
// main-section heading is left without a resolved level.
//
// Resolution rule per heading:
//   level = COALESCE(heading_classifications.user_level,
//                    parser-numbering dot-count + 1)
//   excluded = COALESCE(heading_classifications.excluded, false)
//
// Excluded headings are removed from the resolved outline entirely (they
// are not part of any chapter for synthesis purposes).
//
// Consumers: runChapterCollapse, runDocumentCollapse, intermediate-level
// collapses (when subchapter-aggregation-level is L3 and an L2 layer
// must be synthesized between subchapter and chapter). The existing
// runGraphCollapse (subchapter-level) does not consume this helper — it
// receives a specific subchapterHeadingId from its caller and operates
// on char_start-based slicing without level awareness.

import { query, queryOne } from '../../db/index.js';

export interface ResolvedHeading {
	headingId: string;
	level: number;             // 1 = Hauptkapitel, 2 = Unterkapitel, ...
	numbering: string | null;  // "1.2.2" or null if no parser-numbering
	text: string;              // trimmed heading text from the document
	charStart: number;
	charEnd: number;
}

export interface ChapterUnit {
	l1: ResolvedHeading;
	/** End offset of this chapter (= char_start of next L1 heading or document length) */
	endChar: number;
	/** All non-excluded headings within this chapter, including the L1 itself, in order. */
	innerHeadings: ResolvedHeading[];
	/** Paragraph element-IDs within this chapter, in document order. */
	paragraphIds: string[];
}

/**
 * Load the resolved outline for a document. Throws if the document has
 * not been outline-confirmed by the user, or if any non-excluded heading
 * lacks a resolvable level (which the confirmation gate is supposed to
 * prevent — defense-in-depth).
 */
export async function loadResolvedOutline(
	documentId: string
): Promise<ResolvedHeading[]> {
	const status = await queryOne<{ outline_status: string }>(
		`SELECT outline_status FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	if (!status) {
		throw new Error(`No document_content for document ${documentId}`);
	}
	if (status.outline_status !== 'confirmed') {
		throw new Error(
			`Outline not confirmed for document ${documentId} ` +
			`(current status: ${status.outline_status}). ` +
			`User must validate the outline before chapter/work collapse can run.`
		);
	}

	const rows = (await query<{
		id: string;
		char_start: number;
		char_end: number;
		parser_numbering: string | null;
		user_level: number | null;
		excluded: boolean | null;
		heading_text: string;
	}>(
		`SELECT
		   de.id,
		   de.char_start,
		   de.char_end,
		   (de.properties->>'numbering') AS parser_numbering,
		   hc.user_level,
		   COALESCE(hc.excluded, false) AS excluded,
		   SUBSTRING(dc.full_text FROM de.char_start + 1 FOR de.char_end - de.char_start) AS heading_text
		 FROM document_elements de
		 LEFT JOIN heading_classifications hc ON hc.element_id = de.id
		 LEFT JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.document_id = $1
		   AND de.element_type = 'heading'
		   AND de.section_kind = 'main'
		 ORDER BY de.char_start`,
		[documentId]
	)).rows;

	const resolved: ResolvedHeading[] = [];
	for (const r of rows) {
		if (r.excluded) continue;
		const parserLevel = r.parser_numbering
			? r.parser_numbering.split('.').length
			: null;
		const level = r.user_level ?? parserLevel;
		if (level === null) {
			throw new Error(
				`Heading "${r.heading_text.trim().slice(0, 60)}" (id=${r.id}) ` +
				`has no resolved level: no parser numbering and no user_level override. ` +
				`Outline confirmation should not have allowed this state.`
			);
		}
		resolved.push({
			headingId: r.id,
			level,
			numbering: r.parser_numbering,
			text: r.heading_text.trim(),
			charStart: r.char_start,
			charEnd: r.char_end,
		});
	}
	return resolved;
}

/**
 * Group the resolved outline into chapters (one per L1-heading). Each
 * chapter carries its inner headings (L2/L3/...) and the IDs of the
 * paragraphs within its char-range.
 */
export async function loadChapterUnits(
	documentId: string
): Promise<ChapterUnit[]> {
	const outline = await loadResolvedOutline(documentId);
	const docLength = await queryOne<{ length: number }>(
		`SELECT length(full_text) AS length FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	if (!docLength) throw new Error(`No document_content for document ${documentId}`);

	const allParagraphs = (await query<{ id: string; char_start: number }>(
		`SELECT id, char_start FROM document_elements
		 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
		 ORDER BY char_start`,
		[documentId]
	)).rows;

	const l1Headings = outline.filter(h => h.level === 1);
	if (l1Headings.length === 0) {
		throw new Error(`Document ${documentId} has no L1 (Hauptkapitel) headings in resolved outline`);
	}

	const chapters: ChapterUnit[] = [];
	for (let i = 0; i < l1Headings.length; i++) {
		const l1 = l1Headings[i];
		const endChar = i + 1 < l1Headings.length ? l1Headings[i + 1].charStart : docLength.length;
		const innerHeadings = outline.filter(
			h => h.charStart >= l1.charStart && h.charStart < endChar
		);
		const paragraphIds = allParagraphs
			.filter(p => p.char_start >= l1.charStart && p.char_start < endChar)
			.map(p => p.id);
		chapters.push({ l1, endChar, innerHeadings, paragraphIds });
	}
	return chapters;
}

/**
 * For a given heading, the synthesis-unit it represents (= the range
 * from this heading to the next heading at the same or higher level),
 * counted in paragraphs. Used by the median-based subchapter-level
 * selection algorithm.
 */
export function paragraphCountForUnit(
	heading: ResolvedHeading,
	allHeadingsInChapter: ResolvedHeading[],
	chapterEndChar: number,
	allParagraphs: { id: string; charStart: number }[]
): number {
	const next = allHeadingsInChapter.find(
		h => h.charStart > heading.charStart && h.level <= heading.level
	);
	const endChar = next ? next.charStart : chapterEndChar;
	return allParagraphs.filter(
		p => p.charStart >= heading.charStart && p.charStart < endChar
	).length;
}

/**
 * Median paragraph-count across all headings of a given level within a
 * chapter. Returns null if no headings at that level exist (e.g. asking
 * for L3 in a chapter that has no L3 headings).
 */
export function medianParagraphCountAtLevel(
	chapter: ChapterUnit,
	level: number,
	allParagraphs: { id: string; charStart: number }[]
): number | null {
	const headingsAtLevel = chapter.innerHeadings.filter(h => h.level === level);
	if (headingsAtLevel.length === 0) return null;
	const counts = headingsAtLevel.map(h =>
		paragraphCountForUnit(h, chapter.innerHeadings, chapter.endChar, allParagraphs)
	);
	counts.sort((a, b) => a - b);
	const mid = Math.floor(counts.length / 2);
	return counts.length % 2 === 0
		? (counts[mid - 1] + counts[mid]) / 2
		: counts[mid];
}

// Validated target window for the per-synthesis-unit paragraph count
// (S1–S3 ran at 5 / 5 / 9 / 13 paragraphs). Median in [TARGET_MIN,
// TARGET_MAX] is the algorithm's first-choice criterion.
export const TARGET_MIN = 5;
export const TARGET_MAX = 15;

/**
 * Pick the subchapter-aggregation level for a chapter, based on the
 * median paragraph count per heading at each candidate level.
 *
 * Strategy:
 *   1. Try L3, L2, L1 in that order (deepest first).
 *   2. Pick the deepest level whose median falls in [TARGET_MIN, TARGET_MAX].
 *   3. If no level fits the window: pick the deepest level whose median
 *      is ≥ TARGET_MIN (i.e. has substance; better to over-aggregate than
 *      to synthesize on a 2-paragraph "subchapter").
 *   4. Final fallback: L1 (whole chapter as single synthesis unit).
 *
 * Per-chapter adaptive: a chapter with shallow structure (e.g. typical
 * Methodenkapitel) naturally falls through to L1 = no nested collapse.
 */
export function chooseSubchapterLevel(
	chapter: ChapterUnit,
	allParagraphs: { id: string; charStart: number }[]
): 1 | 2 | 3 {
	const medians: Record<number, number | null> = {
		1: medianParagraphCountAtLevel(chapter, 1, allParagraphs)
		   ?? chapter.paragraphIds.length, // chapter-as-whole has all its paragraphs
		2: medianParagraphCountAtLevel(chapter, 2, allParagraphs),
		3: medianParagraphCountAtLevel(chapter, 3, allParagraphs),
	};

	for (const lvl of [3, 2] as const) {
		const m = medians[lvl];
		if (m !== null && m >= TARGET_MIN && m <= TARGET_MAX) return lvl;
	}
	for (const lvl of [3, 2] as const) {
		const m = medians[lvl];
		if (m !== null && m >= TARGET_MIN) return lvl;
	}
	return 1;
}

/**
 * Read the persisted aggregation_subchapter_level for a chapter. Returns
 * null if not yet computed/persisted.
 *
 * Note: heading_classifications can have multiple anchor mechanisms
 * (element_id hard-binding, or soft-anchor via text+approx_char_start).
 * The lookup here uses element_id; if the parser was re-run and the
 * element was re-anchored via the soft path, callers should ensure the
 * re-anchor has been completed before relying on this read.
 */
export async function getPersistedSubchapterLevel(
	l1HeadingId: string
): Promise<number | null> {
	const row = await queryOne<{ aggregation_subchapter_level: number | null }>(
		`SELECT aggregation_subchapter_level
		 FROM heading_classifications
		 WHERE element_id = $1`,
		[l1HeadingId]
	);
	return row?.aggregation_subchapter_level ?? null;
}

/**
 * Persist the algorithm's chosen subchapter-level for a chapter. Inserts
 * a heading_classifications row if none exists yet for this heading
 * (with no other overrides set), or updates the existing row.
 *
 * The soft-anchor fields (heading_text_normalized, approx_char_start)
 * are populated so that the row survives a parser re-run / re-import,
 * matching the design intent of heading_classifications (see Migration
 * 035 docstring).
 */
export async function persistSubchapterLevel(
	l1HeadingId: string,
	documentId: string,
	level: 1 | 2 | 3
): Promise<void> {
	const heading = await queryOne<{ char_start: number; heading_text: string }>(
		`SELECT de.char_start,
		        SUBSTRING(dc.full_text FROM de.char_start + 1 FOR de.char_end - de.char_start) AS heading_text
		 FROM document_elements de
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE de.id = $1`,
		[l1HeadingId]
	);
	if (!heading) throw new Error(`Heading not found: ${l1HeadingId}`);
	const normalized = heading.heading_text.trim().replace(/\s+/g, ' ').toLowerCase();

	await query(
		`INSERT INTO heading_classifications
		   (document_id, element_id, heading_text_normalized, approx_char_start,
		    aggregation_subchapter_level)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (document_id, heading_text_normalized, approx_char_start)
		 DO UPDATE SET aggregation_subchapter_level = EXCLUDED.aggregation_subchapter_level,
		               updated_at = now()`,
		[documentId, l1HeadingId, normalized, heading.char_start, level]
	);
}
