// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Document element types and parser interfaces.
 * Elements form a directed graph (hierarchy via parent_id, cross-refs via refs).
 */

export type SectionKind = 'front_matter' | 'main' | 'bibliography' | 'appendix';

export interface ParsedElement {
	type: string;           // 'paragraph', 'sentence', 'heading', 'turn', ...
	content: string | null; // text content for leaf nodes; null for containers
	charStart: number;
	charEnd: number;
	// Page range in the source document. Populated by parsers that have
	// page-marker information (DOCX via floating-textbox page numbers,
	// annotations-export via "[Seite N]"). NULL for elements before the
	// first known page marker. Citation helper / LLM-resolver candidate
	// scoping only — never the primary key for content matching.
	pageFrom?: number | null;
	pageTo?: number | null;
	// Structural segment of the source document. Set by parsers that walk
	// a heading state machine (currently docx-academic). NULL for parsers
	// that don't have a sectionable structure (plain-text, annotations-
	// export). 'front_matter' covers everything before the first chapter
	// heading; 'main' is the body; 'bibliography' and 'appendix' are
	// back-matter apparatus.
	sectionKind?: SectionKind | null;
	properties?: Record<string, unknown>;
	children?: ParsedElement[];
	refs?: ElementRef[];
}

export interface ElementRef {
	/** Index into the flat list of all elements (resolved to UUID at store time) */
	toIndex: number;
	refType: string;        // 'overlap_at', 'cross_ref', ...
	properties?: Record<string, unknown>;
}

export interface ParseResult {
	elements: ParsedElement[]; // top-level elements (forest of trees)
	format: string;            // 'plain-text', 'transcript-tiq', 'academic', ...
}
