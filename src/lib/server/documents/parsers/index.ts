// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type pg from 'pg';
import type { ParsedElement, ParseResult } from './types.js';
import { parsePlainText } from './plain-text.js';
import { extractDocxAcademic } from './docx-academic.js';

const DOCX_MIME =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Select parser format based on MIME type.
 *   - DOCX → 'docx-academic' (TOC-bookmark heading detection, German
 *     sentence splitter, footnote-textbox heuristic for PDF-converted DOCX)
 *   - everything else → 'plain-text'
 */
export function selectFormat(mimeType: string, _text: string): string {
	if (mimeType === DOCX_MIME) return 'docx-academic';
	return 'plain-text';
}

/** Plain-text path. The DOCX path needs the raw bytes; see parseDocumentBytes. */
export function parseDocument(text: string, _mimeType: string): ParseResult {
	return parsePlainText(text);
}

/**
 * Parse a document from raw bytes when the MIME type calls for a
 * structure-aware extractor (currently DOCX). Falls back to plain-text
 * over the already-extracted `fallbackText` for unknown types.
 *
 * Returns both the result tree AND the canonical full_text we want to
 * persist (the DOCX extractor builds its own linearized text with
 * deterministic newline separators between elements; storing that
 * preserves char-offset alignment).
 */
export async function parseDocumentBytes(
	bytes: Buffer,
	mimeType: string,
	fallbackText: string
): Promise<{ result: ParseResult; fullText: string }> {
	if (mimeType === DOCX_MIME) {
		const { result, fullText } = await extractDocxAcademic(bytes);
		return { result, fullText };
	}
	return { result: parsePlainText(fallbackText), fullText: fallbackText };
}

/**
 * Parse document text and store elements in the database.
 * Call within an existing transaction.
 *
 * If `bytes` is supplied AND the MIME type calls for byte-level parsing
 * (DOCX), the extracted text is recomputed from bytes and used as the
 * canonical full_text — caller should also UPDATE document_content
 * accordingly. For plain-text inputs, `text` is used as-is.
 */
export async function parseAndStore(
	client: pg.PoolClient,
	documentId: string,
	fullText: string,
	mimeType: string,
	bytes?: Buffer
): Promise<{ canonicalFullText: string }> {
	let result: ParseResult;
	let canonicalFullText = fullText;

	if (bytes && mimeType === DOCX_MIME) {
		const parsed = await parseDocumentBytes(bytes, mimeType, fullText);
		result = parsed.result;
		canonicalFullText = parsed.fullText;
	} else {
		result = parseDocument(fullText, mimeType);
	}

	// Flatten tree into ordered list, tracking parent indices.
	const flat: { element: ParsedElement; parentIndex: number | null; seq: number }[] = [];
	function flatten(els: ParsedElement[], parentIndex: number | null) {
		for (let i = 0; i < els.length; i++) {
			const el = els[i];
			const myIndex = flat.length;
			flat.push({ element: el, parentIndex, seq: i });
			if (el.children) flatten(el.children, myIndex);
		}
	}
	flatten(result.elements, null);
	if (flat.length === 0) return { canonicalFullText };

	// Insert all elements; collect generated UUIDs by flat index.
	// Note: text content is NOT stored — it is derivable as
	// substring(document_content.full_text, char_start, char_end).
	// See migration 027.
	const ids: string[] = [];
	for (const { element, parentIndex, seq } of flat) {
		const parentId = parentIndex !== null ? ids[parentIndex] : null;
		const res = await client.query<{ id: string }>(
			`INSERT INTO document_elements (document_id, element_type, parent_id, seq, char_start, char_end, properties)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 RETURNING id`,
			[
				documentId,
				element.type,
				parentId,
				seq,
				element.charStart,
				element.charEnd,
				JSON.stringify(element.properties || {})
			]
		);
		ids.push(res.rows[0].id);
	}

	// Insert refs (resolve toIndex against the flat list).
	// Refs in the python-rebuild were keyed by flat index; the docx-academic
	// parser sets toIndex relative to its own element array (flat traversal
	// of its top-level + children). The flatten() above produces the same
	// order, so the indices align.
	for (let i = 0; i < flat.length; i++) {
		const refs = flat[i].element.refs;
		if (!refs) continue;
		for (const ref of refs) {
			if (ref.toIndex >= 0 && ref.toIndex < ids.length) {
				await client.query(
					`INSERT INTO document_element_refs (from_id, to_id, ref_type, properties)
					 VALUES ($1, $2, $3, $4)`,
					[ids[i], ids[ref.toIndex], ref.refType, JSON.stringify(ref.properties || {})]
				);
			}
		}
	}

	return { canonicalFullText };
}

/** Re-parse a single document. Deletes existing elements first. */
export async function reparseDocument(
	client: pg.PoolClient,
	documentId: string,
	fullText: string,
	mimeType: string,
	bytes?: Buffer
): Promise<{ canonicalFullText: string }> {
	await client.query('DELETE FROM document_elements WHERE document_id = $1', [documentId]);
	return parseAndStore(client, documentId, fullText, mimeType, bytes);
}
