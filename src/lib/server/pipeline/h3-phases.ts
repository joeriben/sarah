// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3-Phasen-Dispatch — Glue zwischen Orchestrator (orchestrator.ts) und den
// einzelnen H3-Heuristiken unter ../ai/h3/. Das Modul beantwortet drei
// Fragen pro Phase:
//
//   isH3PhaseDone        — ist das primäre Output-Konstrukt bereits im Werk?
//                          (analog zu argument_nodes-Done-Check für AG)
//   isH3PhaseValidated   — hat der User das primäre Konstrukt explizit
//                          validiert (construct_validations, Mig 049)?
//                          Wenn ja → Phase überspringen.
//   runH3Phase           — führt die Phase aus (eine oder eine Heuristik-Kette);
//                          aggregiert Tokens; wirft PreconditionFailedError
//                          ungefangen weiter, damit der Orchestrator die Run-
//                          State-Transition (failed + Diagnose) übernimmt.
//
// Spec: docs/h3_orchestrator_spec.md (#3 Idempotenz mit User-Schutz, #5
// Crash-Resume, #6 Done-Checks).
//
// H3-Heuristiken nutzen heute keinen Prompt-Cache → cacheRead überall 0.

import { queryOne } from '../db/index.js';
import type { StepResult } from './orchestrator.js';

import { runExpositionPass } from '../ai/h3/exposition.js';
import { runGrundlagentheoriePass } from '../ai/h3/grundlagentheorie.js';
import { runRoutingPass } from '../ai/h3/grundlagentheorie_routing.js';
import { runReproductiveBlockPass } from '../ai/h3/grundlagentheorie_reproductive.js';
import { runDiskursivBezugPass } from '../ai/h3/grundlagentheorie_discursive.js';
import { runForschungsgegenstandPass } from '../ai/h3/grundlagentheorie_forschungsgegenstand.js';
import { runForschungsdesignPass } from '../ai/h3/forschungsdesign.js';
import {
	runDurchfuehrungPassStep1,
	runDurchfuehrungPassStep2,
	runDurchfuehrungPassStep3,
	runDurchfuehrungPassStep4,
} from '../ai/h3/durchfuehrung.js';
import { runSynthesePass } from '../ai/h3/synthese.js';
import { runSchlussreflexionPass } from '../ai/h3/schlussreflexion.js';
import { runExkursPass } from '../ai/h3/exkurs.js';
import { runWerkDeskriptionPass } from '../ai/h3/werk-deskription.js';
import { runWerkGutachtPass } from '../ai/h3/werk-gutacht.js';

// ── Phase-Type & Mapping ──────────────────────────────────────────────────

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

const H3_PHASES_SET: ReadonlySet<string> = new Set([
	'h3_exposition',
	'h3_grundlagentheorie',
	'h3_forschungsdesign',
	'h3_durchfuehrung',
	'h3_synthese',
	'h3_schlussreflexion',
	'h3_exkurs',
	'h3_werk_deskription',
	'h3_werk_gutacht',
]);

/**
 * Type-Guard: H3-Phasen sind werk-aggregierte Tool-Aufrufe (kein Iterations-
 * Atom, sondern eine Werk-Sicht). Der Orchestrator führt sie nicht durch die
 * Atom-Schleife, sondern direkt.
 */
export function isWerkPhase(phase: string): phase is H3Phase {
	return H3_PHASES_SET.has(phase);
}

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
// machen). Spec: docs/h3_orchestrator_spec.md #6.
const PHASE_PRIMARY_KINDS: Record<H3Phase, string[] | null> = {
	h3_exposition: ['FRAGESTELLUNG'],
	h3_grundlagentheorie: ['FORSCHUNGSGEGENSTAND'], // werk-aggregierte End-Synthese (Step 4)
	// METHODOLOGIE/METHODEN/BASIS: Standard-FORSCHUNGSDESIGN-Befund.
	// AUFBAU_SKIZZE: Critical-Friend-Befund für Werke ohne methodologische
	// Begründung — Plan vorhanden, aber nicht reflektiert. Eines reicht.
	h3_forschungsdesign: ['METHODOLOGIE', 'METHODEN', 'BASIS', 'AUFBAU_SKIZZE'],
	h3_durchfuehrung: ['BEFUND'], // Step-4-Output
	h3_synthese: ['GESAMTERGEBNIS'],
	h3_schlussreflexion: ['GELTUNGSANSPRUCH'],
	h3_exkurs: null, // Sondersemantik: version_stack @> '[{"kind":"re_spec"}]'
	h3_werk_deskription: ['WERK_BESCHREIBUNG'],
	h3_werk_gutacht: ['WERK_GUTACHT'],
};

// ── Done-Check ────────────────────────────────────────────────────────────

/**
 * True wenn das primäre Output-Konstrukt der Phase im Werk persistiert ist.
 *
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
 * Doc-only Variante von isH3PhaseDone für Aufrufer ohne caseId-Kontext
 * (z.B. listAtomsForPhase im Orchestrator). Da jedes document_id genau
 * einer case_id zugeordnet ist (Memory: caseless docs sind unmöglich),
 * ist der case_id-Filter für den Done-Check ohnehin redundant.
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
 * construct_validations (Mig 049) hat. Wenn validiert → Phase überspringen
 * (User-Schutz, Spec #3 Variante c).
 *
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

// ── Run-Dispatch ──────────────────────────────────────────────────────────

const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0 } as const;

function emptySkipped(): StepResult {
	return { skipped: true, tokens: { input: 0, output: 0, cacheRead: 0 } };
}

/**
 * Führt die zur Phase gehörige Heuristik (oder Heuristik-Kette) aus.
 *
 * Vor jedem Lauf wird isH3PhaseValidated geprüft — bei true wird die Phase
 * skipped (User-Schutz). Andernfalls wird die Heuristik gerufen, ihre
 * Tokens summiert und als StepResult zurückgegeben.
 *
 * PreconditionFailedError aus den Heuristiken wird NICHT gefangen — der
 * Orchestrator-Loop muss ihn sehen, um die Run-State-Transition (failed +
 * Diagnose) zu fahren. Spec: docs/h3_orchestrator_spec.md #2.
 */
export async function runH3Phase(
	phase: H3Phase,
	caseId: string,
	documentId: string
): Promise<StepResult> {
	if (await isH3PhaseValidated(phase, caseId, documentId)) {
		return emptySkipped();
	}

	switch (phase) {
		case 'h3_exposition': {
			const r = await runExpositionPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_grundlagentheorie': {
			// 5-stufige Pyramide. Step 1 (Verweisprofil) ist deterministisch
			// und teilweise LLM (siehe runGrundlagentheoriePass — gibt keine
			// Tokens im Result-Top-Level zurück, weil sie pro Container
			// aggregiert werden; wir summieren konservativ als 0 hier und
			// lassen die LLM-Tokens der GTH-Step-1-Calls in der unteren
			// Persistenz-Schicht zur Tracking-Info werden — der Pass-Result
			// vom Step 1 hat keine top-level tokens-Aggregation).
			//
			// Steps 2/3a/3b/4 reporten alle totalTokens / tokens auf Top-Level.
			let totalInput = 0;
			let totalOutput = 0;

			// Step 1: Verweisprofil pro Container. Result hat keine Token-
			// Aggregation auf Top-Level (nur containers[].profile mit Roh-
			// Statistik); Token-Verbrauch geschieht intern pro Container und
			// wird nicht summiert exportiert. Wir betrachten Step 1 für die
			// Run-Aggregation als Token-frei (Daten-Verlust akzeptiert; das
			// Genaue Tracking lebt im jeweiligen CLI-Skript-Output).
			await runGrundlagentheoriePass(caseId);

			// Step 2: Routing der Verdachts-Blöcke.
			const r2 = await runRoutingPass(caseId);
			totalInput += r2.totalTokens.input;
			totalOutput += r2.totalTokens.output;

			// Step 3a: Reproduktive Block-Würdigung.
			const r3a = await runReproductiveBlockPass(caseId);
			totalInput += r3a.totalTokens.input;
			totalOutput += r3a.totalTokens.output;

			// Step 3b: Diskursiv-Bezug-Prüfung.
			const r3b = await runDiskursivBezugPass(caseId);
			totalInput += r3b.totalTokens.input;
			totalOutput += r3b.totalTokens.output;

			// Step 4: FORSCHUNGSGEGENSTAND-Aggregation.
			const r4 = await runForschungsgegenstandPass(caseId);
			totalInput += r4.tokens.input;
			totalOutput += r4.tokens.output;

			return {
				skipped: false,
				tokens: { input: totalInput, output: totalOutput, cacheRead: 0 },
			};
		}

		case 'h3_forschungsdesign': {
			// Wirft PreconditionFailedError bei fehlender FRAGESTELLUNG /
			// FORSCHUNGSGEGENSTAND — bewusst nicht gefangen.
			const r = await runForschungsdesignPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_durchfuehrung': {
			// 4-stufige Kette. Step 1 ist deterministisch (Hotspot-Detect,
			// keine Tokens). Step 2 hat ein erweitertes Token-Schema mit
			// cacheCreation+cacheRead (nutzt H1-AG-Pass intern, der den
			// Prompt-Cache fährt) — wir summieren cacheRead auf, mappen
			// cacheCreation aber nicht (hat im StepResult keinen Slot;
			// cache-Creation-Tokens werden vom Tracker ohnehin nicht
			// separat akkumuliert, nur cacheRead aus Cost-Sicht relevant).
			// Step 3 ist deterministisch (Token-Lookup, keine Tokens).
			// Step 4 hat tokens: { input, output }.
			let totalInput = 0;
			let totalOutput = 0;
			let totalCacheRead = 0;

			await runDurchfuehrungPassStep1(caseId);

			const r2 = await runDurchfuehrungPassStep2(caseId);
			totalInput += r2.tokens.input;
			totalOutput += r2.tokens.output;
			totalCacheRead += r2.tokens.cacheRead;

			await runDurchfuehrungPassStep3(caseId);

			const r4 = await runDurchfuehrungPassStep4(caseId);
			totalInput += r4.tokens.input;
			totalOutput += r4.tokens.output;

			return {
				skipped: false,
				tokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead },
			};
		}

		case 'h3_synthese': {
			const r = await runSynthesePass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_schlussreflexion': {
			const r = await runSchlussreflexionPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_exkurs': {
			const r = await runExkursPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_werk_deskription': {
			const r = await runWerkDeskriptionPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}

		case 'h3_werk_gutacht': {
			// User-Setzung 2026-05-04: c-Gating heute deaktiviert für Test
			// (kein review_draft-Check). content.gatingDisabled markiert das
			// transparent; volle dialogische Kette d/e/f bleibt deferred.
			const r = await runWerkGutachtPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
	}
}
