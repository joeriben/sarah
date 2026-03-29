<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import { regionColor } from '$lib/canvas/regions.js';

	let { selection }: { selection: ReturnType<typeof createSelection> } = $props();

	const ms = getMapState();
</script>

<div class="sidebar">
	<div class="sidebar-header">
		<h3>Clusters</h3>
		<button class="btn-sm" onclick={() => ms.showClusterForm = !ms.showClusterForm}>
			{ms.showClusterForm ? 'x' : '+'}
		</button>
	</div>

	{#if ms.showClusterForm}
		<form class="cluster-form" onsubmit={e => { e.preventDefault(); ms.addCluster(); }}>
			<input type="text" placeholder="Cluster label..." bind:value={ms.newClusterLabel} />
			<button type="submit" class="btn-sm">Create</button>
		</form>
	{/if}

	{#if ms.clusters.length === 0}
		<p class="empty-small">No clusters yet.</p>
	{:else}
		{#each ms.clusters as cluster, i}
			<div class="cluster-card" class:assigning={ms.assigningToCluster === cluster.id} class:cluster-active={ms.highlightedCluster === cluster.id}
				style="border-left: 3px solid {regionColor(i)}">
				<div class="cluster-header">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span class="cluster-label clickable" onclick={() => { ms.highlightedCluster = ms.highlightedCluster === cluster.id ? null : cluster.id; ms.toggleCluster(cluster.id); }}>{cluster.label}</span>
					<span class="cluster-count">{cluster.element_count}</span>
				</div>
				<button class="btn-xs"
					onclick={() => ms.assigningToCluster = ms.assigningToCluster === cluster.id ? null : cluster.id}>
					{ms.assigningToCluster === cluster.id ? 'done' : 'assign'}
				</button>
				{#if ms.expandedCluster === cluster.id}
					<div class="cluster-contents">
						{#each ms.clusterContents as pc}
							<div class="cluster-element">
								<span class="designation-dot-sm" style="background: {ms.designationColor(pc.designation)}"></span>
								<span class="cluster-el-label">{pc.inscription}</span>
								<button class="btn-xs btn-remove" title="Remove from cluster"
									onclick={() => ms.removeFromCluster(cluster.id, pc.naming_id)}>×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	{#if ms.declinedCount > 0}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cluster-card declined-cluster" class:cluster-active={ms.isDeclinedFilter}
			style="border-left: 3px solid #6b7280">
			<div class="cluster-header">
				<span class="cluster-label clickable" onclick={() => { ms.highlightedCluster = ms.isDeclinedFilter ? null : ms.DECLINED_CLUSTER; }}>Declined</span>
				<span class="cluster-count">{ms.declinedCount}</span>
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
	.cluster-form { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
	.cluster-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.cluster-form input:focus { outline: none; border-color: #8b9cf7; }
	.empty-small { color: #6b7280; font-size: 0.8rem; }
	.cluster-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.3rem;
	}
	.cluster-card.assigning { border-color: #10b981; }
	.cluster-card.cluster-active { background: #1e2030; }
	.declined-cluster { margin-top: 0.5rem; border-style: dashed; }
	.declined-hint { font-size: 0.65rem; color: #6b7280; }
	.cluster-header { display: flex; justify-content: space-between; align-items: center; }
	.cluster-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	.cluster-label.clickable { cursor: pointer; }
	.cluster-label.clickable:hover { color: #8b9cf7; }
	.cluster-count { font-size: 0.7rem; color: #6b7280; }
	.cluster-contents { border-top: 1px solid #2a2d3a; padding-top: 0.3rem; margin-top: 0.25rem; }
	.cluster-element {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0; font-size: 0.75rem; color: #c9cdd5;
	}
	.cluster-el-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
