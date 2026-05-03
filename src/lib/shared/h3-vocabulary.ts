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
