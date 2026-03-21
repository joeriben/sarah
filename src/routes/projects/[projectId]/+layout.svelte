<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string }[]>);
	const pathname = $derived($page.url.pathname);

	const mapTypeLabels: Record<string, string> = {
		situational: 'Sit Map',
		'social-worlds': 'SW/A Map',
		positional: 'Pos Map'
	};
	const mapTypeOrder = ['situational', 'social-worlds', 'positional'];
</script>

<div class="project-layout">
	<div class="project-sidebar">
		<h2>{p.name}</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			<a href="{base}/documents" class:active={pathname.startsWith(`${base}/documents`)}>Documents</a>
			<a href="{base}/namings" class:active={pathname.startsWith(`${base}/namings`)}>Namings</a>
			<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>Memos</a>

			{#each mapTypeOrder as type}
				{#if mapsByType[type]?.length}
					<a href="{base}/maps" class="map-group-label">{mapTypeLabels[type]}</a>
					{#each mapsByType[type] as map}
						<a
							href="{base}/maps/{map.id}"
							class="map-link"
							class:active={pathname === `${base}/maps/${map.id}`}
						>{map.label}</a>
					{/each}
				{/if}
			{/each}

			<a href="{base}/compare" class:active={pathname.startsWith(`${base}/compare`)}>Compare</a>
			<a href="{base}/members" class:active={pathname.startsWith(`${base}/members`)}>Members</a>

			<a href="/projects" class="back-link">← Projects</a>
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
		height: 100%;
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

	.map-group-label {
		font-size: 0.75rem;
		color: #6b7280 !important;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.5rem 0.65rem 0.15rem;
		margin-top: 0.15rem;
		text-decoration: none;
	}
	.map-group-label:hover {
		color: #a5b4fc !important;
	}

	.map-group-label:first-child {
		margin-top: 0;
	}

	.map-link {
		padding-left: 1.2rem !important;
	}

	.active {
		background: #1e2030;
		color: #fff;
	}

	.back-link {
		font-size: 0.78rem;
		color: #6b7280 !important;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #2a2d3a;
	}
	.back-link:hover {
		color: #a5b4fc !important;
	}

	.project-content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
