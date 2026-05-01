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
	type PassKey = 'paragraph' | 'argumentation_graph' | 'subchapter' | 'chapter' | 'work';
	type PassStatus = { completed: number; total: number | null; last_run: string | null; enabled?: boolean };
	type PipelineStatus = {
		case_id: string;
		document_id: string | null;
		brief: { id: string; name: string; argumentation_graph: boolean } | null;
		total_paragraphs: number;
		passes: Record<PassKey, PassStatus>;
	};

	const PASS_ORDER: PassKey[] = ['paragraph', 'argumentation_graph', 'subchapter', 'chapter', 'work'];
	const PASS_LABEL: Record<PassKey, string> = {
		paragraph: 'Per-Absatz-Hermeneutik',
		argumentation_graph: 'Argumentation pro Absatz',
		subchapter: 'Subkapitel-Synthesen (L3)',
		chapter: 'Hauptkapitel-Synthesen (L1)',
		work: 'Werk-Synthese (L0)',
	};
	const PASS_DESC: Record<PassKey, string> = {
		paragraph: 'Formulierender und interpretierender Memo pro Absatz',
		argumentation_graph: 'Argumente und Edges pro Absatz; Scaffolding-Elemente',
		subchapter: 'Kontextualisierende Synthese pro Subkapitel',
		chapter: 'Kontextualisierende Synthese pro Hauptkapitel',
		work: 'Werk-Synthese aus den Hauptkapitel-Synthesen',
	};

	let pipelineStatus = $state<PipelineStatus | null>(null);
	let pipelineLoading = $state(false);
	let pipelineError = $state<string | null>(null);

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
					<div class="pipeline-head">
						<div>
							<h2>Pipeline-Status</h2>
							<p class="pipeline-sub">
								Stand pro hermeneutischem Pass des zentralen Dokuments.
								Der Wert wird aus den persistierten Memos und Argumenten abgeleitet.
							</p>
						</div>
						<button
							class="refresh-btn"
							onclick={loadPipelineStatus}
							disabled={pipelineLoading}
						>
							{pipelineLoading ? 'Aktualisiere…' : 'Neu laden'}
						</button>
					</div>

					{#if pipelineError}
						<div class="error-box">Status konnte nicht geladen werden: {pipelineError}</div>
					{/if}

					{#if pipelineStatus}
						<div class="pass-grid">
							{#each PASS_ORDER as key (key)}
								{@const p = pipelineStatus.passes[key]}
								{@const enabled = key !== 'argumentation_graph' || p.enabled !== false}
								{@const state = passState(p)}
								<article class="pass-card pass-{state}" class:disabled={!enabled}>
									<header class="pass-head">
										<h3>{PASS_LABEL[key]}</h3>
										<span class="pass-state-tag tag-{state}">
											{state === 'done' ? 'Abgeschlossen' : state === 'partial' ? 'Teilweise' : 'Noch nicht gestartet'}
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

						<aside class="trigger-hint">
							<strong>Trigger</strong> — Pässe werden derzeit über die scripts in
							<code>scripts/run-*.ts</code> oder per Einzelaufruf an
							<code>/api/cases/{caseInfo.id}/hermeneutic/paragraph/&lt;id&gt;</code>
							angestoßen. Auto-Trigger und SSE-Live-Status folgen in einem
							separaten Schritt.
						</aside>
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
	.pass-head h3 {
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

	.trigger-hint {
		padding: 0.7rem 0.9rem;
		font-size: 0.8rem;
		color: #8b8fa3;
		background: rgba(165, 180, 252, 0.04);
		border-left: 3px solid rgba(165, 180, 252, 0.3);
		border-radius: 0 4px 4px 0;
		line-height: 1.5;
	}
	.trigger-hint code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		color: #a5b4fc;
		background: rgba(165, 180, 252, 0.08);
		padding: 0.05rem 0.3rem;
		border-radius: 3px;
	}

	.empty { color: #6b7280; font-size: 0.85rem; font-style: italic; }
</style>