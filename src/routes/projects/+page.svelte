<script lang="ts">
	import { goto } from '$app/navigation';

	let { data } = $props();
	let showCreate = $state(false);
	let name = $state('');
	let description = $state('');
	let creating = $state(false);

	// Import
	let importing = $state(false);
	let importError = $state<string | null>(null);

	async function importQdpx(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		importError = null;
		const form = new FormData();
		form.append('file', file);
		const res = await fetch('/api/projects/import', { method: 'POST', body: form });
		const result = await res.json();
		if (res.ok) {
			goto(`/projects/${result.projectId}`);
		} else {
			importError = result.error || 'Import failed';
		}
		importing = false;
		input.value = '';
	}

	// Context menu
	let ctxMenuId = $state<string | null>(null);
	let ctxMenuPos = $state({ x: 0, y: 0 });
	let ctxProject = $derived(data.projects.find((p: any) => p.id === ctxMenuId));

	function onCardContext(projectId: string, e: MouseEvent) {
		e.preventDefault();
		ctxMenuId = projectId;
		ctxMenuPos = { x: e.clientX, y: e.clientY };
	}

	async function createProject() {
		if (!name.trim()) return;
		creating = true;
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined })
		});
		if (res.ok) {
			window.location.reload();
		}
		creating = false;
	}

	async function saveProjectAs(projectId: string) {
		const project = data.projects.find((p: any) => p.id === projectId);
		const newName = prompt('Save project as:', project ? `${project.name} (copy)` : 'Copy');
		if (newName === null) { ctxMenuId = null; return; }
		ctxMenuId = null;
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'duplicate', sourceProjectId: projectId, name: newName.trim() || undefined })
		});
		if (res.ok) {
			window.location.reload();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="projects-page" onclick={() => { ctxMenuId = null; }}>
	<div class="header">
		<h1>Projects</h1>
		<div class="header-actions">
			<label class="btn-import" class:disabled={importing}>
				{importing ? 'Importing...' : 'Import .qdpx'}
				<input type="file" accept=".qdpx" onchange={importQdpx} hidden disabled={importing} />
			</label>
			<button class="btn-primary" onclick={() => showCreate = !showCreate}>
				{showCreate ? 'Cancel' : 'New project'}
			</button>
		</div>
	</div>

	{#if importError}
		<div class="import-error">{importError}</div>
	{/if}

	{#if showCreate}
		<form class="create-form" onsubmit={e => { e.preventDefault(); createProject(); }}>
			<input type="text" placeholder="Project name" bind:value={name} required />
			<textarea placeholder="Description (optional)" bind:value={description} rows="2"></textarea>
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if data.projects.length === 0}
		<p class="empty">No projects yet. Create one to get started.</p>
	{:else}
		<div class="project-grid">
			{#each data.projects as project}
				<div class="project-card" role="button" tabindex="0"
					onclick={() => goto(`/projects/${project.id}`)}
					oncontextmenu={(e) => onCardContext(project.id, e)}
					onkeydown={(e) => { if (e.key === 'Enter') goto(`/projects/${project.id}`); }}>
					<h2>{project.name}</h2>
					{#if project.description}
						<p>{project.description}</p>
					{/if}
					<span class="meta">{project.role}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if ctxMenuId && ctxProject}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="context-menu" style="left: {ctxMenuPos.x}px; top: {ctxMenuPos.y}px;"
			onclick={(e) => e.stopPropagation()}>
			<div class="ctx-header">{ctxProject.name}</div>
			<button class="ctx-item" onclick={() => saveProjectAs(ctxMenuId!)}>
				Save As...
			</button>
		</div>
	{/if}
</div>

<style>
	.projects-page {
		max-width: 900px;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.btn-primary {
		background: #8b9cf7;
		color: #0f1117;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-primary:hover { background: #a5b4fc; }
	.btn-primary:disabled { opacity: 0.5; }

	.header-actions { display: flex; gap: 0.75rem; align-items: center; }

	.btn-import {
		background: none; border: 1px solid #10b981; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600;
		color: #10b981; cursor: pointer;
	}
	.btn-import:hover { background: rgba(16, 185, 129, 0.1); }
	.btn-import.disabled { opacity: 0.5; pointer-events: none; }

	.import-error {
		background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);
		color: #ef4444; padding: 0.6rem 1rem; border-radius: 6px;
		margin-bottom: 1rem; font-size: 0.85rem;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.create-form input,
	.create-form textarea {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}
	.create-form input:focus,
	.create-form textarea:focus {
		outline: none;
		border-color: #8b9cf7;
	}

	.empty {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.project-card {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		display: block;
		transition: border-color 0.15s;
		cursor: pointer;
	}
	.project-card:hover {
		border-color: #8b9cf7;
		color: #e1e4e8;
	}
	.project-card:focus-visible { outline: 2px solid #8b9cf7; outline-offset: 2px; }

	.project-card h2 {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e1e4e8;
		margin-bottom: 0.4rem;
	}

	.project-card p {
		font-size: 0.85rem;
		color: #8b8fa3;
		margin-bottom: 0.75rem;
	}

	.meta {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.context-menu {
		position: fixed;
		background: #1a1c2e;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.35rem 0;
		min-width: 160px;
		z-index: 1000;
		box-shadow: 0 4px 16px rgba(0,0,0,0.4);
	}

	.ctx-header {
		padding: 0.4rem 0.75rem;
		font-size: 0.75rem;
		color: #6b7280;
		border-bottom: 1px solid #2a2d3a;
		margin-bottom: 0.2rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 200px;
	}

	.ctx-item {
		display: block; width: 100%; text-align: left;
		padding: 0.4rem 0.75rem; font-size: 0.85rem;
		background: none; border: none; color: #e1e4e8; cursor: pointer;
	}
	.ctx-item:hover { background: #2a2d3a; }
</style>
