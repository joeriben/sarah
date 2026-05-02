<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Reader-Modal: Peek-Lesefenster für §X:AY-Anker-Klicks aus dem Outline-Tab.
  Hält die Outline-Scrollposition, während der User ein einzelnes Argument im
  Dokument verifiziert. Drei Modi:
   - arguments: Paragraph + Argumente/Memos/Codes inline (Default wenn Case existiert)
   - structure: alle parsed elements als debug-Liste
   - raw: Volltext

  Stufe 2d (geplant): scroll-into-view auf paragraph_id, Argument-Highlight via
  scrollTarget-Prop.
-->
<script lang="ts">
	import type { DocumentElement, ParagraphMemo, CodeAnchor, HeadingSynthesis, CaseInfo, ParagraphAnalysis } from './+page.server.js';
	import DocumentReader from './DocumentReader.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		document: { id: string; label: string; full_text: string | null };
		elements: DocumentElement[];
		caseInfo: CaseInfo | null;
		memosByElement: Record<string, ParagraphMemo[]>;
		codesByElement: Record<string, CodeAnchor[]>;
		synthesesByHeading: Record<string, HeadingSynthesis>;
		analysisByElement: Record<string, ParagraphAnalysis>;
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
		analysisByElement,
		scrollTarget = null,
	}: Props = $props();

	type Mode = 'arguments' | 'structure' | 'raw';
	let mode = $state<Mode>(caseInfo ? 'arguments' : 'structure');

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const e of elements) m.set(e.element_type, (m.get(e.element_type) || 0) + 1);
		return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onClose();
	}
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
					<button class:active={mode === 'arguments'} onclick={() => (mode = 'arguments')}>Argumente</button>
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
				<!-- mode === 'arguments' -->
				<DocumentReader
					{elements}
					{memosByElement}
					{codesByElement}
					{synthesesByHeading}
					{analysisByElement}
					scrollTarget={open ? scrollTarget : null}
				/>
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

	.empty { color: #6b7280; font-size: 0.9rem; }
</style>