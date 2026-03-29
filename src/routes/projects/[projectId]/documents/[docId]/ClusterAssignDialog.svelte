<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let {
		namingIds,
		clusters,
		projectId,
		onclose,
	}: {
		namingIds: string[];
		clusters: any[];
		projectId: string;
		onclose: () => void;
	} = $props();

	let selectedClusterId = $state<string | null>(null);
	let newClusterLabel = $state('');
	let creating = $state(false);
	let assigning = $state(false);

	async function createCluster() {
		if (!newClusterLabel.trim() || creating) return;
		creating = true;
		const res = await fetch(`/api/projects/${projectId}/clusters`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'create', inscription: newClusterLabel.trim() })
		});
		if (res.ok) {
			const cluster = await res.json();
			selectedClusterId = cluster.id;
			newClusterLabel = '';
			await invalidateAll();
		}
		creating = false;
	}

	async function assign() {
		if (!selectedClusterId || assigning) return;
		assigning = true;
		for (const namingId of namingIds) {
			await fetch(`/api/projects/${projectId}/clusters`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'assign', clusterId: selectedClusterId, namingId })
			});
		}
		assigning = false;
		await invalidateAll();
		onclose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={onclose}>
	<div class="modal" onclick={(e) => e.stopPropagation()}>
		<h2>Add to Cluster</h2>
		<p class="modal-subtitle">
			{namingIds.length === 1 ? '1 naming' : `${namingIds.length} namings`}
		</p>

		<div class="cluster-list">
			{#each clusters as c (c.id)}
				<button
					class="cluster-option"
					class:selected={selectedClusterId === c.id}
					onclick={() => { selectedClusterId = c.id; }}
				>
					<span class="cluster-name">{c.label}</span>
					<span class="cluster-count">{c.member_count}</span>
				</button>
			{/each}
			{#if clusters.length === 0}
				<p class="empty">No clusters yet.</p>
			{/if}
		</div>

		<form class="create-form" onsubmit={(e) => { e.preventDefault(); createCluster(); }}>
			<input
				type="text"
				class="create-input"
				placeholder="New cluster name..."
				bind:value={newClusterLabel}
				disabled={creating}
			/>
			{#if newClusterLabel.trim()}
				<button type="submit" class="btn-create" disabled={creating}>
					{creating ? 'Creating...' : '+ Create'}
				</button>
			{/if}
		</form>

		<div class="modal-actions">
			<button class="btn-cancel" onclick={onclose}>Cancel</button>
			<button class="btn-assign" onclick={assign}
				disabled={!selectedClusterId || assigning}>
				{assigning ? 'Assigning...' : 'Assign'}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed; inset: 0;
		background: rgba(0,0,0,0.5);
		z-index: 300;
		display: flex; align-items: center; justify-content: center;
	}
	.modal {
		background: #1e2030;
		border: 1px solid #3a3d4a;
		border-radius: 8px;
		padding: 1.5rem;
		min-width: 320px;
		max-width: 420px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
	}
	.modal h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		color: #e1e4e8;
	}
	.modal-subtitle {
		font-size: 0.78rem;
		color: #6b7280;
		margin: 0 0 0.75rem;
	}
	.cluster-list {
		flex: 1;
		overflow-y: auto;
		margin-bottom: 0.75rem;
		max-height: 240px;
	}
	.cluster-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: 1px solid transparent;
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		color: #c9cdd5;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
	}
	.cluster-option:hover { background: rgba(139, 156, 247, 0.08); }
	.cluster-option.selected {
		background: rgba(139, 156, 247, 0.15);
		border-color: #8b9cf7;
	}
	.cluster-count {
		font-size: 0.7rem;
		color: #6b7280;
	}
	.create-form {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.create-input {
		flex: 1;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.8rem;
	}
	.create-input:focus { outline: none; border-color: #8b9cf7; }
	.btn-create {
		background: rgba(139, 156, 247, 0.1);
		border: 1px dashed #8b9cf7;
		border-radius: 4px;
		padding: 0.3rem 0.5rem;
		color: #8b9cf7;
		font-size: 0.78rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-create:hover { background: rgba(139, 156, 247, 0.2); }
	.btn-create:disabled { opacity: 0.4; cursor: wait; }
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.btn-cancel {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem 0.8rem;
		color: #6b7280;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.btn-cancel:hover { color: #e1e4e8; border-color: #4b5563; }
	.btn-assign {
		background: rgba(139, 156, 247, 0.15);
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.4rem 0.8rem;
		color: #a5b4fc;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.btn-assign:hover { background: rgba(139, 156, 247, 0.25); }
	.btn-assign:disabled { opacity: 0.4; cursor: default; }
	.empty {
		font-size: 0.78rem;
		color: #6b7280;
		text-align: center;
		padding: 0.5rem 0;
	}
</style>
