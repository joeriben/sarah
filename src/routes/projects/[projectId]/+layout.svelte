<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import AidelePanel from '$lib/aidele/AidelePanel.svelte';
	import { createAideleState, setAideleState } from '$lib/aidele/aideleState.svelte.js';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string }[]>);
	const pathname = $derived($page.url.pathname);

	// Aidele: didactic AI persona
	const aidele = createAideleState(p.id);
	setAideleState(aidele);

	// Raichel: autonomous researcher
	let raichelRunning = $state(false);
	let raichelStatus = $state('');

	async function startRaichel() {
		if (raichelRunning) return;
		raichelRunning = true;
		raichelStatus = 'Starting analysis...';
		try {
			const res = await fetch(`/api/projects/${p.id}/raichel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'start' })
			});
			const result = await res.json();
			if (result.success) {
				raichelStatus = `Done — ${result.progress?.length || 0} steps. Map created.`;
				// Navigate to the created map
				if (result.mapId) {
					window.location.href = `${base}/maps/${result.mapId}`;
				}
			} else {
				raichelStatus = `Error: ${result.error}`;
			}
		} catch (e) {
			raichelStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			raichelRunning = false;
		}
	}

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

			<button
				class="aidele-toggle"
				class:aidele-active={aidele.isOpen}
				onclick={() => aidele.isOpen = !aidele.isOpen}
			>Aidele</button>

			<button
				class="raichel-toggle"
				class:raichel-active={raichelRunning}
				onclick={startRaichel}
				disabled={raichelRunning}
			>{raichelRunning ? 'Raichel...' : 'Raichel'}</button>
			{#if raichelStatus}
				<span class="raichel-status">{raichelStatus}</span>
			{/if}

			<a href="/projects" class="back-link">← Projects</a>
		</nav>
	</div>

	<div class="project-content">
		{@render children()}
	</div>

	<AidelePanel />
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

	.aidele-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #a5b4fc;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.5rem;
		font-family: inherit;
		font-weight: 500;
	}
	.aidele-toggle:hover {
		background: #1e2030;
		border-color: #a5b4fc;
	}
	.aidele-active {
		background: rgba(165, 180, 252, 0.1);
		border-color: #a5b4fc;
	}

	.raichel-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #f0abfc;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.15rem;
		font-family: inherit;
		font-weight: 500;
	}
	.raichel-toggle:hover:not(:disabled) {
		background: #1e2030;
		border-color: #f0abfc;
	}
	.raichel-toggle:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.raichel-active {
		background: rgba(240, 171, 252, 0.1);
		border-color: #f0abfc;
	}
	.raichel-status {
		font-size: 0.72rem;
		color: #9ca3af;
		padding: 0.1rem 0.65rem;
		line-height: 1.3;
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
