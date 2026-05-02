<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const documents = $derived(data.documents as { id: string; label: string }[]);
	const pathname = $derived($page.url.pathname);
	// Doc-Detail-Tiefe (`/projects/X/documents/Y[/...]`) bekommt eine
	// dokumentspezifische Sidebar von der Doc-Page selbst — die generische
	// Project-Nav ist hier irrelevant (Triade pro Case, keine Geschwister-Docs).
	const isDocDetail = $derived(/^\/projects\/[^/]+\/documents\/[^/]+(\/|$)/.test(pathname));

	let renamingDocId = $state<string | null>(null);
	let renameValue = $state('');

	async function saveDocRename(docId: string) {
		if (!renameValue.trim()) { renamingDocId = null; return; }
		const res = await fetch(`/api/projects/${p.id}/documents/${docId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: renameValue.trim() })
		});
		if (res.ok) {
			const d = documents.find(d => d.id === docId);
			if (d) d.label = renameValue.trim();
		}
		renamingDocId = null;
	}
</script>

<div class="project-layout" class:no-sidebar={isDocDetail}>
	{#if !isDocDetail}
		<aside class="project-sidebar">
			<div class="proj-header">
				<a href="/projects" class="back">← Projects</a>
				<h2><a href={base} class:active={pathname === base} class="project-name-link">{p.name}</a></h2>
				{#if p.description}<p class="desc">{p.description}</p>{/if}
			</div>

			<nav class="nav">
				<a href={base} class:active={pathname === base}>Overview</a>
				<a href="{base}/cases" class:active={pathname.startsWith(`${base}/cases`)}>
					Cases <span class="count">{c.cases}</span>
				</a>
				<a href="{base}/documents" class:active={pathname.startsWith(`${base}/documents`)}>
					Documents <span class="count">{c.documents}</span>
				</a>
				<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>
					Memos <span class="count">{c.memos}</span>
				</a>
			</nav>

			{#if documents.length > 0}
				<div class="subnav">
					<div class="subnav-label">Documents</div>
					{#each documents as d}
						{#if renamingDocId === d.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="doc-rename-input"
								bind:value={renameValue}
								autofocus
								onkeydown={(e) => { if (e.key === 'Enter') saveDocRename(d.id); if (e.key === 'Escape') renamingDocId = null; }}
								onblur={() => saveDocRename(d.id)}
							/>
						{:else}
							<a
								href="{base}/documents/{d.id}"
								class="subnav-item"
								class:active={pathname === `${base}/documents/${d.id}`}
								ondblclick={(e) => { e.preventDefault(); renamingDocId = d.id; renameValue = d.label; }}
							>{d.label}</a>
						{/if}
					{/each}
				</div>
			{/if}
		</aside>
	{/if}

	<main class="project-main">
		{@render children()}
	</main>
</div>

<style>
	.project-layout {
		display: grid;
		grid-template-columns: 240px 1fr;
		height: 100%;
		min-height: 0;
	}
	.project-layout.no-sidebar {
		grid-template-columns: 1fr;
	}

	.project-sidebar {
		background: #0f1117;
		border-right: 1px solid #1e2030;
		padding: 1rem;
		overflow-y: auto;
		min-height: 0;
	}

	.proj-header {
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #1e2030;
	}
	.back {
		font-size: 0.78rem;
		color: #6b7280;
		text-decoration: none;
		display: block;
		margin-bottom: 0.5rem;
	}
	.back:hover { color: #c9cdd5; }
	.proj-header h2 {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}
	.project-name-link {
		color: #e1e4e8;
		text-decoration: none;
	}
	.project-name-link.active { color: #a5b4fc; }
	.desc {
		font-size: 0.78rem;
		color: #8b8fa3;
		margin: 0;
	}

	.nav { display: flex; flex-direction: column; gap: 2px; margin-bottom: 1rem; }
	.nav a {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.45rem 0.6rem; border-radius: 4px;
		font-size: 0.85rem; color: #c9cdd5; text-decoration: none;
	}
	.nav a:hover { background: #1e2030; }
	.nav a.active { background: rgba(165, 180, 252, 0.1); color: #a5b4fc; }
	.count { font-size: 0.7rem; color: #6b7280; }

	.subnav { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #1e2030; }
	.subnav-label {
		font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
		color: #6b7280; padding: 0 0.6rem; margin-bottom: 0.4rem;
	}
	.subnav-item {
		display: block; padding: 0.35rem 0.6rem;
		font-size: 0.78rem; color: #8b8fa3;
		text-decoration: none; border-radius: 4px;
	}
	.subnav-item:hover { background: #1e2030; color: #c9cdd5; }
	.subnav-item.active { background: rgba(165, 180, 252, 0.08); color: #a5b4fc; }

	.doc-rename-input {
		display: block; width: 100%;
		padding: 0.35rem 0.6rem;
		background: #1a1d2a; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #e1e4e8; font-size: 0.78rem; font-family: inherit;
	}

	.project-main {
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}
</style>
