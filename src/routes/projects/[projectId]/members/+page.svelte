<script lang="ts">
	let { data }: { data: any } = $props();
	let members = $state<any[]>([]);
	$effect(() => { members = data.members; });
	const canManage = $derived(data.myRole === 'owner' || data.myRole === 'admin');
	const isOwner = $derived(data.myRole === 'owner');

	// Add member form
	let showAdd = $state(false);
	let searchQuery = $state('');
	let addRole = $state('member');
	let addLoading = $state(false);
	let addError = $state('');

	// User search autocomplete
	let suggestions = $state<{ id: string; username: string; display_name: string | null }[]>([]);
	let selectedUser = $state<{ id: string; username: string; display_name: string | null } | null>(null);
	let showSuggestions = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput() {
		selectedUser = null;
		addError = '';
		if (searchTimeout) clearTimeout(searchTimeout);
		if (searchQuery.trim().length < 2) {
			suggestions = [];
			showSuggestions = false;
			return;
		}
		searchTimeout = setTimeout(searchUsers, 250);
	}

	async function searchUsers() {
		const q = searchQuery.trim();
		if (q.length < 2) return;
		const res = await fetch(`/api/projects/${data.projectId}/members/search?q=${encodeURIComponent(q)}`);
		if (res.ok) {
			suggestions = await res.json();
			showSuggestions = true;
		}
	}

	function selectUser(user: typeof suggestions[0]) {
		selectedUser = user;
		searchQuery = user.display_name ? `${user.display_name} (@${user.username})` : `@${user.username}`;
		showSuggestions = false;
	}

	async function addMember() {
		if (!selectedUser) {
			addError = 'Select a user from the suggestions';
			return;
		}
		addLoading = true;
		addError = '';
		const res = await fetch(`/api/projects/${data.projectId}/members`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: selectedUser.username, role: addRole })
		});
		const result = await res.json();
		if (res.ok) {
			members = [...members, result];
			searchQuery = '';
			selectedUser = null;
			addRole = 'member';
			showAdd = false;
		} else {
			addError = result.error || 'Failed to add member';
		}
		addLoading = false;
	}

	async function changeRole(userId: string, newRole: string) {
		const res = await fetch(`/api/projects/${data.projectId}/members`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, role: newRole })
		});
		if (res.ok) {
			members = members.map((m: any) => m.id === userId ? { ...m, role: newRole } : m);
		}
	}

	async function removeMember(userId: string, username: string) {
		if (!confirm(`Remove ${username} from this project?`)) return;
		const res = await fetch(`/api/projects/${data.projectId}/members`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});
		if (res.ok) {
			members = members.filter((m: any) => m.id !== userId);
		}
	}

	function roleLabel(role: string) {
		return role.charAt(0).toUpperCase() + role.slice(1);
	}
</script>

<div class="members-page">
	<div class="header">
		<h1>
			<img src="/icons/group.svg" alt="" class="header-icon" />
			Members
		</h1>
		{#if canManage}
			<button class="btn-primary" onclick={() => showAdd = !showAdd}>
				{showAdd ? 'Cancel' : 'Add member'}
			</button>
		{/if}
	</div>

	{#if showAdd}
		<!-- Not a <form> to prevent Firefox from treating this as a login form -->
		<div class="add-form">
			<div class="search-wrapper">
				<input
					type="search"
					placeholder="Search by name, username or email..."
					bind:value={searchQuery}
					oninput={onSearchInput}
					onfocus={() => { if (suggestions.length) showSuggestions = true; }}
					onblur={() => setTimeout(() => { showSuggestions = false; }, 150)}
					autocomplete="off"
					data-1p-ignore
					data-lpignore="true"
				/>
				{#if showSuggestions && suggestions.length > 0}
					<div class="suggestions">
						{#each suggestions as user (user.id)}
							<button class="suggestion" onmousedown={() => selectUser(user)}>
								<span class="suggestion-name">{user.display_name || user.username}</span>
								<span class="suggestion-username">@{user.username}</span>
							</button>
						{/each}
					</div>
				{:else if showSuggestions && searchQuery.trim().length >= 2 && !selectedUser}
					<div class="suggestions">
						<div class="suggestion-empty">No users found</div>
					</div>
				{/if}
			</div>
			<select bind:value={addRole}>
				{#if isOwner}<option value="admin">Admin</option>{/if}
				<option value="member">Member</option>
				<option value="viewer">Viewer</option>
			</select>
			<button class="btn-primary" disabled={addLoading || !selectedUser} onclick={addMember}>
				{addLoading ? 'Adding...' : 'Add'}
			</button>
			{#if addError}
				<span class="error">{addError}</span>
			{/if}
		</div>
	{/if}

	<div class="member-list">
		{#each members as member (member.id)}
			<div class="member-card">
				<div class="member-info">
					<img src="/icons/person_edit.svg" alt="" class="member-icon" />
					<div>
						<span class="member-name">
							{member.display_name || member.username}
							{#if member.id === data.myUserId}
								<span class="you-badge">you</span>
							{/if}
						</span>
						<span class="member-username">@{member.username}</span>
					</div>
				</div>
				<div class="member-actions">
					{#if canManage && member.role !== 'owner' && member.id !== data.myUserId}
						<select
							value={member.role}
							onchange={e => changeRole(member.id, (e.target as HTMLSelectElement).value)}
						>
							{#if isOwner}<option value="admin">Admin</option>{/if}
							<option value="member">Member</option>
							<option value="viewer">Viewer</option>
						</select>
						<button
							class="btn-remove"
							title="Remove member"
							onclick={() => removeMember(member.id, member.username)}
						>
							&times;
						</button>
					{:else}
						<span class="role-badge role-{member.role}">{roleLabel(member.role)}</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.members-page { max-width: 600px; }
	.header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: 1.3rem; display: flex; align-items: center; gap: 0.5rem;
	}
	.header-icon { width: 24px; height: 24px; opacity: 0.7; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }

	.add-form {
		display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;
		background: #161822; border: 1px solid #2a2d3a;
		border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;
	}
	.search-wrapper {
		flex: 1; min-width: 200px; position: relative;
	}
	.add-form input {
		width: 100%;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.add-form input:focus { outline: none; border-color: #8b9cf7; }
	.add-form select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.suggestions {
		position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 6px;
		margin-top: 4px; overflow: hidden;
		box-shadow: 0 4px 12px rgba(0,0,0,0.3);
	}
	.suggestion {
		display: flex; align-items: center; gap: 0.5rem;
		width: 100%; padding: 0.5rem 0.75rem;
		background: none; border: none; color: #e1e4e8;
		font-size: 0.85rem; cursor: pointer; text-align: left;
	}
	.suggestion:hover { background: #282a3a; }
	.suggestion-name { font-weight: 500; }
	.suggestion-username { color: #6b7280; font-size: 0.8rem; }
	.suggestion-empty {
		padding: 0.5rem 0.75rem; color: #6b7280; font-size: 0.85rem;
	}
	.error { color: #ef4444; font-size: 0.8rem; width: 100%; }

	.member-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.member-card {
		display: flex; align-items: center; justify-content: space-between;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem 1rem;
	}
	.member-info {
		display: flex; align-items: center; gap: 0.75rem;
	}
	.member-icon { width: 20px; height: 20px; opacity: 0.5; }
	.member-name { font-size: 0.95rem; font-weight: 500; color: #e1e4e8; }
	.member-username { display: block; font-size: 0.8rem; color: #6b7280; }
	.you-badge {
		font-size: 0.7rem; color: #8b9cf7; background: rgba(139, 156, 247, 0.12);
		padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: 0.4rem;
	}

	.member-actions {
		display: flex; align-items: center; gap: 0.5rem;
	}
	.member-actions select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.35rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}

	.btn-remove {
		background: none; border: 1px solid transparent; border-radius: 4px;
		color: #6b7280; font-size: 1.2rem; cursor: pointer; padding: 0.1rem 0.4rem;
		line-height: 1;
	}
	.btn-remove:hover { color: #ef4444; border-color: #ef4444; }

	.role-badge {
		font-size: 0.8rem; padding: 0.2rem 0.6rem; border-radius: 4px;
		font-weight: 500;
	}
	.role-owner { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
	.role-admin { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.role-member { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }
	.role-viewer { background: rgba(107, 114, 128, 0.1); color: #6b7280; }
</style>
