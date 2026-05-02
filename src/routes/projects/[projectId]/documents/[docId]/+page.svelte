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
	import type { DocumentElement, ParagraphMemo, CodeAnchor, HeadingSynthesis, WorkSynthesis, ChapterFlow, CaseInfo, OutlineEntry, BriefOption, ParagraphAnalysis } from './+page.server.js';
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
	const analysisByElement = $derived(data.analysisByElement as Record<string, ParagraphAnalysis>);

	type View = 'pipeline' | 'dokument' | 'outline' | 'companions';
	const VIEWS: View[] = ['pipeline', 'dokument', 'outline', 'companions'];
	const VIEW_LABEL: Record<View, string> = {
		pipeline: 'Pipeline',
		dokument: 'Dokument',
		outline: 'Outline',
		companions: 'Begleitdocs',
	};

	let view = $state<View>('pipeline');
	let readerOpen = $state(false);
	let readerScrollTarget = $state<{ elementId: string; argumentId?: string } | null>(null);

	// Pipeline-Status — aus /api/cases/[caseId]/pipeline-status.
	// Reihenfolge der ANALYTISCHEN Hauptlinie:
	//   argumentation_graph → subchapter → chapter → work
	// Synthetisch-hermeneutischer Per-¶-Pass ist ADDENDUM (separat dargestellt).
	type AnalyticalPassKey = 'argumentation_graph' | 'argument_validity' | 'subchapter' | 'chapter' | 'work';
	type PassStatus = { completed: number; total: number | null; last_run: string | null; enabled?: boolean };
	type RunPhase =
		| 'argumentation_graph'
		| 'argument_validity'
		| 'section_collapse'
		| 'chapter_collapse'
		| 'document_collapse'
		| 'paragraph_synthetic';
	type RunStatusDto = {
		id: string;
		status: 'running' | 'paused' | 'completed' | 'failed';
		current_phase: RunPhase | null;
		current_index: number;
		total_in_phase: number | null;
		last_step_label: string | null;
		options: { include_synthetic?: boolean; cost_cap_usd?: number | null };
		cancel_requested: boolean;
		error_message: string | null;
		accumulated_input_tokens: number;
		accumulated_output_tokens: number;
		accumulated_cache_read_tokens: number;
		started_at: string;
		paused_at: string | null;
		completed_at: string | null;
	};
	type PipelineStatus = {
		case_id: string;
		document_id: string | null;
		brief: { id: string; name: string; argumentation_graph: boolean; validity_check: boolean } | null;
		total_paragraphs: number;
		passes: Record<AnalyticalPassKey, PassStatus> & {
			kapitelverlauf: PassStatus;
			paragraph_synthetic: PassStatus;
		};
		run: RunStatusDto | null;
	};

	const ANALYTICAL_ORDER: AnalyticalPassKey[] = [
		'argumentation_graph',
		'argument_validity',
		'subchapter',
		'chapter',
		'work',
	];
	const PASS_LABEL: Record<AnalyticalPassKey | 'paragraph_synthetic', string> = {
		argumentation_graph: 'Argumentation pro Absatz',
		argument_validity: 'Argument-Validität (Charity-Pass, opt-in)',
		subchapter: 'Subkapitel-Synthesen',
		chapter: 'Hauptkapitel-Synthesen',
		work: 'Werk-Synthese',
		paragraph_synthetic: 'Synthetisch-hermeneutische Per-Absatz-Memos',
	};
	const PASS_DESC: Record<AnalyticalPassKey | 'paragraph_synthetic', string> = {
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
			'Formulierende und interpretierende Memos pro Absatz, sequentiell unter Bezug auf alle vorhergehenden ¶ desselben Subkapitels. Lese-Hilfe für den Reader; fließt nicht in die Aggregation ein.',
	};

	// Mapping zwischen UI-PassKey (orientiert an memo_content.scope_level) und
	// Run-Phase-Bezeichner aus dem Orchestrator.
	const PHASE_TO_PASS: Record<RunPhase, AnalyticalPassKey | 'paragraph_synthetic'> = {
		argumentation_graph: 'argumentation_graph',
		argument_validity: 'argument_validity',
		section_collapse: 'subchapter',
		chapter_collapse: 'chapter',
		document_collapse: 'work',
		paragraph_synthetic: 'paragraph_synthetic',
	};

	let pipelineStatus = $state<PipelineStatus | null>(null);
	let pipelineLoading = $state(false);
	let pipelineError = $state<string | null>(null);

	// Run-Steuerung
	let runActive = $state(false);
	let runOptions = $state<{ include_synthetic: boolean }>({ include_synthetic: false });
	let runEvents = $state<string[]>([]);
	let runError = $state<string | null>(null);
	let runEventSource: AbortController | null = null;
	let cancellingRun = $state(false);
	let atomErrorsThisRun = $state(0);

	// error_message ist seit fail-tolerant entweder plain string (catastrophic
	// Run-Failure, e.g. Stuck-Guard) oder JSON mit { atom_errors:[…] } (einzelne
	// tolerable Atom-Fehler). Helfer für UI: parsen, oder null.
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
				body: JSON.stringify({ include_synthetic: runOptions.include_synthetic }),
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
					`── Phase: ${PASS_LABEL[PHASE_TO_PASS[evt.phase as RunPhase]]} (${evt.total} Atom${evt.total === 1 ? '' : 'e'})`,
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
		loadPipelineStatus();
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
	// viele synthetisch (interpretierendes Per-¶-Memo, optionales Addendum).
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
				if (memosByElement[e.id]?.some((m) => m.memo_type === 'interpretierend')) {
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
</script>

<svelte:window onclick={handleDocClick} />

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

	<div class="tab-body">
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
						<div>
							<h2>Analyselauf</h2>
							<p class="pipeline-sub">
								Die argumentanalytische Pipeline läuft sequenziell über das zentrale Dokument.
								Du startest den Lauf einmal — die Pässe werden in der korrekten Reihenfolge
								automatisch durchgezogen. Du kannst jederzeit pausieren und später
								fortsetzen, ohne Zwischenstand zu verlieren.
							</p>
						</div>
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
								Die analytische Hauptlinie produziert keine Argumente. Wechsle den Brief am
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
										<label class="opt-toggle">
											<input
												type="checkbox"
												bind:checked={runOptions.include_synthetic}
												disabled={!agEnabled}
											/>
											<span>Synthetisches Per-¶-Memo zusätzlich erzeugen</span>
										</label>
										<button
											class="run-btn start"
											onclick={startOrResumeRun}
											disabled={!agEnabled}
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
									<div class="error-box compact">Fehler: {catastrophic}</div>
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

						<!-- Hauptlinie -->
						<section class="passes-section">
							<header class="passes-section-head">
								<h3>Analytische Hauptlinie</h3>
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
									Zusätzliche Bausteine, die nach der analytischen Hauptlinie auf Klick
									erzeugt werden — kein Pflichtbestandteil der Pipeline.
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

						<!-- Addendum -->
						<section class="passes-section addendum">
							<header class="passes-section-head">
								<h3>
									Addendum
									<span class="addendum-tag">optional · zusätzliche Kosten</span>
								</h3>
								<p>
									Der synthetisch-hermeneutische Per-Absatz-Memo ist <strong>nicht
									Teil der analytischen Aggregation</strong>. Er erzeugt pro Absatz eine
									sequenzielle, narrative Lesart unter Bezug auf die vorhergehenden Absätze
									desselben Subkapitels. Diese Memos erscheinen im Reader-Modal als
									zusätzliche Lese-Hilfe; in die Subkapitel-/Hauptkapitel-/Werk-Synthese
									fließen sie nicht ein. Aktiviere die Checkbox oben, wenn der Addendum-Pass
									im Lauf mitlaufen soll — er verdoppelt grob die Zahl der LLM-Calls auf
									Absatz-Ebene.
								</p>
							</header>
							{#if pipelineStatus.passes.paragraph_synthetic}
								{@const synth = pipelineStatus.passes.paragraph_synthetic}
								{@const synthState = passState(synth)}
								<article class="pass-card pass-{synthState} pass-addendum">
									<header class="pass-head">
										<span class="pass-num add">+</span>
										<h4>{PASS_LABEL.paragraph_synthetic}</h4>
										<span class="pass-state-tag tag-{synthState}">
											{synthState === 'done' ? 'Abgeschlossen' : synthState === 'partial' ? 'Teilweise' : 'Offen'}
										</span>
									</header>
									<p class="pass-desc">{PASS_DESC.paragraph_synthetic}</p>
									<div class="pass-progress">
										<div class="bar"><div class="bar-fill" style:width="{passPercent(synth)}%"></div></div>
										<span class="pass-counts">
											{synth.completed}{synth.total != null ? ` / ${synth.total}` : ''}
										</span>
									</div>
									<div class="pass-meta">
										<span class="last-run">Letzter Lauf: {formatLastRun(synth.last_run)}</span>
									</div>
								</article>
							{/if}
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
				{:else if totalProcessed.withMemo === 0}
					<div class="placeholder">
						<h2>Noch keine Argumente extrahiert</h2>
						<p>
							Die dokumentenzentrierte Ansicht zeigt Argumente am Volltext,
							sobald die analytische Pipeline (Argumentations-Graph) gelaufen
							ist. Wechsle zum <button class="link-btn" onclick={() => selectView('pipeline')}>Pipeline-Tab</button>,
							um den Run zu starten.
						</p>
					</div>
				{:else}
					<div class="dokument-intro">
						<p>
							Volltext mit Argumenten (und ggf. Codes/Beziehungen/Stützstrukturen)
							am jeweiligen Absatz. Umkehrung der Outline-Sicht: Statt von der
							Synthese zu den Argumenten geht der Blick hier vom Dokument
							ausgehend.
						</p>
						<span class="coverage-tag" class:done={totalProcessed.withMemo === totalProcessed.total}>
							{totalProcessed.withMemo}/{totalProcessed.total} ¶ analytisch erfasst
						</span>
					</div>
					<DocumentReader
						{elements}
						{memosByElement}
						{codesByElement}
						{synthesesByHeading}
						{analysisByElement}
					/>
				{/if}
			</section>
		{:else if view === 'outline'}
			<section class="tab-content outline-tab">
				{#if visibleOutline.length === 0}
					<div class="placeholder">
						<h2>Outline</h2>
						<p>
							Keine Hauptkapitel-Headings im Dokument erkannt. Prüfe das
							Inhaltsverzeichnis über den Link oben.
						</p>
					</div>
				{:else}
					{#if workSynthesis}
						<article class="work-verdict">
							<header class="work-verdict-head">
								<span class="work-tag">Gesamtverdikt</span>
								<h2>Werk-Synthese</h2>
							</header>
							<div class="work-content">{workSynthesis.content}</div>
						</article>
					{/if}
					{#if chapterFlow}
						<article class="work-verdict chapter-flow">
							<header class="work-verdict-head">
								<span class="work-tag flow-tag">Kapitelverlauf</span>
								<h2>Argumentations­bewegung über die Kapitelfolge</h2>
							</header>
							<div class="work-content">{chapterFlow.content}</div>
						</article>
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
							<article class="outline-node level-{Math.min(h.level, 5)}" style:--indent="{indent}">
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
	.opt-toggle {
		display: inline-flex; align-items: center; gap: 0.4rem;
		font-size: 0.82rem; color: #c9cdd5;
		cursor: pointer;
	}
	.opt-toggle input { cursor: pointer; }
	.opt-toggle input:disabled { cursor: not-allowed; }
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
</style>