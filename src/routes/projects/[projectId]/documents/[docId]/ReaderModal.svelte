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
	import type { DocumentElement, ParagraphMemo, CodeAnchor, HeadingSynthesis, CaseInfo, ParagraphAnalysis, ParagraphEdge } from './+page.server.js';

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

	const PREMISE_LABEL: Record<'stated' | 'carried' | 'background', string> = {
		stated: 'gesetzt',
		carried: 'getragen',
		background: 'Hintergrund',
	};
	const KIND_VERB: Record<ParagraphEdge['kind'], { out: string; in: string }> = {
		supports: { out: 'stützt', in: 'wird gestützt von' },
		refines: { out: 'präzisiert', in: 'wird präzisiert durch' },
		contradicts: { out: 'widerspricht', in: 'widersprochen von' },
		presupposes: { out: 'setzt voraus', in: 'wird vorausgesetzt von' },
	};
	function formatEdgeTarget(e: ParagraphEdge): string {
		if (e.scope === 'prior_paragraph' && e.other.paraNumWithinChapter) {
			return `§${e.other.paraNumWithinChapter}:${e.other.argLocalId}`;
		}
		return e.other.argLocalId;
	}

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
	function analysisFor(id: string): ParagraphAnalysis | null {
		return analysisByElement?.[id] ?? null;
	}
	function hasAnyAnalysis(a: ParagraphAnalysis | null): boolean {
		return !!a && (a.args.length > 0 || a.scaffolding.length > 0 || a.edges.length > 0);
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
			// Wenn argumentId gesetzt ist, primär das Argument-Block fokussieren —
			// das hat den Pflug-effekt, den ¶ auf den Schirm zu bringen UND das
			// Argument auf die Mitte zu setzen. Sonst auf den Paragraph fallen.
			const argEl = target.argumentId
				? window.document.getElementById(`arg-${target.elementId}-${target.argumentId}`)
				: null;
			const paraEl = window.document.getElementById(`para-${target.elementId}`);
			const focus = argEl ?? paraEl;
			if (!focus) return;
			focus.scrollIntoView({ behavior: 'smooth', block: 'center' });
			if (paraEl) {
				paraEl.classList.add('flash');
				setTimeout(() => paraEl.classList.remove('flash'), 1600);
			}
			if (argEl) {
				argEl.classList.add('arg-flash');
				setTimeout(() => argEl.classList.remove('arg-flash'), 2400);
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
							{@const analysis = analysisFor(el.id)}
							{@const showAnalysis = hasAnyAnalysis(analysis)}
							{@const hasRightPane = !!interpr || !!formul || codes.length > 0 || showAnalysis}
							{@const pos = positionInSubchapter.get(el.id)}
							<article class="herm-paragraph" class:no-memo={!hasRightPane} id="para-{el.id}">
								<div class="para-text">
									{#if pos != null}
										<span class="para-num">§{pos}</span>
									{/if}
									{el.text}
								</div>
								{#if hasRightPane}
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
										{#if showAnalysis && analysis}
											{#if analysis.args.length > 0}
												<div class="analysis-block">
													<div class="memo-label analysis-label">Argumente ({analysis.args.length})</div>
													{#each analysis.args as a (a.id)}
														<div
															class="arg-block"
															class:arg-target={scrollTarget?.elementId === el.id && scrollTarget?.argumentId === a.argLocalId}
															id="arg-{el.id}-{a.argLocalId}"
														>
															<div class="arg-head">
																<span class="arg-id">{a.argLocalId}</span>
																<span class="arg-pos">Position {a.positionInParagraph}</span>
															</div>
															<div class="arg-claim">{a.claim}</div>
															{#if a.anchorPhrase}
																<blockquote class="arg-anchor">„{a.anchorPhrase}"</blockquote>
															{/if}
															{#if a.premises.length > 0}
																<ul class="premises">
																	{#each a.premises as p}
																		<li>
																			<span class="prem-type prem-{p.type}">{PREMISE_LABEL[p.type]}</span>
																			<span class="prem-text">{p.text}</span>
																		</li>
																	{/each}
																</ul>
															{/if}
														</div>
													{/each}
												</div>
											{/if}
											{#if analysis.edges.length > 0}
												<div class="analysis-block">
													<div class="memo-label analysis-label">Beziehungen ({analysis.edges.length})</div>
													<ul class="edges-list">
														{#each analysis.edges as e}
															<li class="edge edge-{e.kind}" class:edge-incoming={e.direction === 'incoming'}>
																<span class="edge-self">{e.selfArgLocalId}</span>
																<span class="edge-verb">{e.direction === 'outgoing' ? KIND_VERB[e.kind].out : KIND_VERB[e.kind].in}</span>
																<span class="edge-target">{formatEdgeTarget(e)}</span>
																<span class="edge-snippet">{e.other.claimSnippet}</span>
															</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if analysis.scaffolding.length > 0}
												<div class="analysis-block">
													<div class="memo-label analysis-label">Stützstrukturen ({analysis.scaffolding.length})</div>
													{#each analysis.scaffolding as s (s.id)}
														<div class="sc-block">
															<div class="sc-head">
																<span class="sc-id">{s.elementLocalId}</span>
																<span class="sc-fn sc-fn-{s.functionType}">{s.functionType}</span>
																{#if s.anchoredTo.length > 0}
																	<span class="sc-anchored">→ {s.anchoredTo.join(', ')}</span>
																{/if}
															</div>
															<div class="sc-desc">{s.functionDescription}</div>
															<div class="sc-assess"><span class="sc-assess-label">Beurteilung:</span> {s.assessment}</div>
														</div>
													{/each}
												</div>
											{/if}
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

	.analysis-block {
		display: flex; flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.7rem;
		border-left: 2px solid rgba(165, 180, 252, 0.35);
		background: rgba(165, 180, 252, 0.03);
		border-radius: 0 4px 4px 0;
	}
	.analysis-label { color: #a5b4fc !important; }

	.arg-block {
		padding: 0.5rem 0.6rem;
		border-radius: 4px;
		background: rgba(255,255,255,0.025);
		display: flex; flex-direction: column; gap: 0.35rem;
		transition: background 0.4s, box-shadow 0.4s;
	}
	.arg-block.arg-target {
		background: rgba(251, 191, 36, 0.08);
		box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.4);
	}
	.arg-block.arg-flash {
		background: rgba(251, 191, 36, 0.18);
		box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.6);
	}
	.arg-head { display: flex; align-items: baseline; gap: 0.5rem; }
	.arg-id {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe; font-size: 0.8rem;
	}
	.arg-pos { font-size: 0.7rem; color: #6b7280; }
	.arg-claim { color: #e1e4e8; line-height: 1.5; font-size: 0.86rem; }
	.arg-anchor {
		margin: 0;
		padding: 0.3rem 0.55rem;
		border-left: 2px solid rgba(165, 180, 252, 0.35);
		background: rgba(255,255,255,0.02);
		font-style: italic; font-size: 0.78rem;
		color: #b8bccc; line-height: 1.4;
	}
	.premises {
		margin: 0; padding: 0; list-style: none;
		display: flex; flex-direction: column; gap: 0.25rem;
	}
	.premises li {
		display: flex; gap: 0.4rem; align-items: flex-start;
		font-size: 0.78rem; line-height: 1.4;
	}
	.prem-type {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}
	.prem-stated { background: rgba(110, 231, 183, 0.15); color: #6ee7b7; }
	.prem-carried { background: rgba(165, 180, 252, 0.15); color: #c7d2fe; }
	.prem-background { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
	.prem-text { flex: 1; color: #c9cdd5; }

	.edges-list {
		margin: 0; padding: 0; list-style: none;
		display: flex; flex-direction: column; gap: 0.3rem;
	}
	.edge {
		display: grid;
		grid-template-columns: auto auto auto 1fr;
		gap: 0.4rem; align-items: baseline;
		font-size: 0.78rem; line-height: 1.35;
	}
	.edge-self {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe;
	}
	.edge-verb { color: #8b8fa3; font-style: italic; white-space: nowrap; }
	.edge-target {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #c7d2fe;
	}
	.edge-snippet { color: #b8bccc; font-size: 0.74rem; }
	.edge-supports .edge-verb { color: #6ee7b7; }
	.edge-contradicts .edge-verb { color: #f87171; }
	.edge-refines .edge-verb { color: #fbbf24; }
	.edge-presupposes .edge-verb { color: #c7d2fe; }
	.edge-incoming .edge-self { color: #8b8fa3; }

	.sc-block {
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		background: rgba(255,255,255,0.02);
		display: flex; flex-direction: column; gap: 0.3rem;
	}
	.sc-head { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; }
	.sc-id {
		font-family: 'JetBrains Mono', monospace; font-weight: 600;
		color: #f9a8d4; font-size: 0.78rem;
	}
	.sc-fn {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		border-radius: 3px;
		font-weight: 500;
	}
	.sc-fn-textorganisatorisch { background: rgba(165, 180, 252, 0.12); color: #c7d2fe; }
	.sc-fn-didaktisch { background: rgba(251, 191, 36, 0.12); color: #fbbf24; }
	.sc-fn-kontextualisierend { background: rgba(110, 231, 183, 0.12); color: #6ee7b7; }
	.sc-fn-rhetorisch { background: rgba(244, 114, 182, 0.12); color: #f9a8d4; }
	.sc-anchored {
		font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
		color: #8b8fa3;
	}
	.sc-desc { color: #c9cdd5; font-size: 0.78rem; line-height: 1.4; }
	.sc-assess { color: #b8bccc; font-size: 0.76rem; line-height: 1.4; }
	.sc-assess-label {
		font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em;
		color: #6b7280;
	}
</style>