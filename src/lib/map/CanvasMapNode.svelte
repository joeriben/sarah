<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import type { CanvasPositions } from './canvasPositions.svelte.js';

	let {
		el,
		cp,
	}: {
		el: any;
		cp: CanvasPositions;
	} = $props();

	const ms = getMapState();
</script>

<div class="map-node" class:absent={el.properties?.absent} class:ai-suggested={el.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(el.properties)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(el)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(el)} class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(el.naming_id)} class:centered-anchor={cp.centeredId === el.naming_id}
	style="{ms.highlightedPhase && ms.isPhaseHighlighted(el) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}">
	<div class="node-header">
		<span class="designation-dot" style="background: {ms.designationColor(el.designation)}"></span>
		{#if el.has_document_anchor}
			<img class="prov-icon" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
		{:else if el.has_memo_link}
			<img class="prov-icon" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
		{:else}
			<img class="prov-icon" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding" />
		{/if}
		<span class="node-designation">{ms.designationLabel(el.designation)}</span>
		{#if el.memo_previews?.length > 0}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="memo-badge" title="{el.memo_previews.length} memo(s)" onclick={(e) => { e.stopPropagation(); ms.showStack(el.naming_id); }}>
				{el.memo_previews.length}
			</span>
		{/if}
		{#if el.phase_ids?.length}
			<span class="phase-dots">
				{#each el.phase_ids as cid}
					{@const c = ms.phaseColorMap.get(cid)}
					{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === cid)?.label}></span>{/if}
				{/each}
			</span>
		{/if}
	</div>
	{#if ms.editingId === el.naming_id}
		<form class="inline-rename" onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
			<input type="text" bind:value={ms.editingValue} />
			<button type="submit" class="btn-xs">ok</button>
		</form>
	{:else}
		<span class="node-label">{el.inscription}</span>
	{/if}
	{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
		<span class="collapsed-hint">now: {el.current_inscription}</span>
	{/if}
	{#if el.memo_previews?.length}
		<div class="memo-tooltip">
			{#each el.memo_previews.slice(0, 4) as mp}
				<div class="memo-tip-entry">
					<div class="memo-tip-header">
						<span class="memo-tip-provenance" class:tip-ai={mp.isAi}>{mp.isAi ? 'AI' : 'R'}</span>
						<span class="memo-tip-label">{mp.label}</span>
						{#if mp.status && mp.status !== 'active'}
							<span class="memo-tip-status tip-status-{mp.status}">{mp.status}</span>
						{/if}
					</div>
					{#if mp.content}<span class="memo-tip-content">{mp.content.slice(0, 150)}{mp.content.length > 150 ? '\u2026' : ''}</span>{/if}
				</div>
			{/each}
			{#if el.memo_previews.length > 4}
				<span class="memo-tip-more">+{el.memo_previews.length - 4} more</span>
			{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="memo-tip-open" onclick={(e) => { e.stopPropagation(); ms.showStack(el.naming_id); }}>open stack</span>
		</div>
	{/if}
</div>

<style>
	.map-node {
		position: relative; background: #161822;
		border: 2px solid var(--el-color, #8b9cf7); border-radius: 8px;
		padding: 0.4rem 0.6rem; min-width: 80px; max-width: 220px;
	}
	.map-node.absent {
		border-style: dashed; border-color: #4b5563;
		background: rgba(22, 24, 34, 0.6); opacity: 0.7;
	}
	.map-node.absent .node-label { color: #6b7280; font-style: italic; }
	.map-node.ai-suggested { border-style: dashed; border-color: rgba(139, 156, 247, 0.5); background: rgba(139, 156, 247, 0.04); }
	.map-node.ai-withdrawn { opacity: 0.3; border-color: rgba(139, 156, 247, 0.2); }
	.map-node.phase-dimmed { opacity: 0.3; transition: opacity 0.3s; }
	.map-node.centered-dim { opacity: 0.35; transition: opacity 0.3s; }
	.map-node.centered-anchor { box-shadow: 0 0 12px rgba(245, 158, 11, 0.6), 0 0 4px rgba(245, 158, 11, 0.3); }
	.map-node.phase-member { animation: phase-pulse 2s ease-in-out infinite; --pulse-color: var(--phase-color, #8b9cf7); }
	@keyframes phase-pulse {
		0%, 100% { box-shadow: 0 0 6px var(--pulse-color); }
		50% { box-shadow: 0 0 20px var(--pulse-color), inset 0 0 0 2px var(--pulse-color); }
	}
	.node-header { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.15rem; }
	.designation-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.prov-icon { width: 12px; height: 12px; opacity: 0.5; }
	.node-designation { font-size: 0.6rem; color: var(--el-color); text-transform: uppercase; letter-spacing: 0.04em; }
	.phase-dots { display: inline-flex; gap: 2px; margin-left: auto; }
	.phase-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
	.node-label { font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block; }
	.collapsed-hint { font-size: 0.65rem; color: #4b5563; font-style: italic; }
	.memo-badge {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 4px; min-width: 16px; height: 16px; line-height: 16px;
		text-align: center; cursor: pointer; flex-shrink: 0; margin-left: auto;
	}
	.memo-badge:hover { background: rgba(245, 158, 11, 0.25); }
	.memo-tooltip {
		display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
		min-width: 280px; max-width: 320px;
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem; z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
	}
	.map-node:hover > .memo-tooltip { display: block; }
	.memo-tip-entry { padding: 0.25rem 0; border-bottom: 1px solid #161822; }
	.memo-tip-entry:last-child { border-bottom: none; }
	.memo-tip-header { display: flex; align-items: center; gap: 0.3rem; }
	.memo-tip-provenance {
		font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0;
	}
	.memo-tip-provenance.tip-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-tip-label { font-size: 0.7rem; color: #f59e0b; }
	.memo-tip-status {
		font-size: 0.55rem; font-weight: 600; text-transform: uppercase;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0; margin-left: auto;
	}
	:global(.tip-status-presented) { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	:global(.tip-status-discussed) { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	:global(.tip-status-acknowledged) { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	:global(.tip-status-dismissed) { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-tip-content { font-size: 0.75rem; color: #a0a4b0; display: block; margin-top: 0.1rem; }
	.memo-tip-more { font-size: 0.7rem; color: #6b7280; margin-top: 0.2rem; display: block; }
	.memo-tip-open {
		font-size: 0.68rem; color: #8b9cf7; cursor: pointer; display: block;
		margin-top: 0.3rem; padding-top: 0.2rem; border-top: 1px solid #2a2d3a;
	}
	.memo-tip-open:hover { text-decoration: underline; }
	.inline-rename { display: flex; gap: 0.3rem; align-items: center; }
	.inline-rename input {
		background: #0f1117; border: 1px solid #8b9cf7; border-radius: 4px;
		padding: 0.15rem 0.35rem; color: #e1e4e8; font-size: 0.85rem; width: 140px;
	}
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
</style>
