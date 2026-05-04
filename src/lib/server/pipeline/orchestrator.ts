// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pipeline-Orchestrator — sequentieller Treiber der hermeneutischen Pässe in
// der korrekten Reihenfolge je gewähltem Heuristik-Pfad. State liegt in
// pipeline_runs (Migration 038); Pause/Resume läuft über cancel_requested +
// Idempotenz der Einzel-Pässe.
//
// Heuristik-Pfade sind exklusiv pro Run (Memory
// `project_three_heuristics_architecture.md`): genau einer von H1, H2, H3
// läuft je Run-Trigger. Default 'h1'. Wer mehrere Pfade auf demselben Werk
// anwenden will, triggert sequenziell mehrere Runs — automatische
// Verkettung gibt es nicht.
//
// H1 — analytische Hauptlinie (Default):
//   1. argumentation_graph  — pro Absatz Argumente/Edges/Scaffolding
//      (optional: argument_validity dazwischen, wenn include_validity)
//   2. section_collapse     — Subkapitel-Memo aus Graph (L2/L3 adaptiv)
//   3. chapter_collapse     — Hauptkapitel-Memo (L1)
//   4. document_collapse    — Werk-Memo (L0)
//
// H2 — synthetisch-hermeneutisch:
//   1. paragraph_synthetic  — formulierend + interpretierend pro Absatz
//      Konsumiert nichts vom Graph; pures Lese-Addendum für den Reader.
//
// H3 — kontextadaptiv (funktionstyp-orchestriert):
//   siehe H3_PHASE_ORDER unten und docs/h3_orchestrator_spec.md.

import { query, queryOne } from '../db/index.js';
import {
	loadResolvedOutline,
	loadChapterUnits,
	chooseSubchapterLevel,
	getPersistedSubchapterLevel,
	persistSubchapterLevel,
} from '../ai/hermeneutic/heading-hierarchy.js';
import { runParagraphPass } from '../ai/hermeneutic/per-paragraph.js';
import { runArgumentationGraphPass } from '../ai/hermeneutic/argumentation-graph.js';
import { runArgumentValidityPass } from '../ai/hermeneutic/argument-validity.js';
import { runGraphCollapse } from '../ai/hermeneutic/section-collapse-from-graph.js';
import { runChapterCollapse } from '../ai/hermeneutic/chapter-collapse.js';
import { runDocumentCollapse } from '../ai/hermeneutic/document-collapse.js';
import { runH3Phase, isH3PhaseDoneForDocument, isWerkPhase } from './h3-phases.js';
import type { H3Phase } from './h3-phases.js';
import { PreconditionFailedError } from '../ai/h3/precondition.js';

export type Phase =
	| 'argumentation_graph'
	| 'argument_validity'
	| 'section_collapse'
	| 'chapter_collapse'
	| 'document_collapse'
	| 'paragraph_synthetic'
	// H3 — kontextadaptive funktionstyp-orchestrierte Phasen
	// Reihenfolge: docs/h3_orchestrator_spec.md (EXPOSITION → GTH →
	// FORSCHUNGSDESIGN → DURCHFÜHRUNG → SYNTHESE → SCHLUSSREFLEXION →
	// EXKURS → WERK_DESKRIPTION → WERK_GUTACHT)
	| 'h3_exposition'
	| 'h3_grundlagentheorie'
	| 'h3_forschungsdesign'
	| 'h3_durchfuehrung'
	| 'h3_synthese'
	| 'h3_schlussreflexion'
	| 'h3_exkurs'
	| 'h3_werk_deskription'
	| 'h3_werk_gutacht';

// Hauptlinie ohne argument_validity — diese Phase ist opt-in und wird per
// phasesForRun() bei aktivem RunOptions.include_validity zwischen
// argumentation_graph und section_collapse eingefügt.
export const PHASE_ORDER_ANALYTICAL: Phase[] = [
	'argumentation_graph',
	'section_collapse',
	'chapter_collapse',
	'document_collapse',
];

export const PHASE_LABEL: Record<Phase, string> = {
	argumentation_graph: 'Argumentation pro Absatz',
	argument_validity: 'Argument-Validität (Charity-Pass)',
	section_collapse: 'Subkapitel-Synthesen',
	chapter_collapse: 'Hauptkapitel-Synthesen',
	document_collapse: 'Werk-Synthese',
	paragraph_synthetic: 'Per-Absatz-Hermeneutik (synthetisch)',
	h3_exposition: 'H3 · Exposition (Fragestellung & Motivation)',
	h3_grundlagentheorie: 'H3 · Grundlagentheorie (Verweisprofil → Forschungsgegenstand)',
	h3_forschungsdesign: 'H3 · Forschungsdesign (Methodik)',
	h3_durchfuehrung: 'H3 · Durchführung',
	h3_synthese: 'H3 · Synthese (Gesamtergebnis)',
	h3_schlussreflexion: 'H3 · Schlussreflexion (Geltungsanspruch)',
	h3_exkurs: 'H3 · Exkurs',
	h3_werk_deskription: 'H3 · Werk-Deskription',
	h3_werk_gutacht: 'H3 · Werk-Gutacht (a + b + c, c-Gating für Test deaktiviert)',
};

// H3-Phase-Reihenfolge gemäß docs/h3_orchestrator_spec.md (Bedingungsgefüge
// determiniert Reihenfolge; harte Vorbedingungen werden in den Pass-Funktionen
// geprüft und führen bei Verletzung zu PreconditionFailedError → Run-State
// `failed`).
const H3_PHASE_ORDER: Phase[] = [
	'h3_exposition',
	'h3_grundlagentheorie',
	'h3_forschungsdesign',
	'h3_durchfuehrung',
	'h3_synthese',
	'h3_schlussreflexion',
	'h3_exkurs',
	'h3_werk_deskription',
	'h3_werk_gutacht',
];

export interface RunOptions {
	// Pfad-Wahl: H1, H2 und H3 sind drei eigenständige, exklusive Heuristik-
	// Pfade pro Run (Memory `project_three_heuristics_architecture.md`).
	// Default `'h1'`, wenn nicht gesetzt. Wer mehrere Pfade auf demselben
	// Werk anwenden will, triggert sequenziell mehrere Runs — automatische
	// Verkettung gibt es nicht.
	heuristic?: 'h1' | 'h2' | 'h3';

	// H1-spezifischer Modifikator. Wird ignoriert, wenn heuristic !== 'h1'.
	include_validity?: boolean;

	cost_cap_usd?: number | null;
}

export interface PipelineRunRow {
	id: string;
	case_id: string;
	document_id: string;
	started_by_user_id: string;
	status: 'running' | 'paused' | 'completed' | 'failed';
	current_phase: Phase | null;
	current_index: number;
	total_in_phase: number | null;
	last_step_label: string | null;
	options: RunOptions;
	cancel_requested: boolean;
	error_message: string | null;
	accumulated_input_tokens: number;
	accumulated_output_tokens: number;
	accumulated_cache_read_tokens: number;
	accumulated_cost_usd: number;
	started_at: string;
	paused_at: string | null;
	resumed_at: string | null;
	completed_at: string | null;
	last_event_at: string;
}

interface AtomRef {
	id: string;
	label: string;
	headingId?: string;
}

interface StepDescriptor {
	phase: Phase;
	atom: AtomRef;
	index: number;
	total: number;
}

export interface StepResult {
	skipped: boolean;
	tokens: { input: number; output: number; cacheRead: number };
	memoId?: string | null;
}

export type PipelineEvent =
	| { type: 'run-init'; runId: string; status: PipelineRunRow['status']; resumed: boolean }
	| { type: 'phase-start'; phase: Phase; total: number }
	| { type: 'step-start'; phase: Phase; atom: AtomRef; index: number; total: number }
	| { type: 'step-done'; phase: Phase; atom: AtomRef; index: number; total: number; skipped: boolean; tokens: StepResult['tokens']; cumulative: { input: number; output: number; cacheRead: number } }
	| { type: 'step-error'; phase: Phase; atom: AtomRef; message: string }
	| { type: 'paused'; reason?: string }
	| { type: 'completed' }
	| { type: 'failed'; message: string };

// ── Run-Lifecycle ─────────────────────────────────────────────────────────

/**
 * Findet den aktiven (running/paused) Run für einen Case oder gibt null
 * zurück. Es kann höchstens einen geben (Unique-Index aus Migration 038).
 */
export async function getActiveRun(caseId: string): Promise<PipelineRunRow | null> {
	const row = await queryOne<PipelineRunRow>(
		`SELECT * FROM pipeline_runs
		 WHERE case_id = $1 AND status IN ('running', 'paused')
		 LIMIT 1`,
		[caseId]
	);
	return row;
}

/**
 * Findet den jüngsten Run für einen Case (egal welcher Status). Für die
 * UI-Status-Anzeige nach Reload.
 */
export async function getLatestRun(caseId: string): Promise<PipelineRunRow | null> {
	const row = await queryOne<PipelineRunRow>(
		`SELECT * FROM pipeline_runs
		 WHERE case_id = $1
		 ORDER BY started_at DESC
		 LIMIT 1`,
		[caseId]
	);
	return row;
}

export async function getRun(runId: string): Promise<PipelineRunRow | null> {
	return queryOne<PipelineRunRow>(`SELECT * FROM pipeline_runs WHERE id = $1`, [runId]);
}

/**
 * Erzeugt einen neuen Run oder reaktiviert einen pausierten/laufenden Run für
 * den gegebenen Case. Wenn ein active Run existiert, wird dieser auf
 * status='running' + cancel_requested=false gesetzt und zurückgegeben (Resume).
 *
 * Ein hängengebliebener 'running'-Run wird ebenso reaktiviert, damit ein
 * Reload nach Server-Restart nicht in einem unentwirrbaren Zustand endet.
 */
export async function startOrResumeRun(
	caseId: string,
	userId: string,
	options: RunOptions
): Promise<{ run: PipelineRunRow; resumed: boolean }> {
	const existing = await getActiveRun(caseId);
	if (existing) {
		const updated = await queryOne<PipelineRunRow>(
			`UPDATE pipeline_runs
			 SET status = 'running',
			     cancel_requested = false,
			     resumed_at = now(),
			     paused_at = NULL,
			     last_event_at = now(),
			     options = $2
			 WHERE id = $1
			 RETURNING *`,
			[existing.id, mergeOptions(existing.options, options)]
		);
		return { run: updated!, resumed: true };
	}

	const caseRow = await queryOne<{ central_document_id: string | null }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow) throw new Error(`Case not found: ${caseId}`);
	if (!caseRow.central_document_id) {
		throw new Error(`Case ${caseId} has no central document — cannot run pipeline`);
	}

	const created = await queryOne<PipelineRunRow>(
		`INSERT INTO pipeline_runs
		   (case_id, document_id, started_by_user_id, status, options)
		 VALUES ($1, $2, $3, 'running', $4)
		 RETURNING *`,
		[caseId, caseRow.central_document_id, userId, options]
	);
	return { run: created!, resumed: false };
}

function mergeOptions(prev: RunOptions, next: RunOptions): RunOptions {
	return {
		heuristic: next.heuristic ?? prev.heuristic ?? 'h1',
		include_validity: next.include_validity ?? prev.include_validity ?? false,
		cost_cap_usd: next.cost_cap_usd ?? prev.cost_cap_usd ?? null,
	};
}

export async function requestCancel(runId: string): Promise<void> {
	await query(
		`UPDATE pipeline_runs
		 SET cancel_requested = true, last_event_at = now()
		 WHERE id = $1 AND status IN ('running', 'paused')`,
		[runId]
	);
}

async function markPaused(runId: string, reason?: string): Promise<void> {
	// reason wird nur überschrieben, wenn explizit übergeben — sonst bleibt
	// das error_message-Feld erhalten (z.B. die persistierten atom_errors aus
	// dem fail-tolerant Mode, die der User nach Reload sehen will).
	if (reason !== undefined) {
		await query(
			`UPDATE pipeline_runs
			 SET status = 'paused', paused_at = now(), last_event_at = now(), error_message = $2
			 WHERE id = $1`,
			[runId, reason]
		);
	} else {
		await query(
			`UPDATE pipeline_runs
			 SET status = 'paused', paused_at = now(), last_event_at = now()
			 WHERE id = $1`,
			[runId]
		);
	}
}

async function markCompleted(runId: string): Promise<void> {
	await query(
		`UPDATE pipeline_runs
		 SET status = 'completed',
		     completed_at = now(),
		     last_event_at = now(),
		     current_phase = NULL,
		     current_index = 0,
		     total_in_phase = NULL,
		     last_step_label = NULL
		 WHERE id = $1`,
		[runId]
	);
}

async function markFailed(runId: string, message: string): Promise<void> {
	await query(
		`UPDATE pipeline_runs
		 SET status = 'failed',
		     completed_at = now(),
		     last_event_at = now(),
		     error_message = $2
		 WHERE id = $1`,
		[runId, message.slice(0, 500)]
	);
}

async function updateProgress(
	runId: string,
	phase: Phase,
	index: number,
	total: number,
	label: string,
	tokenDelta: { input: number; output: number; cacheRead: number }
): Promise<void> {
	await query(
		`UPDATE pipeline_runs
		 SET current_phase = $2,
		     current_index = $3,
		     total_in_phase = $4,
		     last_step_label = $5,
		     last_event_at = now(),
		     accumulated_input_tokens = accumulated_input_tokens + $6,
		     accumulated_output_tokens = accumulated_output_tokens + $7,
		     accumulated_cache_read_tokens = accumulated_cache_read_tokens + $8
		 WHERE id = $1`,
		[runId, phase, index, total, label, tokenDelta.input, tokenDelta.output, tokenDelta.cacheRead]
	);
}

// ── Atom-Listing pro Phase ────────────────────────────────────────────────

interface AtomList {
	all: AtomRef[];
	pending: AtomRef[];
}

async function listParagraphAtoms(documentId: string): Promise<AtomRef[]> {
	const rows = (await query<{ id: string; index: number }>(
		`SELECT id, ROW_NUMBER() OVER (ORDER BY char_start)::int AS index
		 FROM document_elements
		 WHERE document_id = $1
		   AND element_type = 'paragraph'
		   AND section_kind = 'main'
		 ORDER BY char_start`,
		[documentId]
	)).rows;
	return rows.map((r) => ({ id: r.id, label: `Absatz ${r.index}` }));
}

async function listAtomsForPhase(phase: Phase, documentId: string): Promise<AtomList> {
	switch (phase) {
		case 'argumentation_graph': {
			// done-Bedingung muss mit der Skip-Bedingung in
			// runArgumentationGraphPass kongruent sein, sonst Endlosschleife:
			// der Pass skip'd wenn EITHER argument_nodes OR scaffolding_elements
			// für den Absatz existieren (siehe argumentation-graph.ts:842).
			// Ein Absatz mit ausschließlich scaffolding_elements (rein
			// stützendes Material, keine eigenen Argumente — z.B. ¶7 im
			// BA-Test mit 0 args + 1 scaffolding) gilt als done.
			const all = await listParagraphAtoms(documentId);
			const done = new Set(
				(await query<{ pid: string }>(
					`SELECT de.id AS pid
					 FROM document_elements de
					 WHERE de.document_id = $1
					   AND de.element_type = 'paragraph'
					   AND de.section_kind = 'main'
					   AND (EXISTS (SELECT 1 FROM argument_nodes an
					                 WHERE an.paragraph_element_id = de.id)
					        OR EXISTS (SELECT 1 FROM scaffolding_elements s
					                    WHERE s.paragraph_element_id = de.id))`,
					[documentId]
				)).rows.map((r) => r.pid)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'paragraph_synthetic': {
			const all = await listParagraphAtoms(documentId);
			const done = new Set(
				(await query<{ pid: string }>(
					`SELECT DISTINCT mc.scope_element_id AS pid
					 FROM memo_content mc
					 JOIN document_elements de ON de.id = mc.scope_element_id
					 WHERE mc.scope_level = 'paragraph'
					   AND mc.memo_type = 'interpretierend'
					   AND de.document_id = $1`,
					[documentId]
				)).rows.map((r) => r.pid)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'argument_validity': {
			// Atoms = Paragraphen MIT mindestens einem Argument. Reine
			// scaffolding-¶ haben nichts zu beurteilen → fallen aus dem all-Set.
			const allRows = (await query<{ pid: string; total: number; assessed: number }>(
				`SELECT de.id AS pid,
				        COUNT(an.id)::int AS total,
				        COUNT(an.validity_assessment)::int AS assessed
				 FROM document_elements de
				 JOIN argument_nodes an ON an.paragraph_element_id = de.id
				 WHERE de.document_id = $1
				   AND de.element_type = 'paragraph'
				   AND de.section_kind = 'main'
				 GROUP BY de.id, de.char_start
				 ORDER BY de.char_start`,
				[documentId]
			)).rows;
			const all: AtomRef[] = allRows.map((r, i) => ({
				id: r.pid,
				label: `Validität ¶${i + 1} (${r.total} Arg)`,
			}));
			const pending = all.filter((a, i) => allRows[i].assessed < allRows[i].total);
			return { all, pending };
		}
		case 'section_collapse': {
			const subchapters = await listSubchapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'subchapter'
					   AND n.inscription LIKE '[kontextualisierend/subchapter/graph]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return {
				all: subchapters,
				pending: subchapters.filter((s) => !done.has(s.id)),
			};
		}
		case 'chapter_collapse': {
			const all = await listChapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'chapter'
					   AND n.inscription LIKE '[kontextualisierend/chapter/graph]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'document_collapse': {
			const all: AtomRef[] = [{ id: documentId, label: 'Werk-Synthese' }];
			const done = await queryOne<{ id: string }>(
				`SELECT n.id
				 FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
				 JOIN memo_content mc ON mc.naming_id = n.id
				 WHERE n.inscription LIKE '[kontextualisierend/work/graph]%'
				   AND mc.scope_level = 'work'
				   AND a.properties->>'document_id' = $1
				   AND n.deleted_at IS NULL
				 LIMIT 1`,
				[documentId]
			);
			return { all, pending: done ? [] : all };
		}
		// H3-Phasen werden NICHT durch die Atom-Schleife geführt — sie sind
		// werk-aggregierte Tool-Aufrufe (kein Iterations-Atom). Der Orchestrator
		// ruft sie direkt über runWerkPhaseStep auf. Wenn diese Funktion mit
		// einer H3-Phase aufgerufen wird, ist das ein Programmierfehler im
		// Aufrufer.
		case 'h3_exposition':
		case 'h3_grundlagentheorie':
		case 'h3_forschungsdesign':
		case 'h3_durchfuehrung':
		case 'h3_synthese':
		case 'h3_schlussreflexion':
		case 'h3_exkurs':
		case 'h3_werk_deskription':
		case 'h3_werk_gutacht':
			throw new Error(
				`listAtomsForPhase: H3-Phase ${phase} darf nicht durch die Atom-Schleife laufen.`
			);
	}
}

/**
 * Bestimmt für jedes L1-Hauptkapitel die adaptive Subkapitel-Aggregations-
 * ebene (gemäß heading-hierarchy.chooseSubchapterLevel) und gibt die Liste
 * der Heading-Atome zurück, die als Section-Collapse-Inputs gelten. Bei
 * Aggregations-Level 1 ist das Hauptkapitel selbst die Synthese-Einheit
 * (das wird vom Chapter-Collapse-Pass mit-erledigt; wir generieren in dem
 * Fall keinen Section-Collapse-Atom — das Hauptkapitel landet stattdessen
 * direkt in der chapter-Phase).
 */
async function listSubchapterAtoms(documentId: string): Promise<AtomRef[]> {
	const chapters = await loadChapterUnits(documentId);
	const allParagraphs = (await query<{ id: string; charStart: number }>(
		`SELECT id, char_start AS "charStart" FROM document_elements
		 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
		 ORDER BY char_start`,
		[documentId]
	)).rows;

	const atoms: AtomRef[] = [];
	for (const chapter of chapters) {
		let level = await getPersistedSubchapterLevel(chapter.l1.headingId);
		if (level === null) {
			level = chooseSubchapterLevel(chapter, allParagraphs);
			await persistSubchapterLevel(chapter.l1.headingId, documentId, level as 1 | 2 | 3);
		}
		if (level === 1) continue; // Hauptkapitel = Synthese-Einheit; Section-Collapse entfällt
		const sections = chapter.innerHeadings.filter((h) => h.level === level);
		for (const s of sections) {
			atoms.push({
				id: s.headingId,
				label: `${s.numbering ?? ''} ${s.text}`.trim().slice(0, 80),
				headingId: s.headingId,
			});
		}
	}
	return atoms;
}

async function listChapterAtoms(documentId: string): Promise<AtomRef[]> {
	const outline = await loadResolvedOutline(documentId);
	return outline
		.filter((h) => h.level === 1)
		.map((h) => ({
			id: h.headingId,
			label: `${h.numbering ?? ''} ${h.text}`.trim().slice(0, 80),
			headingId: h.headingId,
		}));
}

// ── Step-Execution ────────────────────────────────────────────────────────

async function executeStep(
	phase: Phase,
	atom: AtomRef,
	caseId: string,
	userId: string
): Promise<StepResult> {
	switch (phase) {
		case 'argumentation_graph': {
			const r = await runArgumentationGraphPass(caseId, atom.id);
			return {
				skipped: r.skipped,
				tokens: {
					input: r.tokens?.input ?? 0,
					output: r.tokens?.output ?? 0,
					cacheRead: r.tokens?.cacheRead ?? 0,
				},
			};
		}
		case 'argument_validity': {
			const r = await runArgumentValidityPass(caseId, atom.id);
			return {
				skipped: r.skipped,
				tokens: {
					input: r.tokens?.input ?? 0,
					output: r.tokens?.output ?? 0,
					cacheRead: r.tokens?.cacheRead ?? 0,
				},
			};
		}
		case 'paragraph_synthetic': {
			const r = await runParagraphPass(caseId, atom.id, userId);
			return {
				skipped: false,
				tokens: {
					input: r.tokens.input,
					output: r.tokens.output,
					cacheRead: r.tokens.cacheRead,
				},
			};
		}
		case 'section_collapse': {
			const r = await runGraphCollapse(caseId, atom.id, userId);
			return {
				skipped: r.skipped,
				tokens: {
					input: r.tokens?.input ?? 0,
					output: r.tokens?.output ?? 0,
					cacheRead: r.tokens?.cacheRead ?? 0,
				},
				memoId: r.stored?.memoId ?? r.existingMemoId,
			};
		}
		case 'chapter_collapse': {
			const r = await runChapterCollapse(caseId, atom.id, userId);
			return {
				skipped: r.skipped,
				tokens: {
					input: r.tokens?.input ?? 0,
					output: r.tokens?.output ?? 0,
					cacheRead: r.tokens?.cacheRead ?? 0,
				},
				memoId: r.stored?.memoId ?? r.existingMemoId,
			};
		}
		case 'document_collapse': {
			const r = await runDocumentCollapse(caseId, userId);
			return {
				skipped: r.skipped,
				tokens: {
					input: r.tokens?.input ?? 0,
					output: r.tokens?.output ?? 0,
					cacheRead: r.tokens?.cacheRead ?? 0,
				},
				memoId: r.stored?.memoId ?? r.existingMemoId,
			};
		}
		// H3-Phasen werden NICHT durch executeStep geführt — sie sind werk-
		// aggregierte Tool-Aufrufe und laufen direkt über runWerkPhaseStep,
		// nicht durch die Atom-Schleife. Wenn executeStep mit einer H3-Phase
		// aufgerufen wird, ist das ein Programmierfehler im Aufrufer.
		case 'h3_exposition':
		case 'h3_grundlagentheorie':
		case 'h3_forschungsdesign':
		case 'h3_durchfuehrung':
		case 'h3_synthese':
		case 'h3_schlussreflexion':
		case 'h3_exkurs':
		case 'h3_werk_deskription':
		case 'h3_werk_gutacht':
			throw new Error(
				`executeStep: H3-Phase ${phase} darf nicht durch die Atom-Schleife laufen.`
			);
	}
}

// ── Loop ──────────────────────────────────────────────────────────────────

function phasesForRun(options: RunOptions): Phase[] {
	// Heuristik-Pfade sind exklusiv pro Run (Memory
	// `project_three_heuristics_architecture.md`): genau einer von H1, H2,
	// H3 läuft je Run-Trigger. Default 'h1'. Wer mehrere Pfade auf dem-
	// selben Werk anwenden will, triggert sequenziell mehrere Runs —
	// automatische Verkettung gibt es nicht.
	const heuristic = options.heuristic ?? 'h1';

	switch (heuristic) {
		case 'h3':
			return [...H3_PHASE_ORDER];
		case 'h2':
			return ['paragraph_synthetic'];
		case 'h1': {
			const phases: Phase[] = [...PHASE_ORDER_ANALYTICAL];
			if (options.include_validity) {
				// argument_validity NACH argumentation_graph (braucht die
				// Argumente), VOR section_collapse (Synthese kann bewertete
				// Argumente nutzen).
				const agIdx = phases.indexOf('argumentation_graph');
				phases.splice(agIdx + 1, 0, 'argument_validity');
			}
			return phases;
		}
	}
}

/**
 * Hauptloop: arbeitet die konfigurierte Phasen-Reihenfolge sequentiell ab.
 *
 * Zwei Phasen-Modelle:
 *   - Iterations-Phasen (H1/H2): pro Atom (¶ / Subkapitel / Kapitel) ein
 *     Tool-Aufruf. Fail-tolerant pro Atom + Stuck-Guard gegen Endlos-Loops
 *     bei list-done/pass-skip-Inkongruenz. Implementiert in runIterativePhase.
 *   - Werk-Phasen (H3): ein Tool-Aufruf pro Phase auf das ganze Werk. Kein
 *     Atom-Wrapper, kein Stuck-Guard (Tool muss intrinsisch failsafe sein:
 *     Idempotenz, klare Vorbedingungen, klarer Empty-Path). Implementiert in
 *     runWerkPhaseStep.
 *
 * Idempotenz auf Pass-Ebene macht Resume trivial: ein erneut aufgerufener
 * Run iteriert dieselben Phasen, der jeweilige Done-Check filtert die schon
 * erledigten Einheiten heraus.
 *
 * sendEvent wird sofort beim Auftreten gerufen — ist verantwortlich für
 * SSE-flush oder Logging. Fehler in sendEvent (z.B. Stream-Disconnect)
 * werden ignoriert; der Loop läuft weiter, weil State in DB liegt und
 * der nächste Reconnect den letzten Stand sieht.
 */
export async function runPipelineLoop(
	runId: string,
	caseId: string,
	userId: string,
	options: RunOptions,
	sendEvent: (e: PipelineEvent) => void
): Promise<void> {
	const phases = phasesForRun(options);

	// Fail-tolerant Mode (nur für Iterations-Phasen): einzelne Atom-Fehler
	// stoppen den Run nicht. Werk-Phasen kennen kein fail-tolerant, weil ein
	// Werk-Phase-Fehler systemisch ist (Tool-Defekt) und nicht auf einzelne
	// Atome lokalisierbar ist. Persistierung erfolgt via `error_message` als
	// JSON-Liste der letzten 20 Atome, damit der User nach Page-Reload die
	// Fehler immer noch sieht.
	const erroredAtomIds = new Set<string>();
	const erroredHistory: { phase: Phase; label: string; message: string }[] = [];

	const recordAtomError = async (phase: Phase, atom: AtomRef, message: string) => {
		erroredAtomIds.add(atom.id);
		erroredHistory.push({ phase, label: atom.label, message: message.slice(0, 300) });
		const tail = erroredHistory.slice(-20);
		await query(
			`UPDATE pipeline_runs
			 SET error_message = $2, last_event_at = now()
			 WHERE id = $1`,
			[runId, JSON.stringify({ atom_errors: tail })]
		);
	};

	const initialRun = await getRun(runId);
	if (!initialRun) {
		safeSend(sendEvent, { type: 'failed', message: 'run vanished from DB' });
		return;
	}
	const documentId = initialRun.document_id;

	for (const phase of phases) {
		// Cancel-Check vor jeder Phase. Innerhalb der Phase wird er von
		// runIterativePhase / runWerkPhaseStep selbst nochmal geprüft.
		const run = await getRun(runId);
		if (!run) {
			safeSend(sendEvent, { type: 'failed', message: 'run vanished from DB' });
			return;
		}
		if (run.cancel_requested) {
			await markPaused(runId);
			safeSend(sendEvent, { type: 'paused' });
			return;
		}

		const ok = isWerkPhase(phase)
			? await runWerkPhaseStep(runId, phase, caseId, documentId, sendEvent)
			: await runIterativePhase(
					runId,
					phase,
					caseId,
					documentId,
					userId,
					sendEvent,
					erroredAtomIds,
					recordAtomError
				);
		if (!ok) return; // markFailed/markPaused wurde drinnen schon gesendet
	}

	// Letzte Statusnotiz: completed mit ggf. errored-Count.
	if (erroredHistory.length > 0) {
		const tail = erroredHistory.slice(-20);
		await query(
			`UPDATE pipeline_runs
			 SET error_message = $2
			 WHERE id = $1`,
			[runId, JSON.stringify({ atom_errors: tail, completed_with_errors: true })]
		);
	}
	await markCompleted(runId);
	safeSend(sendEvent, { type: 'completed' });
}

/**
 * Eine Iterations-Phase: Atom für Atom abarbeiten, fail-tolerant pro Atom,
 * Stuck-Guard gegen Endlos-Loops. Stuck-Guard ist hier sinnvoll, weil
 * listAtomsForPhase dynamisch die pending-Liste neu berechnet — eine
 * Inkongruenz zwischen list-done und Pass-Skip-Bedingung würde sonst zum
 * Token-Verbrennen führen.
 *
 * Returnt true bei sauber abgeschlossener Phase, false wenn der Run
 * abgebrochen wurde (markFailed/markPaused bereits aufgerufen, Event
 * versendet).
 */
async function runIterativePhase(
	runId: string,
	phase: Phase,
	caseId: string,
	documentId: string,
	userId: string,
	sendEvent: (e: PipelineEvent) => void,
	erroredAtomIds: Set<string>,
	recordAtomError: (phase: Phase, atom: AtomRef, message: string) => Promise<void>
): Promise<boolean> {
	let lastProcessedAtomId: string | null = null;
	let sameAtomRepeatCount = 0;
	let phaseStartAnnounced = false;

	while (true) {
		const run = await getRun(runId);
		if (!run) {
			safeSend(sendEvent, { type: 'failed', message: 'run vanished from DB' });
			return false;
		}
		if (run.cancel_requested) {
			await markPaused(runId);
			safeSend(sendEvent, { type: 'paused' });
			return false;
		}

		const list = await listAtomsForPhase(phase, documentId);
		const realPending = list.pending.filter((a) => !erroredAtomIds.has(a.id));
		if (realPending.length === 0) return true; // Phase fertig

		if (!phaseStartAnnounced) {
			safeSend(sendEvent, { type: 'phase-start', phase, total: list.all.length });
			phaseStartAnnounced = true;
		}

		const atom = realPending[0];
		const totalDone = list.all.length - list.pending.length;

		safeSend(sendEvent, {
			type: 'step-start',
			phase,
			atom,
			index: totalDone,
			total: list.all.length,
		});

		try {
			// Stuck-Guard: derselbe Atom 3× hintereinander als pending → Loop-
			// Bug zwischen list-done und Pass-Skip. Phase-lokal, weil
			// runIterativePhase pro Phase aufgerufen wird.
			if (atom.id === lastProcessedAtomId) {
				sameAtomRepeatCount += 1;
				if (sameAtomRepeatCount >= 3) {
					const message =
						`Stuck on ${phase}/${atom.label}: ` +
						`pass returned successfully 3× but listAtomsForPhase still marks it pending. ` +
						`Either the pass is skip-on-existing without persisting, or it persists nothing ` +
						`(e.g. AG-Pass output where all scaffolding anchors are unresolvable). ` +
						`Run halted to prevent token-burn; inspect this paragraph manually.`;
					safeSend(sendEvent, { type: 'step-error', phase, atom, message });
					await markFailed(runId, message);
					safeSend(sendEvent, { type: 'failed', message });
					return false;
				}
			} else {
				lastProcessedAtomId = atom.id;
				sameAtomRepeatCount = 1;
			}

			const stepResult = await executeStep(phase, atom, caseId, userId);
			await updateProgress(
				runId,
				phase,
				totalDone + 1,
				list.all.length,
				atom.label,
				stepResult.tokens
			);
			const updated = await getRun(runId);
			safeSend(sendEvent, {
				type: 'step-done',
				phase,
				atom,
				index: totalDone + 1,
				total: list.all.length,
				skipped: stepResult.skipped,
				tokens: stepResult.tokens,
				cumulative: {
					input: updated?.accumulated_input_tokens ?? 0,
					output: updated?.accumulated_output_tokens ?? 0,
					cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			safeSend(sendEvent, { type: 'step-error', phase, atom, message });
			if (err instanceof PreconditionFailedError) {
				await markFailed(runId, message);
				safeSend(sendEvent, { type: 'failed', message });
				return false;
			}
			// Fail-tolerant: Atom merken, weiter mit nächstem.
			await recordAtomError(phase, atom, message);
			lastProcessedAtomId = null;
			sameAtomRepeatCount = 0;
		}
	}
}

/**
 * Eine Werk-Phase (H3): direkter Tool-Aufruf auf das ganze Werk, kein
 * Atom-Wrapper, kein Stuck-Guard. Voraussetzung ist, dass das Tool selbst
 * intrinsisch failsafe ist:
 *   - Idempotenz: Re-Run produziert keinen Duplikat-Stand (clearExisting).
 *   - Klare Vorbedingungen: PreconditionFailedError für inhaltliche
 *     Vorbedingungs-Verletzungen, generic Error nur für interne Bugs.
 *   - Klarer Empty-Path: kein Material → { skipped: true }, kein Fehler.
 *
 * Returnt true bei sauber abgeschlossener Phase, false wenn der Run
 * abgebrochen wurde.
 */
async function runWerkPhaseStep(
	runId: string,
	phase: H3Phase,
	caseId: string,
	documentId: string,
	sendEvent: (e: PipelineEvent) => void
): Promise<boolean> {
	const run = await getRun(runId);
	if (!run) {
		safeSend(sendEvent, { type: 'failed', message: 'run vanished from DB' });
		return false;
	}
	if (run.cancel_requested) {
		await markPaused(runId);
		safeSend(sendEvent, { type: 'paused' });
		return false;
	}

	const atom: AtomRef = { id: documentId, label: PHASE_LABEL[phase] };

	safeSend(sendEvent, { type: 'phase-start', phase, total: 1 });
	safeSend(sendEvent, { type: 'step-start', phase, atom, index: 0, total: 1 });

	// Done-Check: Phase schon abgeschlossen → skippen (Idempotenz auf
	// Pass-Ebene; Resume eines Runs läuft hier durch).
	const isDone = await isH3PhaseDoneForDocument(phase, documentId);
	if (isDone) {
		await updateProgress(runId, phase, 1, 1, atom.label, {
			input: 0,
			output: 0,
			cacheRead: 0,
		});
		const updated = await getRun(runId);
		safeSend(sendEvent, {
			type: 'step-done',
			phase,
			atom,
			index: 1,
			total: 1,
			skipped: true,
			tokens: { input: 0, output: 0, cacheRead: 0 },
			cumulative: {
				input: updated?.accumulated_input_tokens ?? 0,
				output: updated?.accumulated_output_tokens ?? 0,
				cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
			},
		});
		return true;
	}

	try {
		const r = await runH3Phase(phase, caseId, documentId);
		await updateProgress(runId, phase, 1, 1, atom.label, r.tokens);
		const updated = await getRun(runId);
		safeSend(sendEvent, {
			type: 'step-done',
			phase,
			atom,
			index: 1,
			total: 1,
			skipped: r.skipped,
			tokens: r.tokens,
			cumulative: {
				input: updated?.accumulated_input_tokens ?? 0,
				output: updated?.accumulated_output_tokens ?? 0,
				cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
			},
		});
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		safeSend(sendEvent, { type: 'step-error', phase, atom, message });
		// Werk-Phase: kein fail-tolerant. Jeder Fehler heißt entweder
		// Vorbedingungs-Verletzung (Reviewer-Eingriff nötig) oder Tool-Defekt
		// (Code-Fix nötig) — beides braucht markFailed, damit das Problem
		// nicht stillschweigend hinter weiteren Phasen verschwindet.
		await markFailed(runId, message);
		safeSend(sendEvent, { type: 'failed', message });
		return false;
	}
}

function safeSend(sendEvent: (e: PipelineEvent) => void, e: PipelineEvent) {
	try {
		sendEvent(e);
	} catch {
		// Stream may be closed (client disconnected); state lives in DB,
		// loop continues and the next connect will see the latest state.
	}
}

// ── Pre-flight Status (für UI-Anzeige) ───────────────────────────────────

export interface PhasePreflightStatus {
	phase: Phase;
	total: number;
	done: number;
	pending: number;
}

/**
 * Berechnet pro Phase den aktuellen Pending-/Done-Stand. Wird vor dem Run
 * gerufen, um dem User eine Vorschau ("3 ¶ AG fehlen, 0 Section-Collapses,
 * …") zu geben. Im Gegensatz zu listAtomsForPhase werden hier keine
 * Atom-Refs zurückgegeben (nur Counts), damit das günstig/schnell ist.
 */
export async function computePreflight(
	documentId: string,
	options: { heuristic: 'h1' | 'h2' | 'h3'; includeValidity: boolean }
): Promise<PhasePreflightStatus[]> {
	const phases = phasesForRun({
		heuristic: options.heuristic,
		include_validity: options.includeValidity,
	});
	const result: PhasePreflightStatus[] = [];
	for (const phase of phases) {
		if (isWerkPhase(phase)) {
			// Werk-Phase: 1 Tool-Aufruf pro Phase auf das ganze Werk. Done iff
			// das primäre Output-Konstrukt persistiert ist.
			const isDone = await isH3PhaseDoneForDocument(phase, documentId);
			result.push({
				phase,
				total: 1,
				done: isDone ? 1 : 0,
				pending: isDone ? 0 : 1,
			});
		} else {
			const list = await listAtomsForPhase(phase, documentId);
			result.push({
				phase,
				total: list.all.length,
				done: list.all.length - list.pending.length,
				pending: list.pending.length,
			});
		}
	}
	return result;
}
