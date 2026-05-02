<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Hover-Popover für §X:AY-Anker im Outline-Tab.
  Zeigt Argument-Detail kompakt: claim, anchor-phrase, premises (kompakt),
  Edge-Beziehungen (intra-paragraph + cross-paragraph). Bewusst klein
  gehalten — der Reader-Modal bleibt für vertieftes Lesen zuständig.

  Position: relativ zum hovering Anchor-Element (der Caller liefert die
  Anchor-Bounding-Rect via `anchorRect`). Wir platzieren standardmäßig
  unter dem Anker; wenn unten zu wenig Platz ist, oben.
-->
<script lang="ts">
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

	let {
		anchorRect,
		argLocalId,
		paraNum,
		loading,
		error: errorMsg,
		argumentNode,
		edges,
		paragraphText,
		paragraphArgs,
		onOpenInReader,
		onClose,
		onMouseEnter,
		onMouseLeave,
	}: {
		anchorRect: DOMRect | null;
		argLocalId: string | null;
		paraNum: number;
		loading: boolean;
		error: string | null;
		argumentNode: ArgumentNode | null;
		edges: Edge[];
		// Für plain §X (ohne :AY): den Volltext und die Argument-Liste des Paragraphen.
		paragraphText: string | null;
		paragraphArgs: ArgumentNode[];
		onOpenInReader: () => void;
		onClose: () => void;
		onMouseEnter?: () => void;
		onMouseLeave?: () => void;
	} = $props();

	const PREMISE_LABEL: Record<Premise['type'], string> = {
		stated: 'gesetzt',
		carried: 'getragen',
		background: 'Hintergrund',
	};
	const KIND_VERB: Record<Edge['kind'], { out: string; in: string }> = {
		supports: { out: 'stützt', in: 'wird gestützt von' },
		refines: { out: 'präzisiert', in: 'wird präzisiert durch' },
		contradicts: { out: 'widerspricht', in: 'widersprochen von' },
		presupposes: { out: 'setzt voraus', in: 'wird vorausgesetzt von' },
	};

	function formatOther(e: Edge): string {
		const o = e.other;
		const ref = e.scope === 'prior_paragraph' && o.paraNumWithinChapter
			? `§${o.paraNumWithinChapter}:${o.argLocalId}`
			: o.argLocalId;
		return ref;
	}

	let popoverEl: HTMLDivElement | undefined = $state();
	let placement = $state<'below' | 'above'>('below');

	$effect(() => {
		if (!anchorRect || !popoverEl) return;
		const popH = popoverEl.getBoundingClientRect().height;
		const spaceBelow = window.innerHeight - anchorRect.bottom;
		placement = spaceBelow < popH + 20 && anchorRect.top > popH + 20 ? 'above' : 'below';
	});

	const positionStyle = $derived.by(() => {
		if (!anchorRect) return 'display:none;';
		const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 380));
		const top = placement === 'below'
			? anchorRect.bottom + window.scrollY + 6
			: anchorRect.top + window.scrollY - 6;
		const transform = placement === 'below' ? 'translateY(0)' : 'translateY(-100%)';
		return `left:${left}px;top:${top}px;transform:${transform};`;
	});
</script>

<!-- Popover bleibt im DOM, auch beim Hovern darüber — der Caller managt Mouseleave-Delays. -->
<div
	class="arg-popover"
	bind:this={popoverEl}
	style={positionStyle}
	role="tooltip"
	onmouseenter={() => onMouseEnter?.()}
	onmouseleave={() => onMouseLeave?.()}
>
	<header class="arg-pop-head">
		<span class="arg-pop-tag">§{paraNum}{argLocalId ? `:${argLocalId}` : ''}</span>
		{#if argumentNode}
			<span class="arg-pop-pos">Position {argumentNode.positionInParagraph} im Absatz</span>
		{/if}
		<button type="button" class="arg-pop-close" onclick={onClose} aria-label="Schließen">×</button>
	</header>

	{#if loading}
		<div class="arg-pop-body">
			<p class="arg-pop-loading">Lade Argument…</p>
		</div>
	{:else if errorMsg}
		<div class="arg-pop-body">
			<p class="arg-pop-error">Konnte nicht geladen werden: {errorMsg}</p>
		</div>
	{:else if argLocalId == null}
		<!-- Plain §X (ohne :AY): Paragraph-Übersicht — Volltext-Snippet + Argument-Liste. -->
		<div class="arg-pop-body">
			{#if paragraphText}
				<section class="arg-pop-paratext">
					<div class="arg-pop-label">Absatz-Text</div>
					<div class="paratext-scroll">
						<p class="paratext">{paragraphText}</p>
					</div>
				</section>
			{/if}
			{#if paragraphArgs.length > 0}
				<section class="arg-pop-paraargs">
					<div class="arg-pop-label">Argumente in diesem Absatz ({paragraphArgs.length})</div>
					<ul class="paraargs-list">
						{#each paragraphArgs as a (a.id)}
							<li>
								<span class="paraarg-id">{a.argLocalId}</span>
								<span class="paraarg-claim">{a.claim}</span>
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="arg-pop-empty">Kein Argumentations-Graph für diesen Absatz — der Pass wurde noch nicht ausgeführt oder hat hier keine Argumente extrahiert.</p>
			{/if}
			<footer class="arg-pop-foot">
				<button type="button" class="arg-pop-open" onclick={onOpenInReader}>
					Im Reader öffnen →
				</button>
			</footer>
		</div>
	{:else if !argumentNode}
		<div class="arg-pop-body">
			<p class="arg-pop-empty">
				Kein Argument {argLocalId} in §{paraNum} gefunden — die ID stimmt
				nicht mit einem extrahierten Argument überein.
			</p>
		</div>
	{:else}
		<div class="arg-pop-body">
			<section class="arg-pop-claim">
				<div class="arg-pop-label">Claim</div>
				<p>{argumentNode.claim}</p>
			</section>

			{#if argumentNode.anchorPhrase}
				<section class="arg-pop-anchor">
					<div class="arg-pop-label">Anker im Text</div>
					<blockquote>„{argumentNode.anchorPhrase}"</blockquote>
				</section>
			{/if}

			{#if argumentNode.premises.length > 0}
				<section class="arg-pop-premises">
					<div class="arg-pop-label">Prämissen ({argumentNode.premises.length})</div>
					<ul>
						{#each argumentNode.premises as p}
							<li>
								<span class="prem-type prem-{p.type}">{PREMISE_LABEL[p.type]}</span>
								<span class="prem-text">{p.text}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if edges.length > 0}
				{@const outgoing = edges.filter(e => e.direction === 'outgoing')}
				{@const incoming = edges.filter(e => e.direction === 'incoming')}
				<section class="arg-pop-edges">
					<div class="arg-pop-label">Edge-Beziehungen</div>
					<ul class="edges-list">
						{#each outgoing as e}
							<li class="edge edge-{e.kind}">
								<span class="edge-verb">{KIND_VERB[e.kind].out}</span>
								<span class="edge-target">{formatOther(e)}</span>
								<span class="edge-snippet">{e.other.claimSnippet}</span>
							</li>
						{/each}
						{#each incoming as e}
							<li class="edge edge-{e.kind} edge-incoming">
								<span class="edge-verb">{KIND_VERB[e.kind].in}</span>
								<span class="edge-target">{formatOther(e)}</span>
								<span class="edge-snippet">{e.other.claimSnippet}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<footer class="arg-pop-foot">
				<button type="button" class="arg-pop-open" onclick={onOpenInReader}>
					Im Reader öffnen →
				</button>
			</footer>
		</div>
	{/if}
</div>

<style>
	.arg-popover {
		position: absolute;
		width: 420px;
		max-width: calc(100vw - 16px);
		max-height: min(70vh, 640px);
		overflow-y: auto;
		background: #1a1d28;
		border: 1px solid rgba(165, 180, 252, 0.4);
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		z-index: 1000;
		font-size: 0.82rem;
		color: #d6dae8;
	}
	.arg-pop-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid #2a2d3a;
		background: rgba(165, 180, 252, 0.07);
	}
	.arg-pop-tag {
		font-weight: 600;
		color: #c7d2fe;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.78rem;
	}
	.arg-pop-pos {
		font-size: 0.7rem;
		color: #8b8fa3;
	}
	.arg-pop-close {
		margin-left: auto;
		background: transparent;
		border: none;
		color: #8b8fa3;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.3rem;
		line-height: 1;
	}
	.arg-pop-close:hover { color: #e7eaf6; }
	.arg-pop-body {
		padding: 0.6rem 0.75rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.arg-pop-label {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8fa3;
		margin-bottom: 0.2rem;
	}
	.arg-pop-claim p {
		margin: 0;
		line-height: 1.45;
		color: #e7eaf6;
	}
	.arg-pop-anchor blockquote {
		margin: 0;
		padding: 0.35rem 0.55rem;
		border-left: 2px solid rgba(165, 180, 252, 0.4);
		background: rgba(255,255,255,0.025);
		font-style: italic;
		font-size: 0.78rem;
		color: #b8bccc;
		line-height: 1.4;
	}
	.arg-pop-premises ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.arg-pop-premises li {
		display: flex;
		gap: 0.4rem;
		align-items: flex-start;
		font-size: 0.78rem;
		line-height: 1.4;
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
	.prem-text { flex: 1; }

	.edges-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.edge {
		display: grid;
		grid-template-columns: auto auto 1fr;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 0.76rem;
		line-height: 1.35;
	}
	.edge-verb {
		color: #8b8fa3;
		font-style: italic;
		white-space: nowrap;
	}
	.edge-target {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-weight: 600;
		color: #c7d2fe;
	}
	.edge-snippet {
		color: #b8bccc;
		font-size: 0.74rem;
	}
	.edge-supports .edge-verb { color: #6ee7b7; }
	.edge-contradicts .edge-verb { color: #f87171; }
	.edge-refines .edge-verb { color: #fbbf24; }
	.edge-presupposes .edge-verb { color: #c7d2fe; }

	.arg-pop-foot {
		padding-top: 0.4rem;
		border-top: 1px dashed #2a2d3a;
		display: flex;
	}
	.arg-pop-open {
		background: transparent;
		border: 1px solid rgba(165, 180, 252, 0.35);
		color: #c7d2fe;
		padding: 0.3rem 0.6rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.76rem;
	}
	.arg-pop-open:hover {
		background: rgba(165, 180, 252, 0.1);
	}

	.arg-pop-loading, .arg-pop-error, .arg-pop-empty {
		margin: 0;
		font-size: 0.78rem;
		color: #8b8fa3;
		font-style: italic;
	}
	.arg-pop-error { color: #f87171; }

	.paratext-scroll {
		max-height: 220px;
		overflow-y: auto;
		padding: 0.4rem 0.55rem;
		background: rgba(255,255,255,0.02);
		border-left: 2px solid rgba(165, 180, 252, 0.25);
		border-radius: 0 4px 4px 0;
	}
	.paratext {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #d6dae8;
		white-space: pre-wrap;
	}
	.paraargs-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.paraargs-list li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 0.76rem;
		line-height: 1.4;
	}
	.paraarg-id {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-weight: 600;
		color: #c7d2fe;
		font-size: 0.74rem;
	}
	.paraarg-claim {
		color: #d6dae8;
	}
</style>
