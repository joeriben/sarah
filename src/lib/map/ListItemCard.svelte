<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	let { item, listGroupBy }: { item: any; listGroupBy: string } = $props();

	const ms = getMapState();
</script>

{#if item.mode === 'relation'}
	{@const srcId = item.directed_from || item.part_source_id}
	{@const tgtId = item.directed_to || item.part_target_id}
	<div class="element-card relation-card" class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} title={item.properties?.aiReasoning || ''}>
		<div class="el-main">
			{#if item.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
			<span class="designation-dot" style="background: {ms.designationColor(item.designation)}"></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if item.phase_ids?.length}
				<span class="phase-dots">
					{#each item.phase_ids as cid}
						{@const c = ms.phaseColorMap.get(cid)}
						{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === cid)?.label}></span>{/if}
					{/each}
				</span>
			{/if}
			{#if listGroupBy !== 'mode'}<span class="mode-indicator" title="relation">↔</span>{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{item.outside_participation_count} relation(s) outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			<span class="rel-source">{ms.findInscription(srcId)}</span>
			<span class="rel-arrow">
				{#if item.directed_from && item.directed_to}
					{#if item.valence}—{item.valence}→{:else}→{/if}
				{:else}
					{#if item.valence}—{item.valence}—{:else}↔{/if}
				{/if}
			</span>
			<span class="rel-target">{ms.findInscription(tgtId)}</span>
			{#if ms.editingId === item.naming_id}
				<form class="inline-rename" onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
					<input type="text" bind:value={ms.editingValue} />
					<button type="submit" class="btn-xs">ok</button>
					<button type="button" class="btn-xs" onclick={() => ms.editingId = null}>×</button>
				</form>
			{:else if item.inscription}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="rel-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={() => { ms.editingId = item.naming_id; ms.editingValue = item.inscription || ''; }}>
					{item.inscription}
				</span>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="rel-inscription editable unnamed" onclick={() => ms.showStack(item.naming_id)} ondblclick={() => { ms.editingId = item.naming_id; ms.editingValue = item.inscription || ''; }}>
					(name...)
				</span>
			{/if}
			{#if item.is_collapsed && item.current_inscription && item.current_inscription !== item.inscription}
				<span class="collapsed-current">currently: {item.current_inscription}</span>
			{/if}
		</div>
		<div class="el-actions">
			<select value={item.designation || 'cue'} onchange={e => ms.startDesignation(item.naming_id, (e.target as HTMLSelectElement).value)}>
				<option value="cue">cue</option>
				<option value="characterization">characterization</option>
				<option value="specification">specification</option>
			</select>
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, ms.isWithdrawn(item.properties))}>
				{ms.isWithdrawn(item.properties) ? 'restore' : 'withdraw'}
			</button>
			{#if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
			{#if ms.assigningToPhase}
				<button class="btn-sm btn-phase" onclick={() => ms.assignToPhase(ms.assigningToPhase!, item.naming_id)}>+ phase</button>
			{/if}
		</div>
	</div>
{:else if item.mode === 'silence'}
	<div class="element-card silence-card" class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} title={item.properties?.aiReasoning || ''}>
		<div class="el-main">
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if item.phase_ids?.length}
				<span class="phase-dots">
					{#each item.phase_ids as cid}
						{@const c = ms.phaseColorMap.get(cid)}
						{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === cid)?.label}></span>{/if}
					{/each}
				</span>
			{/if}
			{#if listGroupBy !== 'mode'}<span class="mode-indicator" title="silence">∅</span>{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{item.outside_participation_count} relation(s) outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="el-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={() => { ms.editingId = item.naming_id; ms.editingValue = item.inscription || ''; }}>
				{item.inscription}
			</span>
		</div>
		<div class="el-actions">
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, ms.isWithdrawn(item.properties))}>
				{ms.isWithdrawn(item.properties) ? 'restore' : 'withdraw'}
			</button>
			{#if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
		</div>
	</div>
{:else}
	<!-- Entity (element) -->
	<div class="element-card" class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} class:pos-absent={ms.mapType === 'positional' && item.properties?.absent} class:unresolved={ms.isUnresolved(item)} title={item.properties?.aiReasoning || ''}>
		<div class="el-main">
			{#if item.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
			{#if ms.isPrimary}
				<span class="placement-dot" title={ms.isPlaced(item) ? 'Placed on canvas' : ms.isWithdrawn(item.properties) ? 'Declined' : 'Unresolved — not yet placed'}>{ms.isPlaced(item) ? '●' : ms.isWithdrawn(item.properties) ? '—' : '○'}</span>
			{/if}
			<span class="designation-dot" style="background: {ms.designationColor(item.designation)}" title={ms.designationLabel(item.designation)}></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if item.phase_ids?.length}
				<span class="phase-dots">
					{#each item.phase_ids as cid}
						{@const c = ms.phaseColorMap.get(cid)}
						{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === cid)?.label}></span>{/if}
					{/each}
				</span>
			{/if}
			{#if ms.mapType === 'positional' && item.properties?.isAxis}
				<span class="pos-axis-badge">{item.properties.axisDimension === 'x' ? 'X' : 'Y'}-axis</span>
			{/if}
			{#if ms.mapType === 'positional' && item.properties?.absent}
				<span class="pos-absent-badge">absent</span>
			{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{item.outside_participation_count} relation(s) outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			{#if ms.editingId === item.naming_id}
				<form class="inline-rename" onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
					<input type="text" bind:value={ms.editingValue} />
					<button type="submit" class="btn-xs">ok</button>
					<button type="button" class="btn-xs" onclick={() => ms.editingId = null}>×</button>
				</form>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="el-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={() => { ms.editingId = item.naming_id; ms.editingValue = item.inscription || ''; }}>
					{item.inscription}
				</span>
				{#if ms.mapType === 'positional' && !item.properties?.isAxis && item.properties?.x != null}
					<span class="pos-coord">({item.properties.x}, {Math.abs(item.properties.y || 0)})</span>
				{/if}
				{#if item.is_collapsed && item.current_inscription && item.current_inscription !== item.inscription}
					<span class="collapsed-current">currently: {item.current_inscription}</span>
				{/if}
			{/if}
		</div>
		<div class="el-actions">
			<select value={item.designation || 'cue'} onchange={e => ms.startDesignation(item.naming_id, (e.target as HTMLSelectElement).value)}>
				<option value="cue">cue</option>
				<option value="characterization">characterization</option>
				<option value="specification">specification</option>
			</select>
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, ms.isWithdrawn(item.properties))}>
				{ms.isWithdrawn(item.properties) ? 'restore' : 'withdraw'}
			</button>
			{#if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
			{#if ms.assigningToPhase}
				<button class="btn-sm btn-phase" onclick={() => ms.assignToPhase(ms.assigningToPhase!, item.naming_id)}>+ phase</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.element-card {
		display: flex; align-items: center; justify-content: space-between;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}
	.element-card:hover { border-color: #3a3d4a; }
	.element-card.ai-withdrawn { opacity: 0.4; }
	.element-card.ai-withdrawn :global(.el-inscription) { text-decoration: line-through; }
	.element-card.unresolved { border-style: dashed; border-color: rgba(245, 158, 11, 0.3); }
	.placement-dot { font-size: 0.65rem; color: #6b7280; flex-shrink: 0; width: 10px; text-align: center; }
	.relation-card { background: #141620; }
	.silence-card { border-style: dashed; opacity: 0.7; }
	.el-main { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
	.el-inscription { font-size: 0.9rem; color: #e1e4e8; }
	.el-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
	.el-actions select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.2rem 0.3rem; cursor: pointer;
	}
	.designation-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.provenance-indicator { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.5; cursor: default; }
	.memo-count {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 3px; min-width: 14px; height: 14px; line-height: 14px;
		text-align: center; flex-shrink: 0;
	}
	.phase-dots { display: inline-flex; gap: 2px; flex-shrink: 0; }
	.phase-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
	.collapsed-indicator { width: 12px; height: 12px; flex-shrink: 0; margin-right: 0.2rem; opacity: 0.7; }
	.collapsed-current { font-size: 0.7rem; color: #6b7280; font-style: italic; margin-left: 0.5rem; }
	.mode-indicator { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; width: 16px; text-align: center; }
	.outside-badge {
		font-size: 0.65rem; font-weight: 600; color: #e8a54b; background: rgba(232, 165, 75, 0.15);
		border: 1px solid rgba(232, 165, 75, 0.3); border-radius: 3px;
		padding: 0 3px; cursor: pointer; flex-shrink: 0;
	}
	.outside-badge:hover { background: rgba(232, 165, 75, 0.25); }
	.rel-source, .rel-target { font-size: 0.85rem; color: #c9cdd5; }
	.rel-arrow { font-size: 0.8rem; color: #6b7280; margin: 0 0.25rem; }
	.rel-inscription { font-size: 0.75rem; color: #8b8fa3; margin-left: 0.5rem; font-style: italic; }
	.editable { cursor: pointer; }
	.editable:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
	.unnamed { color: #4b5563; font-style: italic; }
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
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-withdraw { border-color: #6b7280; color: #6b7280; font-size: 0.65rem; }
	.btn-withdraw:hover { background: rgba(107, 114, 128, 0.1); }
	.btn-relate { border-color: #f59e0b; color: #f59e0b; }
	.btn-phase { border-color: #10b981; color: #10b981; }
	.pos-coord { font-size: 0.65rem; color: #6b7280; margin-left: 0.4rem; font-family: monospace; }
	.pos-axis-badge {
		font-size: 0.6rem; font-weight: 600; color: #8b9cf7; background: rgba(139, 156, 247, 0.12);
		border: 1px solid rgba(139, 156, 247, 0.3); border-radius: 3px;
		padding: 0 3px; flex-shrink: 0;
	}
	.pos-absent-badge {
		font-size: 0.6rem; font-weight: 600; color: #9ca3af; background: rgba(156, 163, 175, 0.1);
		border: 1px dashed rgba(156, 163, 175, 0.4); border-radius: 3px;
		padding: 0 3px; font-style: italic; flex-shrink: 0;
	}
	.pos-absent { border-style: dashed; opacity: 0.7; }
	.pos-absent :global(.el-inscription) { font-style: italic; color: #9ca3af; }
</style>
