<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  SARAH Doc-Page (Stufe-2-Layout, 2026-05-02):
  Drei Tabs (Pipeline · Outline · Begleitdocs) + Reader-Modal-Overlay.
  Reader (Hermeneutik/Struktur/Volltext) lebt im Modal, getriggert vom Header
  oder von §X:AY-Anker-Klicks im Outline-Tab.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { replaceState, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import type { DocumentElement, ParagraphMemo, CodeAnchor, SubchapterSynthesis, CaseInfo, OutlineEntry, BriefOption } from './+page.server.js';
	import ReaderModal from './ReaderModal.svelte';

	let { data } = $props();
	const doc = $derived(data.document);
	const elements = $derived(data.elements as DocumentElement[]);
	const caseInfo = $derived(data.case as CaseInfo | null);
	const memosByElement = $derived(data.memosByElement as Record<string, ParagraphMemo[]>);
	const codesByElement = $derived(data.codesByElement as Record<string, CodeAnchor[]>);
	const synthesesByHeading = $derived(data.synthesesByHeading as Record<string, SubchapterSynthesis>);
	const outlineEntries = $derived(data.outlineEntries as OutlineEntry[]);
	const briefOptions = $derived(data.briefOptions as BriefOption[]);

	type View = 'pipeline' | 'outline' | 'companions';
	const VIEWS: View[] = ['pipeline', 'outline', 'companions'];
	const VIEW_LABEL: Record<View, string> = {
		pipeline: 'Pipeline',
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
	type AnalyticalPassKey = 'argumentation_graph' | 'subchapter' | 'chapter' | 'work';
	type PassStatus = { completed: number; total: number | null; last_run: string | null; enabled?: boolean };
	type RunPhase =
		| 'argumentation_graph'
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
		brief: { id: string; name: string; argumentation_graph: boolean } | null;
		total_paragraphs: number;
		passes: Record<AnalyticalPassKey, PassStatus> & { paragraph_synthetic: PassStatus };
		run: RunStatusDto | null;
	};

	const ANALYTICAL_ORDER: AnalyticalPassKey[] = [
		'argumentation_graph',
		'subchapter',
		'chapter',
		'work',
	];
	const PASS_LABEL: Record<AnalyticalPassKey | 'paragraph_synthetic', string> = {
		argumentation_graph: 'Argumentation pro Absatz',
		subchapter: 'Subkapitel-Synthesen',
		chapter: 'Hauptkapitel-Synthesen',
		work: 'Werk-Synthese',
		paragraph_synthetic: 'Synthetisch-hermeneutische Per-Absatz-Memos',
	};
	const PASS_DESC: Record<AnalyticalPassKey | 'paragraph_synthetic', string> = {
		argumentation_graph:
			'Argumente, Edges und Scaffolding pro Absatz — Grundlage der Aggregation.',
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
				const txt = await r.text().catch(() => '');
				throw new Error(`HTTP ${r.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
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

	// Resolver §X (im Kontext eines Headings) → paragraph_element_id.
	// §X bezeichnet den X-ten paragraph zwischen diesem heading und dem nächsten heading.
	const paragraphsByHeading = $derived.by(() => {
		const map = new Map<string, string[]>();
		let currentHeadingId: string | null = null;
		for (const e of mainElements) {
			if (e.element_type === 'heading') {
				currentHeadingId = e.id;
				if (!map.has(currentHeadingId)) map.set(currentHeadingId, []);
			} else if (e.element_type === 'paragraph' && currentHeadingId) {
				map.get(currentHeadingId)!.push(e.id);
			}
		}
		return map;
	});
	function resolveParagraph(headingId: string, paraNum: number): string | null {
		const list = paragraphsByHeading.get(headingId) ?? [];
		if (paraNum < 1 || paraNum > list.length) return null;
		return list[paraNum - 1];
	}

	// §X(:AY)-Linkifizierung: zerlegt einen Memo-Text in [text, link, text, link, ...]
	type Segment = { kind: 'text'; value: string } | { kind: 'anchor'; raw: string; paraNum: number; argNum: number | null };
	function parseAnchors(content: string): Segment[] {
		const segments: Segment[] = [];
		const re = /§(\d+)(?::A(\d+))?/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			if (m.index > last) {
				segments.push({ kind: 'text', value: content.slice(last, m.index) });
			}
			segments.push({
				kind: 'anchor',
				raw: m[0],
				paraNum: parseInt(m[1], 10),
				argNum: m[2] ? parseInt(m[2], 10) : null,
			});
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

	// Memo-Coverage pro Heading: wie viele ¶ haben interpretierende Memo?
	const memoCoverageByHeading = $derived.by(() => {
		const map = new Map<string, { withMemo: number; total: number }>();
		let currentHeadingId: string | null = null;
		for (const e of mainElements) {
			if (e.element_type === 'heading') {
				currentHeadingId = e.id;
				if (!map.has(currentHeadingId)) map.set(currentHeadingId, { withMemo: 0, total: 0 });
			} else if (e.element_type === 'paragraph' && currentHeadingId) {
				const cur = map.get(currentHeadingId)!;
				cur.total += 1;
				if (memosByElement[e.id]?.some((m) => m.memo_type === 'interpretierend')) {
					cur.withMemo += 1;
				}
			}
		}
		return map;
	});

	const totalProcessed = $derived.by(() => {
		let withMemo = 0;
		const total = paragraphs.length;
		for (const e of paragraphs) {
			if (memosByElement[e.id]?.some((m) => m.memo_type === 'interpretierend')) {
				withMemo += 1;
			}
		}
		return { withMemo, total };
	});
</script>

<svelte:window onclick={handleDocClick} />

<div class="page">
	<header class="doc-head">
		<div class="title-row">
			<h1>{doc.label}</h1>
			<button class="reader-btn" onclick={() => openReader()}>
				Volltext öffnen →
			</button>
		</div>
		<div class="meta">
			<span class="mono">{doc.mime_type || '—'}</span>
			<span class="mono">{formatSize(doc.file_size)}</span>
			<span class="mono">{elements.length} Elemente · {paragraphs.length} Absätze</span>
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
					Hermeneutik: {totalProcessed.withMemo}/{totalProcessed.total}
				</span>
				{#if briefSwitchError}
					<span class="brief-error">Wechsel fehlgeschlagen: {briefSwitchError}</span>
				{/if}
			{/if}
		</div>
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
								Die hermeneutische Pipeline läuft sequenziell über das zentrale Dokument.
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
									Argumentations-Graph pro Absatz · Subkapitel-Synthesen · Hauptkapitel-Synthesen
									· Werk-Synthese.
								</p>
							</header>
							<div class="pass-grid">
								{#each ANALYTICAL_ORDER as key, i (key)}
									{@const p = pipelineStatus.passes[key]}
									{@const isAgPass = key === 'argumentation_graph'}
									{@const enabled = !isAgPass || p.enabled !== false}
									{@const state = passState(p)}
									{@const phaseLabel = run?.current_phase && PHASE_TO_PASS[run.current_phase] === key}
									<article
										class="pass-card pass-{state}"
										class:disabled={!enabled}
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
										{#if !enabled}
											<p class="pass-note">Im Brief deaktiviert (argumentation_graph=false).</p>
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
							<article class="outline-node level-{Math.min(h.level, 5)}" style:--indent="{indent}">
								<header class="outline-node-head">
									<span class="lvl-tag">L{h.level}</span>
									{#if h.numbering}
										<span class="num-tag">{h.numbering}</span>
									{/if}
									<h3 class="outline-heading">{h.text}</h3>
									{#if cov && cov.total > 0}
										<span class="coverage-tag" class:done={cov.withMemo === cov.total}>
											{cov.withMemo}/{cov.total} ¶
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
														title={targetId ? `Reader öffnen am ${seg.raw}` : `Kein Absatz §${seg.paraNum} in diesem Abschnitt`}
														onclick={() => targetId && openReader({ elementId: targetId, argumentId: seg.argNum != null ? `A${seg.argNum}` : undefined })}
													>{seg.raw}</button>
												{/if}
											{/each}
										</div>
									</div>
								{:else if (cov?.total ?? 0) > 0 && (cov?.withMemo ?? 0) === cov?.total}
									<p class="synth-pending">
										Per-¶-Pass abgeschlossen, Section-Collapse steht noch aus.
									</p>
								{:else if (cov?.total ?? 0) > 0}
									<p class="synth-pending">
										Per-¶-Pass läuft noch ({cov?.withMemo}/{cov?.total} Absätze analysiert).
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
	scrollTarget={readerScrollTarget}
/>

<style>
	.page { padding: 2rem; max-width: 1400px; margin: 0 auto; }

	.doc-head { margin-bottom: 1.5rem; border-bottom: 1px solid #2a2d3a; padding-bottom: 0.5rem; }
	.title-row { display: flex; align-items: center; gap: 1rem; }
	.title-row h1 { flex: 1; font-size: 1.4rem; margin: 0 0 0.5rem; color: #e1e4e8; }
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

	.empty { color: #6b7280; font-size: 0.85rem; font-style: italic; }
</style>