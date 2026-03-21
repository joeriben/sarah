<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import type { CanvasPositions } from './canvasPositions.svelte.js';

	let {
		rel,
		cp,
	}: {
		rel: any;
		cp: CanvasPositions;
	} = $props();

	const ms = getMapState();
</script>

<div class="relation-diamond" class:ai-suggested={rel.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(rel.properties)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(rel)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(rel)} class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(rel.naming_id)} class:centered-anchor={cp.centeredId === rel.naming_id}
	style="{ms.highlightedPhase && ms.isPhaseHighlighted(rel) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}">
	<svg class="diamond-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
		<polygon points="12,0 88,0 100,50 88,100 12,100 0,50" fill="#161822" stroke="#2a2d3a" stroke-width="1.5"/>
	</svg>
	<div class="diamond-content">
		{#if rel.valence}<span class="rd-valence">{rel.valence}</span>{/if}
		{#if rel.inscription}
			<span class="rd-text">{rel.inscription}</span>
		{:else}
			<span class="rd-text unnamed">
				{ms.findInscription(rel.directed_from || rel.part_source_id)} → {ms.findInscription(rel.directed_to || rel.part_target_id)}
			</span>
		{/if}
	</div>
</div>

<style>
	.relation-diamond {
		position: relative; min-width: 90px; max-width: 200px; min-height: 36px;
		display: flex; align-items: center; justify-content: center; text-align: center;
	}
	.diamond-bg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.diamond-content { position: relative; z-index: 1; padding: 0.3rem 1.2rem; display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
	.relation-diamond.ai-suggested .diamond-bg polygon { fill: #1a1d2e; }
	.relation-diamond.ai-withdrawn { opacity: 0.3; }
	.relation-diamond.phase-member { filter: drop-shadow(0 0 3px var(--phase-color)); }
	.relation-diamond.phase-dimmed { opacity: 0.25; }
	.relation-diamond.centered-dim { opacity: 0.15; }
	.relation-diamond.centered-anchor .diamond-bg polygon { stroke: #f59e0b; }
	.rd-valence { font-size: 0.65rem; color: #8b8fa3; font-style: italic; }
	.rd-text { color: #c9cdd5; font-size: 0.75rem; }
	.rd-text.unnamed { color: #4b5563; font-size: 0.65rem; font-style: italic; }
</style>
