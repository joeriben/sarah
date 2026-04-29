<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();
	let showCreate = $state(false);
	let name = $state('');
	let description = $state('');
	let creating = $state(false);
	let message = $state<string | null>(null);

	async function createProject() {
		if (!name.trim()) return;
		creating = true;
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined })
		});
		if (res.ok) {
			await invalidateAll();
			showCreate = false;
			name = '';
			description = '';
		} else {
			message = 'Could not create project.';
		}
		creating = false;
	}

	async function deleteProject(projectId: string, projectName: string) {
		if (!confirm(`Permanently delete "${projectName}"? This cannot be undone.`)) return;
		const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
		if (res.ok) {
			message = `Deleted "${projectName}"`;
			await invalidateAll();
		} else {
			message = 'Could not delete project.';
		}
	}
</script>

<div class="projects-page">
	<div class="header">
		<h1>Projects</h1>
		<button class="btn-primary" onclick={() => (showCreate = !showCreate)}>
			{showCreate ? 'Cancel' : 'New project'}
		</button>
	</div>

	{#if message}
		<div class="msg">{message}</div>
	{/if}

	{#if showCreate}
		<form class="create-form" onsubmit={(e) => { e.preventDefault(); createProject(); }}>
			<input type="text" placeholder="Project name" bind:value={name} required />
			<textarea placeholder="Description (optional)" bind:value={description} rows="2"></textarea>
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if data.projects.length > 0}
		<div class="project-grid">
			{#each data.projects as project}
				<div class="project-card">
					<div
						class="card-main"
						role="button"
						tabindex="0"
						onclick={() => goto(`/projects/${project.id}`)}
						onkeydown={(e) => { if (e.key === 'Enter') goto(`/projects/${project.id}`); }}
					>
						<h3>{project.name}</h3>
						{#if project.description}<p>{project.description}</p>{/if}
						<span class="meta">{project.role}</span>
					</div>
					<div class="card-actions">
						<button class="action-btn action-delete" title="Delete permanently"
							onclick={() => deleteProject(project.id, project.name)}>🗑</button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">No projects yet. Create one to get started.</p>
	{/if}
</div>

<style>
	.projects-page { max-width: 900px; padding: 2rem; }
	.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 600; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:hover { background: #a5b4fc; }
	.btn-primary:disabled { opacity: 0.5; }

	.msg {
		background: rgba(139, 156, 247, 0.1); border: 1px solid rgba(139, 156, 247, 0.3);
		color: #a5b4fc; padding: 0.6rem 1rem; border-radius: 6px;
		margin-bottom: 1rem; font-size: 0.85rem;
	}

	.create-form {
		display: flex; flex-direction: column; gap: 0.75rem;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 1.25rem; margin-bottom: 1.5rem;
	}
	.create-form input, .create-form textarea {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
		font-family: inherit; resize: vertical;
	}

	.empty { color: #6b7280; font-size: 0.9rem; }

	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}
	.project-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		display: flex; flex-direction: column; transition: border-color 0.15s;
	}
	.project-card:hover { border-color: #8b9cf7; }
	.card-main { padding: 1.25rem; cursor: pointer; flex: 1; }
	.card-main h3 { font-size: 1.05rem; font-weight: 600; color: #e1e4e8; margin-bottom: 0.4rem; }
	.card-main p { font-size: 0.85rem; color: #8b8fa3; margin-bottom: 0.5rem; }
	.meta { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
	.card-actions {
		display: flex; justify-content: flex-end;
		border-top: 1px solid #2a2d3a; padding: 0.35rem 0.5rem;
	}
	.action-btn {
		background: none; border: none; padding: 0.3rem 0.5rem;
		border-radius: 4px; cursor: pointer; font-size: 0.85rem; opacity: 0.6;
	}
	.action-btn:hover { background: #1e2030; opacity: 1; }
	.action-delete:hover { background: rgba(239, 68, 68, 0.15); }
</style>
