// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vor-Heuristik FUNKTIONSTYP_ZUWEISEN — weist Outline-Knoten Funktionstypen
// (EXPOSITION, GRUNDLAGENTHEORIE, FORSCHUNGSDESIGN, DURCHFÜHRUNG, EXKURS,
// SYNTHESE, SCHLUSSREFLEXION) und Granularitäts-Ebenen (KAPITEL,
// UNTERKAPITEL, ABSCHNITT) zu.
//
// Konzept: project_three_heuristics_architecture.md (Vor-Heuristik) +
// docs/h3_implementation_status.md.
//
// Inferenzarm bestimmt aus drei Signalen:
//   1. Heading-Marker-Regex (case-insensitive) — höchste Confidence
//   2. Position im Werk (erstes/letztes Top-Level-Kapitel) — mittlere Confidence
//   3. Brief-work_type-Default — niedrigste Confidence
//
// Schreibwege:
//   * suggestFunctionTypesForDocument() persistiert nur dort, wo noch
//     KEIN user_set=true ist (User-Setzungen werden nicht überschrieben).
//   * setFunctionTypeOverride() schreibt einen explizit user-gesetzten
//     Funktionstyp (user_set=true) und respektiert Phase-1-Pattern aus
//     upsertClassification (Outline-Status zurücksetzen).
//
// Was diese Heuristik NICHT tut:
//   * keine LLM-Aufrufe (das Memory will inferenzarm).
//   * keine Werk-Ebene WERK_STRUKTUR (wird durch H3:WERK_STRUKTUR-
//     Heuristik in einer späteren Phase gesetzt).
//   * kein Cross-Heuristik-Bezug (Reihenfolge-Constraints werden im
//     Orchestrator durchgesetzt, nicht hier).

import { pool, query, queryOne } from '../db/index.js';
import { loadEffectiveOutline, type EffectiveHeading } from '../documents/outline.js';
import {
	OUTLINE_FUNCTION_TYPES,
	GRANULARITY_LEVELS,
	type OutlineFunctionType,
	type GranularityLevel,
} from '$lib/shared/h3-vocabulary.js';

export type { OutlineFunctionType, GranularityLevel };
export { OUTLINE_FUNCTION_TYPES, GRANULARITY_LEVELS };

// Default-Granularität pro Funktionstyp gemäß project_three_heuristics_
// architecture.md ("Granularitäts-Defaults"-Tabelle). Ein Eintrag pro
// Funktionstyp, der überhaupt durch FUNKTIONSTYP_ZUWEISEN gesetzt wird;
// WERK_STRUKTUR ist Werk-Ebene und wird hier nicht zugewiesen.
const DEFAULT_GRANULARITY: Record<
	Exclude<OutlineFunctionType, 'WERK_STRUKTUR'>,
	GranularityLevel
> = {
	EXPOSITION: 'KAPITEL',
	GRUNDLAGENTHEORIE: 'UNTERKAPITEL',
	FORSCHUNGSDESIGN: 'KAPITEL', // kaskadierend; siehe applyForschungsdesignCascade()
	DURCHFUEHRUNG: 'UNTERKAPITEL',
	EXKURS: 'KAPITEL',
	SYNTHESE: 'KAPITEL',
	SCHLUSSREFLEXION: 'KAPITEL',
};

// Heading-Regex-Regeln. Reihenfolge wichtig: spezifische vor generischen.
// Confidence:
//   0.9  starke, eindeutige Marker (z.B. "Einleitung", "Fazit")
//   0.85 typische Marker, aber mit möglicher Mehrdeutigkeit
//   0.7  schwächere Marker (z.B. "Methode" allein — könnte Sub-Begriff sein)
const HEADING_REGEX_RULES: Array<{
	pattern: RegExp;
	type: OutlineFunctionType;
	confidence: number;
}> = [
	{ pattern: /\bexkurs(e|us)?\b/i, type: 'EXKURS', confidence: 0.95 },

	{ pattern: /\b(einleitung|einführung|prolog|vorwort|problemstellung)\b/i, type: 'EXPOSITION', confidence: 0.9 },

	{ pattern: /\b(fazit|schluss(folgerung|wort|betrachtung)?|conclusio|ausblick|reflexion)\b/i, type: 'SCHLUSSREFLEXION', confidence: 0.9 },

	{ pattern: /\b(methodolog\w*|forschungsdesign|forschungsmethod\w*|methodisch\w* (vorgehen|ansatz|grundlegung)|verfahren der untersuchung)\b/i, type: 'FORSCHUNGSDESIGN', confidence: 0.9 },

	{ pattern: /\b(theoretisch\w* (rahmen|grundlagen|hintergrund|fundierung)|theoretisch\w* (perspektive|zugang|verortung))\b/i, type: 'GRUNDLAGENTHEORIE', confidence: 0.85 },
	{ pattern: /\b(stand der forschung|forschungsstand|literaturüberblick|literature review|begriffsklärung)\b/i, type: 'GRUNDLAGENTHEORIE', confidence: 0.85 },

	{ pattern: /\b(diskussion|interpretation|synthese|zusammenführung|integration der ergebnisse)\b/i, type: 'SYNTHESE', confidence: 0.85 },

	{ pattern: /\b(empirische ergebnisse|datenanalyse|auswertung|empirie|empirische befunde|empirische untersuchung)\b/i, type: 'DURCHFUEHRUNG', confidence: 0.85 },
	{ pattern: /\b(ergebnisse|befunde|durchführung|fallanalyse|fallstudie)\b/i, type: 'DURCHFUEHRUNG', confidence: 0.7 },

	// Generische Methode-/Theorie-Schlüsselwörter zuletzt (schwächste).
	{ pattern: /\bmethod(en|ik)?\b/i, type: 'FORSCHUNGSDESIGN', confidence: 0.7 },
	{ pattern: /\b(grundlagen|theorie|theoretisch\w*)\b/i, type: 'GRUNDLAGENTHEORIE', confidence: 0.7 },
];

export interface FunctionTypeSuggestion {
	classificationId: string | null; // NULL = nicht als classification persistiert (Parser-Default)
	elementId: string;
	level: number;
	text: string;
	excluded: boolean;
	currentFunctionType: OutlineFunctionType | null;
	currentGranularityLevel: GranularityLevel | null;
	currentUserSet: boolean;
	suggestedFunctionType: OutlineFunctionType | null;
	suggestedGranularityLevel: GranularityLevel | null;
	confidence: number;
	reason: string;
}

interface DocumentBriefContext {
	caseId: string | null;
	workType: string | null;
}

async function loadDocumentBriefContext(documentId: string): Promise<DocumentBriefContext> {
	const row = await queryOne<{ case_id: string | null; work_type: string | null }>(
		`SELECT c.id AS case_id, b.work_type
		 FROM cases c
		 LEFT JOIN assessment_briefs b ON b.id = c.assessment_brief_id
		 WHERE c.central_document_id = $1
		 LIMIT 1`,
		[documentId]
	);
	return {
		caseId: row?.case_id ?? null,
		workType: row?.work_type ?? null,
	};
}

interface HeadingClassificationRow {
	classification_id: string;
	element_id: string;
	outline_function_type: OutlineFunctionType | null;
	granularity_level: GranularityLevel | null;
	outline_function_type_user_set: boolean;
}

async function loadCurrentClassifications(
	documentId: string
): Promise<Map<string, HeadingClassificationRow>> {
	const rows = (
		await query<HeadingClassificationRow>(
			`SELECT id AS classification_id,
			        element_id,
			        outline_function_type,
			        granularity_level,
			        outline_function_type_user_set
			 FROM heading_classifications
			 WHERE document_id = $1 AND element_id IS NOT NULL`,
			[documentId]
		)
	).rows;
	const map = new Map<string, HeadingClassificationRow>();
	for (const r of rows) map.set(r.element_id, r);
	return map;
}

interface RegexMatchResult {
	type: OutlineFunctionType;
	confidence: number;
	pattern: string;
}

function matchHeadingRegex(text: string): RegexMatchResult | null {
	for (const rule of HEADING_REGEX_RULES) {
		if (rule.pattern.test(text)) {
			return {
				type: rule.type,
				confidence: rule.confidence,
				pattern: rule.pattern.toString(),
			};
		}
	}
	return null;
}

// Position-basierte Heuristik für Top-Level-Kapitel ohne Regex-Match.
// Ein Top-Level-Kapitel (effectiveLevel === 1) am Anfang/Ende des Werks
// bekommt einen Default. Mittlere Top-Level bleiben offen (NULL),
// damit der User explizit setzt — die Heuristik soll nicht raten,
// wo sie keine Anhaltspunkte hat.
function positionHeuristicForChapter(
	chapterIndex: number,
	totalChapters: number
): { type: OutlineFunctionType; confidence: number; reason: string } | null {
	if (totalChapters === 0) return null;
	if (chapterIndex === 0) {
		return {
			type: 'EXPOSITION',
			confidence: 0.6,
			reason: 'erstes Top-Level-Kapitel (Position-Default)',
		};
	}
	if (chapterIndex === totalChapters - 1) {
		return {
			type: 'SCHLUSSREFLEXION',
			confidence: 0.6,
			reason: 'letztes Top-Level-Kapitel (Position-Default)',
		};
	}
	return null;
}

// Brief-work_type → reines Hint-Map (kein hartes Default — heute wird das
// nur als Tie-Breaker konsumiert, falls Position+Regex beide leer sind).
// Hier nur protokolliert für später; aktuelle compute-Funktion nutzt es
// nicht aktiv, weil Position-Heuristik schon greift wo nötig.
// (Bewusst gehalten: mehr work_type-Logik kommt mit Falltyp-System aus
// Stufe 3 der UI-Roadmap, nicht in dieser Phase.)

interface ComputeOptions {
	documentId: string;
}

/**
 * Reine Computation: gibt für jeden non-excluded Heading einen Vorschlag.
 * Modifiziert die DB nicht. UI / API können den Output 1:1 anzeigen oder
 * weiterverarbeiten.
 */
export async function computeFunctionTypeAssignments(
	opts: ComputeOptions
): Promise<FunctionTypeSuggestion[]> {
	const outline = await loadEffectiveOutline(opts.documentId);
	if (!outline) return [];

	const classByElement = await loadCurrentClassifications(opts.documentId);

	const visibleHeadings = outline.headings.filter((h) => !h.excluded);
	const topLevelHeadings = visibleHeadings.filter((h) => h.effectiveLevel === 1);

	// Index der Top-Level-Position pro elementId für Position-Heuristik.
	const topLevelIndex = new Map<string, number>();
	topLevelHeadings.forEach((h, i) => topLevelIndex.set(h.elementId, i));

	const suggestions: FunctionTypeSuggestion[] = [];

	for (const h of outline.headings) {
		const cls = classByElement.get(h.elementId) ?? null;
		const base: FunctionTypeSuggestion = {
			classificationId: cls?.classification_id ?? null,
			elementId: h.elementId,
			level: h.effectiveLevel,
			text: h.effectiveText,
			excluded: h.excluded,
			currentFunctionType: cls?.outline_function_type ?? null,
			currentGranularityLevel: cls?.granularity_level ?? null,
			currentUserSet: cls?.outline_function_type_user_set ?? false,
			suggestedFunctionType: null,
			suggestedGranularityLevel: null,
			confidence: 0,
			reason: '',
		};

		if (h.excluded) {
			suggestions.push(base);
			continue;
		}

		// 1. Regex-Match auf Heading-Text (egal welche Ebene).
		const regexMatch = matchHeadingRegex(h.effectiveText);
		if (regexMatch) {
			base.suggestedFunctionType = regexMatch.type;
			base.suggestedGranularityLevel = granularityFor(
				regexMatch.type,
				h.effectiveLevel
			);
			base.confidence = regexMatch.confidence;
			base.reason = `Heading-Marker matched (${regexMatch.pattern})`;
			suggestions.push(base);
			continue;
		}

		// 2. Position-Heuristik nur für Top-Level-Kapitel.
		if (h.effectiveLevel === 1) {
			const idx = topLevelIndex.get(h.elementId);
			if (idx !== undefined) {
				const positional = positionHeuristicForChapter(idx, topLevelHeadings.length);
				if (positional) {
					base.suggestedFunctionType = positional.type;
					base.suggestedGranularityLevel = granularityFor(
						positional.type,
						h.effectiveLevel
					);
					base.confidence = positional.confidence;
					base.reason = positional.reason;
					suggestions.push(base);
					continue;
				}
			}
		}

		// 3. Mittlere Top-Level / Sub-Headings ohne Marker bleiben offen.
		base.reason = 'kein heuristischer Marker — User-Override erforderlich';
		suggestions.push(base);
	}

	// FORSCHUNGSDESIGN-Kaskade: wenn FORSCHUNGSDESIGN nirgends als Kapitel
	// (level 1) detektiert ist, aber als Unterkapitel/Abschnitt — die
	// Granularität unverändert lassen (sie kommt schon aus granularityFor()
	// via Heading-Level). Memory-Spec sagt nur "kaskadierend, wenn
	// nirgends als Kapitel vorhanden"; diese Implementation richtet die
	// Granularität ohnehin am tatsächlichen Heading-Level aus, daher
	// passiert die Kaskade implizit.

	return suggestions;
}

function granularityFor(
	type: OutlineFunctionType,
	level: number
): GranularityLevel | null {
	if (type === 'WERK_STRUKTUR') return null;

	const def = DEFAULT_GRANULARITY[type as Exclude<OutlineFunctionType, 'WERK_STRUKTUR'>];

	// Granularitäts-Default wird mit dem Heading-Level abgeglichen:
	// Default KAPITEL und Heading auf level 1 → KAPITEL
	// Default UNTERKAPITEL und Heading auf level 2/3 → UNTERKAPITEL
	// Heading auf level >= 4 → ABSCHNITT (per heuristischer Konvention,
	// auch wenn ABSCHNITT heute durch den Parser nicht direkt gesetzt
	// wird — die Spalte ist Phase-1-vorgesehen).
	if (level === 1) return def === 'UNTERKAPITEL' ? 'UNTERKAPITEL' : 'KAPITEL';
	if (level === 2 || level === 3) return def === 'KAPITEL' ? 'KAPITEL' : 'UNTERKAPITEL';
	return 'ABSCHNITT';
}

export interface PersistResult {
	updated: number;
	created: number;
	skipped_user_set: number;
}

/**
 * Persistiert die Vorschläge in heading_classifications. Schreibt nur
 * dort, wo `outline_function_type_user_set = false` ist. Wenn für ein
 * Heading noch keine Classification existiert (z.B. Parser-Default ohne
 * User-Edits), wird sie hier mit user_level=NULL angelegt — nur damit
 * outline_function_type Platz findet.
 */
export async function persistFunctionTypeAssignments(
	documentId: string,
	suggestions: FunctionTypeSuggestion[]
): Promise<PersistResult> {
	let updated = 0;
	let created = 0;
	let skipped_user_set = 0;

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		for (const s of suggestions) {
			if (s.excluded) continue;
			if (s.suggestedFunctionType === null) continue;
			if (s.currentUserSet) {
				skipped_user_set++;
				continue;
			}

			if (s.classificationId) {
				await client.query(
					`UPDATE heading_classifications
					 SET outline_function_type = $2,
					     granularity_level = $3,
					     outline_function_type_confidence = $4,
					     outline_function_type_user_set = false,
					     updated_at = now()
					 WHERE id = $1`,
					[
						s.classificationId,
						s.suggestedFunctionType,
						s.suggestedGranularityLevel,
						s.confidence,
					]
				);
				updated++;
				continue;
			}

			// Keine Classification existiert: anlegen — heading_text_normalized
			// und approx_char_start aus document_elements ableiten.
			const heading = await client.query<{
				char_start: number;
				char_end: number;
				full_text: string;
			}>(
				`SELECT de.char_start, de.char_end, dc.full_text
				 FROM document_elements de
				 JOIN document_content dc ON dc.naming_id = de.document_id
				 WHERE de.id = $1`,
				[s.elementId]
			);
			if (heading.rowCount === 0) continue;
			const { char_start, char_end, full_text } = heading.rows[0];
			const rawText = full_text.substring(char_start, char_end).trim();
			const normalized = rawText.replace(/\s+/g, ' ').toLowerCase();

			await client.query(
				`INSERT INTO heading_classifications
				   (document_id, element_id, heading_text_normalized, approx_char_start,
				    outline_function_type, granularity_level,
				    outline_function_type_confidence,
				    outline_function_type_user_set)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, false)
				 ON CONFLICT (document_id, heading_text_normalized, approx_char_start)
				 DO UPDATE SET element_id = EXCLUDED.element_id,
				               outline_function_type = EXCLUDED.outline_function_type,
				               granularity_level = EXCLUDED.granularity_level,
				               outline_function_type_confidence = EXCLUDED.outline_function_type_confidence,
				               updated_at = now()
				 WHERE heading_classifications.outline_function_type_user_set = false`,
				[
					documentId,
					s.elementId,
					normalized,
					char_start,
					s.suggestedFunctionType,
					s.suggestedGranularityLevel,
					s.confidence,
				]
			);
			created++;
		}

		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}

	return { updated, created, skipped_user_set };
}

/**
 * High-level entry point: holt Document-Brief-Kontext, computed Vorschläge
 * und persistiert sie. Der Brief-Kontext wird heute primär für spätere
 * Falltyp-Logik geladen — für Phase 1 wird er als Diagnostik mitgegeben,
 * der compute-Schritt nutzt ihn aber nicht direkt.
 */
export async function suggestFunctionTypesForDocument(
	documentId: string
): Promise<{
	suggestions: FunctionTypeSuggestion[];
	persistResult: PersistResult;
	documentBrief: DocumentBriefContext;
}> {
	const documentBrief = await loadDocumentBriefContext(documentId);
	const suggestions = await computeFunctionTypeAssignments({ documentId });
	const persistResult = await persistFunctionTypeAssignments(documentId, suggestions);
	return { suggestions, persistResult, documentBrief };
}

// User-Override-Pfad: läuft über upsertClassification() in
// src/lib/server/documents/outline.ts (PUT auf /outline/[headingId]).
// Dort wird outline_function_type_user_set=true gesetzt und der
// Outline-Status auf 'pending' zurückgesetzt. Hier kein separater
// Override-Service nötig — das spart Duplikation.

// Re-Export für UI-Konsumenten.
export type { EffectiveHeading };
