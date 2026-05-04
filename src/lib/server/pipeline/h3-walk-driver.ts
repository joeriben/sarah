// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// H3-Walk-Driver — der Orchestrator-Anschluss der H3-Heuristik.
//
// Konzept (User-Setzung 2026-05-04, feedback_no_phase_layer_orchestrator):
// "Es ist nichts anderes als der Aufbau eines sehr einfachen linearen
// direktionalen Graphen." Jede H3-Run-Ausführung läuft eine Sequenz von
// Walk-Steps in Dokument-Reihenfolge ab. Ein Walk-Step ist entweder:
//
//   - ein Komplex-Step  (kind: 'complex')        — pro Absatz-Komplex
//                                                   (EXPOSITION, GTH,
//                                                   DURCHFÜHRUNG, EXKURS)
//   - ein Werk-Step     (kind: 'werk_*')          — virtueller Knoten für
//                                                   werk-aggregierte Tools
//                                                   (FG, FORSCHUNGSDESIGN,
//                                                   SYNTHESE, SR, WERK_*)
//
// Werk-Steps sitzen positional an logischen Übergängen:
//   - FG-Aggregation läuft unmittelbar vor FORSCHUNGSDESIGN.
//   - SYNTHESE / SCHLUSSREFLEXION sitzen am ersten Auftreten ihres Container-
//     Funktionstyps in der Outline.
//   - WERK_DESKRIPTION + WERK_GUTACHT laufen am Ende des Walks.
//   - EXKURS sitzt positional dort, wo er im Dokument steht (kein Sammeln am Ende).
//
// Es gibt keine Phase-Schicht mehr — der Orchestrator dispatcht je Walk-Step
// das passende Tool. h3-phases.ts bleibt nur als Legacy-Helper für Test-
// Skripte erhalten, ist aber nicht mehr Teil des Run-Pfads.

import { queryOne } from '../db/index.js';
import type { StepResult } from './orchestrator.js';
import { loadH3ComplexWalk, type H3Complex } from './h3-complex-walk.js';

import { runExpositionForComplex } from '../ai/h3/exposition.js';
import {
	runGrundlagentheorieStep1ForComplex,
} from '../ai/h3/grundlagentheorie.js';
import { runRoutingForComplex } from '../ai/h3/grundlagentheorie_routing.js';
import { runReproductiveBlockForComplex } from '../ai/h3/grundlagentheorie_reproductive.js';
import { runDiskursivBezugForComplex } from '../ai/h3/grundlagentheorie_discursive.js';
import { runForschungsgegenstandPass } from '../ai/h3/grundlagentheorie_forschungsgegenstand.js';
import { runForschungsdesignPass } from '../ai/h3/forschungsdesign.js';
import {
	runDurchfuehrungStep1ForComplex,
	runDurchfuehrungStep2ForComplex,
	runDurchfuehrungStep3ForComplex,
	runDurchfuehrungStep4ForComplex,
} from '../ai/h3/durchfuehrung.js';
import { runExkursForComplex } from '../ai/h3/exkurs.js';
import { runSynthesePass } from '../ai/h3/synthese.js';
import { runSchlussreflexionPass } from '../ai/h3/schlussreflexion.js';
import { runWerkDeskriptionPass } from '../ai/h3/werk-deskription.js';
import { runWerkGutachtPass } from '../ai/h3/werk-gutacht.js';

// ── Walk-Step-Modell ──────────────────────────────────────────────────────

export type H3WalkStepKind =
	| 'complex'
	| 'werk_fg_aggregation'
	| 'werk_forschungsdesign'
	| 'werk_synthese'
	| 'werk_schlussreflexion'
	| 'werk_deskription'
	| 'werk_gutacht';

export type H3WalkStep =
	| { kind: 'complex'; complex: H3Complex }
	| { kind: 'werk_fg_aggregation' }
	| { kind: 'werk_forschungsdesign' }
	| { kind: 'werk_synthese' }
	| { kind: 'werk_schlussreflexion' }
	| { kind: 'werk_deskription' }
	| { kind: 'werk_gutacht' };

/** Stabile Atom-ID pro Walk-Step (für Pipeline-Run-Atom-Tracking). */
export function walkStepId(step: H3WalkStep): string {
	switch (step.kind) {
		case 'complex':
			return `complex:${step.complex.headingId}`;
		default:
			return step.kind;
	}
}

/** Anzeige-Label pro Walk-Step (für UI / SSE step-start/done). */
export function walkStepLabel(step: H3WalkStep): string {
	switch (step.kind) {
		case 'complex': {
			const heading = step.complex.headingText.trim().slice(0, 60) || '(unbenannt)';
			return `${step.complex.functionType} · ${heading}`;
		}
		case 'werk_fg_aggregation':
			return 'FORSCHUNGSGEGENSTAND-Aggregation';
		case 'werk_forschungsdesign':
			return 'FORSCHUNGSDESIGN (Methodik)';
		case 'werk_synthese':
			return 'SYNTHESE (Gesamtergebnis)';
		case 'werk_schlussreflexion':
			return 'SCHLUSSREFLEXION (Geltungsanspruch)';
		case 'werk_deskription':
			return 'WERK_DESKRIPTION';
		case 'werk_gutacht':
			return 'WERK_GUTACHT';
	}
}

// ── Walk-Aufbau ───────────────────────────────────────────────────────────

/**
 * Baut die Walk-Sequenz aus der geladenen Komplex-Liste auf. Werk-
 * Aggregationen werden positional eingewoben:
 *
 *   - FG-Aggregation läuft unmittelbar VOR dem ersten FG-Konsumenten im
 *     Walk. FG-Konsumenten sind EXKURS (modifiziert FG destruktiv via
 *     re_spec, siehe ai/h3/exkurs.ts) und werk_forschungsdesign (liest
 *     FG als Bezugsrahmen). Stehen mehrere Konsumenten im Walk, läuft die
 *     Aggregation einmal vor dem ersten — die folgenden lesen den
 *     bestehenden Stand.
 *   - werk_forschungsdesign wird IMMER als Werk-Step emittiert, unabhängig
 *     vom Vorhandensein eines FORSCHUNGSDESIGN-Containers in der Outline:
 *     der Pass hat eine eigene Material-Sammel-Kaskade
 *     (Outline-Container → EXPOSITION-Methoden-Marker → Volltext-Scan,
 *     siehe ai/h3/forschungsdesign.ts:collectParagraphs) und einen
 *     AUFBAU_SKIZZE-Fallback für Werke ohne jegliches Methoden-Material.
 *     Position: VOR dem ersten DURCHFÜHRUNG-Komplex (DURCH braucht FD als
 *     Bezugsmaßstab — Mother-Session Zeile 17: "Die DURCHFÜHRUNG setzt das
 *     damit artikulierte FORSCHUNGSDESIGN konkret und programmatisch um").
 *     Falls der Walk vorher schon einen FORSCHUNGSDESIGN-Komplex enthält,
 *     ziehen wir den Werk-Step an dieser Stelle ein. Sonst wird FD spätestens
 *     vor dem ersten DURCH-Komplex sichergestellt — auch wenn FD im Werk
 *     strukturell NO SHOW ist, MUSS der Pass gelaufen sein, damit DURCH
 *     den dokumentierten Befund "kein Methodenmaterial" als Ausgangspunkt
 *     hat (User-Setzung 2026-05-05).
 *   - SYNTHESE / SCHLUSSREFLEXION ersetzen ihre Container-Komplexe durch je
 *     einen Werk-Step beim ersten Auftreten des Funktionstyps. Vor Synthese
 *     wird sichergestellt, dass werk_forschungsdesign bereits gelaufen ist.
 *   - EXPOSITION / GRUNDLAGENTHEORIE bleiben als Komplex-Steps an ihrer
 *     Dokument-Position. DURCHFÜHRUNG triggert bei seinem ersten Auftreten
 *     ensureForschungsdesign() vor sich selbst.
 *   - EXKURS-Komplexe sitzen positional an ihrer Dokument-Stelle. Der erste
 *     EXKURS triggert die FG-Aggregation, falls noch nicht gelaufen.
 *   - WERK_STRUKTUR-Komplexe (Outline-Skelett-Marker) werden übersprungen —
 *     kein zugeordnetes Tool. WERK_DESKRIPTION + WERK_GUTACHT laufen werk-
 *     skopiert immer am Ende.
 */
export function buildH3WalkSteps(walk: H3Complex[]): H3WalkStep[] {
	const steps: H3WalkStep[] = [];
	let fdEmitted = false;
	let fgAggregationEmitted = false;
	let syntheseEmitted = false;
	let schlussreflexionEmitted = false;

	const ensureFgAggregation = () => {
		if (!fgAggregationEmitted) {
			steps.push({ kind: 'werk_fg_aggregation' });
			fgAggregationEmitted = true;
		}
	};
	const ensureForschungsdesign = () => {
		ensureFgAggregation();
		if (!fdEmitted) {
			steps.push({ kind: 'werk_forschungsdesign' });
			fdEmitted = true;
		}
	};

	for (const complex of walk) {
		switch (complex.functionType) {
			case 'EXPOSITION':
			case 'GRUNDLAGENTHEORIE':
				steps.push({ kind: 'complex', complex });
				break;
			case 'DURCHFUEHRUNG':
				// User-Setzung 2026-05-05 + Mother-Session Zeile 17:
				// "Die DURCHFÜHRUNG setzt das damit artikulierte FORSCHUNGSDESIGN
				// konkret und programmatisch um." DURCH darf nicht ohne
				// gelaufenes FORSCHUNGSDESIGN stattfinden — der DURCH-Pass
				// braucht FD als Bezugsmaßstab. Auch wenn FD im Werk strukturell
				// NO SHOW ist (kein Methodenkapitel, keine Aufbau-Skizze), muss
				// der FD-Walk-Step gelaufen sein, damit DURCH den Befund
				// als Ausgangspunkt hat.
				ensureForschungsdesign();
				steps.push({ kind: 'complex', complex });
				break;
			case 'EXKURS':
				// FG-Konsument: aggregiert FG vor Erst-EXKURS, falls noch nicht.
				ensureFgAggregation();
				steps.push({ kind: 'complex', complex });
				break;
			case 'FORSCHUNGSDESIGN':
				ensureForschungsdesign();
				break;
			case 'SYNTHESE':
				// SYNTHESE liest u.a. METHODEN/BASIS aus FORSCHUNGSDESIGN.
				// Der FD-Pass ist der Material-Sammler — wir stellen sicher,
				// dass er vor SYNTHESE läuft, auch ohne Outline-Container.
				ensureForschungsdesign();
				if (!syntheseEmitted) {
					steps.push({ kind: 'werk_synthese' });
					syntheseEmitted = true;
				}
				break;
			case 'SCHLUSSREFLEXION':
				ensureForschungsdesign();
				if (!schlussreflexionEmitted) {
					steps.push({ kind: 'werk_schlussreflexion' });
					schlussreflexionEmitted = true;
				}
				break;
			case 'WERK_STRUKTUR':
				// Outline-Marker für Werk-Skelett — kein per-Komplex-Tool.
				// WERK_DESKRIPTION/WERK_GUTACHT laufen werk-skopiert am Ende.
				break;
		}
	}

	// Post-Loop: stelle sicher, dass FG-Aggregation und FORSCHUNGSDESIGN
	// gelaufen sind, bevor WERK_DESKRIPTION + WERK_GUTACHT folgen. Beide
	// Werk-Pässe brauchen das volle Bezugs-Set.
	ensureForschungsdesign();

	steps.push({ kind: 'werk_deskription' });
	steps.push({ kind: 'werk_gutacht' });

	return steps;
}

/** Convenience-Wrapper: lädt Walk und baut die Step-Sequenz auf. */
export async function listH3WalkSteps(documentId: string): Promise<H3WalkStep[]> {
	const walk = await loadH3ComplexWalk(documentId);
	return buildH3WalkSteps(walk);
}

// ── Done-Check pro Walk-Step ──────────────────────────────────────────────

/**
 * True wenn der Walk-Step bereits abgeschlossene Output-Konstrukte hat. Best-
 * effort — die per-Komplex- und werk-Tools sind selbst idempotent (Re-Run
 * skip'd intern), daher ist der Done-Check nur eine Vor-Optimierung, nicht
 * korrektheitsrelevant.
 */
export async function isH3WalkStepDone(
	step: H3WalkStep,
	caseId: string,
	documentId: string
): Promise<boolean> {
	switch (step.kind) {
		case 'complex': {
			const c = step.complex;
			switch (c.functionType) {
				case 'EXPOSITION':
					return existsConstructWithAnchors(
						caseId,
						documentId,
						'EXPOSITION',
						['FRAGESTELLUNG'],
						c.paragraphIds
					);
				case 'GRUNDLAGENTHEORIE':
					// Step-1-Output (VERWEIS_PROFIL) markiert den Komplex als
					// angefasst; Sub-Steps 2/3a/3b sind intern idempotent.
					return existsConstructWithAnchors(
						caseId,
						documentId,
						'GRUNDLAGENTHEORIE',
						['VERWEIS_PROFIL'],
						c.paragraphIds
					);
				case 'DURCHFUEHRUNG':
					// Step-4-Output (BEFUND) markiert die Pyramide als
					// abgeschlossen.
					return existsConstructWithAnchors(
						caseId,
						documentId,
						'DURCHFUEHRUNG',
						['BEFUND'],
						c.paragraphIds
					);
				case 'EXKURS': {
					// Done iff irgendein FG-Konstrukt einen 're_spec'-Eintrag
					// im version_stack mit Bezug zu diesem Container-Heading hat.
					const row = await queryOne<{ id: string }>(
						`SELECT id FROM function_constructs
						 WHERE case_id = $1
						   AND document_id = $2
						   AND outline_function_type = 'GRUNDLAGENTHEORIE'
						   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
						   AND version_stack @> $3::jsonb
						 LIMIT 1`,
						[
							caseId,
							documentId,
							JSON.stringify([{ kind: 're_spec', heading_id: c.headingId }]),
						]
					);
					return row !== null;
				}
				default:
					return false;
			}
		}
		case 'werk_fg_aggregation':
			return existsConstruct(caseId, documentId, 'GRUNDLAGENTHEORIE', [
				'FORSCHUNGSGEGENSTAND',
			]);
		case 'werk_forschungsdesign':
			return existsConstruct(caseId, documentId, 'FORSCHUNGSDESIGN', [
				'METHODOLOGIE',
				'METHODEN',
				'BASIS',
				'AUFBAU_SKIZZE',
			]);
		case 'werk_synthese':
			return existsConstruct(caseId, documentId, 'SYNTHESE', ['GESAMTERGEBNIS']);
		case 'werk_schlussreflexion':
			return existsConstruct(caseId, documentId, 'SCHLUSSREFLEXION', ['GELTUNGSANSPRUCH']);
		case 'werk_deskription':
			return existsConstruct(caseId, documentId, 'WERK_DESKRIPTION', ['WERK_BESCHREIBUNG']);
		case 'werk_gutacht':
			return existsConstruct(caseId, documentId, 'WERK_GUTACHT', ['WERK_GUTACHT']);
	}
}

async function existsConstruct(
	caseId: string,
	documentId: string,
	outlineType: string,
	kinds: string[]
): Promise<boolean> {
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

async function existsConstructWithAnchors(
	caseId: string,
	documentId: string,
	outlineType: string,
	kinds: string[],
	anchorIds: string[]
): Promise<boolean> {
	if (anchorIds.length === 0) return false;
	const row = await queryOne<{ id: string }>(
		`SELECT id FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = $3
		   AND construct_kind = ANY($4)
		   AND anchor_element_ids && $5::uuid[]
		 LIMIT 1`,
		[caseId, documentId, outlineType, kinds, anchorIds]
	);
	return row !== null;
}

// ── Walk-Step-Validation (User-Schutz) ────────────────────────────────────

/**
 * True wenn ein primäres Konstrukt des Walk-Steps in construct_validations
 * (Mig 049) markiert ist. Validierte Konstrukte werden nicht überschrieben —
 * der Walk-Step skippt im Lauf.
 *
 * Best-effort wie Done-Check: bei Komplex-Steps wird auf Anchor-Overlap zum
 * Komplex geprüft, bei Werk-Steps doc-weit.
 */
export async function isH3WalkStepValidated(
	step: H3WalkStep,
	caseId: string,
	documentId: string
): Promise<boolean> {
	switch (step.kind) {
		case 'complex': {
			const c = step.complex;
			switch (c.functionType) {
				case 'EXPOSITION':
					return existsValidationWithAnchors(
						caseId,
						documentId,
						'EXPOSITION',
						['FRAGESTELLUNG'],
						c.paragraphIds
					);
				case 'GRUNDLAGENTHEORIE':
					return existsValidationWithAnchors(
						caseId,
						documentId,
						'GRUNDLAGENTHEORIE',
						['VERWEIS_PROFIL'],
						c.paragraphIds
					);
				case 'DURCHFUEHRUNG':
					return existsValidationWithAnchors(
						caseId,
						documentId,
						'DURCHFUEHRUNG',
						['BEFUND'],
						c.paragraphIds
					);
				case 'EXKURS': {
					const row = await queryOne<{ id: string }>(
						`SELECT cv.id FROM construct_validations cv
						 JOIN function_constructs fc ON fc.id = cv.construct_id
						 WHERE fc.case_id = $1
						   AND fc.document_id = $2
						   AND fc.outline_function_type = 'GRUNDLAGENTHEORIE'
						   AND fc.construct_kind = 'FORSCHUNGSGEGENSTAND'
						   AND fc.version_stack @> $3::jsonb
						 LIMIT 1`,
						[
							caseId,
							documentId,
							JSON.stringify([{ kind: 're_spec', heading_id: c.headingId }]),
						]
					);
					return row !== null;
				}
				default:
					return false;
			}
		}
		case 'werk_fg_aggregation':
			return existsValidation(caseId, documentId, 'GRUNDLAGENTHEORIE', [
				'FORSCHUNGSGEGENSTAND',
			]);
		case 'werk_forschungsdesign':
			return existsValidation(caseId, documentId, 'FORSCHUNGSDESIGN', [
				'METHODOLOGIE',
				'METHODEN',
				'BASIS',
				'AUFBAU_SKIZZE',
			]);
		case 'werk_synthese':
			return existsValidation(caseId, documentId, 'SYNTHESE', ['GESAMTERGEBNIS']);
		case 'werk_schlussreflexion':
			return existsValidation(caseId, documentId, 'SCHLUSSREFLEXION', [
				'GELTUNGSANSPRUCH',
			]);
		case 'werk_deskription':
			return existsValidation(caseId, documentId, 'WERK_DESKRIPTION', [
				'WERK_BESCHREIBUNG',
			]);
		case 'werk_gutacht':
			return existsValidation(caseId, documentId, 'WERK_GUTACHT', ['WERK_GUTACHT']);
	}
}

async function existsValidation(
	caseId: string,
	documentId: string,
	outlineType: string,
	kinds: string[]
): Promise<boolean> {
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

async function existsValidationWithAnchors(
	caseId: string,
	documentId: string,
	outlineType: string,
	kinds: string[],
	anchorIds: string[]
): Promise<boolean> {
	if (anchorIds.length === 0) return false;
	const row = await queryOne<{ id: string }>(
		`SELECT cv.id FROM construct_validations cv
		 JOIN function_constructs fc ON fc.id = cv.construct_id
		 WHERE fc.case_id = $1
		   AND fc.document_id = $2
		   AND fc.outline_function_type = $3
		   AND fc.construct_kind = ANY($4)
		   AND fc.anchor_element_ids && $5::uuid[]
		 LIMIT 1`,
		[caseId, documentId, outlineType, kinds, anchorIds]
	);
	return row !== null;
}

// ── Run-Dispatch ──────────────────────────────────────────────────────────

function emptySkipped(): StepResult {
	return { skipped: true, tokens: { input: 0, output: 0, cacheRead: 0 } };
}

/**
 * Führt einen Walk-Step aus. Komplex-Steps dispatchen je nach functionType
 * das passende per-Komplex-Tool (bei GRUNDLAGENTHEORIE und DURCHFÜHRUNG die
 * gesamte Sub-Tool-Kette als ein Walk-Step). Werk-Steps rufen das werk-
 * skopierte Tool direkt auf.
 *
 * Vor jedem Lauf wird isH3WalkStepValidated geprüft — bei true wird der
 * Step skipped (User-Schutz, analog zu construct_validations Mig 049).
 *
 * PreconditionFailedError aus den Tools wird NICHT gefangen — der
 * Orchestrator-Loop muss ihn sehen, um den Run-State auf failed zu fahren.
 */
export async function runH3WalkStep(
	step: H3WalkStep,
	caseId: string,
	documentId: string
): Promise<StepResult> {
	if (await isH3WalkStepValidated(step, caseId, documentId)) {
		return emptySkipped();
	}

	switch (step.kind) {
		case 'complex':
			return runComplexStep(step.complex, caseId, documentId);
		case 'werk_fg_aggregation': {
			const r = await runForschungsgegenstandPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'werk_forschungsdesign': {
			const r = await runForschungsdesignPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'werk_synthese': {
			const r = await runSynthesePass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'werk_schlussreflexion': {
			const r = await runSchlussreflexionPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'werk_deskription': {
			const r = await runWerkDeskriptionPass(caseId);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'werk_gutacht': {
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

async function runComplexStep(
	complex: H3Complex,
	caseId: string,
	documentId: string
): Promise<StepResult> {
	switch (complex.functionType) {
		case 'EXPOSITION': {
			const r = await runExpositionForComplex(caseId, documentId, complex);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'GRUNDLAGENTHEORIE': {
			// Komplette Sub-Pyramide pro Komplex: Step 1 (Verweisprofil) →
			// Step 2 (Routing) → Step 3a (Reproductive) → Step 3b (Discursive).
			// FORSCHUNGSGEGENSTAND-Aggregation (alter Step 4) ist als eigener
			// werk_fg_aggregation-Walk-Step modelliert und läuft unmittelbar
			// vor FORSCHUNGSDESIGN.
			let totalInput = 0;
			let totalOutput = 0;

			// Step 1: Verweisprofil. Result hat keine Token-Aggregation auf
			// Top-Level (die LLM-Call-Tokens werden intern persistiert), wir
			// summieren konservativ als 0.
			await runGrundlagentheorieStep1ForComplex(caseId, documentId, complex);

			const r2 = await runRoutingForComplex(caseId, documentId, complex);
			totalInput += r2.totalTokens.input;
			totalOutput += r2.totalTokens.output;

			const r3a = await runReproductiveBlockForComplex(caseId, documentId, complex);
			totalInput += r3a.totalTokens.input;
			totalOutput += r3a.totalTokens.output;

			const r3b = await runDiskursivBezugForComplex(caseId, documentId, complex);
			totalInput += r3b.totalTokens.input;
			totalOutput += r3b.totalTokens.output;

			return {
				skipped: false,
				tokens: { input: totalInput, output: totalOutput, cacheRead: 0 },
			};
		}
		case 'DURCHFUEHRUNG': {
			// 4-Stufen-Pyramide pro Komplex. Step 1 ist deterministisch
			// (Hotspot-Detect, keine Tokens). Step 2 hat erweitertes Token-
			// Schema mit cacheCreation+cacheRead (nutzt H1-AG-Pass intern,
			// der den Prompt-Cache fährt) — wir summieren cacheRead auf,
			// cacheCreation hat im StepResult keinen Slot. Step 3 ist
			// deterministisch (Token-Lookup). Step 4 hat tokens: { input, output }.
			let totalInput = 0;
			let totalOutput = 0;
			let totalCacheRead = 0;

			await runDurchfuehrungStep1ForComplex(caseId, documentId, complex);

			const r2 = await runDurchfuehrungStep2ForComplex(caseId, documentId, complex);
			totalInput += r2.tokens.input;
			totalOutput += r2.tokens.output;
			totalCacheRead += r2.tokens.cacheRead;

			await runDurchfuehrungStep3ForComplex(caseId, documentId, complex);

			const r4 = await runDurchfuehrungStep4ForComplex(caseId, documentId, complex);
			totalInput += r4.tokens.input;
			totalOutput += r4.tokens.output;

			return {
				skipped: false,
				tokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead },
			};
		}
		case 'EXKURS': {
			const r = await runExkursForComplex(caseId, documentId, complex);
			return {
				skipped: false,
				tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: 0 },
			};
		}
		case 'FORSCHUNGSDESIGN':
		case 'SYNTHESE':
		case 'SCHLUSSREFLEXION':
		case 'WERK_STRUKTUR':
			// FORSCHUNGSDESIGN/SYNTHESE/SCHLUSSREFLEXION sind werk-aggregiert
			// und laufen als eigene werk_*-Steps. WERK_STRUKTUR hat kein Tool.
			// buildH3WalkSteps emittiert für diese Typen keinen Komplex-Step.
			throw new Error(
				`runComplexStep: functionType ${complex.functionType} ist werk-aggregiert ` +
					`und darf nicht als Komplex-Step laufen (heading ${complex.headingId}).`
			);
	}
}
