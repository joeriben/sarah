<script lang="ts">
	let { data } = $props();

	let filterStatus = $state<string>('all');
	let filterAuthor = $state<string>('all');
	let showCreate = $state(false);
	let newLabel = $state('');
	let creating = $state(false);
	let expandedId = $state<string | null>(null);

	// Discussion
	let discussTarget = $state<string | null>(null);
	let discussInput = $state('');
	let discussLoading = $state(false);

	const filteredMemos = $derived.by(() => {
		let memos = data.memos;
		if (filterStatus !== 'all') {
			memos = memos.filter((m: any) => m.status === filterStatus);
		}
		if (filterAuthor === 'ai') {
			memos = memos.filter((m: any) => m.isAiAuthored);
		} else if (filterAuthor === 'researcher') {
			memos = memos.filter((m: any) => !m.isAiAuthored);
		}
		return memos;
	});

	const statusCounts = $derived.by(() => {
		const counts: Record<string, number> = { all: data.memos.length };
		for (const m of data.memos) {
			counts[m.status] = (counts[m.status] || 0) + 1;
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

	async function refreshMemos() {
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function setStatus(memoId: string, status: string) {
		await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		await refreshMemos();
	}

	async function submitDiscussion(memoId: string) {
		if (!discussInput.trim() || discussLoading) return;
		discussLoading = true;
		// Use the map action endpoint — discussMemo works without a specific map context
		// We need to find a map to route through. Use the first available map.
		const mapsRes = await fetch(`/api/projects/${data.projectId}/maps`);
		if (!mapsRes.ok) { discussLoading = false; return; }
		const maps = await mapsRes.json();
		if (maps.length === 0) { discussLoading = false; return; }
		const mapId = maps[0].id;

		await fetch(`/api/projects/${data.projectId}/maps/${mapId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'discussMemo', memoId, message: discussInput.trim() })
		});
		discussInput = '';
		discussTarget = null;
		discussLoading = false;
		await refreshMemos();
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
				<div class="memo-card" class:memo-ai={memo.isAiAuthored} class:memo-dismissed={memo.status === 'dismissed'} class:expanded={expandedId === memo.id}>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="memo-card-header" onclick={() => expandedId = expandedId === memo.id ? null : memo.id}>
						<span class="author-badge" class:badge-ai={memo.isAiAuthored}>
							{memo.isAiAuthored ? 'AI' : 'R'}
						</span>
						{#if memo.status !== 'active'}
							<span class="status-badge" style="color: {statusColor(memo.status)}; border-color: {statusColor(memo.status)}">
								{memo.status}
							</span>
						{/if}
						<span class="memo-title">{memo.label}</span>
						{#if memo.discussion?.length > 0}
							<span class="discussion-count" title="{memo.discussion.length} discussion turn(s)">{memo.discussion.length}</span>
						{/if}
						{#if memo.links?.length > 0}
							<span class="link-count">{memo.links.length} link{memo.links.length === 1 ? '' : 's'}</span>
						{/if}
						<span class="memo-date">{new Date(memo.created_at).toLocaleDateString()}</span>
						<span class="expand-indicator">{expandedId === memo.id ? '▾' : '▸'}</span>
					</div>

					{#if expandedId !== memo.id && memo.content}
						<p class="memo-preview">{memo.content.slice(0, 200)}{memo.content.length > 200 ? '...' : ''}</p>
					{/if}

					{#if expandedId === memo.id}
						<!-- Full content -->
						{#if memo.content}
							<div class="memo-content">{memo.content}</div>
						{/if}

						<!-- Linked elements -->
						{#if memo.links?.length > 0}
							<div class="memo-links">
								<span class="section-label">Linked elements</span>
								<div class="link-chips">
									{#each memo.links as link}
										<span class="link-chip" title={link.mode}>
											<span class="link-chip-mode">{link.mode === 'relation' ? '↔' : link.mode === 'silence' ? '∅' : '●'}</span>
											{link.label}
										</span>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Discussion thread -->
						{#if memo.discussion?.length > 0}
							<div class="memo-discussion">
								<span class="section-label">Discussion</span>
								{#each memo.discussion as turn}
									<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
										<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'revise' ? ' (revised)' : ''}</span>
										<span class="turn-content">{turn.content}</span>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Actions -->
						<div class="memo-actions">
							<a href="/projects/{data.projectId}/memos/{memo.id}" class="btn-xs btn-edit">edit</a>
							{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
								<button class="btn-xs" onclick={() => setStatus(memo.id, 'acknowledged')}>ack</button>
								<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
								<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')}>promote</button>
							{/if}
							{#if memo.status === 'acknowledged'}
								<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
							{/if}
							{#if memo.status === 'dismissed'}
								<button class="btn-xs" onclick={() => setStatus(memo.id, 'presented')}>restore</button>
							{/if}
							{#if discussTarget === memo.id}
								<form class="discuss-form" onsubmit={e => { e.preventDefault(); submitDiscussion(memo.id); }}>
									<input type="text" placeholder="Discuss this memo..." bind:value={discussInput} disabled={discussLoading} />
									<button type="submit" class="btn-xs" disabled={discussLoading || !discussInput.trim()}>
										{discussLoading ? '...' : 'send'}
									</button>
									<button type="button" class="btn-xs" onclick={() => { discussTarget = null; discussInput = ''; }}>×</button>
								</form>
							{:else if memo.status !== 'dismissed'}
								<button class="btn-xs btn-discuss" onclick={() => { discussTarget = memo.id; discussInput = ''; }}>discuss</button>
							{/if}
						</div>
					{:else}
						<!-- Collapsed actions -->
						<div class="memo-card-meta">
							<div class="quick-actions">
								{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'acknowledged')}>ack</button>
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
								{/if}
								{#if memo.status === 'dismissed'}
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'presented')}>restore</button>
								{/if}
							</div>
						</div>
					{/if}
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
	.memo-card.expanded { border-color: #3a3d5a; }
	.memo-card.memo-dismissed { opacity: 0.5; }
	.memo-card.memo-ai { border-left: 3px solid rgba(139, 156, 247, 0.3); }

	.memo-card-header {
		display: flex; align-items: center; gap: 0.5rem; cursor: pointer;
	}
	.memo-card-header:hover .memo-title { color: #8b9cf7; }
	.author-badge {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.05rem 0.3rem; border-radius: 3px; flex-shrink: 0;
	}
	.author-badge.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.status-badge {
		font-size: 0.58rem; font-weight: 600; text-transform: uppercase;
		border: 1px solid; padding: 0.05rem 0.35rem; border-radius: 3px; flex-shrink: 0;
	}
	.memo-title {
		flex: 1; font-size: 0.9rem; font-weight: 600; color: #e1e4e8;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.discussion-count {
		font-size: 0.6rem; font-weight: 700; color: #8b9cf7;
		background: rgba(139, 156, 247, 0.12); border-radius: 8px;
		padding: 0 4px; min-width: 14px; height: 14px; line-height: 14px;
		text-align: center; flex-shrink: 0;
	}
	.link-count { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; }
	.memo-date { font-size: 0.7rem; color: #4b5563; flex-shrink: 0; }
	.expand-indicator { font-size: 0.7rem; color: #4b5563; flex-shrink: 0; }

	.memo-preview {
		font-size: 0.8rem; color: #8b8fa3; margin: 0.3rem 0 0;
		line-height: 1.4; max-height: 2.8em; overflow: hidden;
	}

	/* Expanded content */
	.memo-content {
		font-size: 0.85rem; color: #c9cdd5; margin: 0.5rem 0;
		line-height: 1.6; white-space: pre-wrap;
		max-height: 12em; overflow-y: auto;
		padding: 0.5rem; background: #0f1117; border-radius: 4px;
	}

	/* Linked elements */
	.memo-links { margin: 0.5rem 0; }
	.section-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.3rem;
	}
	.link-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.link-chip {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font-size: 0.75rem; color: #c9cdd5; background: #1e2030;
		border: 1px solid #2a2d3a; border-radius: 4px; padding: 0.15rem 0.5rem;
	}
	.link-chip-mode { font-size: 0.65rem; color: #6b7280; }

	/* Discussion thread */
	.memo-discussion { margin: 0.5rem 0; }
	.discussion-turn {
		padding: 0.3rem 0.5rem; margin: 0.2rem 0;
		border-radius: 4px; font-size: 0.78rem;
	}
	.turn-researcher { background: rgba(245, 158, 11, 0.08); border-left: 2px solid rgba(245, 158, 11, 0.4); }
	.turn-ai { background: rgba(139, 156, 247, 0.06); border-left: 2px solid rgba(139, 156, 247, 0.3); }
	.turn-role { font-size: 0.68rem; font-weight: 600; display: block; margin-bottom: 0.1rem; }
	.turn-researcher .turn-role { color: #f59e0b; }
	.turn-ai .turn-role { color: #8b9cf7; }
	.turn-content { color: #c9cdd5; display: block; white-space: pre-wrap; }

	/* Actions */
	.memo-actions {
		display: flex; gap: 0.3rem; margin-top: 0.5rem;
		flex-wrap: wrap; align-items: center;
		padding-top: 0.4rem; border-top: 1px solid #1e2030;
	}
	.memo-card-meta {
		display: flex; align-items: center; justify-content: flex-end;
		margin-top: 0.3rem;
	}
	.quick-actions { display: flex; gap: 0.3rem; }

	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
		text-decoration: none;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-edit { color: #8b9cf7; border-color: rgba(139, 156, 247, 0.3); }
	.btn-edit:hover { background: rgba(139, 156, 247, 0.1); }
	.btn-promote { border-color: #10b981; color: #10b981; }
	.btn-promote:hover { background: rgba(16, 185, 129, 0.1); }
	.btn-discuss { color: #8b9cf7; }

	/* Discuss form */
	.discuss-form { display: flex; gap: 0.3rem; flex: 1; min-width: 200px; }
	.discuss-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a;
		border-radius: 4px; padding: 0.25rem 0.5rem;
		color: #c9cdd5; font-size: 0.75rem;
	}
	.discuss-form input:focus { border-color: #8b9cf7; outline: none; }
	.discuss-form button { border-color: #8b9cf7; color: #8b9cf7; }
	.discuss-form button:disabled { opacity: 0.4; }
</style>
