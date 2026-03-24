<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();
	let showCreate = $state(false);
	let name = $state('');
	let description = $state('');
	let creating = $state(false);

	// Sync status
	let syncing = $state(false);
	let syncMessage = $state<string | null>(null);
	let showLoadMenu = $state(false);

	// QDPX export dialog
	let qdpxExportId = $state<string | null>(null);

	async function syncAction(action: string, body: Record<string, any> = {}) {
		syncing = true;
		syncMessage = null;
		try {
			const res = await fetch('/api/projects/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ...body })
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error);
			return result;
		} catch (e: any) {
			syncMessage = e.message;
			return null;
		} finally {
			syncing = false;
		}
	}

	async function exportProject(projectId: string) {
		const result = await syncAction('export', { projectId });
		if (result) {
			syncMessage = `Exported to projekte/${result.slug}/`;
			await invalidateAll();
		}
	}

	async function unloadProject(projectId: string, slug: string, projectName: string) {
		if (!confirm(`Unload "${projectName}" from database? Data stays safe in project directory.`)) return;
		const result = await syncAction('unload', { projectId, slug });
		if (result) {
			syncMessage = `Unloaded "${projectName}"`;
			await invalidateAll();
		}
	}

	async function loadProject(slug: string) {
		const result = await syncAction('load', { slug });
		if (result) {
			syncMessage = `Loaded "${slug}"`;
			await invalidateAll();
		}
	}

	async function deleteProject(projectId: string, slug: string | null, projectName: string) {
		if (!confirm(`Permanently delete "${projectName}"? This cannot be undone.`)) return;
		if (!confirm(`Are you sure? ALL data for "${projectName}" will be destroyed.`)) return;
		const result = await syncAction('delete', { projectId, slug });
		if (result) {
			syncMessage = `Deleted "${projectName}"`;
			await invalidateAll();
		}
	}

	async function duplicateProject(projectId: string, projectName: string) {
		const newName = prompt('Save project as:', `${projectName} (copy)`);
		if (newName === null) return;
		syncing = true;
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'duplicate', sourceProjectId: projectId, name: newName.trim() || undefined })
		});
		if (res.ok) {
			syncMessage = `Duplicated "${projectName}"`;
			await invalidateAll();
		} else {
			syncMessage = 'Duplicate failed';
		}
		syncing = false;
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
			const project = await res.json();
			// Auto-export new project to directory
			await syncAction('export', { projectId: project.id });
			await invalidateAll();
			showCreate = false;
			name = '';
			description = '';
		}
		creating = false;
	}

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

	// Derive which loaded projects have a directory slug
	function slugify(n: string): string {
		return n.toLowerCase()
			.replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' } as Record<string, string>)[c] || c)
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	const projectSlugs = $derived(
		new Map(data.projects.map((p: any) => [p.id, slugify(p.name)]))
	);

	// Directories that are NOT loaded (available to load)
	const unloadedDirs = $derived(
		(data.directories || []).filter((d: any) =>
			d.hasData && !data.projects.some((p: any) => slugify(p.name) === d.slug)
		)
	);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="projects-page" onclick={(e) => { if (!(e.target as HTMLElement).closest('.load-dropdown')) showLoadMenu = false; }}>
	<div class="header">
		<h1>Projects</h1>
		<div class="header-actions">
			<label class="btn-secondary" class:disabled={importing}>
				{importing ? 'Importing...' : 'Import .qdpx'}
				<input type="file" accept=".qdpx" onchange={importQdpx} hidden disabled={importing} />
			</label>
			<div class="load-dropdown">
				<button class="btn-secondary" onclick={() => showLoadMenu = !showLoadMenu} disabled={unloadedDirs.length === 0}>
					Load from disk {#if unloadedDirs.length > 0}({unloadedDirs.length}){/if}
				</button>
				{#if showLoadMenu && unloadedDirs.length > 0}
					<div class="load-menu">
						{#each unloadedDirs as dir}
							<button class="load-menu-item" onclick={() => { showLoadMenu = false; loadProject(dir.slug); }}>
								{dir.slug}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<button class="btn-primary" onclick={() => showCreate = !showCreate}>
				{showCreate ? 'Cancel' : 'New project'}
			</button>
		</div>
	</div>

	{#if syncMessage}
		<div class="sync-message">{syncMessage}</div>
	{/if}

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

	<!-- Loaded projects (in database) -->
	{#if data.projects.length > 0}
		<h2 class="section-label">Loaded</h2>
		<div class="project-grid">
			{#each data.projects as project}
				<div class="project-card">
					<div class="card-main" role="button" tabindex="0"
						onclick={() => goto(`/projects/${project.id}`)}
						onkeydown={(e) => { if (e.key === 'Enter') goto(`/projects/${project.id}`); }}>
						<h3>{project.name}</h3>
						{#if project.description}
							<p>{project.description}</p>
						{/if}
						<span class="meta">{project.role}</span>
					</div>
					<div class="card-actions">
						<button class="action-btn" title="Save to directory"
							onclick={() => exportProject(project.id)} disabled={syncing}>
							💾
						</button>
						<button class="action-btn" title="Duplicate"
							onclick={() => duplicateProject(project.id, project.name)} disabled={syncing}>
							📋
						</button>
						<button class="action-btn" title="Export as .qdpx (ATLAS.ti, MAXQDA, ...)"
							onclick={() => qdpxExportId = project.id}>
							📦
						</button>
						<button class="action-btn" title="Unload from database"
							onclick={() => unloadProject(project.id, projectSlugs.get(project.id) || slugify(project.name), project.name)}
							disabled={syncing}>
							📤
						</button>
						<button class="action-btn action-delete" title="Delete permanently"
							onclick={() => deleteProject(project.id, projectSlugs.get(project.id) || null, project.name)}
							disabled={syncing}>
							🗑
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Unloaded projects (on disk, not in DB) -->
	<h2 class="section-label" id="on-disk">On disk (not loaded)</h2>
	{#if unloadedDirs.length > 0}
		<div class="project-grid">
			{#each unloadedDirs as dir}
				<div class="project-card project-card-unloaded">
					<div class="card-main" role="button" tabindex="0"
						onclick={() => loadProject(dir.slug)}
						onkeydown={(e) => { if (e.key === 'Enter') loadProject(dir.slug); }}>
						<h3>{dir.slug}</h3>
						<p class="dir-path">{data.projectsDir}/{dir.slug}/</p>
					</div>
					<div class="card-actions">
						<button class="action-btn" title="Load into database"
							onclick={() => loadProject(dir.slug)} disabled={syncing}>
							📥
						</button>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">No saved projects in <code>{data.projectsDir}/</code></p>
	{/if}

	{#if data.projects.length === 0 && unloadedDirs.length === 0}
		<p class="empty" style="margin-top: 1rem;">No projects yet. Create one or import a .qdpx file.</p>
	{/if}

	<p class="dir-info">Project data: <code>{data.projectsDir}/</code></p>
</div>

<!-- QDPX Export Loss Dialog -->
{#if qdpxExportId}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => qdpxExportId = null}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>QDPX Export</h2>
			<p class="modal-subtitle">Interop-Format for ATLAS.ti, MAXQDA, NVivo</p>

			<div class="loss-section loss-warn">
				<h3>Lost for external tools</h3>
				<ul>
					<li>Naming history (renames, re-designations) — collapsed to latest</li>
					<li>CCS gradient (cue/characterization/specification) — only in description field</li>
					<li>Phases — invisible in standard QDA</li>
					<li>Silences — not representable</li>
					<li>AI metadata and reasoning</li>
					<li>Map layouts — only auto-saved positions (seq=0)</li>
					<li>Topology snapshot history</li>
					<li>Researcher identities</li>
				</ul>
			</div>

			<div class="loss-section loss-ok">
				<h3>Preserved</h3>
				<ul>
					<li>All codes, documents, annotations</li>
					<li>Memos and memo content</li>
					<li>Relations between codes</li>
					<li>Document sets (DocNets)</li>
					<li>One map with positions</li>
				</ul>
			</div>

			<div class="loss-section loss-recovery">
				<h3>Lossless backup</h3>
				<p>For full-fidelity backup, use the native project format (💾 Save). QDPX is for interop with other tools only.</p>
			</div>

			<div class="modal-actions">
				<button class="btn-cancel" onclick={() => qdpxExportId = null}>Cancel</button>
				<a class="btn-export" href="/api/projects/{qdpxExportId}/export" download
					onclick={() => qdpxExportId = null}>
					Export .qdpx
				</a>
			</div>
		</div>
	</div>
{/if}

<style>
	.projects-page {
		max-width: 900px;
		padding: 2rem;
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

	.section-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
		margin: 1.5rem 0 0.75rem;
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

	.btn-secondary {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #c9cdd5;
		cursor: pointer;
	}
	.btn-secondary:hover { background: #1e2030; }
	.btn-secondary:disabled { opacity: 0.5; }

	.header-actions { display: flex; gap: 0.75rem; align-items: center; }

	.sync-message {
		background: rgba(139, 156, 247, 0.1);
		border: 1px solid rgba(139, 156, 247, 0.3);
		color: #a5b4fc;
		padding: 0.6rem 1rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}

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
		display: flex;
		flex-direction: column;
		transition: border-color 0.15s;
	}
	.project-card:hover {
		border-color: #8b9cf7;
	}

	.project-card-unloaded {
		opacity: 0.7;
		border-style: dashed;
	}
	.project-card-unloaded:hover {
		opacity: 1;
		border-color: #10b981;
	}

	.card-main {
		padding: 1.25rem;
		cursor: pointer;
		flex: 1;
	}
	.card-main:focus-visible { outline: 2px solid #8b9cf7; outline-offset: -2px; border-radius: 8px 8px 0 0; }

	.card-main h3 {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e1e4e8;
		margin-bottom: 0.4rem;
	}

	.card-main p {
		font-size: 0.85rem;
		color: #8b8fa3;
		margin-bottom: 0.5rem;
	}

	.meta {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.card-actions {
		display: flex;
		border-top: 1px solid #2a2d3a;
		padding: 0.35rem 0.5rem;
		gap: 0.25rem;
	}

	.action-btn {
		background: none;
		border: none;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
		opacity: 0.6;
	}
	.action-btn:hover { background: #1e2030; opacity: 1; }
	.action-btn:disabled { opacity: 0.3; pointer-events: none; }

	.action-delete:hover { background: rgba(239, 68, 68, 0.15); }

	.dir-path {
		font-size: 0.75rem;
		color: #4b5563;
		font-family: monospace;
		word-break: break-all;
	}

	.dir-info {
		margin-top: 2rem;
		padding-top: 1rem;
		border-top: 1px solid #1e2030;
		font-size: 0.75rem;
		color: #4b5563;
	}
	.dir-info code {
		color: #6b7280;
		font-size: 0.75rem;
	}

	.disabled { opacity: 0.5; pointer-events: none; }

	.load-dropdown {
		position: relative;
	}

	.load-menu {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.25rem;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		min-width: 200px;
		padding: 0.25rem 0;
		z-index: 100;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.load-menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		background: none;
		border: none;
		color: #e1e4e8;
		cursor: pointer;
	}
	.load-menu-item:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	/* QDPX Export Modal */
	.modal-overlay {
		position: fixed; inset: 0; z-index: 1000;
		background: rgba(0, 0, 0, 0.6); display: flex;
		align-items: center; justify-content: center;
	}
	.modal {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 12px;
		padding: 1.5rem; max-width: 520px; width: 90%;
		max-height: 80vh; overflow-y: auto;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
	}
	.modal h2 { font-size: 1.1rem; margin: 0 0 0.2rem; color: #e1e4e8; }
	.modal-subtitle { font-size: 0.8rem; color: #6b7280; margin: 0 0 1rem; }
	.loss-section { margin-bottom: 0.75rem; padding: 0.6rem 0.75rem; border-radius: 6px; }
	.loss-section h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 0.3rem; }
	.loss-section ul { margin: 0; padding-left: 1.2rem; font-size: 0.8rem; line-height: 1.6; }
	.loss-section p { margin: 0; font-size: 0.8rem; line-height: 1.5; }
	.loss-warn { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); }
	.loss-warn h3 { color: #f59e0b; }
	.loss-warn li { color: #c9cdd5; }
	.loss-ok { background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.2); }
	.loss-ok h3 { color: #10b981; }
	.loss-ok li { color: #c9cdd5; }
	.loss-recovery { background: rgba(139, 156, 247, 0.06); border: 1px solid rgba(139, 156, 247, 0.2); }
	.loss-recovery h3 { color: #8b9cf7; }
	.loss-recovery p { color: #c9cdd5; }
	.modal-actions {
		display: flex; gap: 0.5rem; justify-content: flex-end;
		margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #2a2d3a;
	}
	.btn-cancel {
		background: none; border: 1px solid #2a2d3a; border-radius: 6px;
		color: #8b8fa3; padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer;
	}
	.btn-cancel:hover { border-color: #4b5060; color: #c9cdd5; }
	.btn-export {
		background: #f59e0b; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600;
		cursor: pointer; text-decoration: none;
	}
	.btn-export:hover { background: #d97706; }
</style>
