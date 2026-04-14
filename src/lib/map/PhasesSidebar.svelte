<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import { regionColor } from '$lib/canvas/regions.js';

	let { selection }: { selection: ReturnType<typeof createSelection> } = $props();

	const ms = getMapState();
</script>

<div class="sidebar">
	<div class="sidebar-header">
		<h3 title="Phase (Dewey/Bentley, Knowing and the Known, 1949): a developmental grouping of namings within the situation. Forming a phase IS characterizing — the designation gradient (cue → characterization → specification) collapsed into analytical wholes. Not a computed cluster.">Phases</h3>
		<button class="btn-sm" onclick={() => ms.showPhaseForm = !ms.showPhaseForm}>
			{ms.showPhaseForm ? 'x' : '+'}
		</button>
	</div>

	{#if ms.showPhaseForm}
		<form class="phase-form" onsubmit={e => { e.preventDefault(); ms.addPhase(); }}>
			<input type="text" placeholder="Phase label..." bind:value={ms.newPhaseLabel} />
			<button type="submit" class="btn-sm">Create</button>
		</form>
	{/if}

	{#if ms.phases.length === 0}
		<p class="empty-small">No phases yet.</p>
	{:else}
		{#each ms.phases as phase, i}
			<div class="phase-card" class:assigning={ms.assigningToPhase === phase.id} class:phase-active={ms.highlightedPhase === phase.id}
				style="border-left: 3px solid {regionColor(i)}">
				<div class="phase-header">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span class="phase-label clickable" onclick={() => { ms.highlightedPhase = ms.highlightedPhase === phase.id ? null : phase.id; ms.togglePhase(phase.id); }}>{phase.label}</span>
					<span class="phase-count">{phase.element_count}</span>
				</div>
				<button class="btn-xs"
					onclick={() => ms.assigningToPhase = ms.assigningToPhase === phase.id ? null : phase.id}>
					{ms.assigningToPhase === phase.id ? 'done' : 'assign'}
				</button>
				{#if ms.expandedPhase === phase.id}
					<div class="phase-contents">
						{#each ms.phaseContents as pc}
							<div class="phase-element">
								<span class="designation-dot-sm" style="background: {ms.designationColor(pc.designation)}"></span>
								<span class="phase-el-label">{pc.inscription}</span>
								<button class="btn-xs btn-remove" title="Remove from phase"
									onclick={() => ms.removeFromPhase(phase.id, pc.naming_id)}>×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	{#if ms.docPhases.length > 0}
		<div class="section-divider">Documents</div>
		{#each ms.docPhases as dc}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="phase-card doc-phase" class:phase-active={ms.highlightedPhase === dc.doc_id}
				style="border-left: 3px solid #6b7280">
				<div class="phase-header">
					<span class="phase-label clickable" onclick={() => { ms.highlightedPhase = ms.highlightedPhase === dc.doc_id ? null : dc.doc_id; }}>
						<span class="doc-icon">&#128196;</span> {dc.doc_label}
					</span>
					<span class="phase-count">{dc.naming_ids?.length || 0}</span>
				</div>
			</div>
		{/each}
	{/if}

	{#if ms.declinedCount > 0}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="phase-card declined-phase" class:phase-active={ms.isDeclinedFilter}
			style="border-left: 3px solid #6b7280">
			<div class="phase-header">
				<span class="phase-label clickable" onclick={() => { ms.highlightedPhase = ms.isDeclinedFilter ? null : ms.DECLINED_PHASE; }}>Declined</span>
				<span class="phase-count">{ms.declinedCount}</span>
			</div>
			<span class="declined-hint">{ms.isDeclinedFilter ? 'hidden' : 'click to hide'}</span>
		</div>
	{/if}

	{#if selection.count > 0}
		<div class="selection-info">
			<h4>Selected ({selection.count})</h4>
			{#each [...selection.ids] as id}
				{@const node = ms.findNode(id)}
				{#if node}
					<div class="selected-item">
						<span class="designation-dot-sm" style="background: {ms.designationColor(node.designation)}"></span>
						<span>{node.inscription || '(unnamed)'}</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.sidebar {
		width: 220px; background: #13151e; border-left: 1px solid #2a2d3a;
		padding: 1rem; overflow-y: auto; flex-shrink: 0;
	}
	.sidebar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
	.sidebar-header h3 { font-size: 0.85rem; color: #8b8fa3; margin: 0; }
	.phase-form { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
	.phase-form input {
		flex: 1; min-width: 0; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.phase-form input:focus { outline: none; border-color: #8b9cf7; }
	.empty-small { color: #6b7280; font-size: 0.8rem; }
	.phase-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.3rem;
	}
	.phase-card.assigning { border-color: #10b981; }
	.phase-card.phase-active { background: #1e2030; }
	.section-divider {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;
		margin: 0.75rem 0 0.3rem; padding-top: 0.5rem; border-top: 1px solid #2a2d3a;
	}
	.doc-phase { border-style: dotted; }
	.doc-icon { font-size: 0.7rem; }
	.declined-phase { margin-top: 0.5rem; border-style: dashed; }
	.declined-hint { font-size: 0.65rem; color: #6b7280; }
	.phase-header { display: flex; justify-content: space-between; align-items: center; }
	.phase-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	.phase-label.clickable { cursor: pointer; }
	.phase-label.clickable:hover { color: #8b9cf7; }
	.phase-count { font-size: 0.7rem; color: #6b7280; }
	.phase-contents { border-top: 1px solid #2a2d3a; padding-top: 0.3rem; margin-top: 0.25rem; }
	.phase-element {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0; font-size: 0.75rem; color: #c9cdd5;
	}
	.phase-el-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.selection-info {
		margin-top: 1rem; border-top: 1px solid #2a2d3a; padding-top: 0.75rem;
	}
	.selection-info h4 { font-size: 0.75rem; color: #6b7280; margin: 0 0 0.3rem; text-transform: uppercase; }
	.selected-item {
		display: flex; align-items: center; gap: 0.3rem;
		font-size: 0.8rem; color: #c9cdd5; padding: 0.1rem 0;
	}
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-remove { color: #ef4444; border-color: #ef4444; font-size: 0.7rem; padding: 0 0.3rem; margin-left: auto; }
	.btn-remove:hover { background: rgba(239, 68, 68, 0.1); }
</style>
