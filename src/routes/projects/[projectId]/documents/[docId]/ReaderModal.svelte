<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Reader-Modal: Volltext-Lesefenster, das aus jedem Doc-Page-Tab oder per
  §X:AY-Anker-Klick geöffnet wird. Zeigt drei Modi:
   - hermeneutic: Paragraph + Memos + Codes inline (Default wenn Case existiert)
   - structure: alle parsed elements als debug-Liste
   - raw: Volltext

  Stufe 2d (geplant): scroll-into-view auf paragraph_id, Argument-Highlight via
  scrollTarget-Prop.
-->
<script lang="ts">
	import type { DocumentElement, ParagraphMemo, CodeAnchor, HeadingSynthesis, CaseInfo } from './+page.server.js';

	interface Props {
		open: boolean;
		onClose: () => void;
		document: { id: string; label: string; full_text: string | null };
		elements: DocumentElement[];
		caseInfo: CaseInfo | null;
		memosByElement: Record<string, ParagraphMemo[]>;
		codesByElement: Record<string, CodeAnchor[]>;
		synthesesByHeading: Record<string, HeadingSynthesis>;
		scrollTarget?: { elementId: string; argumentId?: string } | null;
	}

	let {
		open,
		onClose,
		document: doc,
		elements,
		caseInfo,
		memosByElement,
		codesByElement,
		synthesesByHeading,
		scrollTarget = null,
	}: Props = $props();

	type Mode = 'hermeneutic' | 'structure' | 'raw';
	let mode = $state<Mode>(caseInfo ? 'hermeneutic' : 'structure');

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const e of elements) m.set(e.element_type, (m.get(e.element_type) || 0) + 1);
		return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
	});

	const hermeneuticElements = $derived(
		elements.filter(
			(e) =>
				e.section_kind === 'main' &&
				(e.element_type === 'heading' || e.element_type === 'paragraph')
		)
	);

	const positionInSubchapter = $derived.by(() => {
		const map = new Map<string, number>();
		let posInSection = 0;
		for (const e of hermeneuticElements) {
			if (e.element_type === 'heading') {
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
	function synthesisFor(id: string): HeadingSynthesis | null {
		return synthesesByHeading[id] ?? null;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onClose();
	}

	$effect(() => {
		if (!open) return;
		if (typeof window === 'undefined') return;
		const target = scrollTarget;
		if (!target) return;
		queueMicrotask(() => {
			const el = window.document.getElementById(`para-${target.elementId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				el.classList.add('flash');
				setTimeout(() => el.classList.remove('flash'), 1600);
			}
		});
	});
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div
		class="backdrop"
		role="presentation"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Enter' && onClose()}
	></div>
	<aside class="modal" role="dialog" aria-modal="true" aria-label="Volltext-Reader">
		<header class="modal-head">
			<h2>{doc.label}</h2>
			<div class="mode-switch">
				{#if caseInfo}
					<button class:active={mode === 'hermeneutic'} onclick={() => (mode = 'hermeneutic')}>Hermeneutik</button>
				{/if}
				<button class:active={mode === 'structure'} onclick={() => (mode = 'structure')}>Struktur</button>
				<button class:active={mode === 'raw'} onclick={() => (mode = 'raw')}>Volltext</button>
			</div>
			<button class="close" onclick={onClose} aria-label="Schließen">×</button>
		</header>

		<div class="modal-body">
			{#if mode === 'raw'}
				<pre class="raw">{doc.full_text || ''}</pre>
			{:else if mode === 'structure'}
				{#if elements.length === 0}
					<p class="empty">Keine geparsten Elemente. Parse das Dokument in der Dokumentenliste.</p>
				{:else}
					<div class="counts">
						{#each counts as [type, n]}
							<span class="count-pill"><strong>{n}</strong> {type}</span>
						{/each}
					</div>
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
							<section class="herm-section" id="head-{el.id}">
								<h3 class="herm-heading">{el.text?.trim()}</h3>
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
							<article class="herm-paragraph" class:no-memo={!interpr} id="para-{el.id}">
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
	</aside>
{/if}

<style>
	.backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.55);
		z-index: 80; backdrop-filter: blur(2px);
	}
	.modal {
		position: fixed; top: 3rem; left: 50%; transform: translateX(-50%);
		width: min(94vw, 1280px); max-height: calc(100vh - 6rem);
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 8px;
		box-shadow: 0 20px 60px rgba(0,0,0,0.6);
		z-index: 81; display: flex; flex-direction: column;
		overflow: hidden;
	}
	.modal-head {
		display: flex; align-items: center; gap: 1rem;
		padding: 0.8rem 1.2rem; border-bottom: 1px solid #2a2d3a;
		background: #161822;
	}
	.modal-head h2 {
		flex: 1; margin: 0; font-size: 1rem; font-weight: 600;
		color: #e1e4e8;
	}
	.close {
		background: none; border: none; color: #8b8fa3;
		font-size: 1.6rem; line-height: 1; cursor: pointer;
		padding: 0 0.4rem;
	}
	.close:hover { color: #e1e4e8; }
	.modal-body {
		overflow-y: auto;
		padding: 1.2rem 1.4rem;
		flex: 1;
	}

	.mode-switch { display: flex; gap: 0.4rem; }
	.mode-switch button {
		background: none; border: 1px solid #2a2d3a; color: #c9cdd5;
		padding: 0.32rem 0.7rem; font-size: 0.78rem;
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

	.counts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
	.count-pill {
		font-size: 0.72rem; padding: 0.2rem 0.5rem;
		background: rgba(165, 180, 252, 0.08);
		border: 1px solid rgba(165, 180, 252, 0.2);
		border-radius: 4px; color: #a5b4fc;
	}
	.count-pill strong { color: #c9cdd5; font-weight: 600; }

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
	.mono { font-family: 'JetBrains Mono', monospace; }

	.herm { display: flex; flex-direction: column; gap: 1.5rem; }
	.herm-section { padding-top: 1rem; }
	.herm-heading {
		font-size: 1.1rem; font-weight: 600; color: #e1e4e8;
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
	.synth-content { color: #c9cdd5; line-height: 1.55; font-size: 0.92rem; }

	.herm-paragraph {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 1.2rem;
		padding: 0.6rem 0;
		border-top: 1px solid rgba(42,45,58,0.4);
		transition: background 0.4s;
	}
	.herm-paragraph.flash { background: rgba(251, 191, 36, 0.10); }
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