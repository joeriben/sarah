<script lang="ts">
	let { data } = $props();
	let showCreate = $state(false);
	let newLabel = $state('');
	let creating = $state(false);

	async function createMemo() {
		if (!newLabel.trim()) return;
		creating = true;
		const res = await fetch(`/api/projects/${data.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: newLabel.trim() })
		});
		if (res.ok) {
			const memo = await res.json();
			window.location.href = `/projects/${data.projectId}/memos/${memo.id}`;
		}
		creating = false;
	}
</script>

<div class="memos-page">
	<div class="header">
		<h1>Memos</h1>
		<button class="btn-primary" onclick={() => showCreate = !showCreate}>
			{showCreate ? 'Cancel' : 'New memo'}
		</button>
	</div>

	{#if showCreate}
		<form class="create-form" onsubmit={e => { e.preventDefault(); createMemo(); }}>
			<input type="text" placeholder="Memo title" bind:value={newLabel} required />
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if data.memos.length === 0}
		<p class="empty">No memos yet. Create one to start your analytical writing.</p>
	{:else}
		<div class="memo-list">
			{#each data.memos as memo}
				<a href="/projects/{data.projectId}/memos/{memo.id}" class="memo-card">
					<h3>{memo.label}</h3>
					<div class="memo-meta">
						<span>{memo.link_count} links</span>
						<span>{new Date(memo.created_at).toLocaleDateString()}</span>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.memos-page { max-width: 700px; }
	.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
	h1 { font-size: 1.3rem; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }

	.create-form {
		display: flex; gap: 0.75rem; background: #161822; border: 1px solid #2a2d3a;
		border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;
	}
	.create-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.create-form input:focus { outline: none; border-color: #8b9cf7; }

	.empty { color: #6b7280; font-size: 0.9rem; }

	.memo-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.memo-card {
		display: block; background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 1rem 1.25rem; transition: border-color 0.15s;
	}
	.memo-card:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.memo-card h3 { font-size: 0.95rem; font-weight: 600; color: #e1e4e8; }
	.memo-meta { display: flex; gap: 1rem; font-size: 0.8rem; color: #6b7280; margin-top: 0.35rem; }
</style>
