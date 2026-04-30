<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  SARAH document reader.
  - Default mode: lists every parsed element (debug-style).
  - Hermeneutic mode (when this document is central in a case): renders
    section_kind='main' headings + paragraphs as a reader, with each
    paragraph showing its interpretierende (and optionally formulierende)
    Memo plus Kernthesen-Code chips, and each subchapter heading carrying
    its kontextualisierende Synthese.
-->
<script lang="ts">
	import type { DocumentElement, ParagraphMemo, CodeAnchor, SubchapterSynthesis, CaseInfo } from './+page.server.js';

	let { data } = $props();
	const doc = $derived(data.document);
	const elements = $derived(data.elements as DocumentElement[]);
	const caseInfo = $derived(data.case as CaseInfo | null);
	const memosByElement = $derived(data.memosByElement as Record<string, ParagraphMemo[]>);
	const codesByElement = $derived(data.codesByElement as Record<string, CodeAnchor[]>);
	const synthesesByHeading = $derived(data.synthesesByHeading as Record<string, SubchapterSynthesis>);

	type Mode = 'hermeneutic' | 'structure' | 'raw';
	let mode = $state<Mode>(caseInfo ? 'hermeneutic' : 'structure');

	function formatSize(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const e of elements) m.set(e.element_type, (m.get(e.element_type) || 0) + 1);
		return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
	});

	// In hermeneutic mode, only main-section headings and paragraphs flow.
	// Sentences and apparatus elements stay out of the reader.
	const hermeneuticElements = $derived(
		elements.filter(
			(e) =>
				e.section_kind === 'main' &&
				(e.element_type === 'heading' || e.element_type === 'paragraph')
		)
	);

	// Track paragraph position within its current subchapter, for §-numbering.
	const positionInSubchapter = $derived.by(() => {
		const map = new Map<string, number>();
		let currentHeading = -1;
		let posInSection = 0;
		for (const e of hermeneuticElements) {
			if (e.element_type === 'heading') {
				currentHeading = e.char_start;
				posInSection = 0;
			} else if (e.element_type === 'paragraph') {
				posInSection += 1;
				map.set(e.id, posInSection);
			}
		}
		return map;
	});

	function memosFor(id: string): ParagraphMemo[] {
		return memosByElement[id] ?? [];
	}
	function codesFor(id: string): CodeAnchor[] {
		return codesByElement[id] ?? [];
	}
	function synthesisFor(id: string): SubchapterSynthesis | null {
		return synthesesByHeading[id] ?? null;
	}

	const totalProcessed = $derived.by(() => {
		let withMemo = 0;
		let total = 0;
		for (const e of hermeneuticElements) {
			if (e.element_type === 'paragraph') {
				total += 1;
				if (memosByElement[e.id]?.some((m) => m.memo_type === 'interpretierend')) {
					withMemo += 1;
				}
			}
		}
		return { withMemo, total };
	});
</script>

<div class="reader" class:hermeneutic={mode === 'hermeneutic'}>
	<header>
		<h1>{doc.label}</h1>
		<div class="meta">
			<span class="mono">{doc.mime_type || '—'}</span>
			<span class="mono">{formatSize(doc.file_size)}</span>
			<span class="mono">{elements.length} elements</span>
			{#if caseInfo}
				<span class="case-tag">case: {caseInfo.name}</span>
				{#if caseInfo.briefName}
					<span class="brief-tag">{caseInfo.briefName}</span>
				{/if}
				<span class="progress-tag">
					hermeneutik: {totalProcessed.withMemo}/{totalProcessed.total} Absätze
				</span>
			{/if}
		</div>
		{#if mode === 'structure'}
			<div class="counts">
				{#each counts as [type, n]}
					<span class="count-pill"><strong>{n}</strong> {type}</span>
				{/each}
			</div>
		{/if}
		<div class="mode-switch">
			{#if caseInfo}
				<button class:active={mode === 'hermeneutic'} onclick={() => (mode = 'hermeneutic')}>Hermeneutik</button>
			{/if}
			<button class:active={mode === 'structure'} onclick={() => (mode = 'structure')}>Struktur</button>
			<button class:active={mode === 'raw'} onclick={() => (mode = 'raw')}>Volltext</button>
		</div>
	</header>

	{#if mode === 'raw'}
		<pre class="raw">{doc.full_text || ''}</pre>
	{:else if mode === 'structure'}
		{#if elements.length === 0}
			<p class="empty">No parsed elements. Hit Parse on the documents list to populate.</p>
		{:else}
			<div class="elements">
				{#each elements as el}
					<div class="el el-{el.element_type}">
						<span class="badge">{el.element_type}</span>
						<span class="anchor mono">{el.char_start}–{el.char_end}</span>
						{#if el.text}<span class="content">{el.text}</span>{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- mode === 'hermeneutic' -->
		<div class="herm">
			{#each hermeneuticElements as el (el.id)}
				{#if el.element_type === 'heading'}
					{@const synthesis = synthesisFor(el.id)}
					<section class="herm-section">
						<h2 class="herm-heading">{el.text?.trim()}</h2>
						{#if synthesis}
							<div class="synthesis">
								<div class="synth-label">Kontextualisierende Synthese</div>
								<div class="synth-content">{synthesis.content}</div>
							</div>
						{/if}
					</section>
				{:else}
					{@const interpr = memosFor(el.id).find((m) => m.memo_type === 'interpretierend')}
					{@const formul = memosFor(el.id).find((m) => m.memo_type === 'formulierend')}
					{@const codes = codesFor(el.id)}
					{@const pos = positionInSubchapter.get(el.id)}
					<article class="herm-paragraph" class:no-memo={!interpr}>
						<div class="para-text">
							{#if pos != null}
								<span class="para-num">§{pos}</span>
							{/if}
							{el.text}
						</div>
						{#if interpr || formul || codes.length > 0}
							<aside class="memo-pane">
								{#if formul}
									<div class="memo memo-formulierend">
										<div class="memo-label">formulierend</div>
										<div class="memo-content">{formul.content}</div>
									</div>
								{/if}
								{#if interpr}
									<div class="memo memo-interpretierend">
										<div class="memo-label">interpretierend</div>
										<div class="memo-content">{interpr.content}</div>
									</div>
								{/if}
								{#if codes.length > 0}
									<div class="codes">
										{#each codes as c}
											<span class="code-chip" title={`${c.char_start}–${c.char_end}`}>{c.phrase}</span>
										{/each}
									</div>
								{/if}
							</aside>
						{/if}
					</article>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.reader { padding: 2rem; max-width: 1400px; }
	header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.4rem; margin: 0 0 0.5rem; color: #e1e4e8; }
	.meta { display: flex; flex-wrap: wrap; gap: 0.6rem; font-size: 0.78rem; color: #6b7280; margin-bottom: 0.5rem; align-items: center; }
	.mono { font-family: 'JetBrains Mono', monospace; }
	.case-tag, .brief-tag, .progress-tag {
		font-size: 0.72rem; padding: 0.15rem 0.5rem;
		border-radius: 4px;
	}
	.case-tag { background: rgba(110, 231, 183, 0.10); color: #6ee7b7; border: 1px solid rgba(110, 231, 183, 0.25); }
	.brief-tag { background: rgba(165, 180, 252, 0.08); color: #a5b4fc; border: 1px solid rgba(165, 180, 252, 0.2); }
	.progress-tag { background: rgba(251, 191, 36, 0.08); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2); }

	.counts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
	.count-pill {
		font-size: 0.72rem; padding: 0.2rem 0.5rem;
		background: rgba(165, 180, 252, 0.08);
		border: 1px solid rgba(165, 180, 252, 0.2);
		border-radius: 4px; color: #a5b4fc;
	}
	.count-pill strong { color: #c9cdd5; font-weight: 600; }

	.mode-switch { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
	.mode-switch button {
		background: none; border: 1px solid #2a2d3a; color: #c9cdd5;
		padding: 0.35rem 0.8rem; font-size: 0.78rem;
		border-radius: 4px; cursor: pointer; font-family: inherit;
	}
	.mode-switch button:hover { border-color: #4b5060; }
	.mode-switch button.active {
		background: rgba(165, 180, 252, 0.10);
		border-color: rgba(165, 180, 252, 0.5);
		color: #c7d2fe;
	}

	.raw {
		white-space: pre-wrap;
		font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 1rem; color: #c9cdd5;
	}

	.elements { display: flex; flex-direction: column; gap: 0.4rem; }
	.el {
		display: grid;
		grid-template-columns: 110px 80px 1fr;
		gap: 0.6rem; align-items: baseline;
		padding: 0.4rem 0.6rem; border-radius: 4px;
		font-size: 0.85rem;
	}
	.el:hover { background: rgba(255,255,255,0.02); }
	.el-heading { background: rgba(165, 180, 252, 0.05); }
	.el-paragraph { color: #c9cdd5; }
	.el-sentence { color: #8b8fa3; padding-left: 1.6rem; font-size: 0.78rem; }
	.badge {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em;
		color: #6b7280; background: #161822;
		border: 1px solid #2a2d3a; border-radius: 3px;
		padding: 0.1rem 0.35rem; text-align: center;
	}
	.anchor { font-size: 0.7rem; color: #4b5563; }
	.content { line-height: 1.5; }

	/* — Hermeneutic mode — */
	.herm { display: flex; flex-direction: column; gap: 1.5rem; }
	.herm-section { padding-top: 1rem; }
	.herm-heading {
		font-size: 1.15rem; font-weight: 600; color: #e1e4e8;
		margin: 0 0 0.6rem; padding-bottom: 0.4rem;
		border-bottom: 1px solid #2a2d3a;
	}

	.synthesis {
		background: rgba(110, 231, 183, 0.05);
		border-left: 3px solid rgba(110, 231, 183, 0.5);
		padding: 0.8rem 1rem; border-radius: 0 4px 4px 0;
		margin-bottom: 1rem;
	}
	.synth-label {
		font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6ee7b7; margin-bottom: 0.4rem; font-weight: 600;
	}
	.synth-content {
		color: #c9cdd5; line-height: 1.55; font-size: 0.92rem;
	}

	.herm-paragraph {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 1.2rem;
		padding: 0.6rem 0;
		border-top: 1px solid rgba(42,45,58,0.4);
	}
	.herm-paragraph.no-memo { grid-template-columns: 1fr; opacity: 0.7; }
	.para-text {
		color: #c9cdd5; line-height: 1.6; font-size: 0.95rem;
		position: relative; padding-left: 2.2rem;
	}
	.para-num {
		position: absolute; left: 0; top: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem; color: #4b5563;
		padding-top: 0.3rem;
	}

	.memo-pane {
		display: flex; flex-direction: column; gap: 0.5rem;
		font-size: 0.85rem;
	}
	.memo {
		padding: 0.55rem 0.7rem;
		border-radius: 4px;
		border-left: 2px solid transparent;
	}
	.memo-label {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #6b7280; margin-bottom: 0.25rem; font-weight: 600;
	}
	.memo-content { color: #c9cdd5; line-height: 1.5; }
	.memo-formulierend {
		background: rgba(251, 191, 36, 0.04);
		border-left-color: rgba(251, 191, 36, 0.4);
	}
	.memo-formulierend .memo-label { color: #fbbf24; }
	.memo-interpretierend {
		background: rgba(165, 180, 252, 0.05);
		border-left-color: rgba(165, 180, 252, 0.5);
	}
	.memo-interpretierend .memo-label { color: #a5b4fc; }

	.codes { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.2rem; }
	.code-chip {
		font-size: 0.72rem; padding: 0.18rem 0.5rem;
		background: rgba(244, 114, 182, 0.06);
		color: #f9a8d4;
		border: 1px solid rgba(244, 114, 182, 0.25);
		border-radius: 999px;
		font-style: italic;
	}

	.empty { color: #6b7280; font-size: 0.9rem; }
</style>
