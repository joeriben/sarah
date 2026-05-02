// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edit-Script-basierte Anwendung der Seeds auf einen Text.
//
// Strategie:
//   1. findEdits()   — sucht alle Variant-Treffer und produziert eine
//                      Liste nicht-überlappender (start, end, replacement)-
//                      Edits, sortiert nach start.
//   2. applyEdits()  — wendet sie auf einen Text an → neuer Text.
//   3. recomputeElementSlice() — leitet aus den globalen Edits die neuen
//                      char_start/char_end UND den neuen content für
//                      ein einzelnes document_element ab.
//
// Diese Trennung erlaubt es, die DESELBEN Edits konsistent auf
// document_content.full_text und auf jedes document_elements.content
// anzuwenden, sodass char_offsets korrekt mitlaufen — auch wenn die
// Replacements unterschiedliche Längen haben als die Originale.

import type { ReplacementSeed, SeedCategory } from './seeds.js';

export interface Edit {
	start: number;          // Start-Offset im Originaltext
	end: number;            // End-Offset (exklusiv) im Originaltext
	replacement: string;
	seedCategory: SeedCategory;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Baut das Match-Pattern für eine Variante. Logik aus Python-Original
 * (sacanev privacy.py @ d474667):
 *   – Whitespace im Original wird auf `\s+` aufgeweicht (Word-XML hat
 *     gerne Soft-Wraps mitten im Namen).
 *   – Word-Boundaries hängen von der Kategorie ab:
 *       email      → strikte Lookaround auf E-Mail-Char-Klassen
 *       student_id → Digit-Boundary
 *       person_name (default) → \w-Boundary
 */
function buildVariantPattern(variant: string, category: SeedCategory): RegExp {
	let escaped = escapeRegExp(variant);
	escaped = escaped.replace(/(?:\\\s)+/g, '\\s+');
	if (category === 'email') {
		return new RegExp(`(?<![A-Z0-9._%+-])${escaped}(?!(?:[A-Z0-9_%+-]|\\.[A-Z0-9]))`, 'gi');
	}
	if (category === 'student_id' || category === 'matrikel') {
		return new RegExp(`(?<!\\d)${escaped}(?!\\d)`, 'gi');
	}
	return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
}

/**
 * Findet alle Edit-Positionen für ein Set von Seeds in einem Text.
 * Längere Varianten werden zuerst gematcht (gegen "M. Mustermann" wird
 * vor "Mustermann" gesucht). Überlappungen werden ausgeschlossen — der
 * erste, längste Match an einer Position gewinnt.
 */
export function findEdits(text: string, seeds: ReplacementSeed[]): Edit[] {
	const all: { seed: ReplacementSeed; variant: string }[] = [];
	for (const s of seeds) {
		for (const v of s.variants) {
			if (v && v.length > 0) all.push({ seed: s, variant: v });
		}
	}
	all.sort((a, b) => b.variant.length - a.variant.length);

	const taken = new Uint8Array(text.length);
	const edits: Edit[] = [];

	for (const { seed, variant } of all) {
		const re = buildVariantPattern(variant, seed.category);
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const start = m.index;
			const end = start + m[0].length;
			let conflict = false;
			for (let i = start; i < end; i++) {
				if (taken[i]) { conflict = true; break; }
			}
			if (conflict) continue;
			for (let i = start; i < end; i++) taken[i] = 1;
			edits.push({
				start,
				end,
				replacement: seed.replacement,
				seedCategory: seed.category
			});
		}
	}
	edits.sort((a, b) => a.start - b.start);
	return edits;
}

/**
 * Wendet eine Edit-Liste auf einen Text an.
 */
export function applyEdits(text: string, edits: Edit[]): string {
	if (edits.length === 0) return text;
	let out = '';
	let cursor = 0;
	for (const e of edits) {
		if (e.start < cursor) continue; // Sicherheits-Skip — sollte nie passieren bei non-overlapping edits.
		out += text.slice(cursor, e.start);
		out += e.replacement;
		cursor = e.end;
	}
	out += text.slice(cursor);
	return out;
}

/**
 * Aus globalen Edits + alter Element-Range → neue Range + neuer Content.
 *
 * Annahme: Edits sind global im selben Original-Volltext berechnet; ihre
 * `start`/`end` beziehen sich auf den Original-Volltext. Element-Edges
 * `oldStart`/`oldEnd` ebenso.
 *
 * Edits, die die Element-Grenze überlappen (statt vollständig drin oder
 * draußen liegen), werden ignoriert — solche kommen nicht vor, solange
 * der Parser Elemente an Wort-Grenzen schneidet UND die Variants
 * \w-boundaries respektieren (was buildVariantPattern garantiert).
 */
export function recomputeElementSlice(
	originalText: string,
	oldStart: number,
	oldEnd: number,
	edits: Edit[]
): { newStart: number; newEnd: number; newContent: string } {
	let shiftBefore = 0;
	const within: Edit[] = [];
	for (const e of edits) {
		if (e.end <= oldStart) {
			shiftBefore += e.replacement.length - (e.end - e.start);
			continue;
		}
		if (e.start >= oldEnd) break;
		// In oder überlappend
		if (e.start < oldStart || e.end > oldEnd) continue; // Überlappung ignorieren.
		within.push(e);
	}

	const newStart = oldStart + shiftBefore;
	const localOld = originalText.slice(oldStart, oldEnd);
	const localEdits: Edit[] = within.map((e) => ({
		start: e.start - oldStart,
		end: e.end - oldStart,
		replacement: e.replacement,
		seedCategory: e.seedCategory
	}));
	const newContent = applyEdits(localOld, localEdits);
	const newEnd = newStart + newContent.length;

	return { newStart, newEnd, newContent };
}

/**
 * Statistik: wie oft wurde welche Kategorie ersetzt?
 */
export function countByCategory(edits: Edit[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of edits) {
		counts[e.seedCategory] = (counts[e.seedCategory] ?? 0) + 1;
	}
	return counts;
}
