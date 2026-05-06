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
// H2 — synthetisch-hermeneutisch (kumulativ-sequenziell statt graph-extraktiv):
//   Forward-interleaved Walk pro Hauptkapitel: alle Absätze EINES Subkapitels
//   werden synthetisiert, dann das Subkapitel kollabiert, BEVOR die Absätze
//   des nächsten Subkapitels laufen. Erst nach allen Subkapiteln eines
//   Hauptkapitels läuft chapter_collapse_synthetic; document_collapse zum
//   Schluss. Nur dadurch ist die in per-paragraph.ts:loadParagraphContext
//   geladene Schicht "abgeschlossene Subkapitel davor" tatsächlich populated
//   — bei strikt linearer Phasenordnung wäre sie dormant, weil alle
//   paragraph_synthetic abgeschlossen wären, bevor irgendein
//   section_collapse_synthetic läuft.
//
//   Phasen (für Idempotenz-Tags + Preflight-Counts unverändert):
//     1. paragraph_synthetic            — formulierend + reflektierend pro Absatz,
//        mit voll geladenem Vorlauf-Kontext (Outline + abgeschlossene Subkapitel-
//        Synthesen + reflective chain im aktuellen Subkapitel — siehe
//        per-paragraph.ts:14-17 zum architektonischen Sinn der chain).
//     2. section_collapse_synthetic     — Subkapitel-Synthese aus reflective chain
//     3. chapter_collapse_synthetic     — Hauptkapitel-Synthese aus Subkap-Memos
//     4. document_collapse_synthetic    — Werk-Synthese aus Kapitel-Memos
//   Idempotenz-Tags: [kontextualisierend/{subchapter|chapter|work}/synthetic]
//   (kollisionsfrei zu H1's [.../graph]-Tags).
//   Implementierung: runH2Hierarchical (statt runIterativePhase pro Phase).
//
// H3 — kontextadaptiv (funktionstyp-orchestriert):
//   1. h3_walk              — linearer direktionaler Walk über Absatz-
//                             Komplexe in Dokument-Reihenfolge. Werk-
//                             Aggregationen (FG, FORSCHUNGSDESIGN,
//                             SYNTHESE, SR, WERK_*) sind virtuelle
//                             Walk-Knoten an logischen Übergängen
//                             (User-Setzung 2026-05-04, Memory
//                             feedback_no_phase_layer_orchestrator).
//                             Implementation: ./h3-walk-driver.ts.

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
import { runSectionCollapseSynthetic } from '../ai/hermeneutic/section-collapse-synthetic.js';
import { runChapterCollapseSynthetic } from '../ai/hermeneutic/chapter-collapse-synthetic.js';
import { runDocumentCollapseSynthetic } from '../ai/hermeneutic/document-collapse-synthetic.js';
import { runChapterCollapseRetrograde } from '../ai/hermeneutic/chapter-collapse-retrograde.js';
import { runSectionCollapseRetrograde } from '../ai/hermeneutic/section-collapse-retrograde.js';
import { runParagraphRetrograde } from '../ai/hermeneutic/paragraph-retrograde.js';
import { runMetaSynthesis } from '../ai/hermeneutic/meta-synthesis.js';
import {
	listH3WalkSteps,
	walkStepId,
	walkStepLabel,
	isH3WalkStepDone,
	runH3WalkStep,
	type H3WalkStep,
} from './h3-walk-driver.js';
import { PreconditionFailedError } from '../ai/h3/precondition.js';
import { resolveTier } from '../ai/model-tiers.js';
import { isFatalProviderError, testConnection } from '../ai/client.js';

export type Phase =
	| 'argumentation_graph'
	| 'argument_validity'
	| 'section_collapse'
	| 'chapter_collapse'
	| 'document_collapse'
	| 'paragraph_synthetic'
	// H2-Aggregations-Linie (synthetisch). Idempotenz-Tags
	// [kontextualisierend/{subchapter|chapter|work}/synthetic] —
	// kollisionsfrei zu H1's /graph-Tags.
	| 'section_collapse_synthetic'
	| 'chapter_collapse_synthetic'
	| 'document_collapse_synthetic'
	// H2-Retrograde-Pass (FFN-Backprop-style; opt-in via
	// RunOptions.retrograde_pass). Verfeinert die Forward-Memos durch
	// downstream-Kontext: W absorbiert in Chapter-Retro, Chapter-Retro
	// absorbiert in Subchapter-Retro, Subchapter-Retro absorbiert in
	// Paragraph-Retro. Idempotenz-Tags
	// `[kontextualisierend/{chapter|subchapter}/synthetic-retrograde]` und
	// `[reflektierend-retrograde]` — bracket-position macht sie
	// kollisionsfrei zu den Forward-`/synthetic]` und `[reflektierend]`-
	// LIKE-Patterns.
	| 'chapter_collapse_retrograde'
	| 'section_collapse_retrograde'
	| 'paragraph_retrograde'
	// H3 — linearer Walk über Absatz-Komplexe + Werk-Aggregationen
	// (User-Setzung 2026-05-04: kein Phase-Layer, ein Walk pro H3-Run).
	// Atom-Liste pro Walk siehe h3-walk-driver.ts:listH3WalkSteps.
	| 'h3_walk'
	// Meta-Synthese (heuristic='meta'): terminales Glied im Composite-Run
	// H1 → H2 → meta_synthesis. Konsumiert die Werk-Synthesen beider
	// Linien und produziert Review-Synthese (Teil A) plus drei Literatur-
	// bezugs-Anker (Teil B). Idempotenz-Tag [kontextualisierend/work/meta].
	// Siehe docs/architecture/04-pipeline-h1-h2.md §7.
	| 'meta_synthesis';

// Hauptlinie ohne argument_validity — diese Phase ist opt-in und wird per
// phasesForRun() bei aktivem RunOptions.include_validity zwischen
// argumentation_graph und section_collapse eingefügt.
export const PHASE_ORDER_ANALYTICAL: Phase[] = [
	'argumentation_graph',
	'section_collapse',
	'chapter_collapse',
	'document_collapse',
];

// H2-Synthese-Linie (kumulativ-sequenziell). paragraph_synthetic produziert
// die reflective chain pro Absatz; die drei collapse-synthetic-Phasen
// aggregieren bewegungs-orientiert von Subkapitel → Kapitel → Werk.
export const PHASE_ORDER_SYNTHETIC: Phase[] = [
	'paragraph_synthetic',
	'section_collapse_synthetic',
	'chapter_collapse_synthetic',
	'document_collapse_synthetic',
];

// H2-Retrograde-Tail (opt-in; FFN-Backprop-style). Top-down: W → Chapter-Retro
// → Subchapter-Retro → Paragraph-Retro. Wird nur angehängt, wenn
// RunOptions.retrograde_pass=true gesetzt ist.
export const PHASE_ORDER_RETROGRADE: Phase[] = [
	'chapter_collapse_retrograde',
	'section_collapse_retrograde',
	'paragraph_retrograde',
];

export const PHASE_LABEL: Record<Phase, string> = {
	argumentation_graph: 'Argumentation pro Absatz',
	argument_validity: 'Argument-Validität (Charity-Pass)',
	section_collapse: 'Subkapitel-Synthesen',
	chapter_collapse: 'Hauptkapitel-Synthesen',
	document_collapse: 'Werk-Synthese',
	paragraph_synthetic: 'Per-Absatz-Hermeneutik (synthetisch)',
	section_collapse_synthetic: 'Subkapitel-Synthesen (synthetisch)',
	chapter_collapse_synthetic: 'Hauptkapitel-Synthesen (synthetisch)',
	document_collapse_synthetic: 'Werk-Synthese (synthetisch)',
	chapter_collapse_retrograde: 'Hauptkapitel-Retrograde (W-absorbiert)',
	section_collapse_retrograde: 'Subkapitel-Retrograde (Hauptkap-absorbiert)',
	paragraph_retrograde: 'Per-Absatz-Retrograde (Subkap-absorbiert)',
	h3_walk: 'H3 · Walk (Absatz-Komplexe + Werk-Aggregationen)',
	meta_synthesis: 'Meta-Synthese (Review-Synthese H1+H2 + Literaturbezugs-Anker)',
};

export interface RunOptions {
	// Pfad-Wahl: H1, H2 und H3 sind drei eigenständige, exklusive Heuristik-
	// Pfade pro Run (Memory `project_three_heuristics_architecture.md`).
	// Default `'h1'`, wenn nicht gesetzt. Wer mehrere Pfade auf demselben
	// Werk anwenden will, triggert sequenziell mehrere Runs — automatische
	// Verkettung gibt es nicht.
	//
	// `'meta'` ist eine Composite-Heuristik (User-Setzung 2026-05-05): in
	// einem Run laufen H1-linear und H2-hierarchisch nacheinander, gefolgt
	// vom terminalen meta_synthesis-Glied. H1/H2/H3 bleiben als eigen-
	// ständige Heuristiken gleichrangig — `'meta'` ist eine Synthese
	// *über* H1+H2, keine vierte Heuristik. Siehe
	// docs/architecture/04-pipeline-h1-h2.md §7.
	heuristic?: 'h1' | 'h2' | 'h3' | 'meta';

	// H1-spezifischer Modifikator. Wird auch im 'meta'-Composite-Run für
	// die H1-Teilstrecke berücksichtigt; ignoriert bei heuristic ∈ {h2, h3}.
	include_validity?: boolean;

	// H2-spezifischer Modifikator (User-Setzung 2026-05-05): wenn true, hängt
	// der H2-Walk nach `document_collapse_synthetic` einen retrograden
	// Verfeinerungs-Pass an (FFN-Backprop-style: W → Chapter-Retro →
	// Subchapter-Retro → Paragraph-Retro). Default false — der Forward-
	// Pass ist für sich vollständig; Retrograde ist evaluativ-experimentell.
	// Auch im 'meta'-Composite-Run für die H2-Teilstrecke berücksichtigt;
	// ignoriert bei heuristic ∈ {h1, h3}.
	retrograde_pass?: boolean;

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
		retrograde_pass: next.retrograde_pass ?? prev.retrograde_pass ?? false,
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
			// Forward (`[reflektierend]`) und Retrograde (`[reflektierend-retrograde]`)
			// teilen denselben memo_type — ohne Inscription-Filter würde ein
			// reines Retrograde-Memo den Forward-Pass fälschlich als done
			// markieren. deleted_at IS NULL hält frische Re-Runs nach
			// Soft-Delete idempotent.
			const done = new Set(
				(await query<{ pid: string }>(
					`SELECT DISTINCT mc.scope_element_id AS pid
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 JOIN document_elements de ON de.id = mc.scope_element_id
					 WHERE mc.scope_level = 'paragraph'
					   AND mc.memo_type = 'reflektierend'
					   AND n.inscription LIKE '[reflektierend]%'
					   AND n.deleted_at IS NULL
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
		case 'section_collapse_synthetic': {
			const subchapters = await listSubchapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'subchapter'
					   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return {
				all: subchapters,
				pending: subchapters.filter((s) => !done.has(s.id)),
			};
		}
		case 'chapter_collapse_synthetic': {
			const all = await listChapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'chapter'
					   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'document_collapse_synthetic': {
			const all: AtomRef[] = [{ id: documentId, label: 'Werk-Synthese (synthetisch)' }];
			const done = await queryOne<{ id: string }>(
				`SELECT n.id
				 FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
				 JOIN memo_content mc ON mc.naming_id = n.id
				 WHERE n.inscription LIKE '[kontextualisierend/work/synthetic]%'
				   AND mc.scope_level = 'work'
				   AND a.properties->>'document_id' = $1
				   AND n.deleted_at IS NULL
				 LIMIT 1`,
				[documentId]
			);
			return { all, pending: done ? [] : all };
		}
		case 'chapter_collapse_retrograde': {
			const all = await listChapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'chapter'
					   AND n.inscription LIKE '[kontextualisierend/chapter/synthetic-retrograde]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'section_collapse_retrograde': {
			const subchapters = await listSubchapterAtoms(documentId);
			const done = new Set(
				(await query<{ heading_id: string }>(
					`SELECT mc.scope_element_id AS heading_id
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 WHERE mc.scope_level = 'subchapter'
					   AND n.inscription LIKE '[kontextualisierend/subchapter/synthetic-retrograde]%'
					   AND n.deleted_at IS NULL`,
					[]
				)).rows.map((r) => r.heading_id)
			);
			return {
				all: subchapters,
				pending: subchapters.filter((s) => !done.has(s.id)),
			};
		}
		case 'paragraph_retrograde': {
			const all = await listParagraphAtoms(documentId);
			const done = new Set(
				(await query<{ pid: string }>(
					`SELECT mc.scope_element_id AS pid
					 FROM memo_content mc
					 JOIN namings n ON n.id = mc.naming_id
					 JOIN document_elements de ON de.id = mc.scope_element_id
					 WHERE mc.scope_level = 'paragraph'
					   AND mc.memo_type = 'reflektierend'
					   AND n.inscription LIKE '[reflektierend-retrograde]%'
					   AND n.deleted_at IS NULL
					   AND de.document_id = $1`,
					[documentId]
				)).rows.map((r) => r.pid)
			);
			return { all, pending: all.filter((a) => !done.has(a.id)) };
		}
		case 'meta_synthesis': {
			// Ein Atom auf Werk-Ebene: meta-synthesis.ts liest beide Werk-
			// Synthesen (H1+H2) und produziert ein Werk-Memo plus
			// fact_check_anchors (siehe docs/architecture/04-pipeline-h1-h2.md §7).
			const all: AtomRef[] = [{ id: documentId, label: 'Meta-Synthese (Review)' }];
			const done = await queryOne<{ id: string }>(
				`SELECT n.id
				 FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
				 JOIN memo_content mc ON mc.naming_id = n.id
				 WHERE n.inscription LIKE '[kontextualisierend/work/meta]%'
				   AND mc.scope_level = 'work'
				   AND a.properties->>'document_id' = $1
				   AND n.deleted_at IS NULL
				 LIMIT 1`,
				[documentId]
			);
			return { all, pending: done ? [] : all };
		}
		// H3-Walk wird NICHT durch die generische Atom-Schleife geführt — er
		// hat einen eigenen Loop runH3Walk mit walk-step-spezifischer Done-/
		// Validation-Prüfung und fail-fast-Semantik. Wenn diese Funktion mit
		// 'h3_walk' aufgerufen wird, ist das ein Programmierfehler im Aufrufer.
		case 'h3_walk':
			throw new Error(
				`listAtomsForPhase: 'h3_walk' darf nicht durch die generische Atom-Schleife laufen.`
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
	// Tier-Routing pro Phase (siehe `model-tiers.ts`). Jedes Modell, das
	// hier in der Pipeline läuft, wird über die TIER_REGISTRY aufgelöst —
	// ohne Override fällt die Phase auf den TIER-Default zurück, mit
	// ai-settings.json `tiers`-Override fährt sie das User-Modell.
	switch (phase) {
		case 'argumentation_graph': {
			const r = await runArgumentationGraphPass(caseId, atom.id, {
				modelOverride: resolveTier('h1.tier1'),
			});
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
			const r = await runArgumentValidityPass(caseId, atom.id, {
				modelOverride: resolveTier('h1.tier1'),
			});
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
			const r = await runParagraphPass(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
			const r = await runGraphCollapse(caseId, atom.id, userId, {
				modelOverride: resolveTier('h1.tier2'),
			});
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
			const r = await runChapterCollapse(caseId, atom.id, userId, {
				modelOverride: resolveTier('h1.tier2'),
			});
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
			const r = await runDocumentCollapse(caseId, userId, {
				modelOverride: resolveTier('h1.tier2'),
			});
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
		case 'section_collapse_synthetic': {
			const r = await runSectionCollapseSynthetic(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'chapter_collapse_synthetic': {
			const r = await runChapterCollapseSynthetic(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'document_collapse_synthetic': {
			const r = await runDocumentCollapseSynthetic(caseId, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'chapter_collapse_retrograde': {
			const r = await runChapterCollapseRetrograde(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'section_collapse_retrograde': {
			const r = await runSectionCollapseRetrograde(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'paragraph_retrograde': {
			const r = await runParagraphRetrograde(caseId, atom.id, userId, {
				modelOverride: resolveTier('h2.tier1'),
			});
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
		case 'meta_synthesis': {
			const r = await runMetaSynthesis(caseId, userId, {
				modelOverride: resolveTier('h1.tier2'),
			});
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
		// H3-Walk hat einen eigenen Loop (runH3Walk) mit walk-step-spezifischer
		// Dispatch-Logik. Hier ist h3_walk unerreichbar (siehe runPipelineLoop
		// Branch).
		case 'h3_walk':
			throw new Error(
				`executeStep: 'h3_walk' darf nicht durch die generische Atom-Schleife laufen.`
			);
	}
}

// ── Loop ──────────────────────────────────────────────────────────────────

export function phasesForRun(options: RunOptions): Phase[] {
	// Heuristik-Pfade sind exklusiv pro Run (Memory
	// `project_three_heuristics_architecture.md`): genau einer von H1, H2,
	// H3 läuft je Run-Trigger. Default 'h1'. Wer mehrere Pfade auf dem-
	// selben Werk anwenden will, triggert sequenziell mehrere Runs —
	// automatische Verkettung gibt es nicht.
	const heuristic = options.heuristic ?? 'h1';

	switch (heuristic) {
		case 'h3':
			return ['h3_walk'];
		case 'h2': {
			const phases: Phase[] = [...PHASE_ORDER_SYNTHETIC];
			if (options.retrograde_pass) phases.push(...PHASE_ORDER_RETROGRADE);
			return phases;
		}
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
		case 'meta': {
			// Composite-Heuristik (User-Setzung 2026-05-05): H1-Phasen linear,
			// dann H2-Phasen hierarchisch, dann meta_synthesis terminal. Die
			// hier zurückgegebene Liste ist die semantische Sequenz für UI/
			// Telemetrie/Preflight-Counts; die tatsächliche Ausführung
			// dispatched runPipelineLoop in drei Sub-Strecken (H1 via
			// runIterativePhase, H2 via runH2Hierarchical, meta_synthesis via
			// runIterativePhase).
			const phases: Phase[] = [...PHASE_ORDER_ANALYTICAL];
			if (options.include_validity) {
				const agIdx = phases.indexOf('argumentation_graph');
				phases.splice(agIdx + 1, 0, 'argument_validity');
			}
			phases.push(...PHASE_ORDER_SYNTHETIC);
			if (options.retrograde_pass) phases.push(...PHASE_ORDER_RETROGRADE);
			phases.push('meta_synthesis');
			return phases;
		}
	}
}

/**
 * Hauptloop: arbeitet die konfigurierte Phasen-Reihenfolge sequentiell ab.
 *
 * Zwei Phasen-Modelle:
 *   - Iterations-Phasen (H1/H2): pro Atom (¶ / Subkapitel / Kapitel) ein
 *     Tool-Aufruf. Fail-tolerant pro Atom; Pass-Vertrag (Atom muss nach
 *     executeStep done sein, sonst Code-Bug) statt Endlos-Loop-Pflaster.
 *     Implementiert in runIterativePhase.
 *   - Werk-Phasen (H3): ein Tool-Aufruf pro Phase auf das ganze Werk. Kein
 *     Atom-Wrapper (Tool muss intrinsisch failsafe sein: Idempotenz, klare
 *     Vorbedingungen, klarer Empty-Path). Implementiert in runWerkPhaseStep.
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

	// Pre-Flight: Provider auf Erreichbarkeit prüfen, bevor wir 80+ Atome
	// abfeuern. Fängt den häufigsten Failure-Mode (abgelaufener Key,
	// erschöpfte Wochen-/Tages-Quota auf OpenRouter, Rate-Limit-Block) am
	// Run-Start ab statt erst nach 30 verbrannten Atomen. testConnection()
	// nutzt die globale provider+model-Setzung; tier-spezifische Provider-
	// Splits (selten) sind hier nicht abgedeckt — dann greift der Fail-Fast
	// in den Per-Atom-catch-Blöcken.
	const preflight = await testConnection();
	if (!preflight.ok && preflight.fatal) {
		const message = `Provider-Pre-Flight fehlgeschlagen — Run nicht gestartet: ${preflight.error ?? 'unknown'}`;
		await markFailed(runId, message);
		safeSend(sendEvent, { type: 'failed', message });
		return;
	}

	const heuristic = options.heuristic ?? 'h1';

	// Pre-Check (Cancel + Run-vorhanden). Returnt true wenn der Loop weiter
	// laufen darf, false wenn schon paused/failed gemeldet wurde.
	const preCheck = async (): Promise<boolean> => {
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
		return true;
	};

	if (heuristic === 'h2') {
		// H2 fährt einen Forward-interleaved-Walk (siehe runH2Hierarchical).
		// Cancel-Checks erfolgen pro Atom innerhalb von runH2Hierarchical;
		// hier nur ein zusätzlicher Pre-Check vor dem Plan-Aufbau.
		if (!(await preCheck())) return;
		const ok = await runH2Hierarchical(
			runId,
			caseId,
			documentId,
			userId,
			sendEvent,
			erroredAtomIds,
			recordAtomError,
			options.retrograde_pass ?? false
		);
		if (!ok) return;
	} else if (heuristic === 'meta') {
		// Composite-Run (User-Setzung 2026-05-05): H1-Phasen linear, dann
		// H2-Walk hierarchisch, dann meta_synthesis terminal. Idempotenz:
		// schon durchgelaufene Sub-Strecken werden via Done-Filter in
		// runIterativePhase / runH2Hierarchical übersprungen.

		// 1. H1-Strecke (linear, ± validity).
		const h1Phases: Phase[] = [...PHASE_ORDER_ANALYTICAL];
		if (options.include_validity) {
			const agIdx = h1Phases.indexOf('argumentation_graph');
			h1Phases.splice(agIdx + 1, 0, 'argument_validity');
		}
		for (const phase of h1Phases) {
			if (!(await preCheck())) return;
			const ok = await runIterativePhase(
				runId,
				phase,
				caseId,
				documentId,
				userId,
				sendEvent,
				erroredAtomIds,
				recordAtomError
			);
			if (!ok) return;
		}

		// 2. H2-Strecke (forward-interleaved Walk).
		if (!(await preCheck())) return;
		const h2Ok = await runH2Hierarchical(
			runId,
			caseId,
			documentId,
			userId,
			sendEvent,
			erroredAtomIds,
			recordAtomError,
			options.retrograde_pass ?? false
		);
		if (!h2Ok) return;

		// 3. meta_synthesis (terminal, ein Atom auf Werk-Ebene).
		if (!(await preCheck())) return;
		const metaOk = await runIterativePhase(
			runId,
			'meta_synthesis',
			caseId,
			documentId,
			userId,
			sendEvent,
			erroredAtomIds,
			recordAtomError
		);
		if (!metaOk) return;
	} else {
		// h1 (PHASE_ORDER_ANALYTICAL ± validity) und h3 (h3_walk).
		for (const phase of phases) {
			// Cancel-Check vor jeder Phase. Innerhalb der Phase wird er von
			// runIterativePhase / runH3Walk selbst nochmal geprüft.
			if (!(await preCheck())) return;

			const ok =
				phase === 'h3_walk'
					? await runH3Walk(runId, caseId, documentId, sendEvent)
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
 * Eine Iterations-Phase: Atom für Atom abarbeiten, fail-tolerant pro Atom.
 *
 * Pass-Vertrag: nach executeStep muss listAtomsForPhase das Atom als done
 * führen. Verletzung dieses Vertrags ist ein Code-Bug (Inkongruenz zwischen
 * Done-Set und Pass-Skip/Persist-Bedingung), kein Wiederversuchsfall — wird
 * als generic Error geworfen und vom fail-tolerant-Pfad (recordAtomError +
 * erroredAtomIds) gefangen. Loop läuft mit nächstem Atom weiter; das errored-
 * Set verhindert, dass dasselbe defekte Atom wieder oben in pending steht.
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
			const stepResult = await executeStep(phase, atom, caseId, userId);

			// Pass-Vertrag prüfen: das gerade verarbeitete Atom darf nach dem
			// Pass nicht mehr in pending stehen. Verletzung = Inkongruenz
			// zwischen listAtomsForPhase-Done-Set und Pass-Skip/Persist —
			// Code-Bug, nicht retryable. catch-Block unten merkt das Atom als
			// errored und der Loop macht mit dem nächsten Atom weiter.
			const post = await listAtomsForPhase(phase, documentId);
			if (post.pending.some((p) => p.id === atom.id)) {
				throw new Error(
					`Pass for ${phase}/${atom.label} returned but atom remains pending — ` +
						`done-check and pass-persist are out of sync (code bug, not retryable)`
				);
			}

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
			// Provider-Fatale (Auth/Quota/Rate-Limit) sind nicht atom-spezifisch
			// — derselbe Key/Account ist für alle Folge-Atome dasselbe Limit.
			// Statt durch 80+ Atome durchzubrennen: Run hart abbrechen.
			if (isFatalProviderError(err)) {
				await markFailed(runId, `Provider-Fehler (Auth/Quota/Rate-Limit) — Run abgebrochen: ${message}`);
				safeSend(sendEvent, { type: 'failed', message });
				return false;
			}
			// Fail-tolerant: Atom merken, weiter mit nächstem.
			await recordAtomError(phase, atom, message);
		}
	}
}

/**
 * Baut den H2-Walk-Plan für ein Werk: eine in Ausführungsreihenfolge sortierte
 * Liste {phase, atom}, die den Forward-interleaved-Walk vom Hauptkapitel-Header
 * über die Subkapitel ihrer Absätze bis zur Werk-Synthese kodiert.
 *
 * Walk-Choreographie pro Hauptkapitel:
 *   - aggregation_subchapter_level==1 (flaches Kapitel): alle Absätze des
 *     Hauptkapitels → chapter_collapse_synthetic (kein section_collapse).
 *   - level==2 oder 3: pro Subkapitel auf der gewählten Ebene seine Absätze
 *     → section_collapse_synthetic; nach allen Subkapiteln des Hauptkapitels
 *     → chapter_collapse_synthetic.
 * Absätze, die im Hauptkapitel vor dem ersten Subkapitel-Heading liegen
 * (selten, z.B. Vorlauf zwischen L1- und erstem L2-Heading), werden als
 * Pre-Section-Absätze emittiert; sie haben keinen Subkap-Collapse, der sie
 * abdeckt — Verhalten ist identisch zur linearen Phasenausführung.
 *
 * Pre-Chapter-Absätze (vor dem ersten L1, z.B. Einleitung-ohne-Hauptkapitel)
 * werden ganz am Anfang als paragraph_synthetic-Atome emittiert.
 *
 * Am Ende: ein document_collapse_synthetic-Atom.
 *
 * Per-Phase-Atom-Counts entsprechen exakt denen von listAtomsForPhase, nur
 * die Reihenfolge ist hierarchisch statt phasenweise — Preflight bleibt
 * also unverändert korrekt.
 */
async function buildH2HierarchicalPlan(
	documentId: string,
	options: { retrograde: boolean } = { retrograde: false }
): Promise<Array<{ phase: Phase; atom: AtomRef }>> {
	const plan: Array<{ phase: Phase; atom: AtomRef }> = [];
	const chapters = await loadChapterUnits(documentId);

	const allParagraphRows = (
		await query<{ id: string; charStart: number }>(
			`SELECT id, char_start AS "charStart" FROM document_elements
			 WHERE document_id = $1 AND element_type = 'paragraph' AND section_kind = 'main'
			 ORDER BY char_start`,
			[documentId]
		)
	).rows;
	const paragraphCharStart = new Map(allParagraphRows.map((p) => [p.id, p.charStart]));
	const paragraphIndexById = new Map<string, number>();
	allParagraphRows.forEach((p, i) => paragraphIndexById.set(p.id, i + 1));

	const labelForParagraph = (pid: string): string =>
		`Absatz ${paragraphIndexById.get(pid) ?? '?'}`;

	// Pre-chapter paragraphs (vor erstem L1): nur paragraph_synthetic, keine
	// section/chapter-collapse decken sie ab.
	const firstChapterStart = chapters.length > 0 ? chapters[0].l1.charStart : Infinity;
	const orphanIds = allParagraphRows
		.filter((p) => p.charStart < firstChapterStart)
		.map((p) => p.id);
	for (const pid of orphanIds) {
		plan.push({
			phase: 'paragraph_synthetic',
			atom: { id: pid, label: labelForParagraph(pid) },
		});
	}

	for (const chapter of chapters) {
		let level = await getPersistedSubchapterLevel(chapter.l1.headingId);
		if (level === null) {
			level = chooseSubchapterLevel(chapter, allParagraphRows);
			await persistSubchapterLevel(chapter.l1.headingId, documentId, level as 1 | 2 | 3);
		}

		const chapterAtom: AtomRef = {
			id: chapter.l1.headingId,
			label: `${chapter.l1.numbering ?? ''} ${chapter.l1.text}`.trim().slice(0, 80),
			headingId: chapter.l1.headingId,
		};

		const sections =
			level === 1 ? [] : chapter.innerHeadings.filter((h) => h.level === level);

		// Defensiv: chooseSubchapterLevel darf level=2/3 nur wählen, wenn auch
		// Headings auf der Ebene existieren — falls dennoch leer (Inkonsistenz),
		// behandeln wie level=1.
		const effectiveLevel: 1 | 2 | 3 =
			level === 1 || sections.length === 0 ? 1 : (level as 2 | 3);

		if (effectiveLevel === 1) {
			for (const pid of chapter.paragraphIds) {
				plan.push({
					phase: 'paragraph_synthetic',
					atom: { id: pid, label: labelForParagraph(pid) },
				});
			}
			plan.push({ phase: 'chapter_collapse_synthetic', atom: chapterAtom });
			continue;
		}

		// Pre-section orphan ¶s im Hauptkapitel (zwischen L1-Heading und erstem
		// Subkap-Heading): paragraph_synthetic, kein section_collapse.
		const preSectionPids = chapter.paragraphIds.filter((pid) => {
			const cs = paragraphCharStart.get(pid)!;
			return cs < sections[0].charStart;
		});
		for (const pid of preSectionPids) {
			plan.push({
				phase: 'paragraph_synthetic',
				atom: { id: pid, label: labelForParagraph(pid) },
			});
		}

		for (let i = 0; i < sections.length; i++) {
			const section = sections[i];
			const sectionEnd =
				i + 1 < sections.length ? sections[i + 1].charStart : chapter.endChar;
			const sectionPids = chapter.paragraphIds.filter((pid) => {
				const cs = paragraphCharStart.get(pid)!;
				return cs >= section.charStart && cs < sectionEnd;
			});
			for (const pid of sectionPids) {
				plan.push({
					phase: 'paragraph_synthetic',
					atom: { id: pid, label: labelForParagraph(pid) },
				});
			}
			plan.push({
				phase: 'section_collapse_synthetic',
				atom: {
					id: section.headingId,
					label: `${section.numbering ?? ''} ${section.text}`.trim().slice(0, 80),
					headingId: section.headingId,
				},
			});
		}

		plan.push({ phase: 'chapter_collapse_synthetic', atom: chapterAtom });
	}

	plan.push({
		phase: 'document_collapse_synthetic',
		atom: { id: documentId, label: 'Werk-Synthese (synthetisch)' },
	});

	// Retrograde 2-pass (FFN-Backprop-style refinement): top-down nach
	// abgeschlossener Forward-Strecke + W. Reihenfolge ist hart sequentiell
	// chapter → subchapter → paragraph, weil jede Ebene auf der retrograden
	// Vorgänger-Ebene aufbaut (siehe paragraph-retrograde / section-collapse-
	// retrograde / chapter-collapse-retrograde).
	if (options.retrograde) {
		// Hauptkapitel-Retrograde (W absorbiert).
		for (const chapter of chapters) {
			plan.push({
				phase: 'chapter_collapse_retrograde',
				atom: {
					id: chapter.l1.headingId,
					label: `${chapter.l1.numbering ?? ''} ${chapter.l1.text}`.trim().slice(0, 80),
					headingId: chapter.l1.headingId,
				},
			});
		}

		// Subkapitel-Retrograde (Hauptkap-Retrograde absorbiert) — nur für
		// Kapitel mit echtem Subkapitel-Level (2 oder 3); level=1-Kapitel haben
		// keine section_collapse-Forward-Memos zum Verfeinern.
		for (const chapter of chapters) {
			const level = await getPersistedSubchapterLevel(chapter.l1.headingId);
			const sections =
				level === 2 || level === 3
					? chapter.innerHeadings.filter((h) => h.level === level)
					: [];
			if (sections.length === 0) continue;
			for (const section of sections) {
				plan.push({
					phase: 'section_collapse_retrograde',
					atom: {
						id: section.headingId,
						label: `${section.numbering ?? ''} ${section.text}`.trim().slice(0, 80),
						headingId: section.headingId,
					},
				});
			}
		}

		// Per-Absatz-Retrograde (Subkap-Retrograde bzw. Hauptkap-Retrograde
		// absorbiert) — für alle Hauptlinien-Absätze, in Dokument-Reihenfolge.
		for (const p of allParagraphRows) {
			plan.push({
				phase: 'paragraph_retrograde',
				atom: { id: p.id, label: labelForParagraph(p.id) },
			});
		}
	}

	return plan;
}

/**
 * H2-Forward-interleaved-Loop: arbeitet einen vorab gebauten Plan ab, der
 * paragraph_synthetic / section_collapse_synthetic / chapter_collapse_synthetic
 * / document_collapse_synthetic in hierarchischer Reihenfolge interleavt
 * (siehe buildH2HierarchicalPlan-Doc).
 *
 * Pro Atom: Cancel-Check, Done-Check via listAtomsForPhase (Idempotenz für
 * Resume + Skip-Anzeige), Step-Execution, Pass-Vertrag-Check, fail-tolerant
 * Catch (PreconditionFailedError fail-fast wie in runIterativePhase).
 *
 * Phase-Start wird einmal pro Phase emittiert, beim ersten Auftreten im Plan;
 * Phase-Total = Anzahl Atome dieser Phase im Plan (== listAtomsForPhase-
 * Total). Step-Index läuft pro Phase mit, sodass die UI ihre vier
 * Phasen-Progress-Balken korrekt animiert, auch wenn die Phasen interleaved
 * laufen.
 *
 * Returnt true bei sauber abgeschlossenem Walk, false wenn der Run
 * abgebrochen wurde (markFailed/markPaused bereits aufgerufen, Event
 * versendet).
 */
async function runH2Hierarchical(
	runId: string,
	caseId: string,
	documentId: string,
	userId: string,
	sendEvent: (e: PipelineEvent) => void,
	erroredAtomIds: Set<string>,
	recordAtomError: (phase: Phase, atom: AtomRef, message: string) => Promise<void>,
	retrograde: boolean = false
): Promise<boolean> {
	const plan = await buildH2HierarchicalPlan(documentId, { retrograde });

	const phaseTotals = new Map<Phase, number>();
	for (const step of plan) {
		phaseTotals.set(step.phase, (phaseTotals.get(step.phase) ?? 0) + 1);
	}
	const phaseIndex = new Map<Phase, number>();
	const phaseAnnounced = new Set<Phase>();

	for (const step of plan) {
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

		const phase = step.phase;
		const atom = step.atom;
		const totalInPhase = phaseTotals.get(phase)!;
		const indexInPhase = phaseIndex.get(phase) ?? 0;

		if (!phaseAnnounced.has(phase)) {
			safeSend(sendEvent, { type: 'phase-start', phase, total: totalInPhase });
			phaseAnnounced.add(phase);
		}

		if (erroredAtomIds.has(atom.id)) {
			// Schon gescheitert in diesem Run-Lauf — überspringen, Index trotzdem
			// hochzählen, damit Folge-Atom-Indizes konsistent bleiben.
			phaseIndex.set(phase, indexInPhase + 1);
			continue;
		}

		safeSend(sendEvent, {
			type: 'step-start',
			phase,
			atom,
			index: indexInPhase,
			total: totalInPhase,
		});

		const list = await listAtomsForPhase(phase, documentId);
		const isDone = !list.pending.some((p) => p.id === atom.id);

		if (isDone) {
			const updated = await getRun(runId);
			safeSend(sendEvent, {
				type: 'step-done',
				phase,
				atom,
				index: indexInPhase + 1,
				total: totalInPhase,
				skipped: true,
				tokens: { input: 0, output: 0, cacheRead: 0 },
				cumulative: {
					input: updated?.accumulated_input_tokens ?? 0,
					output: updated?.accumulated_output_tokens ?? 0,
					cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
				},
			});
			phaseIndex.set(phase, indexInPhase + 1);
			continue;
		}

		try {
			const stepResult = await executeStep(phase, atom, caseId, userId);

			// Pass-Vertrag (analog runIterativePhase): das gerade verarbeitete
			// Atom darf nach dem Pass nicht mehr in pending stehen.
			const post = await listAtomsForPhase(phase, documentId);
			if (post.pending.some((p) => p.id === atom.id)) {
				throw new Error(
					`Pass for ${phase}/${atom.label} returned but atom remains pending — ` +
						`done-check and pass-persist are out of sync (code bug, not retryable)`
				);
			}

			await updateProgress(
				runId,
				phase,
				indexInPhase + 1,
				totalInPhase,
				atom.label,
				stepResult.tokens
			);
			const updated = await getRun(runId);
			safeSend(sendEvent, {
				type: 'step-done',
				phase,
				atom,
				index: indexInPhase + 1,
				total: totalInPhase,
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
			// Provider-Fatale: siehe runIterativePhase (gleiche Logik).
			if (isFatalProviderError(err)) {
				await markFailed(runId, `Provider-Fehler (Auth/Quota/Rate-Limit) — Run abgebrochen: ${message}`);
				safeSend(sendEvent, { type: 'failed', message });
				return false;
			}
			await recordAtomError(phase, atom, message);
		}

		phaseIndex.set(phase, indexInPhase + 1);
	}

	return true;
}

/**
 * H3-Walk-Loop: arbeitet die Walk-Step-Sequenz (Absatz-Komplexe + Werk-
 * Aggregationen, in Dokument-Reihenfolge) sequentiell ab. Kein Stuck-
 * Guard und kein fail-tolerant pro Step — jeder Walk-Step-Fehler ist
 * entweder Vorbedingungs-Verletzung (Reviewer-Eingriff nötig) oder Tool-
 * Defekt (Code-Fix nötig); markFailed sorgt dafür, dass das Problem nicht
 * stillschweigend hinter weiteren Steps verschwindet.
 *
 * Voraussetzungen pro Tool:
 *   - Idempotenz: Re-Run produziert keinen Duplikat-Stand (clearExisting
 *     komplex- bzw. werk-skopiert).
 *   - Klare Vorbedingungen: PreconditionFailedError für inhaltliche
 *     Vorbedingungs-Verletzungen, generic Error nur für interne Bugs.
 *   - Klarer Empty-Path: kein Material → { skipped: true }, kein Fehler.
 *
 * Returnt true bei sauber abgeschlossenem Walk, false wenn der Run
 * abgebrochen wurde (markFailed/markPaused bereits aufgerufen, Event
 * versendet).
 */
async function runH3Walk(
	runId: string,
	caseId: string,
	documentId: string,
	sendEvent: (e: PipelineEvent) => void
): Promise<boolean> {
	const phase: Phase = 'h3_walk';
	const steps = await listH3WalkSteps(documentId);

	safeSend(sendEvent, { type: 'phase-start', phase, total: steps.length });

	for (let i = 0; i < steps.length; i++) {
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

		const step = steps[i];
		const atom: AtomRef = { id: walkStepId(step), label: walkStepLabel(step) };
		const stepIndex = i + 1;
		const total = steps.length;

		// last_step_label/current_index sofort beim step-start in DB schreiben
		// (mit 0 Token-Delta), damit das UI bei einem Tool-Fehler den TATSÄCHLICH
		// fehlgeschlagenen Step zeigt — nicht den letzten erfolgreich gelaufenen.
		// Erfolgsfall überschreibt unten mit den echten Tokens (Label bleibt gleich).
		await updateProgress(runId, phase, stepIndex, total, atom.label, {
			input: 0,
			output: 0,
			cacheRead: 0,
		});

		safeSend(sendEvent, { type: 'step-start', phase, atom, index: i, total });

		// Done-Check: Walk-Step schon abgeschlossen → skippen (Idempotenz auf
		// Pass-Ebene; Resume eines Runs läuft hier durch). Validation-Check
		// (User-Schutz) erfolgt zusätzlich in runH3WalkStep.
		const isDone = await isH3WalkStepDone(step, caseId, documentId);
		if (isDone) {
			// Label/Index bereits oben beim step-start gesetzt — hier nur
			// step-done mit skipped-Flag und aktuellem Cumulative-Token-Stand.
			const updated = await getRun(runId);
			safeSend(sendEvent, {
				type: 'step-done',
				phase,
				atom,
				index: stepIndex,
				total,
				skipped: true,
				tokens: { input: 0, output: 0, cacheRead: 0 },
				cumulative: {
					input: updated?.accumulated_input_tokens ?? 0,
					output: updated?.accumulated_output_tokens ?? 0,
					cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
				},
			});
			continue;
		}

		try {
			const r = await runH3WalkStep(step, caseId, documentId);
			await updateProgress(runId, phase, stepIndex, total, atom.label, r.tokens);
			const updated = await getRun(runId);
			safeSend(sendEvent, {
				type: 'step-done',
				phase,
				atom,
				index: stepIndex,
				total,
				skipped: r.skipped,
				tokens: r.tokens,
				cumulative: {
					input: updated?.accumulated_input_tokens ?? 0,
					output: updated?.accumulated_output_tokens ?? 0,
					cacheRead: updated?.accumulated_cache_read_tokens ?? 0,
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			safeSend(sendEvent, { type: 'step-error', phase, atom, message });
			await markFailed(runId, message);
			safeSend(sendEvent, { type: 'failed', message });
			return false;
		}
	}

	return true;
}

// Importiert von H3WalkStep — Type-Re-Export für Konsumenten, die ohne
// h3-walk-driver.js direkt mit dem Orchestrator arbeiten (z.B. Tests).
export type { H3WalkStep };

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
		if (phase === 'h3_walk') {
			// H3-Walk: total = Anzahl Walk-Steps (Komplexe + Werk-Knoten),
			// done = Anzahl Steps mit existierendem Output-Konstrukt.
			// caseId ist hier nicht im Scope — wir nutzen documentId-basierte
			// Done-Checks (caseless docs sind unmöglich, Memory
			// project_no_caseless_docs).
			const caseRow = await queryOne<{ id: string }>(
				`SELECT id FROM cases WHERE central_document_id = $1 LIMIT 1`,
				[documentId]
			);
			const steps = await listH3WalkSteps(documentId);
			let done = 0;
			if (caseRow) {
				for (const step of steps) {
					if (await isH3WalkStepDone(step, caseRow.id, documentId)) done += 1;
				}
			}
			result.push({
				phase,
				total: steps.length,
				done,
				pending: steps.length - done,
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
