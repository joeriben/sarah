<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  SARAH Doc-Page (Stufe-2-Layout, 2026-05-02):
  Drei Tabs (Pipeline · Outline · Begleitdocs) + Reader-Modal-Overlay.
  Reader (Argumente/Struktur/Volltext) lebt im Modal, getriggert von Outline-§X:AY-Klicks
  oder von §X:AY-Anker-Klicks im Outline-Tab.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { replaceState, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import type { DocumentElement, ParagraphMemo, CodeAnchor, HeadingSynthesis, WorkSynthesis, ChapterFlow, WorkSynthetic, WorkMeta, CaseInfo, OutlineEntry, BriefOption, ParagraphAnalysis, H3ConstructForReader } from './+page.server.js';
	import type { DocReaderHeuristic } from './DocumentReader.svelte';
	import {
		missingRequiredFunctionTypes,
		OUTLINE_FUNCTION_TYPE_LABELS,
		type HeuristicPath,
		type OutlineFunctionType,
	} from '$lib/shared/h3-vocabulary.js';
	import ReaderModal from './ReaderModal.svelte';
	import DocumentReader from './DocumentReader.svelte';
	import ArgumentPopover from './ArgumentPopover.svelte';

	let { data } = $props();
	const doc = $derived(data.document);
	const anonymization = $derived(data.anonymization as {
		status: 'applied' | 'skipped_already_redacted' | 'no_candidates' | 'failed' | null;
		anonymizedAt: string | null;
		originalFilename: string | null;
		seedCount: number;
	});
	let anonRunning = $state(false);
	let anonError = $state<string | null>(null);
	const anonKey = $derived(anonymization.status ?? 'missing');

	async function runAnonymization(action: 'run' | 'reset' = 'run') {
		anonRunning = true;
		anonError = null;
		try {
			// 'reset' lädt das Original-DOCX neu und re-anonymisiert mit der
			// aktuellen Heuristik. Sinnvoll nach Algorithmus-Updates.
			const url = action === 'reset'
				? `/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/anonymize?mode=reset`
				: `/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/anonymize`;
			const res = await fetch(url, { method: 'POST' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? `HTTP ${res.status}`);
			}
			await invalidateAll();
		} catch (e) {
			anonError = e instanceof Error ? e.message : String(e);
		} finally {
			anonRunning = false;
		}
	}

	const ANON_LABEL: Record<NonNullable<typeof anonymization.status> | 'missing', string> = {
		applied: 'Anonymisiert',
		skipped_already_redacted: 'Vor-anonymisiert',
		no_candidates: 'Keine PII gefunden',
		failed: 'Anonymisierung fehlgeschlagen',
		missing: 'Nicht anonymisiert'
	};
	const ANON_TITLE: Record<NonNullable<typeof anonymization.status> | 'missing', (a: typeof anonymization) => string> = {
		applied: (a) =>
			`Volltext wurde algorithmisch anonymisiert (${a.seedCount} PII-Seeds aktiv).` +
			(a.originalFilename ? `\nOriginal-Dateiname: ${a.originalFilename}` : '') +
			'\n\nFailsafe-Tripwire vor jedem Outbound-Call an Non-DSGVO-Provider scharf.',
		skipped_already_redacted: (a) =>
			`Frontpage war bereits geschwärzt — keine Überschreibung. ${a.seedCount} Seeds wurden trotzdem extrahiert und der Failsafe ist scharf.`,
		no_candidates: () =>
			'Keine PII-Kandidaten im Dokument gefunden. Externe LLM-Calls sind unkritisch.',
		failed: () => 'Anonymisierungs-Lauf ist fehlgeschlagen. Klick zum Neu-Versuch.',
		missing: () =>
			'Dokument ist nicht anonymisiert. Klartext darf nicht an Non-DSGVO-Provider gehen, bis Anonymisierung gelaufen ist.'
	};
	const elements = $derived(data.elements as DocumentElement[]);
	const caseInfo = $derived(data.case as CaseInfo | null);
	const memosByElement = $derived(data.memosByElement as Record<string, ParagraphMemo[]>);
	const codesByElement = $derived(data.codesByElement as Record<string, CodeAnchor[]>);
	const synthesesByHeading = $derived(data.synthesesByHeading as Record<string, HeadingSynthesis>);
	const outlineEntries = $derived(data.outlineEntries as OutlineEntry[]);
	const briefOptions = $derived(data.briefOptions as BriefOption[]);
	const paragraphHasAg = $derived(data.paragraphHasAg as Record<string, boolean>);
	const aggregationLevelByL1 = $derived(data.aggregationLevelByL1 as Record<string, 1 | 2 | 3>);
	const workSynthesis = $derived(data.workSynthesis as WorkSynthesis | null);
	const chapterFlow = $derived(data.chapterFlow as ChapterFlow | null);
	const workSynthetic = $derived(data.workSynthetic as WorkSynthetic | null);
	const workMeta = $derived(data.workMeta as WorkMeta | null);
	const analysisByElement = $derived(data.analysisByElement as Record<string, ParagraphAnalysis>);
	// H3-§-Spalte: serverseitig gefiltert auf §-skopierte construct_kinds
	// (Whitelist FRAGESTELLUNG, MOTIVATION, METHODOLOGIE, METHODEN, BASIS,
	// AUFBAU_SKIZZE, BEFUND, HOTSPOT, EXKURS_ANKER, RE_SPEC_AKT). Werk-/
	// container-aggregierte Konstrukte gehören in den Results-Tab.
	const h3ConstructsByElement = $derived(
		data.h3ConstructsByElement as Record<string, H3ConstructForReader[]>
	);

	type View = 'pipeline' | 'dokument' | 'outline' | 'meta' | 'companions';
	const VIEWS: View[] = ['pipeline', 'dokument', 'outline', 'meta', 'companions'];
	const VIEW_LABEL: Record<View, string> = {
		pipeline: 'Pipeline',
		dokument: 'Dokument',
		outline: 'Synthesen',
		meta: 'Meta-Synthese',
		companions: 'Begleitdocs',
	};

	let view = $state<View>('pipeline');
	let readerOpen = $state(false);
	let readerScrollTarget = $state<{ elementId: string; argumentId?: string } | null>(null);

	// XOR-Heuristik-Wahl im Doc-Tab (Drei-Heuristiken-Architektur):
	// genau eine Spalte sichtbar (H1 Argumentanalyse / H2 synthetisch-hermeneutisch /
	// H3 funktionstyp-orchestriert). Persistiert in localStorage; Default beim
	// ersten Laden = erste verfügbare Heuristik in H1→H2→H3-Reihenfolge.
	const HEURISTIC_LS_KEY = 'sarah:docTab:heuristic';
	let activeHeuristic = $state<DocReaderHeuristic>('h1');

	// Pipeline-Status — aus /api/cases/[caseId]/pipeline-status.
	// Drei Heuristik-Linien (exklusiv pro Run):
	//   H1 (analytisch):    argumentation_graph → subchapter → chapter → work
	//   H2 (synthetisch):   paragraph_synthetic → subchapter_synthetic → chapter_synthetic → work_synthetic
	//   H3 (funktionstyp):  Cross-Typ-Reihenfolge der WERK-aggregierten Heuristiken
	type AnalyticalPassKey = 'argumentation_graph' | 'argument_validity' | 'subchapter' | 'chapter' | 'work';
	type SyntheticPassKey =
		| 'paragraph_synthetic'
		| 'subchapter_synthetic'
		| 'chapter_synthetic'
		| 'work_synthetic';
	type PassStatus = { completed: number; total: number | null; last_run: string | null; enabled?: boolean };
	type RunPhase =
		| 'argumentation_graph'
		| 'argument_validity'
		| 'section_collapse'
		| 'chapter_collapse'
		| 'document_collapse'
		| 'paragraph_synthetic'
		| 'section_collapse_synthetic'
		| 'chapter_collapse_synthetic'
		| 'document_collapse_synthetic'
		| 'chapter_collapse_retrograde'
		| 'section_collapse_retrograde'
		| 'paragraph_retrograde'
		| 'h3_exposition'
		| 'h3_grundlagentheorie'
		| 'h3_forschungsdesign'
		| 'h3_durchfuehrung'
		| 'h3_synthese'
		| 'h3_schlussreflexion'
		| 'h3_exkurs'
		| 'h3_werk_deskription'
		| 'h3_werk_gutacht';
	type RunStatusDto = {
		id: string;
		status: 'running' | 'paused' | 'completed' | 'failed';
		current_phase: RunPhase | null;
		current_index: number;
		total_in_phase: number | null;
		last_step_label: string | null;
		options: { heuristic?: 'h1' | 'h2' | 'h3' | 'meta'; include_validity?: boolean; retrograde_pass?: boolean; cost_cap_usd?: number | null };
		cancel_requested: boolean;
		error_message: string | null;
		accumulated_input_tokens: number;
		accumulated_output_tokens: number;
		accumulated_cache_read_tokens: number;
		started_at: string;
		paused_at: string | null;
		completed_at: string | null;
	};
	type H3PhaseKey =
		| 'h3_exposition'
		| 'h3_grundlagentheorie'
		| 'h3_forschungsdesign'
		| 'h3_durchfuehrung'
		| 'h3_synthese'
		| 'h3_schlussreflexion'
		| 'h3_werk_deskription'
		| 'h3_werk_gutacht'
		| 'h3_exkurs';
	type PipelineStatus = {
		case_id: string;
		document_id: string | null;
		brief: { id: string; name: string; argumentation_graph: boolean; validity_check: boolean; h3_enabled: boolean } | null;
		total_paragraphs: number;
		passes: Record<AnalyticalPassKey, PassStatus> & {
			kapitelverlauf: PassStatus;
		} & Record<SyntheticPassKey, PassStatus> & Record<H3PhaseKey, PassStatus>;
		run: RunStatusDto | null;
	};

	const ANALYTICAL_ORDER: AnalyticalPassKey[] = [
		'argumentation_graph',
		'argument_validity',
		'subchapter',
		'chapter',
		'work',
	];
	const SYNTHETIC_ORDER: SyntheticPassKey[] = [
		'paragraph_synthetic',
		'subchapter_synthetic',
		'chapter_synthetic',
		'work_synthetic',
	];
	const PASS_LABEL: Record<AnalyticalPassKey | SyntheticPassKey, string> = {
		argumentation_graph: 'Argumentation pro Absatz',
		argument_validity: 'Argument-Validität (Charity-Pass, opt-in)',
		subchapter: 'Subkapitel-Synthesen',
		chapter: 'Hauptkapitel-Synthesen',
		work: 'Werk-Synthese',
		paragraph_synthetic: 'Synthetisch-hermeneutische Per-Absatz-Memos',
		subchapter_synthetic: 'Subkapitel-Synthesen (synthetisch)',
		chapter_synthetic: 'Hauptkapitel-Synthesen (synthetisch)',
		work_synthetic: 'Werk-Synthese (synthetisch)',
	};
	const PASS_DESC: Record<AnalyticalPassKey | SyntheticPassKey, string> = {
		argumentation_graph:
			'Argumente, Edges und Scaffolding pro Absatz — Grundlage der Aggregation.',
		argument_validity:
			'Charity-First-Prüfung pro Argument: zuerst positiver Tragfähigkeitsnachweis (deduktiv/induktiv/abduktiv); nur wenn der nicht erbracht werden kann, Auswahl aus enger Fallacy-Whitelist. Eigener Pass nach AG, vor Synthesen — addiert ~1 LLM-Call pro Absatz mit Argumenten.',
		subchapter:
			'Kontextualisierende Synthese pro Subkapitel (L2/L3 adaptiv) aus dem Argumentations-Graph.',
		chapter:
			'Kontextualisierende Synthese pro Hauptkapitel inkl. gutachten-fertiger Argumentationswiedergabe.',
		work: 'Werk-Synthese aus den Hauptkapitel-Synthesen.',
		paragraph_synthetic:
			'Formulierende und reflektierende Memos pro Absatz, sequentiell unter Bezug auf alle vorhergehenden ¶ desselben Subkapitels. Grundlage für die kumulativ-sequenzielle H2-Aggregation.',
		subchapter_synthetic:
			'Kontextualisierende Synthese pro Subkapitel (L2/L3 adaptiv) aus der reflective chain — Verlaufswiedergabe statt Argumentations-Graph.',
		chapter_synthetic:
			'Kontextualisierende Synthese pro Hauptkapitel aus den synthetischen Subkapitel-Memos. Vier Pflichtbestandteile inkl. hermeneutischer Tragfähigkeit.',
		work_synthetic:
			'Werk-Synthese aus den synthetischen Hauptkapitel-Memos: Forschungsbeitrag-Diagnose, Werk-Architektur, Niveau-Beurteilung.',
	};

	// H3-Phase-Labels (kein PassKey-Pendant, weil H3 eigene Konstrukt-
	// Familie nutzt — wir labeln direkt). Reihenfolge in H3_ORDER spiegelt
	// die Cross-Typ-Bezüge (Exposition → … → Werk-Gutacht); Exkurs steht
	// am Ende, weil seine Position im Werk variabel ist (vgl. Memory
	// project_three_heuristics_architecture.md).
	const H3_PHASE_LABEL: Record<H3PhaseKey, string> = {
		h3_exposition: 'Exposition · Fragestellung',
		h3_grundlagentheorie: 'Grundlagentheorie · Forschungsgegenstand',
		h3_forschungsdesign: 'Forschungsdesign · Methodik',
		h3_durchfuehrung: 'Durchführung · Befunde',
		h3_synthese: 'Synthese · Gesamtergebnis',
		h3_schlussreflexion: 'Schlussreflexion · Geltungsanspruch',
		h3_werk_deskription: 'Werk-Deskription',
		h3_werk_gutacht: 'Werk-Gutacht (a + b + c)',
		h3_exkurs: 'Exkurs · Re-Spezifikation',
	};

	const H3_PHASE_DESC: Record<H3PhaseKey, string> = {
		h3_exposition:
			'Rekonstruiert FRAGESTELLUNG und MOTIVATION aus dem Einleitungs-Container. Liefert den Bezugsrahmen für alle nachfolgenden H3-Pässe.',
		h3_grundlagentheorie:
			'Fünfstufige Pyramide pro Grundlagentheorie-Container: Verweis-Profil → Block-Routing → reproduktive/diskursive Würdigung → Aggregation zum FORSCHUNGSGEGENSTAND.',
		h3_forschungsdesign:
			'Extrahiert METHODOLOGIE, METHODEN und BASIS aus dem Methoden-Container — oder findet eine AUFBAU_SKIZZE in der Einleitung, falls kein eigenständiges Methodenkapitel vorliegt.',
		h3_durchfuehrung:
			'Detektiert Hotspots, ruft den H1-Argumentations-Pass mit Grounding-Suche auf, konsolidiert zu BEFUNDEN. Argumentanalytisch fundiert, hermeneutisch verdichtet.',
		h3_synthese:
			'Aggregiert aus den BEFUNDEN ein GESAMTERGEBNIS plus Bezug zur ursprünglichen Fragestellung. Critical-Friend-Diagnose bei niedriger Befund-Coverage.',
		h3_schlussreflexion:
			'Extrahiert GELTUNGSANSPRUCH, GRENZEN und ANSCHLUSSFORSCHUNG aus dem Schluss-Container. Cross-Read auf METHODOLOGIE/BASIS für reflektierte Methodengrenzen.',
		h3_werk_deskription:
			'Werk-aggregierte deskriptive Beschreibung aus allen vorherigen H3-Konstrukten. Neutral, kein Urteil — bildet die Grundlage für das Werk-Gutachten.',
		h3_werk_gutacht:
			'Kritische Würdigung in drei Teilen: a) Werk im Lichte der Fragestellung, b) Hotspot-Würdigung pro Funktionstyp, c) Fazit (gated durch eigenen Review-Draft des Users — heute zur Test-Phase deaktiviert).',
		h3_exkurs:
			'Re-Spezifiziert FORSCHUNGSGEGENSTAND aus EXKURS-Containern via append-only Stack. Iterative Spezifikation des Gegenstands aus gewonnenen Erkenntnissen.',
	};

	// Reihenfolge der H3-Cards. EXKURS ans Ende (variabler Ort im Werk;
	// User-Setzung 2026-05-04).
	const H3_ORDER: H3PhaseKey[] = [
		'h3_exposition',
		'h3_grundlagentheorie',
		'h3_forschungsdesign',
		'h3_durchfuehrung',
		'h3_synthese',
		'h3_schlussreflexion',
		'h3_werk_deskription',
		'h3_werk_gutacht',
		'h3_exkurs',
	];

	// Outline-Funktionstypen die HARTE Pflicht für eine H3-Phase sind: ohne
	// Container im Outline kann die Heuristik nichts extrahieren UND es gibt
	// keine Recovery-Pyramide. FORSCHUNGSDESIGN, SCHLUSSREFLEXION und EXKURS
	// fehlen hier bewusst — die zugehörigen Heuristiken haben Recovery-
	// Mechanismen (AUFBAU_SKIZZE-Pyramide bei FD, Letztes-Drittel bei SR;
	// EXKURS ist sowieso optional). Quelle: H3_REQUIRED_FUNCTION_TYPES in
	// h3-vocabulary.ts.
	const H3_REQUIRED_OUTLINE_TYPE: Partial<Record<H3PhaseKey, string>> = {
		h3_exposition: 'EXPOSITION',
		h3_grundlagentheorie: 'GRUNDLAGENTHEORIE',
		h3_durchfuehrung: 'DURCHFUEHRUNG',
	};

	// Vorgelagerte H3-Phasen, deren Output als Bezugsrahmen einer Phase
	// vorliegen muss. Pro Vorbedingung der zugehörige Pass-Key.
	const H3_PHASE_PREREQS: Partial<Record<H3PhaseKey, H3PhaseKey[]>> = {
		h3_grundlagentheorie: ['h3_exposition'],
		h3_forschungsdesign: ['h3_exposition', 'h3_grundlagentheorie'],
		h3_durchfuehrung: ['h3_grundlagentheorie', 'h3_forschungsdesign'],
		h3_synthese: ['h3_durchfuehrung'],
		h3_schlussreflexion: ['h3_synthese'],
		h3_werk_deskription: ['h3_exposition', 'h3_grundlagentheorie', 'h3_forschungsdesign'],
		h3_werk_gutacht: ['h3_werk_deskription'],
		h3_exkurs: ['h3_grundlagentheorie'],
	};

	const RETROGRADE_PHASE_LABEL: Record<string, string> = {
		chapter_collapse_retrograde: 'Hauptkapitel-Retrograde (W-absorbiert)',
		section_collapse_retrograde: 'Subkapitel-Retrograde (Hauptkap-absorbiert)',
		paragraph_retrograde: 'Per-Absatz-Retrograde (Subkap-absorbiert)',
	};

	function phaseLabel(phase: RunPhase): string {
		if (phase.startsWith('h3_')) return H3_PHASE_LABEL[phase as H3PhaseKey] ?? phase;
		if (phase.endsWith('_retrograde')) return RETROGRADE_PHASE_LABEL[phase] ?? phase;
		const key = PHASE_TO_PASS[phase as keyof typeof PHASE_TO_PASS];
		return key ? PASS_LABEL[key] : phase;
	}

	// Mapping zwischen UI-PassKey (orientiert an memo_content.scope_level + Linien-Tag)
	// und Run-Phase-Bezeichner aus dem Orchestrator.
	const PHASE_TO_PASS: Record<string, AnalyticalPassKey | SyntheticPassKey> = {
		argumentation_graph: 'argumentation_graph',
		argument_validity: 'argument_validity',
		section_collapse: 'subchapter',
		chapter_collapse: 'chapter',
		document_collapse: 'work',
		paragraph_synthetic: 'paragraph_synthetic',
		section_collapse_synthetic: 'subchapter_synthetic',
		chapter_collapse_synthetic: 'chapter_synthetic',
		document_collapse_synthetic: 'work_synthetic',
	};

	let pipelineStatus = $state<PipelineStatus | null>(null);
	let pipelineLoading = $state(false);
	let pipelineError = $state<string | null>(null);

	// Werk-Analyse: vollständige H3-Konstrukt-Inhalte (function_constructs.content).
	type H3ConstructDto = {
		id: string;
		outline_function_type: string;
		construct_kind: string;
		content: Record<string, unknown>;
		anchor_element_ids: string[];
		version_stack: unknown[];
		virtual_container_id: string | null;
		source_run_id: string | null;
		created_at: string;
		updated_at: string;
	};
	let werkConstructs = $state<H3ConstructDto[] | null>(null);
	let werkLoading = $state(false);
	let werkError = $state<string | null>(null);

	const CONSTRUCT_KIND_LABEL: Record<string, string> = {
		FRAGESTELLUNG: 'Fragestellung',
		MOTIVATION: 'Motivation',
		VERWEIS_PROFIL: 'Verweis-Profil',
		BLOCK_ROUTING: 'Block-Routing',
		DISKURSIV_BEZUG_BEFUND: 'Diskursive Bezüge',
		FORSCHUNGSGEGENSTAND: 'Forschungsgegenstand',
		METHODOLOGIE: 'Methodologie',
		METHODEN: 'Methoden',
		BASIS: 'Basis (Korpus / Sample)',
		AUFBAU_SKIZZE: 'Aufbau-Skizze',
		BEFUND: 'Befund',
		GESAMTERGEBNIS: 'Gesamtergebnis',
		GELTUNGSANSPRUCH: 'Geltungsanspruch',
		WERK_BESCHREIBUNG: 'Werk-Beschreibung',
		WERK_GUTACHT: 'Werk-Gutacht',
	};

	function constructKindLabel(k: string): string {
		return CONSTRUCT_KIND_LABEL[k] ?? k;
	}

	function pickText(c: H3ConstructDto, ...keys: string[]): string | null {
		for (const k of keys) {
			const v = (c.content as Record<string, unknown>)[k];
			if (typeof v === 'string' && v.trim().length > 0) return v;
		}
		return null;
	}

	// Run-Steuerung. H1, H2, H3 sind exklusive Heuristik-Pfade pro Run
	// (Memory `project_three_heuristics_architecture.md`). 'auto' = Server
	// nutzt den Brief-Default (h3 wenn briefH3Enabled, sonst h1); explizite
	// Wahl überschreibt. Pre-Run-Validation prüft H3-Pflicht-Funktionstypen
	// gegen die Outline-Coverage und blockiert den Run bei fehlenden Typen.
	type HeuristicChoice = 'auto' | HeuristicPath;
	let runActive = $state(false);
	// retrograde_pass = H2-Modifikator (FFN-Backprop-style 2-Pass:
	// nach Werk-Synthese werden Hauptkapitel/Subkapitel/Absatz-Memos
	// retrograd verfeinert). Toggle für Evaluation; Default aus.
	// Wirkt nur bei heuristic='h2' oder 'meta'.
	let runOptions = $state<{ heuristic: HeuristicChoice; retrograde_pass: boolean }>({
		heuristic: 'auto',
		retrograde_pass: false,
	});
	let runEvents = $state<string[]>([]);
	let runError = $state<string | null>(null);
	let runEventSource: AbortController | null = null;
	let cancellingRun = $state(false);
	let atomErrorsThisRun = $state(0);

	// Brief-Default und effektive Heuristik. h3_enabled=true im Brief →
	// Server würde 'h3' wählen, wenn der Run-Body kein heuristic-Feld setzt.
	const briefDefaultHeuristic = $derived<HeuristicPath>(
		caseInfo?.briefH3Enabled ? 'h3' : 'h1'
	);
	const effectiveHeuristic = $derived<HeuristicPath>(
		runOptions.heuristic === 'auto' ? briefDefaultHeuristic : runOptions.heuristic
	);
	const outlineCoverage = $derived(data.outlineFunctionTypeCoverage ?? {});
	const missingRequiredTypes = $derived(
		missingRequiredFunctionTypes(effectiveHeuristic, outlineCoverage)
	);
	const preRunValidationBlocks = $derived(missingRequiredTypes.length > 0);

	// error_message ist seit fail-tolerant entweder plain string (catastrophic
	// Run-Failure, z.B. Vorbedingung verletzt oder Pass-Vertrag verletzt) oder
	// JSON mit { atom_errors:[…] } (einzelne tolerable Atom-Fehler). Helfer für
	// UI: parsen, oder null.
	type AtomError = { phase: string; label: string; message: string };
	function parseAtomErrors(raw: string | null): AtomError[] | null {
		if (!raw) return null;
		try {
			const j = JSON.parse(raw);
			if (j && Array.isArray(j.atom_errors)) return j.atom_errors as AtomError[];
		} catch { /* not JSON → catastrophic message */ }
		return null;
	}
	function isCatastrophicRunError(raw: string | null): string | null {
		if (!raw) return null;
		try { JSON.parse(raw); return null; } catch { return raw; }
	}

	// Strukturierte Diagnose für Hard-Fail-Anzeige. PreconditionFailedError
	// (precondition.ts) formatiert als: "H3:${heuristic} — Vorbedingung
	// verletzt: ${missing}\n  ${diagnostic}".
	type ParsedFailure =
		| { kind: 'precondition'; heuristic: string; missing: string; diagnostic: string }
		| { kind: 'generic'; diagnostic: string };

	function parseFailureMessage(raw: string): ParsedFailure {
		// Format aus precondition.ts: "H3:HEURISTIC — Vorbedingung verletzt: MISSING\n  DIAGNOSTIC"
		const preMatch = raw.match(
			/^H3:([A-Z_]+) — Vorbedingung verletzt: ([^\n]+)\n\s*([\s\S]+)$/
		);
		if (preMatch) {
			return {
				kind: 'precondition',
				heuristic: preMatch[1],
				missing: preMatch[2].trim(),
				diagnostic: preMatch[3].trim(),
			};
		}
		return { kind: 'generic', diagnostic: raw };
	}

	async function loadPipelineStatus() {
		if (!caseInfo) return;
		pipelineLoading = true;
		pipelineError = null;
		try {
			const r = await fetch(`/api/cases/${caseInfo.id}/pipeline-status`);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			pipelineStatus = await r.json();
		} catch (e) {
			pipelineError = (e as Error).message;
		} finally {
			pipelineLoading = false;
		}
	}

	async function loadWerkConstructs() {
		if (!caseInfo) return;
		werkLoading = true;
		werkError = null;
		try {
			const r = await fetch(`/api/cases/${caseInfo.id}/h3-constructs`);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = await r.json();
			werkConstructs = j.constructs ?? [];
		} catch (e) {
			werkError = (e as Error).message;
		} finally {
			werkLoading = false;
		}
	}

	async function startOrResumeRun() {
		if (!caseInfo || runActive) return;
		runError = null;
		runEvents = [];
		atomErrorsThisRun = 0;
		runActive = true;
		const ac = new AbortController();
		runEventSource = ac;
		try {
			const r = await fetch(`/api/cases/${caseInfo.id}/pipeline/run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					...(runOptions.heuristic === 'auto' ? {} : { heuristic: runOptions.heuristic }),
					...(runOptions.retrograde_pass ? { retrograde_pass: true } : {}),
				}),
				signal: ac.signal,
			});
			if (!r.ok || !r.body) {
				// Server liefert für strukturierte Fehler JSON {code, message},
				// für SvelteKit-Default-Errors HTML — beide Fälle abfangen.
				const txt = await r.text().catch(() => '');
				let nice: string | null = null;
				try {
					const obj = JSON.parse(txt);
					if (obj?.code === 'OUTLINE_NOT_CONFIRMED') {
						nice = 'Outline noch nicht bestätigt — bitte zuerst im Outline-Tab die Kapitel-Struktur prüfen und bestätigen.';
					} else if (obj?.message) {
						nice = obj.message;
					} else if (obj?.error) {
						nice = String(obj.error);
					}
				} catch {
					// HTML-Body — versuche <title> zu greifen
					const m = txt.match(/<title>([^<]*)<\/title>/i);
					if (m) nice = m[1].trim();
				}
				throw new Error(nice ?? `HTTP ${r.status}${txt ? ': ' + txt.slice(0, 80) : ''}`);
			}
			const reader = r.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let nlIdx;
				while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
					const chunk = buffer.slice(0, nlIdx);
					buffer = buffer.slice(nlIdx + 2);
					for (const line of chunk.split('\n')) {
						if (!line.startsWith('data:')) continue;
						const payload = line.slice(5).trim();
						if (!payload) continue;
						try {
							const evt = JSON.parse(payload);
							handleRunEvent(evt);
						} catch {
							// keep silent — event corruption shouldn't kill the loop
						}
					}
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				runError = (e as Error).message;
			}
		} finally {
			runActive = false;
			runEventSource = null;
			await loadPipelineStatus();
		}
	}

	function handleRunEvent(evt: Record<string, unknown>) {
		const type = String(evt.type ?? '');
		switch (type) {
			case 'run-init':
				runEvents = [...runEvents, evt.resumed ? '↻ Run fortgesetzt' : '▸ Run gestartet'];
				break;
			case 'phase-start':
				runEvents = [
					...runEvents,
					`── Phase: ${phaseLabel(evt.phase as RunPhase)} (${evt.total} Atom${evt.total === 1 ? '' : 'e'})`,
				];
				break;
			case 'step-start':
				// step-start spammt sonst — hier nicht persistieren, step-done ist genug.
				break;
			case 'step-done': {
				const atom = evt.atom as { label: string };
				const tok = evt.tokens as { input: number; output: number };
				// SKIP-Events nicht ins Log spammen — sie wären bei einem grossen
				// Doc nach einem Fehl-Stop hunderte. Stattdessen den letzten Log-
				// Eintrag mit Skip-Counter verdichten.
				if (evt.skipped) {
					const last = runEvents[runEvents.length - 1] ?? '';
					const m = last.match(/^  \(SKIP ×(\d+) übersprungen\)$/);
					const count = m ? parseInt(m[1], 10) + 1 : 1;
					if (m) {
						runEvents = [...runEvents.slice(0, -1), `  (SKIP ×${count} übersprungen)`];
					} else {
						runEvents = [...runEvents, `  (SKIP ×1 übersprungen)`];
					}
				} else {
					runEvents = [
						...runEvents,
						`  [${evt.index}/${evt.total}] OK ${atom.label} (in=${tok.input} out=${tok.output})`,
					];
				}
				// Hard cap to prevent DOM blowup if something pathological happens.
				if (runEvents.length > 500) runEvents = runEvents.slice(-500);
				loadPipelineStatus();
				break;
			}
			case 'step-error': {
				const atom = evt.atom as { label: string };
				runEvents = [...runEvents, `  ✗ ${atom.label}: ${String(evt.message).slice(0, 200)}`];
				atomErrorsThisRun = atomErrorsThisRun + 1;
				break;
			}
			case 'paused':
				runEvents = [...runEvents, '⏸ Pausiert'];
				break;
			case 'completed':
				runEvents = [...runEvents, '✓ Run abgeschlossen'];
				break;
			case 'failed':
				runEvents = [...runEvents, `✗ Run gescheitert: ${evt.message}`];
				runError = String(evt.message ?? 'Unbekannter Fehler');
				break;
		}
	}

	async function pauseRun() {
		if (!caseInfo || cancellingRun) return;
		cancellingRun = true;
		// SSE-Stream sofort abbrechen → UI-seitig entkoppelt, runActive=false
		// kommt von selbst beim Stream-Ende. Der Server-Loop läuft noch bis
		// zum nächsten Atom-Cancel-Check (~30s bei laufendem LLM-Call), aber
		// für den User fühlt sich Pause sofort an.
		runEventSource?.abort();
		runEvents = [...runEvents, '⏸ Pause angefordert (Server stoppt nach laufendem Atom)…'];
		try {
			await fetch(`/api/cases/${caseInfo.id}/pipeline/run`, { method: 'DELETE' });
		} catch (e) {
			runError = (e as Error).message;
		} finally {
			cancellingRun = false;
		}
	}

	// Kapitelverlauf-Pass: einmalig nach abgeschlossener analytischer Hauptlinie
	// triggerbar. Synchroner POST (~10–30s). force=true beim Re-Generieren.
	let flowGenerating = $state(false);
	let flowError = $state<string | null>(null);
	async function generateChapterFlow(force: boolean) {
		if (!caseInfo || flowGenerating) return;
		flowGenerating = true;
		flowError = null;
		try {
			const r = await fetch(`/api/cases/${caseInfo.id}/chapter-flow-summary`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ force }),
			});
			if (!r.ok) {
				const txt = await r.text().catch(() => '');
				throw new Error(`HTTP ${r.status}${txt ? ': ' + txt.slice(0, 300) : ''}`);
			}
			await loadPipelineStatus();
			await invalidateAll();
		} catch (e) {
			flowError = (e as Error).message;
		} finally {
			flowGenerating = false;
		}
	}

	onMount(() => {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		const v = params.get('view') as View | null;
		if (v && VIEWS.includes(v)) view = v;
		try {
			const saved = window.localStorage.getItem(HEURISTIC_LS_KEY);
			if (saved === 'h1' || saved === 'h2' || saved === 'h3') {
				activeHeuristic = saved;
			}
		} catch (_) { /* ignore */ }
		loadPipelineStatus();
		loadWerkConstructs();
	});

	function passState(p: PassStatus): 'pending' | 'partial' | 'done' {
		if (p.completed === 0) return 'pending';
		if (p.total != null && p.completed >= p.total) return 'done';
		if (p.total == null && p.completed > 0) return 'done';
		return 'partial';
	}
	function passPercent(p: PassStatus): number {
		if (p.total == null || p.total === 0) return p.completed > 0 ? 100 : 0;
		return Math.min(100, Math.round((p.completed / p.total) * 100));
	}
	function formatLastRun(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	type H3PhaseDiagnosis = {
		state: 'done' | 'pending' | 'blocked';
		missingOutlineType: string | null;
		missingPrereqs: H3PhaseKey[];
	};
	function h3PhaseDiagnosis(
		phase: H3PhaseKey,
		passes: PipelineStatus['passes'],
		coverage: Record<string, number>
	): H3PhaseDiagnosis {
		const pass = passes[phase];
		const requiredType = H3_REQUIRED_OUTLINE_TYPE[phase] ?? null;
		const missingOutlineType =
			requiredType && (coverage[requiredType] ?? 0) === 0 ? requiredType : null;
		const prereqs = H3_PHASE_PREREQS[phase] ?? [];
		const missingPrereqs = prereqs.filter((p) => passes[p].completed === 0);
		const isDone = pass.completed > 0;
		const isBlocked = !isDone && (missingOutlineType !== null || missingPrereqs.length > 0);
		return {
			state: isDone ? 'done' : isBlocked ? 'blocked' : 'pending',
			missingOutlineType,
			missingPrereqs,
		};
	}

	function selectView(v: View) {
		view = v;
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('view', v);
		replaceState(url, $page.state);
	}

	function openReader(target: { elementId: string; argumentId?: string } | null = null) {
		readerScrollTarget = target;
		readerOpen = true;
	}
	function closeReader() {
		readerOpen = false;
		readerScrollTarget = null;
	}

	let briefMenuOpen = $state(false);
	let briefSwitching = $state(false);
	let briefSwitchError = $state<string | null>(null);

	async function selectBrief(briefId: string) {
		if (!caseInfo || briefSwitching) return;
		if (briefId === caseInfo.briefId) {
			briefMenuOpen = false;
			return;
		}
		briefSwitching = true;
		briefSwitchError = null;
		try {
			const r = await fetch(`/api/cases/${caseInfo.id}/brief`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ briefId }),
			});
			if (!r.ok) {
				const errText = await r.text().catch(() => '');
				throw new Error(`HTTP ${r.status}${errText ? ': ' + errText.slice(0, 120) : ''}`);
			}
			briefMenuOpen = false;
			await invalidateAll();
			await loadPipelineStatus();
		} catch (e) {
			briefSwitchError = (e as Error).message;
		} finally {
			briefSwitching = false;
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (!briefMenuOpen) return;
		const target = e.target as HTMLElement;
		if (!target.closest('.brief-picker')) briefMenuOpen = false;
	}

	function formatSize(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	// Outline-Daten: Heading-Hierarchie + Synthese pro Knoten.
	const mainElements = $derived(
		elements.filter((e) => e.section_kind === 'main')
	);
	const paragraphs = $derived(mainElements.filter((e) => e.element_type === 'paragraph'));

	// Effective outline (mit Level/Numbering aus loadEffectiveOutline) + Heading-Element-Lookup.
	const visibleOutline = $derived(outlineEntries.filter((e) => !e.excluded));

	// Synthesen-Tab Hx-Verfügbarkeit (Drei-Heuristiken-Architektur):
	// werk-/heading-Ebene pro Heuristik. Layout im Synthesen-Tab schaltet
	// auto auf 1-/2-/3-Spalten je nach Anzahl belegter Hx — damit der User
	// die werk-Verdikte nebeneinander lesen kann.
	//   H1: Werk-Synthese, Kapitelverlauf, Heading-Synthesen
	//   H2: Werk-Synthese-synthetic (cousin von H1, ohne argument-extraktive Stützung)
	//   H3: SYNTHESE/GESAMTERGEBNIS, SCHLUSSREFLEXION/GELTUNGSANSPRUCH,
	//        WERK_DESKRIPTION, WERK_GUTACHT — die vier Werk-Aggregate, die
	//        zusammen den Substrat-Pfad zum Schluss-Verdikt tragen
	//        (siehe docs/h3_werk_aggregate_substrate_pfad.md).
	const synthesenAvail = $derived.by(() => {
		const h1 = workSynthesis !== null || chapterFlow !== null;
		const h2 = workSynthetic !== null;
		const h3 = (werkConstructs ?? []).some(
			(c) =>
				(c.outline_function_type === 'SYNTHESE' && c.construct_kind === 'GESAMTERGEBNIS') ||
				(c.outline_function_type === 'SCHLUSSREFLEXION' && c.construct_kind === 'GELTUNGSANSPRUCH') ||
				c.outline_function_type === 'WERK_DESKRIPTION' ||
				c.outline_function_type === 'WERK_GUTACHT'
		);
		return { h1, h2, h3 };
	});
	const synthesenColCount = $derived(
		(synthesenAvail.h1 ? 1 : 0) + (synthesenAvail.h2 ? 1 : 0) + (synthesenAvail.h3 ? 1 : 0)
	);

	// Sanity-Heuristik: Heading-Texte > 200 Zeichen sind quasi immer parser-
	// fehlklassifizierte Sätze (Autor:in hat einen Absatz mit Heading-Style versehen).
	// Wenn sie nicht excluded sind, brechen sie Synthese-Boundaries und §X-Numerierung
	// — also als Banner anzeigen mit Link in den Outline-Editor.
	const SUSPICIOUS_HEADING_LEN = 200;
	const suspiciousHeadings = $derived.by(() => {
		const out: { elementId: string; level: number; preview: string; len: number }[] = [];
		for (const h of outlineEntries) {
			if (h.excluded) continue;
			const text = h.text ?? '';
			if (text.length > SUSPICIOUS_HEADING_LEN) {
				out.push({
					elementId: h.elementId,
					level: h.level,
					preview: text.slice(0, 80).trim() + '…',
					len: text.length,
				});
			}
		}
		return out;
	});

	// Resolver §X (im Kontext eines Headings) → paragraph_element_id.
	// Eine Heading-Synthese referenziert Paragraphen, die in der Synthese-Einheit
	// liegen — und das ist kongruent zu den Aggregations-Pässen:
	//   - chapter-collapse → Paragraphen vom L1 bis zum nächsten non-excluded L1
	//     (alle Subsections eingeschlossen). Siehe loadChapterUnits.
	//   - section-collapse-from-graph → Paragraphen vom L2/L3-Heading bis zum
	//     nächsten non-excluded Heading auf SAME-OR-HIGHER level (alle Sub-Subsections
	//     eingeschlossen). Siehe loadCollapseContext.
	// Excluded Headings (z.B. parser-fehlklassifizierte Pseudo-Überschriften wie
	// ein langer Satz mit Heading-Style) sind weder Synthese-Einheit noch
	// Boundary — sie werden hier ignoriert. Sonst würden §-Anchors auf Paragraphen
	// hinter einem excluded Pseudo-Heading als "dead" durchgestrichen, obwohl die
	// Synthese sie korrekt zählt.
	const outlineMetaById = $derived(
		new Map(outlineEntries.map((e) => [e.elementId, { level: e.level, excluded: e.excluded }]))
	);
	const synthesisUnitParagraphsByHeading = $derived.by(() => {
		const map = new Map<string, string[]>();
		const headingsInOrder = mainElements.filter((e) => e.element_type === 'heading');
		const allParas = mainElements.filter((e) => e.element_type === 'paragraph');
		for (let i = 0; i < headingsInOrder.length; i++) {
			const h = headingsInOrder[i];
			const meta = outlineMetaById.get(h.id);
			if (!meta || meta.excluded) continue;
			let endChar = Number.POSITIVE_INFINITY;
			for (let j = i + 1; j < headingsInOrder.length; j++) {
				const candMeta = outlineMetaById.get(headingsInOrder[j].id);
				if (!candMeta || candMeta.excluded) continue;
				if (candMeta.level <= meta.level) {
					endChar = headingsInOrder[j].char_start;
					break;
				}
			}
			const paras: string[] = [];
			for (const p of allParas) {
				if (p.char_start >= h.char_start && p.char_start < endChar) {
					paras.push(p.id);
				}
			}
			map.set(h.id, paras);
		}
		return map;
	});
	function resolveParagraph(headingId: string, paraNum: number): string | null {
		const list = synthesisUnitParagraphsByHeading.get(headingId) ?? [];
		if (paraNum < 1 || paraNum > list.length) return null;
		return list[paraNum - 1];
	}

	// ── Hover-Popover für §X:AY-Anker (Phase A: nur §X:AY, plain AY später) ──
	type Premise = { type: 'stated' | 'carried' | 'background'; text: string };
	type ArgumentNode = {
		id: string;
		argLocalId: string;
		claim: string;
		premises: Premise[];
		anchorPhrase: string;
		positionInParagraph: number;
	};
	type EdgeOther = {
		argLocalId: string;
		paragraphId: string;
		paraNumWithinChapter: number | null;
		claimSnippet: string;
	};
	type Edge = {
		kind: 'supports' | 'refines' | 'contradicts' | 'presupposes';
		scope: 'inter_argument' | 'prior_paragraph';
		direction: 'outgoing' | 'incoming';
		selfArgLocalId: string;
		other: EdgeOther;
	};
	type ParaArgsResponse = {
		paragraphId: string;
		paraNumWithinChapter: number | null;
		args: ArgumentNode[];
		edges: Edge[];
	};
	type CacheState =
		| { kind: 'pending'; promise: Promise<ParaArgsResponse> }
		| { kind: 'ok'; data: ParaArgsResponse }
		| { kind: 'error'; message: string };
	const argCache = new Map<string, CacheState>();

	let hoveredAnchor = $state<{
		paragraphId: string;
		paraNum: number;
		argNum: number | null;
		rect: DOMRect | null;
	} | null>(null);
	let popoverData = $state<{ args: ArgumentNode[]; edges: Edge[]; paraNumWithin: number | null } | null>(null);
	let popoverLoading = $state(false);
	let popoverError = $state<string | null>(null);

	let showTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	const SHOW_DELAY = 220;
	const HIDE_DELAY = 180;

	function cancelShow() { if (showTimer) { clearTimeout(showTimer); showTimer = null; } }
	function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

	async function loadParaArgs(paragraphId: string): Promise<ParaArgsResponse> {
		const cached = argCache.get(paragraphId);
		if (cached) {
			if (cached.kind === 'ok') return cached.data;
			if (cached.kind === 'pending') return cached.promise;
			throw new Error(cached.message);
		}
		if (!caseInfo) throw new Error('Kein Case');
		const promise = (async () => {
			const r = await fetch(`/api/cases/${caseInfo.id}/paragraph-arguments/${paragraphId}`);
			if (!r.ok) {
				const txt = await r.text().catch(() => '');
				throw new Error(`HTTP ${r.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
			}
			return r.json() as Promise<ParaArgsResponse>;
		})();
		argCache.set(paragraphId, { kind: 'pending', promise });
		try {
			const data = await promise;
			argCache.set(paragraphId, { kind: 'ok', data });
			return data;
		} catch (e) {
			argCache.set(paragraphId, { kind: 'error', message: (e as Error).message });
			throw e;
		}
	}

	function handleAnchorHover(
		event: MouseEvent,
		headingId: string,
		paraNum: number,
		argNum: number | null
	) {
		cancelHide();
		cancelShow();
		const target = event.currentTarget as HTMLElement;
		const paragraphId = resolveParagraph(headingId, paraNum);
		if (!paragraphId) return;
		showTimer = setTimeout(async () => {
			const rect = target.getBoundingClientRect();
			hoveredAnchor = { paragraphId, paraNum, argNum, rect };
			popoverLoading = true;
			popoverError = null;
			popoverData = null;
			try {
				const data = await loadParaArgs(paragraphId);
				if (hoveredAnchor?.paragraphId !== paragraphId) return; // hover wechselte
				popoverData = { args: data.args, edges: data.edges, paraNumWithin: data.paraNumWithinChapter };
			} catch (e) {
				if (hoveredAnchor?.paragraphId !== paragraphId) return;
				popoverError = (e as Error).message;
			} finally {
				popoverLoading = false;
			}
		}, SHOW_DELAY);
	}

	function handleAnchorLeave() {
		cancelShow();
		cancelHide();
		hideTimer = setTimeout(() => {
			hoveredAnchor = null;
			popoverData = null;
			popoverError = null;
			popoverLoading = false;
		}, HIDE_DELAY);
	}

	function handlePopoverEnter() { cancelHide(); }
	function handlePopoverLeave() { handleAnchorLeave(); }
	function closePopover() {
		cancelShow();
		cancelHide();
		hoveredAnchor = null;
		popoverData = null;
	}

	const popoverArgNode = $derived.by(() => {
		if (!hoveredAnchor || !popoverData) return null;
		const { argNum } = hoveredAnchor;
		if (argNum == null) return null;
		const target = `A${argNum}`;
		return popoverData.args.find((a) => a.argLocalId === target) ?? null;
	});

	const popoverArgEdges = $derived.by(() => {
		if (!hoveredAnchor || !popoverData || !popoverArgNode) return [];
		return popoverData.edges.filter((e) => e.selfArgLocalId === popoverArgNode.argLocalId);
	});

	// Bei plain §X (argNum null): Volltext + alle Argumente des Paragraphen.
	const popoverParagraphText = $derived.by(() => {
		if (!hoveredAnchor) return null;
		const el = elements.find((e) => e.id === hoveredAnchor!.paragraphId);
		return el?.text ?? null;
	});
	const popoverParagraphArgs = $derived.by(() => {
		if (!hoveredAnchor || !popoverData) return [];
		return popoverData.args;
	});

	function openPopoverInReader() {
		if (!hoveredAnchor) return;
		const { paragraphId, argNum } = hoveredAnchor;
		closePopover();
		openReader({ elementId: paragraphId, argumentId: argNum != null ? `A${argNum}` : undefined });
	}

	// §X(:AY)- und plain-AY-Linkifizierung: zerlegt einen Memo-Text in
	// [text, link, text, link, ...]. Plain `AY` (z.B. "A5/A6/A7" ohne §-Prefix)
	// wird über Distanz-Heuristik dem nächstgelegenen `§X` im Text zugeordnet
	// (max. 100 Zeichen Distanz, sonst als Text gerendert).
	type Segment =
		| { kind: 'text'; value: string }
		| {
				kind: 'anchor';
				raw: string;
				paraNum: number;
				argNum: number | null;
				resolvedFromContext: boolean;
		  };
	const PLAIN_AY_MAX_DISTANCE = 100;
	function parseAnchors(content: string): Segment[] {
		// Pass 1: alle §X-Positionen für Distanz-Resolver bei plain AY sammeln.
		const paraRefs: { idx: number; len: number; paraNum: number }[] = [];
		{
			const re = /§(\d+)/g;
			let m: RegExpExecArray | null;
			while ((m = re.exec(content)) !== null) {
				paraRefs.push({ idx: m.index, len: m[0].length, paraNum: parseInt(m[1], 10) });
			}
		}
		function nearestPara(ayIdx: number, ayLen: number): number | null {
			let best: number | null = null;
			let bestDist = Infinity;
			for (const p of paraRefs) {
				const dist = Math.min(
					Math.abs(p.idx - (ayIdx + ayLen)),
					Math.abs(p.idx + p.len - ayIdx)
				);
				if (dist < bestDist) {
					bestDist = dist;
					best = p.paraNum;
				}
			}
			if (best === null || bestDist > PLAIN_AY_MAX_DISTANCE) return null;
			return best;
		}

		// Pass 2: kombinierte Regex über §X(:AY) ODER plain AY (Word-Boundary).
		const segments: Segment[] = [];
		const re = /§(\d+)(?::A(\d+))?|\bA(\d+)\b/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			if (m.index > last) {
				segments.push({ kind: 'text', value: content.slice(last, m.index) });
			}
			if (m[1] !== undefined) {
				segments.push({
					kind: 'anchor',
					raw: m[0],
					paraNum: parseInt(m[1], 10),
					argNum: m[2] !== undefined ? parseInt(m[2], 10) : null,
					resolvedFromContext: false,
				});
			} else if (m[3] !== undefined) {
				const argNum = parseInt(m[3], 10);
				const resolvedPara = nearestPara(m.index, m[0].length);
				if (resolvedPara !== null) {
					segments.push({
						kind: 'anchor',
						raw: m[0],
						paraNum: resolvedPara,
						argNum,
						resolvedFromContext: true,
					});
				} else {
					segments.push({ kind: 'text', value: m[0] });
				}
			}
			last = m.index + m[0].length;
		}
		if (last < content.length) segments.push({ kind: 'text', value: content.slice(last) });
		return segments;
	}

	// Paragraph-counts pro Heading (Subkapitel-Granularität).
	const paraCountByHeading = $derived.by(() => {
		const map = new Map<string, number>();
		let currentHeadingId: string | null = null;
		for (const e of mainElements) {
			if (e.element_type === 'heading') {
				currentHeadingId = e.id;
				if (!map.has(currentHeadingId)) map.set(currentHeadingId, 0);
			} else if (e.element_type === 'paragraph' && currentHeadingId) {
				map.set(currentHeadingId, (map.get(currentHeadingId) || 0) + 1);
			}
		}
		return map;
	});

	// Coverage pro Heading: wie viele ¶ analytisch erfasst (AG-Daten) und wie
	// viele synthetisch (reflektierendes Per-¶-Memo, optionales Addendum).
	// Beide Zahlen werden separat geführt, damit die UI die richtige Pending-
	// Message wählen kann (synth ist optional, AG ist Pflicht-Hauptlinie).
	const memoCoverageByHeading = $derived.by(() => {
		const map = new Map<string, { withAg: number; withSynth: number; total: number }>();
		let currentHeadingId: string | null = null;
		for (const e of mainElements) {
			if (e.element_type === 'heading') {
				currentHeadingId = e.id;
				if (!map.has(currentHeadingId)) map.set(currentHeadingId, { withAg: 0, withSynth: 0, total: 0 });
			} else if (e.element_type === 'paragraph' && currentHeadingId) {
				const cur = map.get(currentHeadingId)!;
				cur.total += 1;
				if (paragraphHasAg[e.id]) cur.withAg += 1;
				if (memosByElement[e.id]?.some((m) => m.memo_type === 'reflektierend')) {
					cur.withSynth += 1;
				}
			}
		}
		return map;
	});

	// Mapping headingId → parent-L1-headingId. Wird für die Pending-Message
	// genutzt: ein L2-Subkapitel "gehört" semantisch zum L1, dessen
	// aggregation_subchapter_level entscheidet, ob für das L2 eine eigene
	// Synthese erzeugt wurde oder nicht.
	const parentL1ByHeading = $derived.by(() => {
		const map = new Map<string, string>();
		let currentL1: string | null = null;
		for (const h of outlineEntries) {
			if (h.level === 1) {
				currentL1 = h.elementId;
				map.set(h.elementId, h.elementId);
			} else if (currentL1) {
				map.set(h.elementId, currentL1);
			}
		}
		return map;
	});

	const totalProcessed = $derived.by(() => {
		let withMemo = 0;
		const total = paragraphs.length;
		for (const e of paragraphs) {
			// "Verarbeitet" = analytisch erfasst (AG-Hauptlinie). Das synthetische
			// Per-¶-Memo ist optional und kein Indikator für Pipeline-Fortschritt.
			if (paragraphHasAg[e.id]) withMemo += 1;
		}
		return { withMemo, total };
	});

	// Verfügbarkeit der drei Heuristiken im Doc-Tab. Eine Heuristik ist
	// "verfügbar", sobald für irgendeinen Absatz Daten dieser Heuristik
	// existieren — sonst wird die zugehörige Pille deaktiviert.
	const heuristicAvail = $derived.by(() => {
		const h1 = totalProcessed.withMemo > 0;
		let h2 = false;
		for (const memos of Object.values(memosByElement)) {
			if (memos && memos.length > 0) { h2 = true; break; }
		}
		if (!h2) {
			for (const codes of Object.values(codesByElement)) {
				if (codes && codes.length > 0) { h2 = true; break; }
			}
		}
		let h3 = false;
		for (const arr of Object.values(h3ConstructsByElement)) {
			if (arr && arr.length > 0) { h3 = true; break; }
		}
		return { h1, h2, h3 };
	});

	// Wenn die aktuell aktive Heuristik auf diesem Dokument keine Daten hat,
	// auf die erste verfügbare in H1→H2→H3-Reihenfolge fallen — auch wenn
	// der User in localStorage eine andere Wahl gespeichert hat. Die User-
	// Wahl ist eine Präferenz pro Doc, nicht ein Hard-Pin: wer auf einem
	// Doc ohne H3 landet, soll keinen leeren Reader sehen.
	$effect(() => {
		const a = heuristicAvail;
		if (!a[activeHeuristic]) {
			if (a.h1) activeHeuristic = 'h1';
			else if (a.h2) activeHeuristic = 'h2';
			else if (a.h3) activeHeuristic = 'h3';
		}
	});

	function selectHeuristic(h: DocReaderHeuristic) {
		activeHeuristic = h;
		if (browser) {
			try { window.localStorage.setItem(HEURISTIC_LS_KEY, h); } catch (_) { /* ignore quota */ }
		}
	}

	const HEURISTIC_LABEL: Record<DocReaderHeuristic, string> = {
		h1: 'H1 Argumentanalyse',
		h2: 'H2 Hermeneutische Memos',
		h3: 'H3 Funktionstypen',
	};
	const HEURISTIC_HINT: Record<DocReaderHeuristic, string> = {
		h1: 'Argumente, Beziehungen, Stützstrukturen pro Absatz (Argumentations-Graph).',
		h2: 'Formulierende & reflektierende Memos und Codes pro Absatz.',
		h3: '§-skopierte Funktionstyp-Konstrukte pro Absatz (Werk-Konstrukte siehe Outline).',
	};

	const coverageLabel = $derived.by(() => {
		if (activeHeuristic === 'h1') {
			return `${totalProcessed.withMemo}/${totalProcessed.total} ¶ analytisch erfasst`;
		}
		if (activeHeuristic === 'h2') {
			let n = 0;
			for (const e of paragraphs) {
				if ((memosByElement[e.id]?.length ?? 0) > 0 || (codesByElement[e.id]?.length ?? 0) > 0) n += 1;
			}
			return `${n}/${paragraphs.length} ¶ mit Memo/Code`;
		}
		let n = 0;
		for (const e of paragraphs) {
			if ((h3ConstructsByElement[e.id]?.length ?? 0) > 0) n += 1;
		}
		return `${n}/${paragraphs.length} ¶ mit H3-Konstrukt`;
	});

	// TOC-Sidebar: nur in Dokument- und Outline-Tabs sichtbar (in den anderen
	// Tabs gibt es keine Heading-verankerten Anker, sie wäre dort sinnlos).
	const tocVisible = $derived(
		(view === 'dokument' || view === 'outline') && visibleOutline.length > 0
	);
	let activeHeadingId = $state<string | null>(null);

	function scrollToHeading(elementId: string) {
		if (!browser) return;
		const prefix = view === 'outline' ? 'outline-node-' : 'head-';
		const el = window.document.getElementById(prefix + elementId);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// Scroll-Spy: highlightet das im Viewport oben sichtbare Heading. Beobachter
	// wird bei Tab-Wechsel oder Outline-Änderung neu aufgesetzt, weil die DOM-
	// Anker je nach Tab unterschiedliche IDs haben (head-* vs. outline-node-*).
	$effect(() => {
		if (!browser) return;
		if (!tocVisible) {
			activeHeadingId = null;
			return;
		}
		const prefix = view === 'outline' ? 'outline-node-' : 'head-';
		const headingIds = visibleOutline.map((h) => h.elementId);
		if (headingIds.length === 0) return;

		let cleanup: (() => void) | null = null;
		// rAF, weil der Tab-Inhalt evtl. gerade erst gemountet wurde.
		const raf = requestAnimationFrame(() => {
			const intersecting = new Set<string>();
			const observer = new IntersectionObserver(
				(entries) => {
					for (const e of entries) {
						if (e.isIntersecting) intersecting.add(e.target.id);
						else intersecting.delete(e.target.id);
					}
					let best: { id: string; top: number } | null = null;
					for (const id of intersecting) {
						const el = window.document.getElementById(id);
						if (!el) continue;
						const rect = el.getBoundingClientRect();
						if (!best || rect.top < best.top) best = { id, top: rect.top };
					}
					if (best) activeHeadingId = best.id.slice(prefix.length);
				},
				// Spy-Band: oberste ~25 % des Viewports.
				{ rootMargin: '0px 0px -75% 0px', threshold: 0 }
			);
			for (const id of headingIds) {
				const el = window.document.getElementById(prefix + id);
				if (el) observer.observe(el);
			}
			cleanup = () => observer.disconnect();
		});

		return () => {
			cancelAnimationFrame(raf);
			cleanup?.();
		};
	});
</script>

<svelte:window onclick={handleDocClick} />

{#snippet werkConstructBody(c: H3ConstructDto)}
	{#if c.construct_kind === 'GESAMTERGEBNIS'}
		{@const gesamt = pickText(c, 'gesamtergebnisText', 'text')}
		{@const antwort = pickText(c, 'fragestellungsAntwortText')}
		{@const integration = (c.content as { erkenntnisIntegration?: unknown[] }).erkenntnisIntegration}
		{#if gesamt}
			<p class="werk-paragraph">{gesamt}</p>
		{/if}
		{#if antwort}
			<div class="werk-subblock">
				<h5>Antwort auf die Fragestellung</h5>
				<p class="werk-paragraph">{antwort}</p>
			</div>
		{/if}
		{#if Array.isArray(integration) && integration.length > 0}
			<div class="werk-subblock">
				<h5>Erkenntnis-Integration</h5>
				<ul class="werk-list">
					{#each integration as item}
						<li>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else if c.construct_kind === 'GELTUNGSANSPRUCH'}
		{@const geltung = pickText(c, 'geltungsanspruchText', 'text')}
		{@const grenzen = pickText(c, 'grenzenText')}
		{@const anschluss = pickText(c, 'anschlussforschungText')}
		{#if geltung}
			<div class="werk-subblock">
				<h5>Geltungsanspruch</h5>
				<p class="werk-paragraph">{geltung}</p>
			</div>
		{/if}
		{#if grenzen}
			<div class="werk-subblock">
				<h5>Grenzen</h5>
				<p class="werk-paragraph">{grenzen}</p>
			</div>
		{/if}
		{#if anschluss}
			<div class="werk-subblock">
				<h5>Anschlussforschung</h5>
				<p class="werk-paragraph">{anschluss}</p>
			</div>
		{/if}
	{:else if c.construct_kind === 'WERK_BESCHREIBUNG'}
		{@const wText = pickText(c, 'werkBeschreibungText', 'text')}
		{#if wText}
			<p class="werk-paragraph">{wText}</p>
		{/if}
	{:else if c.construct_kind === 'WERK_GUTACHT'}
		{@const aText = pickText(c, 'aText')}
		{@const bText = pickText(c, 'bText')}
		{@const cText = pickText(c, 'cText')}
		{@const gatingDisabled = (c.content as { gatingDisabled?: boolean }).gatingDisabled === true}
		{#if aText}
			<div class="werk-subblock">
				<h5>a · Werk im Lichte der Fragestellung</h5>
				<p class="werk-paragraph">{aText}</p>
			</div>
		{/if}
		{#if bText}
			<div class="werk-subblock">
				<h5>b · Hotspot-Würdigung</h5>
				<p class="werk-paragraph">{bText}</p>
			</div>
		{/if}
		{#if cText}
			<div class="werk-subblock">
				<h5>c · Fazit{gatingDisabled ? ' (Gating zur Test-Phase deaktiviert)' : ''}</h5>
				<p class="werk-paragraph">{cText}</p>
			</div>
		{/if}
	{:else if c.construct_kind === 'DISKURSIV_BEZUG_BEFUND'}
		{@const blocks = (c.content as { blocks?: Array<Record<string, unknown>> }).blocks ?? []}
		{#if blocks.length === 0}
			<p class="werk-empty">Keine Bezugs-Blöcke detektiert.</p>
		{:else}
			<ul class="werk-list">
				{#each blocks as block}
					{@const signal = String(block.signal ?? '')}
					{@const bezug = String(block.bezug ?? '')}
					{@const rationale = String(block.rationale ?? '')}
					<li class="werk-bezug-item">
						<span class="werk-signal werk-signal-{signal}">{bezug}</span>
						<span class="werk-rationale">{rationale}</span>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if c.construct_kind === 'VERWEIS_PROFIL'}
		{@const density = (c.content as { density?: Record<string, number> }).density ?? {}}
		<dl class="werk-stats">
			{#if density.paragraphsWithCitation != null}
				<dt>Absätze mit Verweis</dt>
				<dd>{density.paragraphsWithCitation}{density.paragraphsWithoutCitation != null ? ` von ${(density.paragraphsWithCitation as number) + (density.paragraphsWithoutCitation as number)}` : ''}</dd>
			{/if}
			{#if density.meanCitationsPerParagraph != null}
				<dt>Verweise pro Absatz (∅)</dt>
				<dd>{(density.meanCitationsPerParagraph as number).toFixed(2)}</dd>
			{/if}
			{#if density.topAuthorShare != null}
				<dt>Top-Autor-Anteil</dt>
				<dd>{((density.topAuthorShare as number) * 100).toFixed(1)} %</dd>
			{/if}
			{#if density.top3AuthorShare != null}
				<dt>Top-3-Autoren-Anteil</dt>
				<dd>{((density.top3AuthorShare as number) * 100).toFixed(1)} %</dd>
			{/if}
		</dl>
	{:else if c.construct_kind === 'BLOCK_ROUTING'}
		{@const blocks = (c.content as { blocks?: unknown[] }).blocks ?? []}
		<p class="werk-meta">
			{blocks.length === 0 ? 'Keine Verdachts-Blöcke geroutet.' : `${blocks.length} Verdachts-Block(s) zur Würdigung geroutet.`}
		</p>
	{:else}
		{@const text = pickText(c, 'text', 'gesamtergebnisText', 'werkBeschreibungText')}
		{#if text}
			<p class="werk-paragraph">{text}</p>
		{:else}
			<details class="werk-fallback">
				<summary>Roh-Inhalt anzeigen</summary>
				<pre>{JSON.stringify(c.content, null, 2)}</pre>
			</details>
		{/if}
	{/if}
{/snippet}

<div class="page">
	<header class="doc-head">
		<div class="title-row">
			<h1>{doc.label}</h1>
		</div>
		<div class="meta">
			<span class="mono">{doc.mime_type || '—'}</span>
			<span class="mono">{formatSize(doc.file_size)}</span>
			<span class="mono">{elements.length} Elemente · {paragraphs.length} Absätze</span>

			{#if anonymization.status === 'applied' || anonymization.status === 'skipped_already_redacted'}
				<span class="anon-tag anon-ok" title={ANON_TITLE[anonKey](anonymization)}>
					🔒 {ANON_LABEL[anonKey]}
					{#if anonymization.seedCount > 0}<span class="anon-count">· {anonymization.seedCount} Seeds</span>{/if}
					<button
						class="anon-action anon-action-secondary"
						onclick={() => runAnonymization('reset')}
						disabled={anonRunning}
						title="Original-Datei neu einlesen und mit aktueller Heuristik re-anonymisieren. Nutzen, wenn die Anonymisierung mit alter Heuristik unvollständig war."
					>
						{anonRunning ? '…' : '↻ neu'}
					</button>
				</span>
			{:else if anonymization.status === 'no_candidates'}
				<span class="anon-tag anon-neutral" title={ANON_TITLE[anonKey](anonymization)}>
					Keine PII
				</span>
			{:else}
				<span class="anon-tag anon-warn" title={ANON_TITLE[anonKey](anonymization)}>
					⚠ {ANON_LABEL[anonKey]}
					<button class="anon-action" onclick={() => runAnonymization('run')} disabled={anonRunning}>
						{anonRunning ? '…' : 'Jetzt anonymisieren'}
					</button>
				</span>
			{/if}
			{#if anonError}
				<span class="anon-tag anon-warn" title={anonError}>Fehler: {anonError.slice(0, 60)}</span>
			{/if}

			{#if caseInfo}
				<span class="case-tag">case: {caseInfo.name}</span>
				<span class="brief-picker">
					<button
						class="brief-tag clickable"
						class:no-brief={!caseInfo.briefName}
						onclick={() => (briefMenuOpen = !briefMenuOpen)}
						disabled={briefSwitching}
					>
						{caseInfo.briefName ?? 'Kein Brief'} <span class="caret">▾</span>
					</button>
					{#if briefMenuOpen}
						<div class="brief-menu" role="menu">
							<div class="brief-menu-head">Brief wechseln</div>
							{#each briefOptions as opt (opt.id)}
								<button
									class="brief-menu-item"
									class:active={opt.id === caseInfo.briefId}
									onclick={() => selectBrief(opt.id)}
									disabled={briefSwitching}
								>
									<span class="bm-name">{opt.name}</span>
									<span class="bm-meta">
										{#if opt.isSystemTemplate}<span class="bm-tag">Vorlage</span>{/if}
										{#if opt.workType}<span class="bm-type">{opt.workType}</span>{/if}
									</span>
								</button>
							{/each}
							<a class="brief-menu-foot" href="/settings?tab=briefs">Brief-Library verwalten →</a>
						</div>
					{/if}
				</span>
				<span class="progress-tag">
					Analytisch erfasst: {totalProcessed.withMemo}/{totalProcessed.total} ¶
				</span>
				{#if briefSwitchError}
					<span class="brief-error">Wechsel fehlgeschlagen: {briefSwitchError}</span>
				{/if}
			{/if}
		</div>
		{#if suspiciousHeadings.length > 0}
			<div class="suspicious-banner" role="status">
				<div class="suspicious-head">
					<span class="suspicious-icon">⚠</span>
					<strong>Wahrscheinlich parser-fehlklassifizierte Heading{suspiciousHeadings.length > 1 ? 's' : ''}</strong>
					<span class="suspicious-count">{suspiciousHeadings.length}× &gt; {SUSPICIOUS_HEADING_LEN} Zeichen Heading-Text</span>
				</div>
				<p class="suspicious-msg">
					Lange Heading-Texte sind in DOCX-Dateien fast immer Absätze, die mit
					einem Heading-Style versehen wurden. Sie brechen Kapitel-Boundaries
					und die §X-Numerierung — bitte im Outline-Editor als
					<em>excluded</em> markieren.
				</p>
				<ul class="suspicious-list">
					{#each suspiciousHeadings.slice(0, 3) as s (s.elementId)}
						<li>
							<span class="lvl-tag">L{s.level}</span>
							<span class="suspicious-len">({s.len} Z.)</span>
							<span class="suspicious-preview">„{s.preview}"</span>
						</li>
					{/each}
					{#if suspiciousHeadings.length > 3}
						<li class="suspicious-more">… und {suspiciousHeadings.length - 3} weitere</li>
					{/if}
				</ul>
				<a class="suspicious-cta" href="./{doc.id}/outline">In Outline-Editor öffnen →</a>
			</div>
		{/if}
		<nav class="tabs" aria-label="Doc-Page Tabs">
			{#each VIEWS as v}
				<button
					class="tab"
					class:active={view === v}
					onclick={() => selectView(v)}
					aria-current={view === v ? 'page' : undefined}
				>
					{VIEW_LABEL[v]}
				</button>
			{/each}
			<a class="outline-link" href="./{doc.id}/outline">Inhaltsverzeichnis prüfen →</a>
		</nav>
	</header>

	<div class="tab-body" class:has-toc={tocVisible}>
		{#if tocVisible}
			<aside class="doc-toc" aria-label="Kapitel-Navigation">
				<div class="toc-head">
					<a href="/projects/{$page.params.projectId}/cases" class="toc-back">← Cases</a>
					{#if caseInfo}<div class="toc-case" title="Case">{caseInfo.name}</div>{/if}
				</div>
				<nav class="toc-nav">
					{#each visibleOutline as h (h.elementId)}
						<button
							type="button"
							class="toc-item level-{Math.min(h.level, 5)}"
							class:active={activeHeadingId === h.elementId}
							onclick={() => scrollToHeading(h.elementId)}
							title={h.text}
						>
							{#if h.numbering}<span class="toc-num">{h.numbering}</span>{/if}
							<span class="toc-text">{h.text}</span>
						</button>
					{/each}
				</nav>
			</aside>
		{/if}
		<div class="tab-main">
		{#if view === 'pipeline'}
			<section class="tab-content pipeline-tab">
				{#if !caseInfo}
					<div class="placeholder">
						<h2>Pipeline</h2>
						<p>
							Dieses Dokument ist zurzeit nicht zentrales Dokument eines Case —
							es läuft keine Pipeline darauf.
						</p>
					</div>
				{:else}
					{@const run = pipelineStatus?.run ?? null}
					{@const agEnabled = pipelineStatus?.passes.argumentation_graph.enabled !== false}
					{@const runIsLive = run && (run.status === 'running' || runActive)}
					{@const canResume = run && run.status === 'paused'}

					<div class="pipeline-head">
						<h2>Analyselauf</h2>
						<button
							class="refresh-btn"
							onclick={loadPipelineStatus}
							disabled={pipelineLoading}
						>
							{pipelineLoading ? 'Aktualisiere…' : 'Status neu laden'}
						</button>
					</div>

					{#if pipelineError}
						<div class="error-box">Status konnte nicht geladen werden: {pipelineError}</div>
					{/if}

					{#if pipelineStatus}
						{#if !agEnabled}
							<div class="brief-warn">
								Im aktuell gewählten Brief ist <code>argumentation_graph</code> auf <code>false</code> gesetzt.
								H1 produziert keine Argumente. Wechsle den Brief am
								Doc-Header, um die Pipeline zu aktivieren.
							</div>
						{/if}

						<!-- Master-Steuerung -->
						<div class="run-control">
							<div class="run-control-head">
								<div class="run-status-block">
									{#if run}
										<span class="run-status-tag run-status-{run.status}">
											{run.status === 'running'
												? (runIsLive ? 'Läuft' : 'Hängt — neu starten zum Fortsetzen')
												: run.status === 'paused'
												? 'Pausiert'
												: run.status === 'completed'
												? 'Abgeschlossen'
												: 'Fehlgeschlagen'}
										</span>
										{#if run.current_phase}
											<span class="run-phase-info">
												{PASS_LABEL[PHASE_TO_PASS[run.current_phase]]}
												{#if run.total_in_phase != null}
													· {run.current_index}/{run.total_in_phase}
												{/if}
												{#if run.last_step_label}
													· {run.last_step_label}
												{/if}
											</span>
										{/if}
									{:else}
										<span class="run-status-tag run-status-idle">Noch kein Lauf</span>
									{/if}
								</div>
								<div class="run-buttons">
									{#if runIsLive}
										<button
											class="run-btn pause"
											onclick={pauseRun}
											disabled={cancellingRun}
										>
											{cancellingRun ? 'Pausiere…' : '⏸ Pausieren'}
										</button>
									{:else}
										{#if pipelineStatus.brief?.validity_check}
											<p class="run-validity-note">
												Brief-Flag <code>validity_check</code> aktiv → der Lauf umfasst zusätzlich
												die Charity-Pass-Phase (Argument-Validität) zwischen AG und Synthesen.
											</p>
										{/if}
										<fieldset class="heuristic-radio">
											<legend>Heuristik-Pfad</legend>
											<label>
												<input
													type="radio"
													name="heuristic"
													value="auto"
													bind:group={runOptions.heuristic}
													disabled={!agEnabled}
												/>
												<span>Auto · Brief-Default ({briefDefaultHeuristic.toUpperCase()})</span>
											</label>
											<label>
												<input
													type="radio"
													name="heuristic"
													value="h1"
													bind:group={runOptions.heuristic}
													disabled={!agEnabled}
												/>
												<span>H1 · Argumentanalyse (AG → Subkapitel/Kapitel/Werk-Synthese)</span>
											</label>
											<label>
												<input
													type="radio"
													name="heuristic"
													value="h2"
													bind:group={runOptions.heuristic}
													disabled={!agEnabled}
												/>
												<span>H2 · Synthetisches Per-¶-Memo</span>
											</label>
											<label>
												<input
													type="radio"
													name="heuristic"
													value="meta"
													bind:group={runOptions.heuristic}
													disabled={!agEnabled}
												/>
												<span>Meta · Review-Synthese (H1 + H2 + Literaturbezugs-Anker)</span>
											</label>
											<label>
												<input
													type="radio"
													name="heuristic"
													value="h3"
													bind:group={runOptions.heuristic}
													disabled={!agEnabled}
												/>
												<span>H3 · Funktionstyp-orchestriert</span>
											</label>
										</fieldset>
										{#if effectiveHeuristic === 'h2' || effectiveHeuristic === 'meta'}
											<fieldset class="run-modifiers">
												<legend>H2-Modifikatoren</legend>
												<label>
													<input
														type="checkbox"
														bind:checked={runOptions.retrograde_pass}
														disabled={!agEnabled}
													/>
													<span>
														Retrograde-Pass (FFN-Backprop-style)
														<small>Nach der Werk-Synthese werden Kapitel- → Subkapitel- → Absatz-Memos top-down im Lichte der Werk-Synthese verfeinert. Forward-Memos bleiben erhalten; retrograde Memos werden parallel persistiert.</small>
													</span>
												</label>
											</fieldset>
										{/if}
										{#if preRunValidationBlocks}
											<div class="prerun-block">
												<strong>Outline unvollständig für H3</strong> — folgende Pflicht-Funktionstypen sind im Outline noch nicht vergeben:
												<ul>
													{#each missingRequiredTypes as t (t)}
														<li><code>{t}</code> ({OUTLINE_FUNCTION_TYPE_LABELS[t]})</li>
													{/each}
												</ul>
												<a class="prerun-link" href="/projects/{$page.params.projectId}/documents/{$page.params.docId}/outline">→ Outline öffnen und Funktionstypen zuweisen</a>
											</div>
										{/if}
										<button
											class="run-btn start"
											onclick={startOrResumeRun}
											disabled={!agEnabled || preRunValidationBlocks}
										>
											{canResume ? '▶ Fortsetzen' : run?.status === 'completed' ? '↻ Neu durchlaufen' : '▶ Analyselauf starten'}
										</button>
									{/if}
								</div>
							</div>
							{#if run && (run.accumulated_input_tokens > 0 || run.accumulated_output_tokens > 0)}
								<div class="run-meta-row">
									<span>Tokens: in={run.accumulated_input_tokens.toLocaleString('de-DE')} · out={run.accumulated_output_tokens.toLocaleString('de-DE')} · cache_r={run.accumulated_cache_read_tokens.toLocaleString('de-DE')}</span>
									{#if run.completed_at}
										<span>Abgeschlossen: {formatLastRun(run.completed_at)}</span>
									{:else if run.paused_at}
										<span>Pausiert: {formatLastRun(run.paused_at)}</span>
									{:else}
										<span>Gestartet: {formatLastRun(run.started_at)}</span>
									{/if}
								</div>
							{/if}
							{#if run}
								{@const persistedAtomErrors = parseAtomErrors(run.error_message)}
								{@const catastrophic = isCatastrophicRunError(run.error_message)}
								{#if catastrophic && run.status === 'failed'}
									{@const parsed = parseFailureMessage(catastrophic)}
									<div class="failure-box">
										<header class="failure-head">
											{#if parsed.kind === 'precondition'}
												<span class="failure-tag tag-precondition">Vorbedingung verletzt</span>
												<span class="failure-locus">H3:{parsed.heuristic} · {parsed.missing}</span>
											{:else}
												<span class="failure-tag tag-generic">Lauf-Fehler</span>
											{/if}
										</header>
										<p class="failure-diagnostic">{parsed.diagnostic}</p>
										<nav class="failure-actions">
											{#if parsed.kind === 'precondition'}
												<a class="failure-action" href="/projects/{$page.params.projectId}/documents/{$page.params.docId}/outline">→ Outline öffnen (Funktionstypen prüfen / umtaggen)</a>
											{/if}
											{#if parsed.kind === 'generic'}
												<a class="failure-action" href="/projects/{$page.params.projectId}/documents/{$page.params.docId}/outline">→ Outline öffnen</a>
											{/if}
										</nav>
									</div>
								{:else if persistedAtomErrors && persistedAtomErrors.length > 0}
									<details class="atom-errors" open={run.status === 'failed'}>
										<summary>
											{persistedAtomErrors.length}{persistedAtomErrors.length === 20 ? '+' : ''} Atom-Fehler{run.status === 'completed' ? ' (Run mit Fehlern abgeschlossen)' : ''}
										</summary>
										<ul class="atom-errors-list">
											{#each persistedAtomErrors as err}
												<li>
													<span class="ae-phase">{err.phase}</span>
													<span class="ae-label">{err.label}</span>
													<div class="ae-message">{err.message}</div>
												</li>
											{/each}
										</ul>
									</details>
								{/if}
							{/if}
							{#if runError}
								<div class="error-box compact">{runError}</div>
							{/if}
							{#if runEvents.length > 0}
								<details class="run-log" open={runIsLive}>
									<summary>Live-Log ({runEvents.length} Einträge)</summary>
									<pre class="run-log-body">{runEvents.join('\n')}</pre>
								</details>
							{/if}
						</div>

						<!-- H1 — Argumentanalyse -->
						<section
							class="passes-section"
							class:active-path={effectiveHeuristic === 'h1'}
						>
							<header class="passes-section-head">
								<h3>
									H1 · Argumentanalyse
									{#if effectiveHeuristic === 'h1'}
										<span class="path-tag active">aktiver Pfad</span>
									{/if}
								</h3>
								<p>
									Sequenzielle Pässe in der Reihenfolge, in der sie aufeinander aufbauen:
									Argumentations-Graph pro Absatz · {pipelineStatus.brief?.validity_check ? 'Argument-Validität (Charity-Pass) · ' : ''}Subkapitel-Synthesen · Hauptkapitel-Synthesen · Werk-Synthese.
									{#if !pipelineStatus.brief?.validity_check}
										<span class="hint-inline">Argument-Validität ist im Brief deaktiviert — siehe Karte 2.</span>
									{/if}
								</p>
							</header>
							<div class="pass-grid">
								{#each ANALYTICAL_ORDER as key, i (key)}
									{@const p = pipelineStatus.passes[key]}
									{@const isAgPass = key === 'argumentation_graph'}
									{@const isValidityPass = key === 'argument_validity'}
									{@const enabled = isValidityPass
										? p.enabled === true
										: (!isAgPass || p.enabled !== false)}
									{@const state = passState(p)}
									{@const phaseLabel = run?.current_phase && PHASE_TO_PASS[run.current_phase] === key}
									<article
										class="pass-card pass-{state}"
										class:disabled={!enabled}
										class:current={runIsLive && phaseLabel}
										class:opt-in={isValidityPass}
									>
										<header class="pass-head">
											<span class="pass-num">{i + 1}</span>
											<h4>{PASS_LABEL[key]}</h4>
											<span class="pass-state-tag tag-{state}">
												{#if isValidityPass && !enabled}
													Inaktiv
												{:else}
													{state === 'done' ? 'Abgeschlossen' : state === 'partial' ? 'Teilweise' : 'Offen'}
												{/if}
											</span>
										</header>
										<p class="pass-desc">{PASS_DESC[key]}</p>
										{#if !enabled}
											{#if isValidityPass}
												<p class="pass-note">
													Im Brief deaktiviert (validity_check=false). Aktivieren in der
													<a href="/settings?tab=briefs">Brief-Library</a> → läuft beim
													nächsten Run als zusätzliche Phase nach AG, vor Synthesen
													(≈ +1 LLM-Call pro Absatz mit Argumenten).
												</p>
											{:else}
												<p class="pass-note">Im Brief deaktiviert (argumentation_graph=false).</p>
											{/if}
										{:else}
											<div class="pass-progress">
												<div class="bar"><div class="bar-fill" style:width="{passPercent(p)}%"></div></div>
												<span class="pass-counts">
													{p.completed}{p.total != null ? ` / ${p.total}` : ''}
												</span>
											</div>
											<div class="pass-meta">
												<span class="last-run">Letzter Lauf: {formatLastRun(p.last_run)}</span>
											</div>
										{/if}
									</article>
								{/each}
							</div>
						</section>

						<!-- H2 — Synthetisch-hermeneutische Linie -->
						<section
							class="passes-section"
							class:active-path={effectiveHeuristic === 'h2'}
						>
							<header class="passes-section-head">
								<h3>
									H2 · Synthetisch-hermeneutische Linie
									{#if effectiveHeuristic === 'h2'}
										<span class="path-tag active">aktiver Pfad</span>
									{/if}
								</h3>
								<p>
									Kumulativ-sequenzielle Synthese in vier Stufen, in der jede Ebene
									nur synthetisch-getaggte Vorgänger lädt: Per-Absatz-Memos · Subkapitel-
									Synthesen · Hauptkapitel-Synthesen · Werk-Synthese. Verlaufswiedergabe
									statt Argumentations-Graph; cousin der H1-Linie, ohne argument-extraktive
									Stützung.
								</p>
							</header>
							<div class="pass-grid">
								{#each SYNTHETIC_ORDER as key, i (key)}
									{@const p = pipelineStatus.passes[key]}
									{@const state = passState(p)}
									{@const phaseLabel = run?.current_phase && PHASE_TO_PASS[run.current_phase] === key}
									<article
										class="pass-card pass-{state}"
										class:current={runIsLive && phaseLabel}
									>
										<header class="pass-head">
											<span class="pass-num">{i + 1}</span>
											<h4>{PASS_LABEL[key]}</h4>
											<span class="pass-state-tag tag-{state}">
												{state === 'done' ? 'Abgeschlossen' : state === 'partial' ? 'Teilweise' : 'Offen'}
											</span>
										</header>
										<p class="pass-desc">{PASS_DESC[key]}</p>
										<div class="pass-progress">
											<div class="bar"><div class="bar-fill" style:width="{passPercent(p)}%"></div></div>
											<span class="pass-counts">
												{p.completed}{p.total != null ? ` / ${p.total}` : ''}
											</span>
										</div>
										<div class="pass-meta">
											<span class="last-run">Letzter Lauf: {formatLastRun(p.last_run)}</span>
										</div>
									</article>
								{/each}
							</div>
						</section>

						<!-- H3 — Funktionstyp-orchestrierte Heuristiken -->
						<section
							class="passes-section h3-section"
							class:active-path={effectiveHeuristic === 'h3'}
						>
							<header class="passes-section-head">
								<h3>
									H3 · Funktionstyp-orchestrierte Heuristiken
									{#if effectiveHeuristic === 'h3'}
										<span class="path-tag active">aktiver Pfad</span>
									{/if}
								</h3>
								<p>
									Werk-aggregierte Heuristiken in der Cross-Typ-Reihenfolge, in der die
									Konstrukte aufeinander aufbauen. Jede Karte erzeugt ein eigenes
									Output-Konstrukt am jeweiligen Funktionstyp-Container.
									Exkurs steht am Ende, weil sein Ort im Werk variabel ist.
									{#if pipelineStatus.brief && !pipelineStatus.brief.h3_enabled}
										<span class="hint-inline">H3 ist im Brief nicht aktiviert — Karten zeigen den DB-Stand,
										der Lauf nutzt aber den Brief-Default-Pfad.</span>
									{/if}
								</p>
							</header>
							<div class="pass-grid">
								{#each H3_ORDER as key, i (key)}
									{@const p = pipelineStatus.passes[key]}
									{@const diag = h3PhaseDiagnosis(key, pipelineStatus.passes, outlineCoverage)}
									{@const isCurrent = run?.current_phase === key && runIsLive}
									<article
										class="pass-card pass-{diag.state}"
										class:current={isCurrent}
									>
										<header class="pass-head">
											<span class="pass-num h3">{i + 1}</span>
											<h4>{H3_PHASE_LABEL[key]}</h4>
											<span class="pass-state-tag tag-{diag.state}">
												{#if diag.state === 'done'}
													Vorhanden
												{:else if diag.state === 'blocked'}
													Vorbedingung fehlt
												{:else}
													Offen
												{/if}
											</span>
										</header>
										<p class="pass-desc">{H3_PHASE_DESC[key]}</p>
										{#if diag.state === 'blocked'}
											<div class="precondition-block">
												{#if diag.missingOutlineType}
													<p>
														Outline-Funktionstyp <code>{diag.missingOutlineType}</code>
														({OUTLINE_FUNCTION_TYPE_LABELS[diag.missingOutlineType as OutlineFunctionType]})
														ist im Werk nicht vergeben.
														<a href="/projects/{$page.params.projectId}/documents/{$page.params.docId}/outline">→ Outline öffnen</a>
													</p>
												{/if}
												{#if diag.missingPrereqs.length > 0}
													<p>
														Vorgelagerte H3-Phasen fehlen:
														{#each diag.missingPrereqs as prereq, j (prereq)}
															<code>{H3_PHASE_LABEL[prereq]}</code>{j < diag.missingPrereqs.length - 1 ? ', ' : ''}
														{/each}
													</p>
												{/if}
											</div>
										{:else}
											<div class="pass-meta">
												<span class="last-run">Letzter Lauf: {formatLastRun(p.last_run)}</span>
											</div>
										{/if}
									</article>
								{/each}
							</div>
						</section>

						<!-- Auf Anforderung: Kapitelverlauf -->
						{@const flowReady = pipelineStatus.passes.chapter.completed > 0
							&& pipelineStatus.passes.work.completed > 0}
						{@const flowDone = pipelineStatus.passes.kapitelverlauf.completed > 0}
						<section class="passes-section on-demand">
							<header class="passes-section-head">
								<h3>
									Auf Anforderung
									<span class="addendum-tag">einzelner Klick · Opus</span>
								</h3>
								<p>
									Zusätzliche Bausteine, die auf Klick erzeugt werden — kein
									Pflichtbestandteil der Pipeline.
								</p>
							</header>
							<article class="pass-card pass-{flowDone ? 'done' : 'pending'} pass-on-demand">
								<header class="pass-head">
									<span class="pass-num add">↦</span>
									<h4>Kapitelverlauf-Darstellung</h4>
									<span class="pass-state-tag tag-{flowDone ? 'done' : 'pending'}">
										{flowDone ? 'Erzeugt' : 'Offen'}
									</span>
								</header>
								<p class="pass-desc">
									Narrativ-referierender Mittelabsatz des Gutachtens: führt durch die
									Kapitelfolge mit eingestreuten Wertungen, kalibriert in Länge am Werktyp.
									Wird im Outline-Tab unter dem Werk-Verdikt angezeigt.
								</p>
								{#if !flowReady}
									<p class="pass-note">
										Erst verfügbar, wenn Hauptkapitel-Synthesen UND Werk-Synthese
										abgeschlossen sind ({pipelineStatus.passes.chapter.completed}/{pipelineStatus.passes.chapter.total ?? '?'} Kap. · {pipelineStatus.passes.work.completed}/1 Werk).
									</p>
								{/if}
								<div class="pass-actions">
									<button
										class="run-btn start"
										onclick={() => generateChapterFlow(flowDone)}
										disabled={!flowReady || flowGenerating}
									>
										{#if flowGenerating}
											…erzeuge
										{:else if flowDone}
											↻ Neu erzeugen
										{:else}
											▶ Kapitelverlauf erzeugen
										{/if}
									</button>
								</div>
								{#if flowError}
									<div class="error-box compact">{flowError}</div>
								{/if}
								{#if flowDone && pipelineStatus.passes.kapitelverlauf.last_run}
									<div class="pass-meta">
										<span class="last-run">Letzter Lauf: {formatLastRun(pipelineStatus.passes.kapitelverlauf.last_run)}</span>
									</div>
								{/if}
							</article>
						</section>

					{:else if !pipelineLoading}
						<p class="empty">Noch keine Statusdaten geladen.</p>
					{/if}
				{/if}
			</section>
		{:else if view === 'dokument'}
			<section class="tab-content dokument-tab">
				{#if !caseInfo}
					<div class="placeholder">
						<h2>Dokument-Ansicht</h2>
						<p>
							Dokumentenzentrierte Volltext-Ansicht mit Argumenten, Beziehungen,
							Stützstrukturen und Codes pro Absatz. Voraussetzung: ein Case mit
							ausgeführter Argumentations-Graph-Pipeline.
						</p>
					</div>
				{:else if !heuristicAvail.h1 && !heuristicAvail.h2 && !heuristicAvail.h3}
					<div class="placeholder">
						<h2>Noch keine Analyse-Daten</h2>
						<p>
							Die Dokument-Ansicht zeigt eine Heuristik (H1 Argumentanalyse,
							H2 hermeneutische Memos oder H3 Funktionstypen) pro Absatz an,
							sobald die jeweilige Pipeline gelaufen ist. Wechsle zum
							<button class="link-btn" onclick={() => selectView('pipeline')}>Pipeline-Tab</button>,
							um einen Run zu starten.
						</p>
					</div>
				{:else}
					<!-- XOR-Heuristik-Header: pro Run-Trigger genau eine Heuristik
						 (Drei-Heuristiken-Architektur). Sticky, damit beim Scrollen
						 durch das Dokument die Wahl sichtbar bleibt. Verfügbarkeit
						 dynamisch — Pillen ohne Daten sind grau und nicht klickbar. -->
					<div class="heuristic-header">
						<div class="heuristic-pills" role="tablist" aria-label="Heuristik wählen">
							<button
								type="button"
								class="heuristic-pill"
								class:active={activeHeuristic === 'h1'}
								disabled={!heuristicAvail.h1}
								role="tab"
								aria-selected={activeHeuristic === 'h1'}
								title={HEURISTIC_HINT.h1}
								onclick={() => selectHeuristic('h1')}
							>{HEURISTIC_LABEL.h1}</button>
							<button
								type="button"
								class="heuristic-pill"
								class:active={activeHeuristic === 'h2'}
								disabled={!heuristicAvail.h2}
								role="tab"
								aria-selected={activeHeuristic === 'h2'}
								title={HEURISTIC_HINT.h2}
								onclick={() => selectHeuristic('h2')}
							>{HEURISTIC_LABEL.h2}</button>
							<button
								type="button"
								class="heuristic-pill"
								class:active={activeHeuristic === 'h3'}
								disabled={!heuristicAvail.h3}
								role="tab"
								aria-selected={activeHeuristic === 'h3'}
								title={HEURISTIC_HINT.h3}
								onclick={() => selectHeuristic('h3')}
							>{HEURISTIC_LABEL.h3}</button>
						</div>
						<span class="coverage-tag heuristic-coverage">{coverageLabel}</span>
					</div>
					<div class="dokument-intro">
						<p>{HEURISTIC_HINT[activeHeuristic]}</p>
					</div>
					<DocumentReader
						{elements}
						{memosByElement}
						{codesByElement}
						{synthesesByHeading}
						{analysisByElement}
						{h3ConstructsByElement}
						{activeHeuristic}
					/>
				{/if}
			</section>
		{:else if view === 'outline'}
			<section class="tab-content outline-tab">
				{#if visibleOutline.length === 0}
					<div class="placeholder">
						<h2>Synthesen</h2>
						<p>
							Keine Hauptkapitel-Headings im Dokument erkannt. Prüfe das
							Inhaltsverzeichnis über den Link oben.
						</p>
					</div>
				{:else}
					{#if synthesenColCount > 0}
						<div class="synthesen-grid" data-cols={synthesenColCount}>
							{#if synthesenAvail.h1}
								<div class="synthesen-col">
									<div class="export-bar export-bar-col" title="H1-Synthese (Werk-Synthese + Kapitelverlauf) als Datei herunterladen.">
										<span class="export-bar-label">H1 ↓</span>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=docx&heuristic=h1`} download>DOCX</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=pdf&heuristic=h1`} download>PDF</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=md&heuristic=h1`} download>MD</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=json&heuristic=h1`} download>JSON</a>
									</div>
									{#if workSynthesis}
										<article class="work-verdict">
											<header class="work-verdict-head">
												<span class="work-tag">H1 · Gesamtverdikt</span>
												<h2>Werk-Synthese</h2>
											</header>
											<div class="work-content">{workSynthesis.content}</div>
										</article>
									{/if}
									{#if chapterFlow}
										<article class="work-verdict chapter-flow">
											<header class="work-verdict-head">
												<span class="work-tag flow-tag">H1 · Kapitelverlauf</span>
												<h2>Argumentations­bewegung über die Kapitelfolge</h2>
											</header>
											<div class="work-content">{chapterFlow.content}</div>
										</article>
									{/if}
								</div>
							{/if}
							{#if synthesenAvail.h2 && workSynthetic}
								<div class="synthesen-col">
									<div class="export-bar export-bar-col" title="H2-Synthese (synthetisch-hermeneutisches Verdikt) als Datei herunterladen.">
										<span class="export-bar-label">H2 ↓</span>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=docx&heuristic=h2`} download>DOCX</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=pdf&heuristic=h2`} download>PDF</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=md&heuristic=h2`} download>MD</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=json&heuristic=h2`} download>JSON</a>
									</div>
									<article class="work-verdict">
										<header class="work-verdict-head">
											<span class="work-tag">H2 · Synthetisches Verdikt</span>
											<h2>Werk-Synthese (synthetisch-hermeneutisch)</h2>
										</header>
										<div class="work-content">{workSynthetic.content}</div>
										{#if workSynthetic.auffaelligkeiten.length > 0}
											<details class="auff-block">
												<summary>Werkweite Auffälligkeiten ({workSynthetic.auffaelligkeiten.length})</summary>
												<ul class="auff-list">
													{#each workSynthetic.auffaelligkeiten as a, idx (idx)}
														<li><span class="auff-scope">[{a.scope}]</span> {a.observation}</li>
													{/each}
												</ul>
											</details>
										{/if}
									</article>
								</div>
							{/if}
							{#if synthesenAvail.h3}
								<div class="synthesen-col">
									<div class="export-bar export-bar-col" title="H3-Synthese (Werk-Aggregate aus SYNTHESE/SCHLUSSREFLEXION + Werk-Beschreibung + Werk-Gutachten) als Datei herunterladen.">
										<span class="export-bar-label">H3 ↓</span>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=docx&heuristic=h3`} download>DOCX</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=pdf&heuristic=h3`} download>PDF</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=md&heuristic=h3`} download>MD</a>
										<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=json&heuristic=h3`} download>JSON</a>
									</div>
									<!--
										Reihenfolge des Substrat-Pfades zum Schluss-Verdikt
										(siehe docs/h3_werk_aggregate_substrate_pfad.md):
										  1. SYNTHESE/GESAMTERGEBNIS   — Werk-Antwort + Befund-Integration
										  2. SCHLUSSREFLEXION/GELTUNGSANSPRUCH — Geltung + Grenzen + Anschlussforschung
										  3. WERK_DESKRIPTION         — deskriptive Meta-Reflexion
										  4. WERK_GUTACHT             — Critical-Friend-Würdigung (a/b/c)
										Die ersten beiden sind direkte Werk-Texte; 3+4 reflektieren über sie.
									-->
									{#each (werkConstructs ?? []).filter((c) => c.outline_function_type === 'SYNTHESE' && c.construct_kind === 'GESAMTERGEBNIS') as c (c.id)}
										{@const antwort = pickText(c, 'fragestellungsAntwortText')}
										{@const gesamt = pickText(c, 'gesamtergebnisText', 'text')}
										{@const integration = (c.content as { erkenntnisIntegration?: unknown[] }).erkenntnisIntegration}
										{@const integrationItems = Array.isArray(integration) ? integration as Array<{ befundId?: string; befundSnippet?: string; integriert?: boolean; hinweis?: string; synthesisAnchorParagraphId?: string | null }> : []}
										{@const integrated = integrationItems.filter((i) => i.integriert === true)}
										{@const notIntegrated = integrationItems.filter((i) => i.integriert === false)}
										{#if antwort || gesamt || integrationItems.length > 0}
											<article class="work-verdict">
												<header class="work-verdict-head">
													<span class="work-tag">H3 · Werk-Aggregat</span>
													<h2>Synthese — Gesamtergebnis</h2>
												</header>
												<div class="work-content">
													{#if antwort}
														<div class="werk-subblock">
															<h5>Antwort auf die Fragestellung</h5>
															<p class="werk-paragraph">{antwort}</p>
														</div>
													{/if}
													{#if gesamt}
														<div class="werk-subblock">
															<h5>Gesamtergebnis</h5>
															<p class="werk-paragraph">{gesamt}</p>
														</div>
													{/if}
													{#if integrationItems.length > 0}
														<div class="werk-subblock">
															<h5>Erkenntnis-Integration ({integrated.length}/{integrationItems.length} Befunde integriert)</h5>
															<ul class="werk-integration-list">
																{#each integrationItems as item, idx (item.befundId ?? idx)}
																	<li class="werk-integration-item" class:integrated={item.integriert === true} class:not-integrated={item.integriert === false}>
																		<span class="werk-integration-marker" title={item.integriert === true ? 'In die Synthese integriert' : 'Nicht in die Synthese integriert'}>{item.integriert === true ? '✓' : '✗'}</span>
																		<div class="werk-integration-body">
																			{#if item.befundSnippet}
																				<div class="werk-integration-snippet">{item.befundSnippet}</div>
																			{/if}
																			{#if item.hinweis}
																				<div class="werk-integration-hinweis">{item.hinweis}</div>
																			{/if}
																		</div>
																	</li>
																{/each}
															</ul>
															{#if notIntegrated.length > 0}
																<p class="werk-meta">{notIntegrated.length} Befund{notIntegrated.length === 1 ? '' : 'e'} bleib{notIntegrated.length === 1 ? 't' : 'en'} unverbunden mit der Synthese — Hotspot-Material für die Werk-Würdigung.</p>
															{/if}
														</div>
													{/if}
												</div>
											</article>
										{/if}
									{/each}
									{#each (werkConstructs ?? []).filter((c) => c.outline_function_type === 'SCHLUSSREFLEXION' && c.construct_kind === 'GELTUNGSANSPRUCH') as c (c.id)}
										{@const geltung = pickText(c, 'geltungsanspruchText', 'text')}
										{@const grenzen = pickText(c, 'grenzenText')}
										{@const anschluss = pickText(c, 'anschlussforschungText')}
										{#if geltung || grenzen || anschluss}
											<article class="work-verdict">
												<header class="work-verdict-head">
													<span class="work-tag">H3 · Werk-Aggregat</span>
													<h2>Schlussreflexion — Geltungsanspruch</h2>
												</header>
												<div class="work-content">
													{#if geltung}
														<div class="werk-subblock">
															<h5>Geltungsanspruch</h5>
															<p class="werk-paragraph">{geltung}</p>
														</div>
													{/if}
													{#if grenzen}
														<div class="werk-subblock">
															<h5>Grenzen</h5>
															<p class="werk-paragraph">{grenzen}</p>
														</div>
													{/if}
													{#if anschluss}
														<div class="werk-subblock">
															<h5>Anschlussforschung</h5>
															<p class="werk-paragraph">{anschluss}</p>
														</div>
													{/if}
												</div>
											</article>
										{/if}
									{/each}
									{#each (werkConstructs ?? []).filter((c) => c.outline_function_type === 'WERK_DESKRIPTION') as c (c.id)}
										{@const text = pickText(c, 'werkBeschreibungText', 'text')}
										{#if text}
											<article class="work-verdict">
												<header class="work-verdict-head">
													<span class="work-tag">H3 · Beschreibung</span>
													<h2>Werk-Beschreibung</h2>
												</header>
												<div class="work-content">{text}</div>
											</article>
										{/if}
									{/each}
									{#each (werkConstructs ?? []).filter((c) => c.outline_function_type === 'WERK_GUTACHT') as c (c.id)}
										{@const aText = pickText(c, 'aText')}
										{@const bAxesRaw = (c.content as { bAxes?: unknown[] }).bAxes}
										{@const bAxes = Array.isArray(bAxesRaw) ? bAxesRaw as Array<{ axisName?: string; indicator?: 'yellow' | 'red' | null; rationale?: string }> : []}
										{@const cText = pickText(c, 'cText')}
										{@const gatingDisabled = (c.content as { gatingDisabled?: boolean }).gatingDisabled === true}
										{#if aText || bAxes.length > 0 || cText}
											<article class="work-verdict">
												<header class="work-verdict-head">
													<span class="work-tag">H3 · Würdigung (Critical Friend)</span>
													<h2>Werk-Gutachten</h2>
												</header>
												<div class="work-content">
													{#if aText}
														<div class="werk-subblock">
															<h5>a · Werk im Lichte der Fragestellung</h5>
															<p class="werk-paragraph">{aText}</p>
														</div>
													{/if}
													{#if bAxes.length > 0}
														<div class="werk-subblock">
															<h5>b · Hotspot-Würdigung (pro Funktionstyp-Achse)</h5>
															<ul class="werk-axes-list">
																{#each bAxes as axis, idx (idx)}
																	{@const ind = axis.indicator === 'red' || axis.indicator === 'yellow' ? axis.indicator : null}
																	<li class="werk-axis-item">
																		<div class="werk-axis-head">
																			<span class="werk-axis-name">{axis.axisName ?? 'Achse'}</span>
																			{#if ind}
																				<span class="werk-signal werk-signal-{ind}" title={ind === 'red' ? 'Hotspot — Hinweis auf strukturellen Befund' : 'Hotspot — ambivalente Beobachtung'}>{ind === 'red' ? 'Hotspot' : 'Ambivalent'}</span>
																			{:else}
																				<span class="werk-signal werk-signal-neutral" title="Kein Hotspot — Beobachtung ohne Indikator">unauffällig</span>
																			{/if}
																		</div>
																		{#if axis.rationale}
																			<p class="werk-paragraph">{axis.rationale}</p>
																		{/if}
																	</li>
																{/each}
															</ul>
														</div>
													{/if}
													{#if cText}
														<div class="werk-subblock">
															<h5>c · Fazit{gatingDisabled ? ' (Gating zur Test-Phase deaktiviert — eigentlich gegated durch eigenen Review-Draft)' : ''}</h5>
															<p class="werk-paragraph">{cText}</p>
														</div>
													{/if}
												</div>
											</article>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
					<p class="outline-intro">
						Hierarchische Synthesen-Navigation. Klick auf §X:AY-Anker in
						einer Synthese öffnet den Reader-Modal an der entsprechenden
						Stelle.
					</p>
					<div class="outline-list">
						{#each visibleOutline as h (h.elementId)}
							{@const synthesis = synthesesByHeading[h.elementId]}
							{@const cov = memoCoverageByHeading.get(h.elementId)}
							{@const indent = Math.min(h.level, 5) - 1}
							{@const parentL1 = parentL1ByHeading.get(h.elementId)}
							{@const parentAggLevel = parentL1 ? aggregationLevelByL1[parentL1] : undefined}
							{@const eingefasst = h.level > 1 && parentAggLevel === 1 && !synthesis}
							<article class="outline-node level-{Math.min(h.level, 5)}" style:--indent="{indent}" id="outline-node-{h.elementId}">
								<header class="outline-node-head">
									<span class="lvl-tag">L{h.level}</span>
									{#if h.numbering}
										<span class="num-tag">{h.numbering}</span>
									{/if}
									<h3 class="outline-heading">{h.text}</h3>
									{#if cov && cov.total > 0}
										<span class="coverage-tag" class:done={cov.withAg === cov.total}>
											{cov.withAg}/{cov.total} ¶
										</span>
									{/if}
								</header>
								{#if synthesis}
									<div class="synthesis">
										<div class="synth-label">Kontextualisierende Synthese</div>
										<div class="synth-content">
											{#each parseAnchors(synthesis.content) as seg}
												{#if seg.kind === 'text'}{seg.value}{:else}
													{@const targetId = resolveParagraph(h.elementId, seg.paraNum)}
													<button
														type="button"
														class="anchor-link"
														class:dead={!targetId}
														class:resolved-context={seg.resolvedFromContext}
														title={targetId
															? seg.resolvedFromContext
																? `${seg.raw} kontextuell aufgelöst zu §${seg.paraNum}:A${seg.argNum} · Hover für Detail · Click öffnet Reader`
																: `Hover für Argument-Detail · Click öffnet Reader am ${seg.raw}`
															: `Kein Absatz §${seg.paraNum} in diesem Abschnitt`}
														onclick={() => targetId && openReader({ elementId: targetId, argumentId: seg.argNum != null ? `A${seg.argNum}` : undefined })}
														onmouseenter={(e) => targetId && handleAnchorHover(e, h.elementId, seg.paraNum, seg.argNum)}
														onmouseleave={() => targetId && handleAnchorLeave()}
														onfocus={(e) => targetId && handleAnchorHover(e as unknown as MouseEvent, h.elementId, seg.paraNum, seg.argNum)}
														onblur={() => targetId && handleAnchorLeave()}
													>{seg.raw}</button>
												{/if}
											{/each}
										</div>
									</div>
								{:else if eingefasst}
									<p class="synth-pending">
										In Hauptkapitel-Synthese eingefasst — die Subkapitel dieses Hauptkapitels waren im Schnitt zu klein für eigene Synthesen, daher direkt auf L1-Ebene aggregiert.
									</p>
								{:else if (cov?.total ?? 0) > 0 && cov && cov.withAg === cov.total}
									<p class="synth-pending">
										Argumentations-Graph erfasst ({cov.withAg}/{cov.total} ¶), Section-Collapse steht noch aus.
									</p>
								{:else if (cov?.total ?? 0) > 0}
									<p class="synth-pending">
										Argumentations-Graph läuft noch ({cov?.withAg}/{cov?.total} ¶ erfasst).
									</p>
								{:else}
									<p class="synth-pending">Noch keine Daten zu diesem Abschnitt.</p>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{:else if view === 'meta'}
			<section class="tab-content meta-tab">
				{#if !workMeta}
					<div class="placeholder">
						<h2>Meta-Synthese</h2>
						<p>
							Noch keine Meta-Synthese vorhanden. Sie entsteht im Composite-Run
							<strong>Meta · Review-Synthese (H1 + H2 + Literaturbezugs-Anker)</strong>
							als terminales Glied nach H1 und H2 — wählbar im Pipeline-Tab.
						</p>
						<p class="meta-intro">
							Die Meta-Synthese spannt eine vier-schritt-Prosa über die beiden
							Hauptlinien (positive Werkhypothese · geteilte Defizithypothese ·
							H1↔H2-Differenz · Synthesehypothese) und benennt drei
							Argumente, deren Literaturbezug für ein finales Gutachten
							verifiziert werden sollte.
						</p>
					</div>
				{:else}
					<div class="meta-export-bar" title="Meta-Synthese (Vier-Schritte-Prosa) als Datei herunterladen.">
						<span class="export-bar-label">Meta ↓</span>
						<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=docx&heuristic=meta`} download>DOCX</a>
						<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=md&heuristic=meta`} download>MD</a>
						<a class="export-link" href={`/api/projects/${$page.params.projectId}/documents/${$page.params.docId}/outline/export?format=json&heuristic=meta`} download>JSON</a>
					</div>
					<p class="meta-intro">
						Review-Synthese aus H1 (analytisch) und H2 (synthetisch-hermeneutisch).
						Critical-Friend-Lesart — Diskussionsgrundlage, kein Verdikt.
					</p>
					<article class="meta-block">
						<header class="meta-block-head">
							<span class="meta-tag">1 · Positive Werkhypothese</span>
						</header>
						<div class="meta-content">{workMeta.syntheseParts.positive_werkhypothese}</div>
					</article>
					<article class="meta-block">
						<header class="meta-block-head">
							<span class="meta-tag">2 · Geteilte Defizithypothese</span>
						</header>
						<div class="meta-content">{workMeta.syntheseParts.defizit_hypothese}</div>
					</article>
					<article class="meta-block">
						<header class="meta-block-head">
							<span class="meta-tag">3 · H1 ↔ H2 — Differenz</span>
						</header>
						<div class="meta-content">{workMeta.syntheseParts.h1_h2_differenz}</div>
					</article>
					<article class="meta-block">
						<header class="meta-block-head">
							<span class="meta-tag">4 · Synthesehypothese</span>
						</header>
						<div class="meta-content">{workMeta.syntheseParts.synthese_hypothese}</div>
					</article>
					{#if workMeta.factCheckAnchors.length > 0}
						<section class="fact-check-block">
							<header class="fact-check-head">
								<h3>Literaturbezugs-Anker</h3>
								<p class="fact-check-intro">
									Drei Argumente, deren Literaturbezug vor einem finalen
									Gutachten verifiziert werden sollte. Klick auf §-Referenz
									öffnet den Reader an der entsprechenden Stelle.
								</p>
							</header>
							<ol class="fact-check-list">
								{#each workMeta.factCheckAnchors as anchor (anchor.argumentNodeId)}
									{@const paraAnalysis = analysisByElement[anchor.paragraphId]}
									{@const arg = paraAnalysis?.args.find((a) => a.id === anchor.argumentNodeId)}
									{@const argLocalId = arg?.argLocalId}
									<li class="fact-check-item">
										<div class="fact-check-claim">
											<button
												type="button"
												class="anchor-link"
												title={argLocalId
													? `Reader öffnen an §${anchor.paragraphIndex}:${argLocalId}`
													: `Reader öffnen an §${anchor.paragraphIndex}`}
												onclick={() => openReader({ elementId: anchor.paragraphId, argumentId: argLocalId })}
											>§{anchor.paragraphIndex}{argLocalId ? `:${argLocalId}` : ''}</button>
											<span class="fact-check-claim-text">{anchor.argumentClaim}</span>
										</div>
										<div class="fact-check-rationale">{anchor.rationale}</div>
									</li>
								{/each}
							</ol>
						</section>
					{/if}
				{/if}
			</section>
		{:else}
			<section class="tab-content companions-tab">
				<div class="placeholder">
					<h2>Begleitdokumente</h2>
					<p>
						Annotation-Dokument (Reviewer-Notes) und Gutachtenentwurf werden in
						Phase B der Falltyp-Erweiterung (Stufe 3) als rollen-getypte Slots
						integriert. Heute leer.
					</p>
				</div>
			</section>
		{/if}
		</div>
	</div>
</div>

<ReaderModal
	open={readerOpen}
	onClose={closeReader}
	document={doc}
	{elements}
	{caseInfo}
	{memosByElement}
	{codesByElement}
	{synthesesByHeading}
	{analysisByElement}
	scrollTarget={readerScrollTarget}
/>

{#if hoveredAnchor}
	<ArgumentPopover
		anchorRect={hoveredAnchor.rect}
		argLocalId={hoveredAnchor.argNum != null ? `A${hoveredAnchor.argNum}` : null}
		paraNum={hoveredAnchor.paraNum}
		loading={popoverLoading}
		error={popoverError}
		argumentNode={popoverArgNode}
		edges={popoverArgEdges}
		paragraphText={popoverParagraphText}
		paragraphArgs={popoverParagraphArgs}
		onOpenInReader={openPopoverInReader}
		onClose={closePopover}
		onMouseEnter={handlePopoverEnter}
		onMouseLeave={handlePopoverLeave}
	/>
{/if}

<style>
	.page { padding: 2rem; max-width: 1400px; margin: 0 auto; }

	.doc-head { margin-bottom: 1.5rem; border-bottom: 1px solid #2a2d3a; padding-bottom: 0.5rem; }
	.title-row { display: flex; align-items: center; gap: 1rem; }
	.title-row h1 { flex: 1; font-size: 1.4rem; margin: 0 0 0.5rem; color: #e1e4e8; }
	/* TODO cleanup: dead style — Button "Volltext öffnen" wurde entfernt, Selektor ungenutzt. */
	.reader-btn {
		background: rgba(165, 180, 252, 0.10);
		border: 1px solid rgba(165, 180, 252, 0.4);
		color: #c7d2fe;
		padding: 0.4rem 0.85rem; font-size: 0.8rem;
		border-radius: 4px; cursor: pointer; font-family: inherit;
	}
	.reader-btn:hover {
		background: rgba(165, 180, 252, 0.18);
		border-color: rgba(165, 180, 252, 0.65);
	}

	.meta { display: flex; flex-wrap: wrap; gap: 0.6rem; font-size: 0.78rem; color: #6b7280; margin-bottom: 0.7rem; align-items: center; }
	.mono { font-family: 'JetBrains Mono', monospace; }
	.case-tag, .brief-tag, .progress-tag {
		font-size: 0.72rem; padding: 0.15rem 0.5rem;
		border-radius: 4px;
	}
	.case-tag { background: rgba(110, 231, 183, 0.10); color: #6ee7b7; border: 1px solid rgba(110, 231, 183, 0.25); }
	.brief-tag { background: rgba(165, 180, 252, 0.08); color: #a5b4fc; border: 1px solid rgba(165, 180, 252, 0.2); }
	.progress-tag { background: rgba(251, 191, 36, 0.08); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2); }

	.anon-tag {
		font-size: 0.72rem; padding: 0.15rem 0.5rem;
		border-radius: 4px;
		display: inline-flex; align-items: center; gap: 0.4rem;
	}
	.anon-tag.anon-ok    { background: rgba(110, 231, 183, 0.10); color: #6ee7b7; border: 1px solid rgba(110, 231, 183, 0.25); }
	.anon-tag.anon-neutral { background: rgba(148, 163, 184, 0.08); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); }
	.anon-tag.anon-warn  { background: rgba(248, 113, 113, 0.10); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.30); }
	.anon-count { opacity: 0.7; font-size: 0.95em; }
	.anon-action {
		background: transparent; border: 1px solid currentColor;
		color: inherit; font: inherit;
		padding: 0.05rem 0.4rem; border-radius: 3px;
		cursor: pointer; font-size: 0.95em;
	}
	.anon-action:disabled { opacity: 0.5; cursor: wait; }
	.anon-action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
	.anon-action-secondary {
		font-size: 0.85em;
		padding: 0.05rem 0.35rem;
		opacity: 0.7;
	}
	.anon-action-secondary:hover:not(:disabled) { opacity: 1; }

	.brief-picker { position: relative; display: inline-block; }
	.brief-tag.clickable {
		cursor: pointer;
		font-family: inherit;
		font-size: 0.72rem;
	}
	.brief-tag.clickable:hover {
		background: rgba(165, 180, 252, 0.14);
		border-color: rgba(165, 180, 252, 0.4);
	}
	.brief-tag.no-brief {
		background: rgba(251, 191, 36, 0.08);
		border-color: rgba(251, 191, 36, 0.3);
		color: #fbbf24;
	}
	.brief-tag .caret { margin-left: 0.3rem; opacity: 0.6; font-size: 0.7em; }
	.brief-menu {
		position: absolute; top: calc(100% + 6px); left: 0;
		min-width: 320px; max-width: 460px;
		background: #0f1117; border: 1px solid #2a2d3a;
		border-radius: 6px;
		box-shadow: 0 10px 30px rgba(0,0,0,0.4);
		z-index: 30;
		padding: 0.4rem 0;
	}
	.brief-menu-head {
		font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6b7280; padding: 0.4rem 0.9rem 0.5rem;
		border-bottom: 1px solid #2a2d3a;
		font-weight: 600;
	}
	.brief-menu-item {
		display: flex; flex-direction: column; align-items: stretch;
		gap: 0.2rem;
		width: 100%;
		text-align: left;
		background: none; border: none;
		padding: 0.55rem 0.9rem;
		color: #c9cdd5;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.85rem;
		border-left: 2px solid transparent;
	}
	.brief-menu-item:hover:not(:disabled) {
		background: rgba(165, 180, 252, 0.06);
	}
	.brief-menu-item.active {
		border-left-color: rgba(110, 231, 183, 0.7);
		background: rgba(110, 231, 183, 0.05);
		color: #e1e4e8;
	}
	.brief-menu-item:disabled { opacity: 0.5; cursor: progress; }
	.bm-name { font-weight: 500; }
	.bm-meta { display: flex; gap: 0.4rem; font-size: 0.72rem; color: #6b7280; }
	.bm-tag {
		background: rgba(165, 180, 252, 0.10);
		color: #a5b4fc;
		padding: 0.05rem 0.3rem;
		border-radius: 3px;
		font-size: 0.68rem;
	}
	.bm-type { font-style: italic; }
	.brief-menu-foot {
		display: block;
		padding: 0.5rem 0.9rem;
		font-size: 0.78rem;
		color: #a5b4fc;
		text-decoration: none;
		border-top: 1px solid #2a2d3a;
		margin-top: 0.3rem;
	}
	.brief-menu-foot:hover { background: rgba(165, 180, 252, 0.06); }
	.brief-error {
		font-size: 0.72rem;
		color: #fca5a5;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
	}

	.tabs {
		display: flex; gap: 0.4rem;
		align-items: center;
	}
	.tab {
		background: none; border: 1px solid transparent;
		border-bottom: 2px solid transparent;
		color: #8b8fa3;
		padding: 0.5rem 1rem; font-size: 0.85rem;
		cursor: pointer; font-family: inherit;
		border-radius: 4px 4px 0 0;
	}
	.tab:hover { color: #c9cdd5; }
	.tab.active {
		color: #c7d2fe;
		border-bottom-color: rgba(165, 180, 252, 0.7);
		background: rgba(165, 180, 252, 0.05);
	}
	.outline-link {
		margin-left: auto;
		color: #a5b4fc;
		text-decoration: none;
		font-size: 0.78rem;
		padding: 0.4rem 0.6rem;
	}
	.outline-link:hover { text-decoration: underline; }

	.suspicious-banner {
		margin: 0.75rem 0 0;
		padding: 0.7rem 0.9rem;
		background: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.35);
		border-radius: 4px;
		color: #c9cdd5;
		font-size: 0.82rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.suspicious-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
	.suspicious-icon { color: #fbbf24; font-size: 1rem; }
	.suspicious-head strong { color: #fbbf24; font-weight: 600; }
	.suspicious-count {
		font-size: 0.72rem; color: #8b8fa3;
		font-family: 'JetBrains Mono', monospace;
	}
	.suspicious-msg { margin: 0; line-height: 1.45; color: #b8bccc; }
	.suspicious-msg em { color: #fbbf24; font-style: normal; font-weight: 500; }
	.suspicious-list {
		margin: 0; padding: 0; list-style: none;
		display: flex; flex-direction: column; gap: 0.25rem;
	}
	.suspicious-list li {
		display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline;
		font-size: 0.78rem; line-height: 1.4;
	}
	.suspicious-list .lvl-tag {
		font-size: 0.66rem;
		padding: 1px 5px;
		background: rgba(165, 180, 252, 0.10);
		border: 1px solid rgba(165, 180, 252, 0.25);
		color: #c7d2fe;
		border-radius: 3px;
		font-family: 'JetBrains Mono', monospace;
	}
	.suspicious-len {
		font-size: 0.72rem; color: #8b8fa3;
		font-family: 'JetBrains Mono', monospace;
	}
	.suspicious-preview { color: #c9cdd5; font-style: italic; flex: 1; min-width: 0; }
	.suspicious-more { color: #8b8fa3; font-size: 0.74rem; padding-left: 0.4rem; }
	.suspicious-cta {
		align-self: flex-start;
		color: #fbbf24;
		text-decoration: none;
		font-size: 0.78rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid rgba(251, 191, 36, 0.35);
		border-radius: 4px;
	}
	.suspicious-cta:hover {
		background: rgba(251, 191, 36, 0.10);
		border-color: rgba(251, 191, 36, 0.55);
	}

	.tab-body { min-height: 60vh; }
	.tab-body.has-toc {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	.tab-main { min-width: 0; }

	.doc-toc {
		position: sticky;
		top: 1rem;
		align-self: start;
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding-right: 0.5rem;
		border-right: 1px solid #1e2030;
	}
	.toc-head {
		margin-bottom: 0.6rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #1e2030;
	}
	.toc-back {
		display: block;
		font-size: 0.78rem;
		color: #6b7280;
		text-decoration: none;
		margin-bottom: 0.25rem;
	}
	.toc-back:hover { color: #c9cdd5; }
	.toc-case {
		font-size: 0.72rem;
		color: #8b8fa3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.toc-nav { display: flex; flex-direction: column; gap: 1px; }
	.toc-item {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.32rem 0.55rem;
		font-size: 0.78rem;
		font-family: inherit;
		color: #8b8fa3;
		text-align: left;
		background: transparent;
		border: 0;
		border-left: 2px solid transparent;
		cursor: pointer;
		width: 100%;
		min-width: 0;
	}
	.toc-item:hover { color: #c9cdd5; background: rgba(255,255,255,0.025); }
	.toc-item.active {
		color: #a5b4fc;
		border-left-color: #a5b4fc;
		background: rgba(165, 180, 252, 0.06);
	}
	.toc-item.level-1 { font-weight: 600; color: #c9cdd5; padding-left: 0.55rem; }
	.toc-item.level-1.active { color: #a5b4fc; }
	.toc-item.level-2 { padding-left: 1.3rem; }
	.toc-item.level-3 { padding-left: 2.0rem; font-size: 0.74rem; }
	.toc-item.level-4 { padding-left: 2.6rem; font-size: 0.74rem; }
	.toc-item.level-5 { padding-left: 3.2rem; font-size: 0.72rem; }
	.toc-num {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		color: #6b7280;
		flex-shrink: 0;
	}
	.toc-item.active .toc-num { color: #a5b4fc; }
	.toc-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.placeholder {
		padding: 2rem 1.5rem;
		background: rgba(165, 180, 252, 0.03);
		border: 1px dashed rgba(165, 180, 252, 0.2);
		border-radius: 6px;
		max-width: 720px;
	}
	.placeholder h2 {
		margin: 0 0 0.7rem;
		font-size: 1rem;
		color: #c7d2fe;
		font-weight: 600;
	}
	.placeholder p {
		color: #c9cdd5; line-height: 1.55; font-size: 0.9rem;
		margin: 0 0 0.5rem;
	}
	.placeholder .hint {
		color: #8b8fa3; font-size: 0.82rem;
		font-style: italic;
	}

	.outline-intro {
		font-size: 0.82rem; color: #8b8fa3;
		margin: 0 0 1rem; max-width: 70ch; line-height: 1.5;
	}
	.export-bar {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.8rem;
		margin: 0 0 1.2rem;
		background: rgba(165, 180, 252, 0.04);
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		font-size: 0.78rem;
		color: #8b8fa3;
	}
	.export-bar-col {
		gap: 0.35rem;
		padding: 0.4rem 0.55rem;
		margin: 0 0 0.7rem;
		flex-wrap: wrap;
	}
	.export-bar-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		color: #8b8fa3;
		margin-right: 0.15rem;
	}
	.export-link {
		color: #c7d2fe;
		text-decoration: none;
		padding: 0.18rem 0.55rem;
		border: 1px solid rgba(165, 180, 252, 0.3);
		border-radius: 3px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.74rem;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}
	.export-link:hover {
		background: rgba(165, 180, 252, 0.12);
		border-color: rgba(165, 180, 252, 0.5);
		color: #e0e7ff;
	}
	/* Doc-Tab XOR-Heuristik-Header. Sticky, damit beim Volltext-Scroll die
	   aktive Heuristik-Wahl sichtbar bleibt. Pillen H1/H2/H3 — exakt eine
	   ist aktiv, andere graulich; deaktiviert wenn keine Daten vorliegen. */
	.heuristic-header {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex; align-items: center; gap: 1rem;
		flex-wrap: wrap;
		padding: 0.7rem 0.2rem 0.7rem;
		margin: 0 0 0.8rem;
		background: linear-gradient(to bottom, rgba(13,17,23,0.96), rgba(13,17,23,0.84));
		backdrop-filter: blur(4px);
		border-bottom: 1px solid #2a2d3a;
	}
	.heuristic-pills {
		display: flex; gap: 0.4rem; flex-wrap: wrap;
	}
	.heuristic-pill {
		font-family: inherit;
		font-size: 0.78rem;
		padding: 0.32rem 0.78rem;
		border-radius: 999px;
		border: 1px solid #2a2d3a;
		background: rgba(255,255,255,0.02);
		color: #8b8fa3;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.heuristic-pill:hover:not(:disabled) {
		background: rgba(255,255,255,0.05);
		color: #c9cdd5;
	}
	.heuristic-pill.active {
		background: rgba(103, 232, 249, 0.10);
		border-color: rgba(103, 232, 249, 0.45);
		color: #a5f3fc;
		font-weight: 600;
	}
	.heuristic-pill:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		color: #4b5563;
	}
	.heuristic-coverage { margin-left: auto; }

	.dokument-intro {
		display: flex; align-items: baseline; gap: 1rem;
		flex-wrap: wrap;
		margin: 0 0 1.4rem;
	}
	.dokument-intro p {
		flex: 1; min-width: 0;
		font-size: 0.82rem; color: #8b8fa3;
		margin: 0; max-width: 70ch; line-height: 1.5;
	}
	.link-btn {
		background: none; border: none; padding: 0;
		color: #a5b4fc; text-decoration: underline;
		font: inherit; cursor: pointer;
	}
	.link-btn:hover { color: #c7d2fe; }
	.work-verdict {
		padding: 1.1rem 1.3rem 1.2rem;
		background: rgba(134, 239, 172, 0.06);
		border: 1px solid rgba(134, 239, 172, 0.35);
		border-radius: 8px;
		margin: 0 0 1.6rem;
	}
	.synthesen-grid {
		display: grid;
		gap: 1rem;
		margin-bottom: 1.5rem;
		align-items: start;
	}
	.synthesen-grid[data-cols="1"] { grid-template-columns: 1fr; }
	.synthesen-grid[data-cols="2"] { grid-template-columns: 1fr 1fr; }
	.synthesen-grid[data-cols="3"] { grid-template-columns: 1fr 1fr 1fr; }
	.synthesen-col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.synthesen-col > .work-verdict { margin-bottom: 0; }
	.work-verdict-head {
		display: flex; align-items: baseline; gap: 0.7rem;
		margin-bottom: 0.7rem;
	}
	.work-verdict-head h2 {
		font-size: 1.1rem; margin: 0; color: #e7eaf6;
	}
	.work-tag {
		font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase;
		padding: 2px 8px; border-radius: 4px;
		background: rgba(134, 239, 172, 0.18); color: #bbf7d0;
		font-weight: 600;
	}
	.work-content {
		font-size: 0.92rem; line-height: 1.55; color: #d6dae8;
		white-space: pre-wrap;
	}
	/* Meta-Synthese-Tab: Review-Synthese H1+H2+Literaturbezugs-Anker.
	   Eigene Lavender-Akzentfarbe — distinkt von H1 (grün), H2 (grün, gleicher
	   Verdikt-Look wie H1) und H3 (grün), markiert die Meta-Ebene als terminales
	   Glied über den beiden Hauptlinien. */
	.meta-tab .meta-intro {
		font-size: 0.82rem; color: #8b8fa3;
		margin: 0 0 1rem; max-width: 72ch; line-height: 1.55;
	}
	.meta-export-bar {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.8rem;
		margin: 0 0 1rem;
		background: rgba(196, 181, 253, 0.05);
		border: 1px solid rgba(196, 181, 253, 0.3);
		border-radius: 5px;
		font-size: 0.78rem;
		color: #8b8fa3;
	}
	.meta-block {
		padding: 1rem 1.25rem 1.1rem;
		background: rgba(196, 181, 253, 0.05);
		border: 1px solid rgba(196, 181, 253, 0.32);
		border-radius: 8px;
		margin: 0 0 0.9rem;
	}
	.meta-block-head {
		display: flex; align-items: baseline; gap: 0.7rem;
		margin-bottom: 0.55rem;
	}
	.meta-tag {
		font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase;
		padding: 2px 8px; border-radius: 4px;
		background: rgba(196, 181, 253, 0.18); color: #ddd6fe;
		font-weight: 600;
	}
	.meta-content {
		font-size: 0.92rem; line-height: 1.6; color: #d6dae8;
		white-space: pre-wrap;
	}
	.fact-check-block {
		margin: 1.6rem 0 0;
		padding: 1.1rem 1.25rem 1.2rem;
		border: 1px dashed rgba(196, 181, 253, 0.35);
		border-radius: 8px;
		background: rgba(196, 181, 253, 0.025);
	}
	.fact-check-head { margin-bottom: 0.8rem; }
	.fact-check-head h3 {
		font-size: 0.95rem; margin: 0 0 0.4rem; color: #ddd6fe;
		letter-spacing: 0.02em;
	}
	.fact-check-intro {
		font-size: 0.78rem; color: #8b8fa3;
		margin: 0; max-width: 72ch; line-height: 1.5;
	}
	.fact-check-list {
		list-style: decimal inside;
		padding: 0; margin: 0;
		display: flex; flex-direction: column; gap: 0.85rem;
	}
	.fact-check-item {
		padding: 0.7rem 0.9rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid #2a2d3a;
		border-radius: 5px;
	}
	.fact-check-claim {
		display: flex; align-items: baseline; gap: 0.55rem;
		margin-bottom: 0.4rem;
		flex-wrap: wrap;
	}
	.fact-check-claim-text {
		font-size: 0.88rem; line-height: 1.5; color: #e7eaf6;
	}
	.fact-check-rationale {
		font-size: 0.82rem; line-height: 1.55; color: #a8acbf;
		padding-left: 0.2rem;
	}
	.outline-list { display: flex; flex-direction: column; gap: 0.7rem; }
	.outline-node {
		padding: 0.85rem 1rem;
		background: rgba(255,255,255,0.015);
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		margin-left: calc(var(--indent, 0) * 1.6rem);
	}
	.outline-node.level-1 {
		background: rgba(165, 180, 252, 0.04);
		border-color: rgba(165, 180, 252, 0.25);
	}
	.outline-node.level-2 {
		background: rgba(255,255,255,0.025);
	}
	.outline-node-head {
		display: flex; align-items: baseline; gap: 0.6rem;
		margin-bottom: 0.5rem;
	}
	.lvl-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		color: #6b7280;
		background: rgba(107, 114, 128, 0.10);
		border: 1px solid rgba(107, 114, 128, 0.25);
		border-radius: 3px;
		padding: 0.05rem 0.35rem;
	}
	.num-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		color: #a5b4fc;
		min-width: 2.5em;
	}
	.outline-heading {
		flex: 1; margin: 0;
		font-size: 0.95rem; font-weight: 600; color: #e1e4e8;
	}
	.outline-node.level-1 .outline-heading { font-size: 1.05rem; }
	.coverage-tag {
		font-size: 0.7rem; padding: 0.1rem 0.45rem;
		background: rgba(107, 114, 128, 0.10);
		color: #9ca3af;
		border: 1px solid rgba(107, 114, 128, 0.22);
		border-radius: 3px;
		white-space: nowrap;
	}
	.coverage-tag.done {
		background: rgba(110, 231, 183, 0.08);
		color: #6ee7b7;
		border-color: rgba(110, 231, 183, 0.25);
	}
	.anchor-link {
		display: inline;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.82em;
		background: rgba(165, 180, 252, 0.10);
		border: 1px solid rgba(165, 180, 252, 0.3);
		color: #c7d2fe;
		padding: 0 0.35em;
		margin: 0 0.1em;
		border-radius: 3px;
		cursor: pointer;
		font-family: 'JetBrains Mono', monospace;
	}
	.anchor-link:hover {
		background: rgba(165, 180, 252, 0.2);
		border-color: rgba(165, 180, 252, 0.55);
	}
	.anchor-link.dead {
		opacity: 0.5;
		cursor: not-allowed;
		text-decoration: line-through;
	}
	/* Plain AY, kontextuell über Distanz-Heuristik aufgelöst — dezenter
	   als ein expliziter §X:AY-Anker, damit erkennbar bleibt dass das
	   eine Auflösung ist und kein direkter Verweis. */
	.anchor-link.resolved-context {
		background: rgba(165, 180, 252, 0.05);
		border-style: dashed;
		border-color: rgba(165, 180, 252, 0.25);
	}
	.anchor-link.resolved-context:hover {
		background: rgba(165, 180, 252, 0.15);
		border-color: rgba(165, 180, 252, 0.45);
		border-style: solid;
	}
	.synthesis {
		background: rgba(110, 231, 183, 0.05);
		border-left: 3px solid rgba(110, 231, 183, 0.5);
		padding: 0.75rem 1rem; border-radius: 0 4px 4px 0;
	}
	.synth-label {
		font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6ee7b7; margin-bottom: 0.35rem; font-weight: 600;
	}
	.synth-content { color: #c9cdd5; line-height: 1.55; font-size: 0.9rem; }
	.synth-pending {
		color: #6b7280; font-size: 0.82rem; font-style: italic;
		margin: 0;
	}

	/* — Pipeline-Tab — */
	.pipeline-head {
		display: flex; align-items: flex-start; gap: 1rem;
		margin-bottom: 1.2rem;
	}
	.pipeline-head h2 {
		margin: 0 0 0.4rem; font-size: 1.05rem; color: #e1e4e8; font-weight: 600;
	}
	.pipeline-sub {
		margin: 0; font-size: 0.85rem; color: #8b8fa3; max-width: 60ch;
		line-height: 1.45;
	}
	.refresh-btn {
		margin-left: auto;
		background: none;
		border: 1px solid #2a2d3a;
		color: #c9cdd5;
		padding: 0.45rem 0.9rem;
		font-size: 0.78rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
	}
	.refresh-btn:hover:not(:disabled) {
		border-color: rgba(165, 180, 252, 0.5);
		color: #c7d2fe;
	}
	.refresh-btn:disabled { opacity: 0.5; cursor: progress; }

	.error-box {
		padding: 0.7rem 0.9rem;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 4px;
		color: #fca5a5;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}

	.pass-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 0.9rem;
		margin-bottom: 1.2rem;
	}
	.pass-card {
		padding: 0.9rem 1rem;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		background: rgba(255,255,255,0.015);
	}
	.pass-card.pass-done { border-color: rgba(110, 231, 183, 0.3); }
	.pass-card.pass-partial { border-color: rgba(251, 191, 36, 0.3); }
	.pass-card.disabled { opacity: 0.55; }
	.pass-card.opt-in {
		border-style: dashed;
		background: rgba(165, 180, 252, 0.025);
	}
	.pass-card.opt-in.disabled { opacity: 0.7; }
	.hint-inline {
		display: inline-block;
		margin-left: 0.4rem;
		font-size: 0.78rem;
		color: #8b8fa3;
		font-style: italic;
	}

	.pass-head {
		display: flex; align-items: baseline; gap: 0.6rem;
		margin-bottom: 0.4rem;
	}
	.pass-head h3, .pass-head h4 {
		flex: 1; margin: 0;
		font-size: 0.92rem; font-weight: 600; color: #e1e4e8;
	}
	.pass-state-tag {
		font-size: 0.68rem; padding: 0.1rem 0.45rem;
		border-radius: 3px; white-space: nowrap;
	}
	.tag-done { background: rgba(110, 231, 183, 0.10); color: #6ee7b7; border: 1px solid rgba(110, 231, 183, 0.3); }
	.tag-partial { background: rgba(251, 191, 36, 0.08); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
	.tag-pending { background: rgba(107, 114, 128, 0.10); color: #9ca3af; border: 1px solid rgba(107, 114, 128, 0.3); }

	.pass-desc {
		margin: 0 0 0.7rem;
		font-size: 0.78rem;
		color: #8b8fa3;
		line-height: 1.4;
	}
	.pass-note {
		margin: 0; font-size: 0.78rem; font-style: italic; color: #6b7280;
	}

	.pass-progress {
		display: flex; align-items: center; gap: 0.6rem;
		margin-bottom: 0.4rem;
	}
	.bar {
		flex: 1; height: 6px;
		background: #1a1c25;
		border-radius: 3px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: linear-gradient(90deg, rgba(165, 180, 252, 0.8), rgba(110, 231, 183, 0.7));
		transition: width 0.4s ease;
	}
	.pass-counts {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		color: #c9cdd5;
		min-width: 5.5em;
		text-align: right;
	}
	.pass-meta {
		display: flex; gap: 0.7rem;
		font-size: 0.72rem; color: #6b7280;
	}

	/* — Run-Steuerung — */
	.brief-warn {
		padding: 0.7rem 0.9rem;
		font-size: 0.85rem;
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-left-width: 3px;
		border-radius: 0 4px 4px 0;
		margin-bottom: 1rem;
		line-height: 1.5;
	}
	.brief-warn code {
		font-family: 'JetBrains Mono', monospace;
		background: rgba(251, 191, 36, 0.10);
		padding: 0.05rem 0.3rem;
		border-radius: 3px;
		font-size: 0.78rem;
	}

	.run-control {
		padding: 1rem 1.1rem;
		background: rgba(165, 180, 252, 0.04);
		border: 1px solid rgba(165, 180, 252, 0.25);
		border-radius: 6px;
		margin-bottom: 1.4rem;
	}
	.run-control-head {
		display: flex; flex-wrap: wrap;
		gap: 1rem; align-items: center;
		justify-content: space-between;
	}
	.run-status-block {
		display: flex; flex-wrap: wrap; gap: 0.6rem;
		align-items: center;
		min-width: 0; flex: 1;
	}
	.run-status-tag {
		font-size: 0.78rem;
		padding: 0.18rem 0.55rem;
		border-radius: 3px;
		white-space: nowrap;
		font-weight: 600;
	}
	.run-status-running {
		background: rgba(165, 180, 252, 0.15); color: #c7d2fe;
		border: 1px solid rgba(165, 180, 252, 0.5);
	}
	.run-status-paused {
		background: rgba(251, 191, 36, 0.10); color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.4);
	}
	.run-status-completed {
		background: rgba(110, 231, 183, 0.10); color: #6ee7b7;
		border: 1px solid rgba(110, 231, 183, 0.4);
	}
	.run-status-failed {
		background: rgba(239, 68, 68, 0.10); color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
	.run-status-idle {
		background: rgba(107, 114, 128, 0.10); color: #9ca3af;
		border: 1px solid rgba(107, 114, 128, 0.3);
	}
	.run-phase-info {
		font-size: 0.82rem; color: #c9cdd5;
		font-family: 'JetBrains Mono', monospace;
		min-width: 0; overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap;
	}
	.run-buttons {
		display: flex; align-items: center; gap: 0.7rem;
		flex-wrap: wrap;
	}
	.heuristic-radio {
		flex-basis: 100%;
		display: flex; flex-direction: column; gap: 0.35rem;
		margin: 0 0 0.5rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 4px;
		background: rgba(255,255,255,0.02);
	}
	.heuristic-radio legend {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9aa0aa;
		padding: 0 0.3rem;
	}
	.heuristic-radio label {
		display: inline-flex; align-items: center; gap: 0.4rem;
		font-size: 0.82rem; color: #c9cdd5;
		cursor: pointer;
	}
	.heuristic-radio input[type='radio'] { cursor: pointer; }
	.heuristic-radio input[type='radio']:disabled { cursor: not-allowed; }
	.run-modifiers {
		flex-basis: 100%;
		display: flex; flex-direction: column; gap: 0.4rem;
		margin: 0 0 0.5rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 4px;
		background: rgba(255,255,255,0.02);
	}
	.run-modifiers legend {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9aa0aa;
		padding: 0 0.3rem;
	}
	.run-modifiers label {
		display: flex; align-items: flex-start; gap: 0.5rem;
		font-size: 0.82rem; color: #c9cdd5;
		cursor: pointer; line-height: 1.4;
	}
	.run-modifiers label small {
		display: block;
		font-size: 0.74rem;
		color: #8b94a3;
		margin-top: 0.2rem;
		line-height: 1.45;
	}
	.run-modifiers input[type='checkbox'] {
		cursor: pointer;
		margin-top: 0.18rem;
		flex: none;
	}
	.run-modifiers input[type='checkbox']:disabled { cursor: not-allowed; }
	.prerun-block {
		flex-basis: 100%;
		margin: 0 0 0.5rem;
		padding: 0.55rem 0.75rem;
		background: rgba(248, 113, 113, 0.08);
		border-left: 2px solid rgba(248, 113, 113, 0.6);
		border-radius: 0 4px 4px 0;
		font-size: 0.82rem;
		color: #fca5a5;
		line-height: 1.45;
	}
	.prerun-block strong {
		color: #fecaca;
	}
	.prerun-block ul {
		margin: 0.3rem 0 0.4rem 1rem;
		padding: 0;
	}
	.prerun-block code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.74rem;
		color: #fecaca;
		background: rgba(248, 113, 113, 0.12);
		padding: 1px 4px;
		border-radius: 3px;
	}
	.prerun-link {
		color: #fbbf24;
		text-decoration: underline;
		font-size: 0.78rem;
	}
	.prerun-link:hover { color: #fcd34d; }
	.run-validity-note {
		flex-basis: 100%;
		margin: 0 0 0.4rem;
		padding: 0.45rem 0.7rem;
		background: rgba(165, 180, 252, 0.06);
		border-left: 2px solid rgba(165, 180, 252, 0.5);
		border-radius: 0 4px 4px 0;
		font-size: 0.78rem;
		color: #c9cdd5;
		line-height: 1.4;
	}
	.run-validity-note code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.74rem;
		color: #c7d2fe;
		background: rgba(165, 180, 252, 0.1);
		padding: 1px 4px;
		border-radius: 3px;
	}
	.run-btn {
		padding: 0.5rem 1.1rem;
		font-size: 0.85rem;
		border-radius: 4px;
		font-family: inherit;
		cursor: pointer;
		font-weight: 600;
	}
	.run-btn.start {
		background: rgba(110, 231, 183, 0.10);
		border: 1px solid rgba(110, 231, 183, 0.5);
		color: #6ee7b7;
	}
	.run-btn.start:hover:not(:disabled) {
		background: rgba(110, 231, 183, 0.18);
		border-color: rgba(110, 231, 183, 0.7);
	}
	.run-btn.start:disabled {
		opacity: 0.4; cursor: not-allowed;
	}
	.run-btn.pause {
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.4);
		color: #fbbf24;
	}
	.run-btn.pause:hover:not(:disabled) {
		background: rgba(251, 191, 36, 0.15);
		border-color: rgba(251, 191, 36, 0.6);
	}
	.run-meta-row {
		display: flex; flex-wrap: wrap; gap: 1.2rem;
		font-size: 0.75rem; color: #8b8fa3;
		margin-top: 0.7rem;
		font-family: 'JetBrains Mono', monospace;
	}
	.run-log {
		margin-top: 0.7rem;
		font-size: 0.78rem;
		color: #9ca3af;
	}
	.run-log summary {
		cursor: pointer; padding: 0.3rem 0;
	}
	.run-log-body {
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.8rem;
		background: #0a0c12;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		max-height: 280px;
		overflow: auto;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.74rem;
		color: #c9cdd5;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.error-box.compact {
		padding: 0.4rem 0.7rem;
		font-size: 0.8rem;
		margin: 0.6rem 0 0;
	}
	.failure-box {
		margin-top: 0.6rem;
		padding: 0.7rem 0.85rem;
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-left-width: 3px;
		border-radius: 0 4px 4px 0;
	}
	.failure-head {
		display: flex; align-items: center; gap: 0.55rem;
		margin-bottom: 0.45rem;
		flex-wrap: wrap;
	}
	.failure-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.45rem;
		border-radius: 3px;
		font-weight: 600;
	}
	.tag-precondition {
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.12);
		border: 1px solid rgba(251, 191, 36, 0.35);
	}
	.tag-generic {
		color: #c9cdd5;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.failure-locus {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		color: #fecaca;
	}
	.failure-diagnostic {
		margin: 0 0 0.55rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #e5e7eb;
		white-space: pre-wrap;
	}
	.failure-actions {
		display: flex; gap: 0.6rem;
		flex-wrap: wrap;
	}
	.failure-action {
		font-size: 0.8rem;
		color: #fbbf24;
		text-decoration: underline;
		padding: 0.15rem 0;
	}
	.failure-action:hover { color: #fcd34d; }
	.atom-errors {
		margin-top: 0.6rem;
		padding: 0.5rem 0.7rem;
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-left-width: 3px;
		border-radius: 0 4px 4px 0;
	}
	.atom-errors summary {
		cursor: pointer;
		font-size: 0.82rem;
		color: #fca5a5;
		font-weight: 600;
	}
	.atom-errors-list {
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
		display: flex; flex-direction: column; gap: 0.5rem;
	}
	.atom-errors-list li {
		padding: 0.45rem 0.6rem;
		background: rgba(239, 68, 68, 0.04);
		border-radius: 3px;
		font-size: 0.78rem;
	}
	.ae-phase {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.10);
		border: 1px solid rgba(251, 191, 36, 0.25);
		padding: 0.05rem 0.35rem;
		border-radius: 3px;
		margin-right: 0.4rem;
	}
	.ae-label { color: #c9cdd5; font-weight: 500; }
	.ae-message { color: #8b8fa3; margin-top: 0.25rem; line-height: 1.4; }

	/* — Pass-Sections (Hauptlinie + Addendum) — */
	.passes-section {
		margin-bottom: 1.6rem;
	}
	.passes-section-head { margin-bottom: 0.7rem; }
	.passes-section-head h3 {
		margin: 0 0 0.3rem; font-size: 0.95rem;
		color: #e1e4e8; font-weight: 600;
		display: flex; align-items: center; gap: 0.5rem;
	}
	.passes-section-head p {
		margin: 0; font-size: 0.82rem;
		color: #8b8fa3; line-height: 1.5;
		max-width: 78ch;
	}
	.passes-section.addendum {
		margin-top: 1.4rem;
		padding-top: 1.2rem;
		border-top: 1px dashed #2a2d3a;
	}
	.addendum-tag {
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.1rem 0.45rem;
		background: rgba(251, 191, 36, 0.10);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.pass-num {
		display: inline-flex; align-items: center; justify-content: center;
		width: 1.5em; height: 1.5em;
		background: rgba(165, 180, 252, 0.10);
		border: 1px solid rgba(165, 180, 252, 0.3);
		color: #c7d2fe;
		border-radius: 50%;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.74rem;
		font-weight: 600;
	}
	.pass-num.add {
		background: rgba(251, 191, 36, 0.10);
		border-color: rgba(251, 191, 36, 0.4);
		color: #fbbf24;
	}
	.pass-card.current {
		border-color: rgba(165, 180, 252, 0.55);
		box-shadow: 0 0 0 1px rgba(165, 180, 252, 0.15);
	}
	.pass-card.pass-addendum {
		border-style: dashed;
		max-width: 760px;
	}
	.passes-section.on-demand {
		margin-top: 1.4rem;
		padding-top: 1rem;
		border-top: 1px dashed #2a2d3a;
	}
	.pass-card.pass-on-demand {
		max-width: 760px;
		border-color: rgba(165, 180, 252, 0.28);
		background: rgba(165, 180, 252, 0.04);
	}
	.pass-actions {
		display: flex; gap: 0.6rem; align-items: center;
		margin-top: 0.6rem;
	}
	.work-verdict.chapter-flow {
		background: rgba(165, 180, 252, 0.06);
		border-color: rgba(165, 180, 252, 0.35);
	}
	.work-tag.flow-tag {
		background: rgba(165, 180, 252, 0.18);
		color: #c7d2fe;
	}

	.empty { color: #6b7280; font-size: 0.85rem; font-style: italic; }

	.pass-card.pass-blocked {
		border-color: rgba(251, 191, 36, 0.30);
		opacity: 0.85;
	}
	.tag-blocked {
		background: rgba(251, 191, 36, 0.10);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}
	.pass-num.h3 {
		background: rgba(167, 139, 250, 0.10);
		border-color: rgba(167, 139, 250, 0.3);
		color: #c4b5fd;
	}
	.passes-section.h3-section {
		margin-top: 1.4rem;
		padding-top: 1rem;
		border-top: 1px dashed #2a2d3a;
	}
	.passes-section.active-path {
		padding-left: 0.6rem;
		border-left: 2px solid rgba(167, 139, 250, 0.55);
	}
	.path-tag.active {
		font-size: 0.65rem;
		font-weight: 500;
		padding: 0.1rem 0.45rem;
		background: rgba(167, 139, 250, 0.14);
		color: #c4b5fd;
		border: 1px solid rgba(167, 139, 250, 0.35);
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.precondition-block {
		font-size: 0.78rem;
		color: #c5c8d3;
		background: rgba(251, 191, 36, 0.04);
		border: 1px solid rgba(251, 191, 36, 0.18);
		border-radius: 4px;
		padding: 0.5rem 0.65rem;
		margin-top: 0.3rem;
	}
	.precondition-block p { margin: 0.15rem 0; }
	.precondition-block code {
		font-size: 0.78em;
		padding: 0.05em 0.3em;
		background: rgba(165, 180, 252, 0.08);
		border-radius: 2px;
	}
	.precondition-block a {
		color: #a5b4fc;
		margin-left: 0.3em;
	}

	.werk-construct {
		padding: 0.7rem 0;
		border-top: 1px dashed #1f2230;
	}
	.werk-construct:first-of-type { border-top: none; padding-top: 0; }
	.werk-construct-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.8rem;
		margin-bottom: 0.4rem;
	}
	.werk-construct h4 {
		margin: 0;
		font-size: 0.88rem;
		color: #c7d2fe;
		font-weight: 600;
	}
	.werk-meta {
		font-size: 0.72rem;
		color: #6b7280;
	}
	.werk-paragraph {
		margin: 0.3rem 0;
		font-size: 0.92rem;
		color: #d6d8e0;
		line-height: 1.55;
	}
	.werk-subblock {
		margin-top: 0.7rem;
	}
	.werk-subblock h5 {
		margin: 0 0 0.2rem;
		font-size: 0.78rem;
		color: #9ca3af;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.werk-list {
		margin: 0.3rem 0;
		padding-left: 1.2rem;
		font-size: 0.86rem;
		color: #d6d8e0;
		line-height: 1.5;
	}
	.werk-list li { margin: 0.15rem 0; }
	.werk-empty {
		color: #6b7280;
		font-size: 0.82rem;
		font-style: italic;
		margin: 0.3rem 0;
	}
	.werk-bezug-item {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}
	.werk-signal {
		display: inline-block;
		min-width: 5em;
		padding: 0.05em 0.4em;
		border-radius: 3px;
		font-size: 0.75rem;
		text-align: center;
	}
	.werk-signal-green {
		background: rgba(110, 231, 183, 0.10);
		color: #6ee7b7;
		border: 1px solid rgba(110, 231, 183, 0.3);
	}
	.werk-signal-yellow {
		background: rgba(251, 191, 36, 0.10);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}
	.werk-signal-red {
		background: rgba(239, 68, 68, 0.10);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}
	.werk-signal-neutral {
		background: rgba(156, 163, 175, 0.08);
		color: #9ca3af;
		border: 1px solid rgba(156, 163, 175, 0.25);
	}
	.werk-rationale { font-size: 0.84rem; color: #c5c8d3; }
	/*
	 * Erkenntnis-Integration (SYNTHESE/GESAMTERGEBNIS, Coverage-Audit über
	 * BEFUNDE → Synthese). ✓ = integriert (gedeckt durch Synthese), ✗ =
	 * nicht-integriert (Indikator-Material für die Werk-Würdigung). Farbe
	 * codiert Wertung (rot/gelb/grün via .werk-signal-*), nicht Klassifikator-
	 * Typ — siehe feedback_color_only_for_reviewer_signals.
	 */
	.werk-integration-list {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.werk-integration-item {
		display: grid;
		grid-template-columns: 1.4em 1fr;
		gap: 0.5rem;
		padding: 0.45rem 0.6rem;
		border-radius: 4px;
		border-left: 3px solid transparent;
		background: rgba(255, 255, 255, 0.025);
	}
	.werk-integration-item.integrated {
		border-left-color: rgba(110, 231, 183, 0.55);
	}
	.werk-integration-item.not-integrated {
		border-left-color: rgba(239, 68, 68, 0.55);
		background: rgba(239, 68, 68, 0.04);
	}
	.werk-integration-marker {
		font-weight: 700;
		font-size: 1.05rem;
		line-height: 1.2;
		color: #6ee7b7;
	}
	.werk-integration-item.not-integrated .werk-integration-marker {
		color: #ef4444;
	}
	.werk-integration-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.werk-integration-snippet {
		font-size: 0.85rem;
		color: #d6d8e0;
		font-style: italic;
		line-height: 1.45;
	}
	.werk-integration-hinweis {
		font-size: 0.85rem;
		color: #c5c8d3;
		line-height: 1.5;
	}
	/*
	 * WERK_GUTACHT Stage B (Hotspot-Würdigung pro Funktionstyp-Achse).
	 * Pro Achse: axisName, indicator (yellow|red|null), rationale.
	 * indicator=null heißt explizit "kein Hotspot" — wird als unauffällig
	 * markiert, statt fehlt-Lücke.
	 */
	.werk-axes-list {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.werk-axis-item {
		padding: 0.5rem 0.65rem;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.025);
		border-left: 3px solid rgba(156, 163, 175, 0.25);
	}
	.werk-axis-item:has(.werk-signal-yellow) { border-left-color: rgba(251, 191, 36, 0.55); }
	.werk-axis-item:has(.werk-signal-red) { border-left-color: rgba(239, 68, 68, 0.55); }
	.werk-axis-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.25rem;
	}
	.werk-axis-name {
		font-size: 0.82rem;
		color: #c7d2fe;
		font-weight: 600;
	}
	.werk-stats {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 1rem;
		margin: 0;
		font-size: 0.84rem;
	}
	.werk-stats dt { color: #9ca3af; }
	.werk-stats dd { margin: 0; color: #d6d8e0; font-variant-numeric: tabular-nums; }
	.werk-fallback summary { cursor: pointer; font-size: 0.8rem; color: #9ca3af; }
	.werk-fallback pre {
		font-size: 0.74rem;
		color: #c5c8d3;
		background: rgba(255,255,255,0.02);
		padding: 0.5rem;
		border-radius: 4px;
		overflow-x: auto;
		margin-top: 0.4rem;
	}
</style>