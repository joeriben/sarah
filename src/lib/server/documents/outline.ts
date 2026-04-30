// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Effektive Heading-Outline: Parser-Werte (document_elements.properties)
// gemerged mit User-Overrides (heading_classifications). Numerierung wird
// aus Level + Reihenfolge synthetisch berechnet — User gibt nicht "1.3.2"
// ein, sondern setzt Level und ggf. Text/Excluded; die Numerierung folgt
// der Position im Counter-Array.

import type pg from 'pg';
import { pool, query, queryOne } from '../db/index.js';

export interface EffectiveHeading {
	classificationId: string | null;
	elementId: string;
	charStart: number;
	charEnd: number;
	parserText: string;
	parserLevel: number | null;
	parserNumbering: string | null;
	userText: string | null;
	userLevel: number | null;
	excluded: boolean;
	notes: string | null;
	// Effective values (user wins over parser)
	effectiveText: string;
	effectiveLevel: number;
	effectiveNumbering: string | null;  // null = excluded
	// Diagnostics
	hasNoNumberingFromParser: boolean;
	hasNumberingMismatch: boolean;
}

export interface EffectiveOutline {
	documentId: string;
	outlineStatus: 'pending' | 'confirmed';
	outlineConfirmedAt: string | null;
	headings: EffectiveHeading[];
}

export function normalizeHeadingText(text: string): string {
	return text
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

interface HeadingRow {
	id: string;
	char_start: number;
	char_end: number;
	properties: any;
}

interface ClassificationRow {
	id: string;
	element_id: string | null;
	heading_text_normalized: string;
	approx_char_start: number;
	user_level: number | null;
	user_text: string | null;
	excluded: boolean;
	notes: string | null;
}

async function loadDocumentMeta(documentId: string): Promise<{
	full_text: string;
	outline_status: 'pending' | 'confirmed';
	outline_confirmed_at: string | null;
} | null> {
	return queryOne(
		`SELECT full_text, outline_status, outline_confirmed_at
		 FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
}

export async function loadEffectiveOutline(
	documentId: string
): Promise<EffectiveOutline | null> {
	const docRow = await loadDocumentMeta(documentId);
	if (!docRow) return null;

	const headings = await query<HeadingRow>(
		`SELECT id, char_start, char_end, properties
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'heading'
		   AND section_kind = 'main'
		 ORDER BY char_start`,
		[documentId]
	);

	const classifications = await query<ClassificationRow>(
		`SELECT id, element_id, heading_text_normalized, approx_char_start,
		        user_level, user_text, excluded, notes
		 FROM heading_classifications
		 WHERE document_id = $1`,
		[documentId]
	);

	const classByElement = new Map<string, ClassificationRow>();
	const classByAnchor = new Map<string, ClassificationRow>();
	for (const c of classifications.rows) {
		if (c.element_id) classByElement.set(c.element_id, c);
		classByAnchor.set(`${c.heading_text_normalized}|${c.approx_char_start}`, c);
	}

	const merged: Omit<
		EffectiveHeading,
		'effectiveNumbering'
	>[] = headings.rows.map((h) => {
		const text = docRow.full_text
			.substring(h.char_start, h.char_end)
			.trim();
		const normalized = normalizeHeadingText(text);
		const anchor = `${normalized}|${h.char_start}`;

		const cls =
			classByElement.get(h.id) ??
			classByAnchor.get(anchor) ??
			null;

		const parserLevel =
			typeof h.properties?.level === 'number'
				? h.properties.level
				: h.properties?.level
					? parseInt(h.properties.level, 10)
					: null;
		const parserNumbering =
			typeof h.properties?.numbering === 'string'
				? h.properties.numbering
				: null;

		const effectiveLevel =
			cls?.user_level ?? parserLevel ?? 1;
		const effectiveText = cls?.user_text ?? text;

		return {
			classificationId: cls?.id ?? null,
			elementId: h.id,
			charStart: h.char_start,
			charEnd: h.char_end,
			parserText: text,
			parserLevel,
			parserNumbering,
			userText: cls?.user_text ?? null,
			userLevel: cls?.user_level ?? null,
			excluded: cls?.excluded ?? false,
			notes: cls?.notes ?? null,
			effectiveText,
			effectiveLevel,
			hasNoNumberingFromParser: !parserNumbering,
			hasNumberingMismatch: !!h.properties?.numbering_mismatch
		};
	});

	const counter: number[] = [];
	const result: EffectiveHeading[] = merged.map((h) => {
		if (h.excluded) {
			return { ...h, effectiveNumbering: null };
		}
		const lvl = h.effectiveLevel;
		while (counter.length < lvl) counter.push(0);
		counter.length = lvl;
		counter[lvl - 1] = (counter[lvl - 1] ?? 0) + 1;
		return { ...h, effectiveNumbering: counter.join('.') };
	});

	return {
		documentId,
		outlineStatus: docRow.outline_status,
		outlineConfirmedAt: docRow.outline_confirmed_at,
		headings: result
	};
}

export interface ClassificationPatch {
	user_level?: number | null;
	user_text?: string | null;
	excluded?: boolean;
	notes?: string | null;
}

export async function upsertClassification(
	documentId: string,
	elementId: string,
	patch: ClassificationPatch
): Promise<{ id: string }> {
	const heading = await queryOne<HeadingRow>(
		`SELECT id, char_start, char_end, properties
		 FROM document_elements
		 WHERE id = $1 AND document_id = $2`,
		[elementId, documentId]
	);
	if (!heading) {
		throw new Error(
			`Heading element ${elementId} not found in document ${documentId}`
		);
	}

	const docRow = await queryOne<{ full_text: string }>(
		`SELECT full_text FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	if (!docRow) throw new Error(`Document ${documentId} not found`);

	const parserText = docRow.full_text
		.substring(heading.char_start, heading.char_end)
		.trim();
	const normalized = normalizeHeadingText(parserText);

	const existing = await queryOne<{ id: string }>(
		`SELECT id FROM heading_classifications
		 WHERE document_id = $1 AND element_id = $2`,
		[documentId, elementId]
	);

	if (existing) {
		const sets: string[] = [];
		const vals: unknown[] = [];
		let i = 1;
		if (patch.user_level !== undefined) {
			sets.push(`user_level = $${i++}`);
			vals.push(patch.user_level);
		}
		if (patch.user_text !== undefined) {
			sets.push(`user_text = $${i++}`);
			vals.push(patch.user_text);
		}
		if (patch.excluded !== undefined) {
			sets.push(`excluded = $${i++}`);
			vals.push(patch.excluded);
		}
		if (patch.notes !== undefined) {
			sets.push(`notes = $${i++}`);
			vals.push(patch.notes);
		}
		sets.push(`updated_at = now()`);
		vals.push(existing.id);
		await pool.query(
			`UPDATE heading_classifications SET ${sets.join(', ')} WHERE id = $${i}`,
			vals
		);
		// Outline-Status zurücksetzen: jede Änderung erfordert erneute Bestätigung.
		await pool.query(
			`UPDATE document_content SET outline_status = 'pending',
			        outline_confirmed_at = NULL, outline_confirmed_by = NULL
			 WHERE naming_id = $1 AND outline_status = 'confirmed'`,
			[documentId]
		);
		return { id: existing.id };
	}

	const insert = await queryOne<{ id: string }>(
		`INSERT INTO heading_classifications
		   (document_id, element_id, heading_text_normalized, approx_char_start,
		    user_level, user_text, excluded, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (document_id, heading_text_normalized, approx_char_start)
		 DO UPDATE SET element_id = EXCLUDED.element_id,
		               user_level = EXCLUDED.user_level,
		               user_text  = EXCLUDED.user_text,
		               excluded   = EXCLUDED.excluded,
		               notes      = EXCLUDED.notes,
		               updated_at = now()
		 RETURNING id`,
		[
			documentId,
			elementId,
			normalized,
			heading.char_start,
			patch.user_level ?? null,
			patch.user_text ?? null,
			patch.excluded ?? false,
			patch.notes ?? null
		]
	);
	if (!insert) throw new Error('insert failed');

	await pool.query(
		`UPDATE document_content SET outline_status = 'pending',
		        outline_confirmed_at = NULL, outline_confirmed_by = NULL
		 WHERE naming_id = $1 AND outline_status = 'confirmed'`,
		[documentId]
	);

	return { id: insert.id };
}

export async function confirmOutline(
	documentId: string,
	userId: string
): Promise<{ ok: true }> {
	const r = await pool.query(
		`UPDATE document_content
		 SET outline_status = 'confirmed',
		     outline_confirmed_at = now(),
		     outline_confirmed_by = $2
		 WHERE naming_id = $1
		 RETURNING naming_id`,
		[documentId, userId]
	);
	if (r.rowCount === 0) {
		throw new Error(`Document ${documentId} not found`);
	}
	return { ok: true };
}

/**
 * Re-anchor heading_classifications nach reparseDocument: alle element_ids
 * sind durch den DELETE FROM document_elements (in reparseDocument) NULL
 * geworden. Hier matchen wir per (heading_text_normalized + approx_char_start)
 * gegen die neuen heading-Elements und setzen element_id wieder.
 *
 * Match-Strategie:
 *   1. Exact match: same normalized text AND char_start identisch
 *   2. Fallback: same normalized text within ±200 chars
 *   3. Sonst: element_id bleibt NULL — User wird informiert
 */
export async function reanchorClassifications(
	client: pg.PoolClient,
	documentId: string,
	fullText: string
): Promise<{ matched: number; orphaned: number }> {
	const headings = (
		await client.query<HeadingRow>(
			`SELECT id, char_start, char_end, properties
			 FROM document_elements
			 WHERE document_id = $1
			   AND element_type = 'heading'
			   AND section_kind = 'main'
			 ORDER BY char_start`,
			[documentId]
		)
	).rows;

	const headingByAnchor = new Map<string, HeadingRow>();
	const headingsByText: Map<string, HeadingRow[]> = new Map();
	for (const h of headings) {
		const text = fullText.substring(h.char_start, h.char_end).trim();
		const normalized = normalizeHeadingText(text);
		headingByAnchor.set(`${normalized}|${h.char_start}`, h);
		const list = headingsByText.get(normalized) ?? [];
		list.push(h);
		headingsByText.set(normalized, list);
	}

	const classifications = (
		await client.query<{
			id: string;
			heading_text_normalized: string;
			approx_char_start: number;
		}>(
			`SELECT id, heading_text_normalized, approx_char_start
			 FROM heading_classifications
			 WHERE document_id = $1`,
			[documentId]
		)
	).rows;

	let matched = 0;
	let orphaned = 0;
	for (const c of classifications) {
		const exact = headingByAnchor.get(
			`${c.heading_text_normalized}|${c.approx_char_start}`
		);
		let target: HeadingRow | null = exact ?? null;

		if (!target) {
			const candidates = headingsByText.get(c.heading_text_normalized) ?? [];
			const close = candidates.find(
				(h) => Math.abs(h.char_start - c.approx_char_start) <= 200
			);
			target = close ?? null;
		}

		if (target) {
			await client.query(
				`UPDATE heading_classifications
				 SET element_id = $1, approx_char_start = $2, updated_at = now()
				 WHERE id = $3`,
				[target.id, target.char_start, c.id]
			);
			matched++;
		} else {
			await client.query(
				`UPDATE heading_classifications
				 SET element_id = NULL, updated_at = now()
				 WHERE id = $1`,
				[c.id]
			);
			orphaned++;
		}
	}

	// Outline-Status zurücksetzen: nach Re-Import muss neu bestätigt werden.
	await client.query(
		`UPDATE document_content
		 SET outline_status = 'pending',
		     outline_confirmed_at = NULL, outline_confirmed_by = NULL
		 WHERE naming_id = $1`,
		[documentId]
	);

	return { matched, orphaned };
}
