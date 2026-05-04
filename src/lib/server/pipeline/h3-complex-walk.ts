// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3-Komplex-Walk — die Walk-Einheit der H3-Heuristik.
//
// Konzept: feedback_no_phase_layer_orchestrator.md (User-Setzung 2026-05-04).
//
// Granularitäts-Achse ist der Absatz, nicht das Heading. Jeder Absatz
// erbt seinen Funktionstyp aus dem nächst-vorhergehenden Heading mit
// gesetztem outline_function_type. Aufeinanderfolgende Absätze unter
// demselben direkten Container-Heading werden zu einem Komplex
// zusammengefasst — ein Komplex bricht an jedem Heading-Wechsel
// (auch wenn der vererbte Funktionstyp gleich bliebe), weil Kapitel-
// und Unterkapitel-Grenzen nach User-Setzung trennen.
//
// Das Tool sieht den Komplex (heading_id + paragraph_ids + function_type),
// nicht das ganze Werk. Werk-Aggregationen (FORSCHUNGSGEGENSTAND etc.) sind
// virtuelle Knoten im Walk, kein Teil dieses Moduls.

import { query } from '../db/index.js';
import type {
	OutlineFunctionType,
	GranularityLevel,
} from '$lib/shared/h3-vocabulary.js';

export interface H3Complex {
	/** Direktes Container-Heading der Absätze (DB-Element-ID). */
	headingId: string;
	headingText: string;
	headingLevel: number;
	/** Funktionstyp des Komplexes — direkt am Container oder geerbt. */
	functionType: OutlineFunctionType;
	/** Granularitäts-Ebene aus dem function_type-tragenden Heading. */
	granularityLevel: GranularityLevel | null;
	/** Heading-Element, das den function_type setzt — = headingId, oder ein Eltern-Heading. */
	functionTypeSourceHeadingId: string;
	/** Absätze des Komplexes in Dokument-Reihenfolge. */
	paragraphIds: string[];
	/** Zeichenbereich (für Reader-Highlight + Cursor-Position). */
	charStart: number;
	charEnd: number;
}

interface ParagraphRow {
	paragraph_id: string;
	char_start: number;
	char_end: number;
	container_heading_id: string;
	container_heading_text: string;
	container_heading_level: number;
	function_type: OutlineFunctionType | null;
	granularity_level: GranularityLevel | null;
	function_type_source_heading_id: string | null;
}

/**
 * Lädt die Komplex-Liste in Dokument-Reihenfolge. Komplexe ohne
 * function_type (kein Heading-Default greift) werden weggelassen — sie
 * sind im Walk nicht dispatchbar.
 *
 * Bibliographie-Bereiche (section_kind='bibliography') und ausgeschlossene
 * Headings (heading_classifications.excluded=true) sind ausgeklammert.
 */
export async function loadH3ComplexWalk(documentId: string): Promise<H3Complex[]> {
	const rows = (
		await query<ParagraphRow>(
			`WITH headings AS (
			   SELECT de.id AS heading_id,
			          de.char_start,
			          de.char_end,
			          de.properties->>'level' AS level_str,
			          SUBSTRING(dc.full_text FROM de.char_start + 1
			                                FOR de.char_end - de.char_start) AS heading_text,
			          hc.outline_function_type,
			          hc.granularity_level,
			          COALESCE(hc.excluded, false) AS excluded
			   FROM document_elements de
			   JOIN document_content dc ON dc.naming_id = de.document_id
			   LEFT JOIN heading_classifications hc ON hc.element_id = de.id
			   WHERE de.document_id = $1
			     AND de.element_type = 'heading'
			 ),
			 visible_headings AS (
			   SELECT * FROM headings WHERE excluded = false
			 )
			 SELECT p.id AS paragraph_id,
			        p.char_start,
			        p.char_end,
			        direct.heading_id AS container_heading_id,
			        direct.heading_text AS container_heading_text,
			        COALESCE(direct.level_str::int, 1) AS container_heading_level,
			        ft.outline_function_type AS function_type,
			        ft.granularity_level,
			        ft.heading_id AS function_type_source_heading_id
			 FROM document_elements p
			 JOIN LATERAL (
			   SELECT heading_id, char_start, heading_text, level_str
			   FROM visible_headings vh
			   WHERE vh.char_start <= p.char_start
			   ORDER BY vh.char_start DESC
			   LIMIT 1
			 ) direct ON true
			 LEFT JOIN LATERAL (
			   SELECT heading_id, outline_function_type, granularity_level
			   FROM visible_headings vh2
			   WHERE vh2.char_start <= p.char_start
			     AND vh2.outline_function_type IS NOT NULL
			   ORDER BY vh2.char_start DESC
			   LIMIT 1
			 ) ft ON true
			 WHERE p.document_id = $1
			   AND p.element_type = 'paragraph'
			   AND p.section_kind = 'main'
			 ORDER BY p.char_start`,
			[documentId]
		)
	).rows;

	const complexes: H3Complex[] = [];
	let current: H3Complex | null = null;

	for (const r of rows) {
		if (!r.function_type) {
			current = null;
			continue;
		}
		const startsNew = !current || current.headingId !== r.container_heading_id;
		if (startsNew) {
			if (current) complexes.push(current);
			current = {
				headingId: r.container_heading_id,
				headingText: r.container_heading_text.trim(),
				headingLevel: r.container_heading_level,
				functionType: r.function_type,
				granularityLevel: r.granularity_level ?? null,
				functionTypeSourceHeadingId: r.function_type_source_heading_id ?? r.container_heading_id,
				paragraphIds: [r.paragraph_id],
				charStart: r.char_start,
				charEnd: r.char_end,
			};
		} else if (current) {
			current.paragraphIds.push(r.paragraph_id);
			current.charEnd = r.char_end;
		}
	}
	if (current) complexes.push(current);

	return complexes;
}
