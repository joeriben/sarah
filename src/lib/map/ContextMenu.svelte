<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	let {
		namingId,
		position,
		onclose,
		oncenter,
		onrename,
	}: {
		namingId: string;
		position: { x: number; y: number };
		onclose: () => void;
		oncenter: (id: string) => void;
		onrename: (id: string) => void;
	} = $props();

	const ms = getMapState();
	const node = $derived(ms.findNode(namingId));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu" style="left: {position.x}px; top: {position.y}px;"
	onclick={(e) => e.stopPropagation()}>
	<div class="ctx-header">{node?.inscription || '(unnamed)'}</div>
	<button class="ctx-item" onclick={() => { onrename(namingId); onclose(); }}>Rename</button>
	<div class="ctx-separator"></div>
	<button class="ctx-item" onclick={() => { ms.startDesignation(namingId, 'cue'); onclose(); }}>
		<span class="designation-dot-sm" style="background: #6b7280"></span> cue
	</button>
	<button class="ctx-item" onclick={() => { ms.startDesignation(namingId, 'characterization'); onclose(); }}>
		<span class="designation-dot-sm" style="background: #f59e0b"></span> characterization
	</button>
	<button class="ctx-item" onclick={() => { ms.startDesignation(namingId, 'specification'); onclose(); }}>
		<span class="designation-dot-sm" style="background: #10b981"></span> specification
	</button>
	<div class="ctx-separator"></div>
	<button class="ctx-item" onclick={() => {
		if (ms.relatingFrom) { ms.completeRelating(namingId); } else { ms.startRelating(namingId); }
		onclose();
	}}>
		{ms.relatingFrom ? 'Connect here' : 'Relate...'}
	</button>
	<button class="ctx-item" onclick={() => { ms.showStack(namingId); onclose(); }}>Stack</button>
	<button class="ctx-item" onclick={() => { ms.openMemoCreate([namingId]); onclose(); }}>Write memo</button>
	<button class="ctx-item" onclick={() => { oncenter(namingId); onclose(); }}>
		Center
	</button>
	{#if ms.assigningToCluster}
		<div class="ctx-separator"></div>
		<button class="ctx-item" onclick={() => { ms.assignToCluster(ms.assigningToCluster!, namingId); onclose(); }}>
			+ Cluster
		</button>
	{/if}
	<div class="ctx-separator"></div>
	<button class="ctx-item" onclick={() => { ms.toggleWithdraw(namingId, ms.isWithdrawn(node?.properties)); onclose(); }}>
		{ms.isWithdrawn(node?.properties) ? 'Restore' : 'Withdraw'}
	</button>
</div>

<style>
	.context-menu {
		position: fixed; z-index: 200;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.35rem 0; min-width: 160px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.ctx-header {
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #6b7280;
		border-bottom: 1px solid #2a2d3a; margin-bottom: 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.ctx-item {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.ctx-item:hover { background: #2a2d3a; }
	.ctx-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
</style>
