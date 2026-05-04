// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Isomorphes Vokabular für die H3-Pipeline. Wird sowohl serverseitig
// (function-type-assignment.ts, Endpoints) als auch clientseitig
// (Outline-UI, Reader) konsumiert.
//
// Konzept: project_three_heuristics_architecture.md

export type OutlineFunctionType =
	| 'EXPOSITION'
	| 'GRUNDLAGENTHEORIE'
	| 'FORSCHUNGSDESIGN'
	| 'DURCHFUEHRUNG'
	| 'EXKURS'
	| 'SYNTHESE'
	| 'SCHLUSSREFLEXION'
	| 'WERK_STRUKTUR';

export type GranularityLevel = 'KAPITEL' | 'UNTERKAPITEL' | 'ABSCHNITT';

export const OUTLINE_FUNCTION_TYPES: readonly OutlineFunctionType[] = [
	'EXPOSITION',
	'GRUNDLAGENTHEORIE',
	'FORSCHUNGSDESIGN',
	'DURCHFUEHRUNG',
	'EXKURS',
	'SYNTHESE',
	'SCHLUSSREFLEXION',
	'WERK_STRUKTUR',
] as const;

export const GRANULARITY_LEVELS: readonly GranularityLevel[] = [
	'KAPITEL',
	'UNTERKAPITEL',
	'ABSCHNITT',
] as const;

// Display-Labels (deutsch). Internal keys bleiben ASCII (DURCHFUEHRUNG,
// SCHLUSSREFLEXION) — Display verwendet die korrekten Umlaute.
export const OUTLINE_FUNCTION_TYPE_LABELS: Record<OutlineFunctionType, string> = {
	EXPOSITION: 'Exposition',
	GRUNDLAGENTHEORIE: 'Grundlagentheorie',
	FORSCHUNGSDESIGN: 'Forschungsdesign',
	DURCHFUEHRUNG: 'Durchführung',
	EXKURS: 'Exkurs',
	SYNTHESE: 'Synthese',
	SCHLUSSREFLEXION: 'Schlussreflexion',
	WERK_STRUKTUR: 'Werkstruktur',
};

export const GRANULARITY_LEVEL_LABELS: Record<GranularityLevel, string> = {
	KAPITEL: 'Kapitel',
	UNTERKAPITEL: 'Unterkapitel',
	ABSCHNITT: 'Abschnitt',
};

export function isOutlineFunctionType(v: unknown): v is OutlineFunctionType {
	return typeof v === 'string' && (OUTLINE_FUNCTION_TYPES as readonly string[]).includes(v);
}

export function isGranularityLevel(v: unknown): v is GranularityLevel {
	return typeof v === 'string' && (GRANULARITY_LEVELS as readonly string[]).includes(v);
}

// ── Heuristik-Pflicht-Funktionstypen ──────────────────────────────
//
// Pre-Run-Validation: welche Outline-Funktionstypen müssen mind. 1× im
// Outline vergeben sein, damit eine Heuristik laufen kann?
//
// H1, H2: strukturblind (analytische Hauptlinie / synthetisches Per-¶-Memo) —
// keine Pflicht-Funktionstypen.
//
// H3: funktionstyp-orchestriert. Pflicht sind die Funktionstypen, deren
// Konstrukt direkt von späteren H3-Phasen als Cross-Read verlangt wird:
//   - EXPOSITION → liefert FRAGESTELLUNG (Cross-Read überall)
//   - GRUNDLAGENTHEORIE → liefert FORSCHUNGSGEGENSTAND (Cross-Read von
//     FORSCHUNGSDESIGN/DURCHFUEHRUNG/SCHLUSSREFLEXION)
//   - DURCHFUEHRUNG → liefert BEFUNDE (Cross-Read von SYNTHESE)
//   - SYNTHESE → liefert GESAMTERGEBNIS (Cross-Read von SCHLUSSREFLEXION/
//     WERK_GUTACHT)
//
// Optional (mit Recovery-Heuristik): FORSCHUNGSDESIGN (AUFBAU_SKIZZE-
// Pyramide), SCHLUSSREFLEXION (letztes-Drittel-Recovery). EXKURS und
// WERK_STRUKTUR sind ohnehin optional.

export const H3_REQUIRED_FUNCTION_TYPES: readonly OutlineFunctionType[] = [
	'EXPOSITION',
	'GRUNDLAGENTHEORIE',
	'DURCHFUEHRUNG',
	'SYNTHESE',
] as const;

export const H3_OPTIONAL_FUNCTION_TYPES: readonly OutlineFunctionType[] = [
	'FORSCHUNGSDESIGN',
	'SCHLUSSREFLEXION',
	'EXKURS',
	'WERK_STRUKTUR',
] as const;

export type HeuristicPath = 'h1' | 'h2' | 'h3';

/**
 * Berechnet die fehlenden Pflicht-Funktionstypen für eine Heuristik gegen
 * die tatsächliche Outline-Coverage. coverage: Map outline_function_type →
 * Anzahl Headings im Werk. Werte >= 1 zählen als "vergeben".
 *
 * Returns die Liste der fehlenden Pflicht-Typen — leer = alles OK.
 * Für H1/H2 immer leer (strukturblind).
 */
export function missingRequiredFunctionTypes(
	heuristic: HeuristicPath,
	coverage: Record<string, number>
): OutlineFunctionType[] {
	if (heuristic !== 'h3') return [];
	return H3_REQUIRED_FUNCTION_TYPES.filter((t) => (coverage[t] ?? 0) === 0);
}
