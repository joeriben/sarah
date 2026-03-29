<script lang="ts">
	let {
		namingIds,
		position,
		namingLabels,
		onclose,
		onaddtocluster,
	}: {
		namingIds: string[];
		position: { x: number; y: number };
		namingLabels: string[];
		onclose: () => void;
		onaddtocluster: () => void;
	} = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu" style="left: {position.x}px; top: {position.y}px;"
	onclick={(e) => e.stopPropagation()}>
	<div class="ctx-header">
		{namingIds.length === 1 ? namingLabels[0] : `${namingIds.length} namings`}
	</div>
	<button class="ctx-item" onclick={() => { onaddtocluster(); onclose(); }}>
		Add to Cluster...
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
</style>
