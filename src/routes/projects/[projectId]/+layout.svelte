<script lang="ts">
	import type { Snippet } from 'svelte';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
</script>

<div class="project-layout">
	<div class="project-sidebar">
		<h2>{p.name}</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			<a href="{base}">Overview</a>
			<a href="{base}/documents">Documents <span class="badge">{c.documents}</span></a>
			<a href="{base}/codes">Grounding <span class="badge">{c.codes}</span></a>
			<a href="{base}/maps">Maps <span class="badge">{c.maps}</span></a>
			<a href="{base}/memos">Memos <span class="badge">{c.memos}</span></a>
			<a href="{base}/members">Members <span class="badge">{c.members}</span></a>
		</nav>
	</div>

	<div class="project-content">
		{@render children()}
	</div>
</div>

<style>
	.project-layout {
		display: flex;
		gap: 0;
		height: calc(100vh - 4rem);
		margin: -2rem;
	}

	.project-sidebar {
		width: 200px;
		padding: 1.25rem;
		border-right: 1px solid #2a2d3a;
		background: #13151e;
	}

	.project-sidebar h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.desc {
		font-size: 0.8rem;
		color: #6b7280;
		margin-bottom: 1rem;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 1rem;
	}

	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #c9cdd5;
	}
	nav a:hover {
		background: #1e2030;
		color: #fff;
	}

	.badge {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.project-content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
