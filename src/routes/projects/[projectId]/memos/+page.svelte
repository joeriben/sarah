<script lang="ts">
	let { data } = $props();

	const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

	let filterStatus = $state<string>('all');
	let filterAuthor = $state<string>('all');
	let showCreate = $state(false);
	let newLabel = $state('');
	let creating = $state(false);

	const filteredMemos = $derived.by(() => {
		let memos = data.memos;
		if (filterStatus !== 'all') {
			memos = memos.filter((m: any) => (m.status || 'active') === filterStatus);
		}
		if (filterAuthor === 'ai') {
			memos = memos.filter((m: any) => m.created_by === AI_SYSTEM_UUID);
		} else if (filterAuthor === 'researcher') {
			memos = memos.filter((m: any) => m.created_by !== AI_SYSTEM_UUID);
		}
		return memos;
	});

	const statusCounts = $derived.by(() => {
		const counts: Record<string, number> = { all: data.memos.length };
		for (const m of data.memos) {
			const s = m.status || 'active';
			counts[s] = (counts[s] || 0) + 1;
		}
		return counts;
	});

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

	async function quickAction(memoId: string, status: string) {
		await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		// Refresh
		const res = await fetch(`/api/projects/${data.projectId}/memos`);
		if (res.ok) data.memos = await res.json();
	}

	function isAi(memo: any): boolean {
		return memo.created_by === AI_SYSTEM_UUID;
	}

	function statusColor(status: string): string {
		if (status === 'presented') return '#8b9cf7';
		if (status === 'discussed') return '#f59e0b';
		if (status === 'acknowledged') return '#10b981';
		if (status === 'promoted') return '#10b981';
		if (status === 'dismissed') return '#6b7280';
		return '#9ca3af';
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

	<div class="filters">
		<div class="filter-group">
			<span class="filter-label">Status</span>
			<button class="filter-btn" class:active={filterStatus === 'all'} onclick={() => filterStatus = 'all'}>
				All <span class="count">{statusCounts.all || 0}</span>
			</button>
			{#each ['presented', 'active', 'discussed', 'acknowledged', 'promoted', 'dismissed'] as s}
				{#if statusCounts[s]}
					<button class="filter-btn" class:active={filterStatus === s} onclick={() => filterStatus = s}>
						{s} <span class="count">{statusCounts[s]}</span>
					</button>
				{/if}
			{/each}
		</div>
		<div class="filter-group">
			<span class="filter-label">Author</span>
			<button class="filter-btn" class:active={filterAuthor === 'all'} onclick={() => filterAuthor = 'all'}>All</button>
			<button class="filter-btn" class:active={filterAuthor === 'ai'} onclick={() => filterAuthor = 'ai'}>AI</button>
			<button class="filter-btn" class:active={filterAuthor === 'researcher'} onclick={() => filterAuthor = 'researcher'}>Researcher</button>
		</div>
	</div>

	{#if filteredMemos.length === 0}
		<p class="empty">{data.memos.length === 0 ? 'No memos yet.' : 'No memos match these filters.'}</p>
	{:else}
		<div class="memo-list">
			{#each filteredMemos as memo}
				<div class="memo-card" class:memo-dismissed={memo.status === 'dismissed'}>
					<div class="memo-card-header">
						<span class="author-badge" class:badge-ai={isAi(memo)}>
							{isAi(memo) ? 'AI' : 'R'}
						</span>
						{#if memo.status && memo.status !== 'active'}
							<span class="status-badge" style="color: {statusColor(memo.status)}; border-color: {statusColor(memo.status)}">
								{memo.status}
							</span>
						{/if}
						<a href="/projects/{data.projectId}/memos/{memo.id}" class="memo-title">{memo.label}</a>
						<span class="memo-date">{new Date(memo.created_at).toLocaleDateString()}</span>
					</div>
					{#if memo.content}
						<p class="memo-preview">{memo.content.slice(0, 200)}{memo.content.length > 200 ? '...' : ''}</p>
					{/if}
					<div class="memo-card-meta">
						<span class="link-count">{memo.link_count} link{memo.link_count == 1 ? '' : 's'}</span>
						<div class="quick-actions">
							{#if memo.status === 'presented' || memo.status === 'discussed'}
								<button class="btn-xs" onclick={() => quickAction(memo.id, 'acknowledged')}>ack</button>
								<button class="btn-xs" onclick={() => quickAction(memo.id, 'dismissed')}>dismiss</button>
							{/if}
							{#if memo.status === 'dismissed'}
								<button class="btn-xs" onclick={() => quickAction(memo.id, 'presented')}>restore</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.memos-page { max-width: 750px; }
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

	/* Filters */
	.filters {
		display: flex; flex-direction: column; gap: 0.5rem;
		margin-bottom: 1rem; padding: 0.6rem 0.8rem;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
	}
	.filter-group { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
	.filter-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; min-width: 3.5rem;
	}
	.filter-btn {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.72rem; padding: 0.2rem 0.5rem; cursor: pointer;
	}
	.filter-btn:hover { border-color: #8b9cf7; }
	.filter-btn.active { background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; color: #c9cdd5; }
	.count { font-size: 0.6rem; color: #6b7280; margin-left: 0.2rem; }

	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }

	/* Memo cards */
	.memo-list { display: flex; flex-direction: column; gap: 0.4rem; }
	.memo-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem 1rem; transition: border-color 0.15s;
	}
	.memo-card:hover { border-color: #3a3d5a; }
	.memo-card.memo-dismissed { opacity: 0.5; }

	.memo-card-header { display: flex; align-items: center; gap: 0.5rem; }
	.author-badge {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.05rem 0.3rem; border-radius: 3px; flex-shrink: 0;
	}
	.author-badge.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.status-badge {
		font-size: 0.58rem; font-weight: 600; text-transform: uppercase;
		border: 1px solid; padding: 0.05rem 0.35rem; border-radius: 3px;
	}
	.memo-title {
		flex: 1; font-size: 0.9rem; font-weight: 600; color: #e1e4e8;
		text-decoration: none;
	}
	.memo-title:hover { color: #8b9cf7; }
	.memo-date { font-size: 0.75rem; color: #4b5563; }

	.memo-preview {
		font-size: 0.8rem; color: #8b8fa3; margin: 0.3rem 0 0;
		line-height: 1.4; max-height: 2.8em; overflow: hidden;
	}

	.memo-card-meta {
		display: flex; align-items: center; justify-content: space-between;
		margin-top: 0.4rem;
	}
	.link-count { font-size: 0.72rem; color: #6b7280; }
	.quick-actions { display: flex; gap: 0.3rem; }

	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
</style>
