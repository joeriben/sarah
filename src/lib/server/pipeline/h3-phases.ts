// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3-Phasen-Helper (LEGACY) — der Phase-Layer ist seit User-Setzung
// 2026-05-04 aus dem Run-Pfad entfernt; der H3-Run läuft als linearer Walk
// über Absatz-Komplexe + Werk-Aggregationen (siehe h3-walk-driver.ts und
// Memory feedback_no_phase_layer_orchestrator).
//
// Diese Datei stellt nur noch Done-/Validation-Check-Helper auf
// outline_function_type-Ebene zur Verfügung, die von Test-Skripten und der
// pipeline-status-API zur Card-Anzeige genutzt werden. Es gibt KEINEN
// Dispatch (`runH3Phase`) und KEINE Phase-Set-Mitgliedschaft (`isWerkPhase`)
// mehr — der Orchestrator dispatcht walk-step-basiert.

import { queryOne } from '../db/index.js';

// ── Legacy-Phase-Type & Done-Mapping ──────────────────────────────────────

export type H3Phase =
	| 'h3_exposition'
	| 'h3_grundlagentheorie'
	| 'h3_forschungsdesign'
	| 'h3_durchfuehrung'
	| 'h3_synthese'
	| 'h3_schlussreflexion'
	| 'h3_exkurs'
	| 'h3_werk_deskription'
	| 'h3_werk_gutacht';

// outline_function_type pro Phase (gemäß Mig 043 + Mig 050 CHECK-Liste).
// EXKURS hat Sondersemantik (siehe h3_exkurs unten — modifiziert
// FORSCHUNGSGEGENSTAND destruktiv via version_stack-Append). Werk-Phasen
// (Mig 050) nutzen eigene Funktionstyp-Marker.
const PHASE_OUTLINE_TYPE: Record<H3Phase, string | null> = {
	h3_exposition: 'EXPOSITION',
	h3_grundlagentheorie: 'GRUNDLAGENTHEORIE',
	h3_forschungsdesign: 'FORSCHUNGSDESIGN',
	h3_durchfuehrung: 'DURCHFUEHRUNG',
	h3_synthese: 'SYNTHESE',
	h3_schlussreflexion: 'SCHLUSSREFLEXION',
	h3_exkurs: 'GRUNDLAGENTHEORIE', // FG-Konstrukt liegt am GTH-Outline-Typ
	h3_werk_deskription: 'WERK_DESKRIPTION',
	h3_werk_gutacht: 'WERK_GUTACHT',
};

// Primäres Output-Konstrukt-Set pro Phase (Done-Marker). Mind. eines davon
// muss existieren, damit die Phase als "done" gilt. Mehrere Einträge =
// disjunktiv (z.B. FORSCHUNGSDESIGN: METHODOLOGIE/METHODEN/BASIS — eines
// reicht, weil unterschiedliche Werke unterschiedliche Aspekte explizit
// machen).
const PHASE_PRIMARY_KINDS: Record<H3Phase, string[] | null> = {
	h3_exposition: ['FRAGESTELLUNG'],
	h3_grundlagentheorie: ['FORSCHUNGSGEGENSTAND'], // werk-aggregierte End-Synthese
	h3_forschungsdesign: ['METHODOLOGIE', 'METHODEN', 'BASIS', 'AUFBAU_SKIZZE'],
	h3_durchfuehrung: ['BEFUND'],
	h3_synthese: ['GESAMTERGEBNIS'],
	h3_schlussreflexion: ['GELTUNGSANSPRUCH'],
	h3_exkurs: null, // Sondersemantik: version_stack @> '[{"kind":"re_spec"}]'
	h3_werk_deskription: ['WERK_BESCHREIBUNG'],
	h3_werk_gutacht: ['WERK_GUTACHT'],
};

// ── Done-Check ────────────────────────────────────────────────────────────

/**
 * True wenn das primäre Output-Konstrukt der Phase im Werk persistiert ist.
 */
export async function isH3PhaseDone(
	phase: H3Phase,
	caseId: string,
	documentId: string
): Promise<boolean> {
	if (phase === 'h3_exkurs') {
		// Sondersemantik: EXKURS modifiziert FORSCHUNGSGEGENSTAND destruktiv
		// via version_stack-Append (siehe ../ai/h3/exkurs.ts Top-Doc).
		// Done iff irgendein FG-Konstrukt einen 're_spec'-Eintrag im Stack hat.
		const row = await queryOne<{ id: string }>(
			`SELECT id FROM function_constructs
			 WHERE case_id = $1
			   AND document_id = $2
			   AND outline_function_type = 'GRUNDLAGENTHEORIE'
			   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
			   AND version_stack @> '[{"kind":"re_spec"}]'::jsonb
			 LIMIT 1`,
			[caseId, documentId]
		);
		return row !== null;
	}

	const outlineType = PHASE_OUTLINE_TYPE[phase];
	const kinds = PHASE_PRIMARY_KINDS[phase];
	if (!outlineType || !kinds) return false;

	const row = await queryOne<{ id: string }>(
		`SELECT id FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = $3
		   AND construct_kind = ANY($4)
		 LIMIT 1`,
		[caseId, documentId, outlineType, kinds]
	);
	return row !== null;
}

/**
 * Doc-only Variante von isH3PhaseDone für Aufrufer ohne caseId-Kontext.
 * Da jedes document_id genau einer case_id zugeordnet ist (Memory:
 * caseless docs sind unmöglich), ist der case_id-Filter für den Done-
 * Check ohnehin redundant.
 */
export async function isH3PhaseDoneForDocument(
	phase: H3Phase,
	documentId: string
): Promise<boolean> {
	if (phase === 'h3_exkurs') {
		const row = await queryOne<{ id: string }>(
			`SELECT id FROM function_constructs
			 WHERE document_id = $1
			   AND outline_function_type = 'GRUNDLAGENTHEORIE'
			   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
			   AND version_stack @> '[{"kind":"re_spec"}]'::jsonb
			 LIMIT 1`,
			[documentId]
		);
		return row !== null;
	}

	const outlineType = PHASE_OUTLINE_TYPE[phase];
	const kinds = PHASE_PRIMARY_KINDS[phase];
	if (!outlineType || !kinds) return false;

	const row = await queryOne<{ id: string }>(
		`SELECT id FROM function_constructs
		 WHERE document_id = $1
		   AND outline_function_type = $2
		   AND construct_kind = ANY($3)
		 LIMIT 1`,
		[documentId, outlineType, kinds]
	);
	return row !== null;
}

// ── Validation-Check ──────────────────────────────────────────────────────

/**
 * True wenn ein primäres Konstrukt der Phase einen Validierungs-Marker in
 * construct_validations (Mig 049) hat.
 */
export async function isH3PhaseValidated(
	phase: H3Phase,
	caseId: string,
	documentId: string
): Promise<boolean> {
	if (phase === 'h3_exkurs') {
		// Sondersemantik: validiert iff ein FG-Konstrukt mit re_spec-Stack-
		// Eintrag einen Validierungs-Marker hat. Der Re-Spec-Akt selbst
		// ist die Validierungs-Einheit, nicht das gesamte FG-Konstrukt.
		const row = await queryOne<{ id: string }>(
			`SELECT cv.id FROM construct_validations cv
			 JOIN function_constructs fc ON fc.id = cv.construct_id
			 WHERE fc.case_id = $1
			   AND fc.document_id = $2
			   AND fc.outline_function_type = 'GRUNDLAGENTHEORIE'
			   AND fc.construct_kind = 'FORSCHUNGSGEGENSTAND'
			   AND fc.version_stack @> '[{"kind":"re_spec"}]'::jsonb
			 LIMIT 1`,
			[caseId, documentId]
		);
		return row !== null;
	}

	const outlineType = PHASE_OUTLINE_TYPE[phase];
	const kinds = PHASE_PRIMARY_KINDS[phase];
	if (!outlineType || !kinds) return false;

	const row = await queryOne<{ id: string }>(
		`SELECT cv.id FROM construct_validations cv
		 JOIN function_constructs fc ON fc.id = cv.construct_id
		 WHERE fc.case_id = $1
		   AND fc.document_id = $2
		   AND fc.outline_function_type = $3
		   AND fc.construct_kind = ANY($4)
		 LIMIT 1`,
		[caseId, documentId, outlineType, kinds]
	);
	return row !== null;
}
