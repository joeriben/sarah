<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { goto } from '$app/navigation';

	let { data } = $props();

	function getInitialComparison() {
		return data.comparison ?? null;
	}

	const initialComparison = getInitialComparison();
	let typeA = $state(initialComparison?.typeA || 'docnet');
	let typeB = $state(initialComparison?.typeB || 'docnet');
	let sourceA = $state(initialComparison?.sourceA || '');
	let sourceB = $state(initialComparison?.sourceB || '');

	function sourcesFor(type: string) {
		if (type === 'docnet') return data.docnets;
		if (type === 'map') return data.maps;
		return data.documents;
	}
	const sourcesA = $derived(sourcesFor(typeA));
	const sourcesB = $derived(sourcesFor(typeB));

	function compare() {
		if (!sourceA || !sourceB) return;
		goto(`?a=${sourceA}&b=${sourceB}&typeA=${typeA}&typeB=${typeB}`);
	}

	function labelFor(type: string, id: string) {
		return sourcesFor(type).find((s: any) => s.id === id)?.label || id;
	}

	const c = $derived(data.comparison);
</script>

<div class="compare-page">
	<h1>Compare</h1>

	<div class="source-selection">
		<div class="source-col">
			<label class="source-label" for="compare-type-a">Source A</label>
			<div class="source-controls">
				<select id="compare-type-a" bind:value={typeA} onchange={() => sourceA = ''}>
					<option value="docnet">DocNet</option>
					<option value="document">Document</option>
					<option value="map">Map</option>
				</select>
				<select aria-label="Source A item" bind:value={sourceA}>
					<option value="">— select —</option>
					{#each sourcesA as s}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</div>
		</div>

		<span class="vs">vs.</span>

		<div class="source-col">
			<label class="source-label" for="compare-type-b">Source B</label>
			<div class="source-controls">
				<select id="compare-type-b" bind:value={typeB} onchange={() => sourceB = ''}>
					<option value="docnet">DocNet</option>
					<option value="document">Document</option>
				</select>
				<select aria-label="Source B item" bind:value={sourceB}>
					<option value="">— select —</option>
					{#each sourcesB as s}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</div>
		</div>

		<button class="btn-compare" onclick={compare} disabled={!sourceA || !sourceB || sourceA === sourceB}>
			Compare
		</button>
	</div>

	{#if c}
		<div class="comparison-results">
			<div class="result-header">
				<span class="rh-label rh-a">{labelFor(c.typeA, c.sourceA)}</span>
				<span class="rh-vs">vs.</span>
				<span class="rh-label rh-b">{labelFor(c.typeB, c.sourceB)}</span>
			</div>

			<div class="result-columns">
				<div class="result-col col-only-a">
					<h3>Only in A <span class="col-count">({c.onlyA.length})</span></h3>
					{#each c.onlyA as n}
						<div class="naming-item item-a">{n.label}</div>
					{/each}
					{#if c.onlyA.length === 0}
						<span class="empty">—</span>
					{/if}
				</div>

				<div class="result-col col-shared">
					<h3>Shared <span class="col-count">({c.shared.length})</span></h3>
					{#each c.shared as n}
						<div class="naming-item item-shared">{n.label}</div>
					{/each}
					{#if c.shared.length === 0}
						<span class="empty">—</span>
					{/if}
				</div>

				<div class="result-col col-only-b">
					<h3>Only in B <span class="col-count">({c.onlyB.length})</span></h3>
					{#each c.onlyB as n}
						<div class="naming-item item-b">{n.label}</div>
					{/each}
					{#if c.onlyB.length === 0}
						<span class="empty">—</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.compare-page { max-width: 1000px; }
	h1 { font-size: 1.3rem; margin-bottom: 1.5rem; }

	/* Source selection */
	.source-selection {
		display: flex; align-items: flex-end; gap: 1rem;
		padding: 1rem; background: #161822; border: 1px solid #2a2d3a;
		border-radius: 8px; margin-bottom: 2rem;
	}
	.source-col { flex: 1; }
	.source-label {
		font-size: 0.7rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.3rem;
	}
	.source-controls { display: flex; gap: 0.4rem; }
	.source-controls select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.35rem 0.5rem; color: #c9cdd5; font-size: 0.82rem;
		flex: 1; min-width: 0;
	}
	.source-controls select:focus { border-color: #8b9cf7; outline: none; }
	.vs {
		color: #6b7280; font-size: 0.9rem; font-weight: 600;
		padding-bottom: 0.3rem;
	}
	.btn-compare {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.4rem 1rem; font-size: 0.85rem; font-weight: 600;
		cursor: pointer; white-space: nowrap;
	}
	.btn-compare:disabled { opacity: 0.4; cursor: default; }

	/* Results */
	.result-header {
		display: flex; align-items: center; gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.rh-label { font-size: 1rem; font-weight: 600; }
	.rh-a { color: #f59e0b; }
	.rh-b { color: #8b9cf7; }
	.rh-vs { color: #6b7280; font-size: 0.85rem; }

	.result-columns {
		display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;
	}
	.result-col {
		background: #161822; border: 1px solid #1e2030;
		border-radius: 6px; padding: 0.75rem;
	}
	.result-col h3 {
		font-size: 0.8rem; margin-bottom: 0.5rem;
		text-transform: uppercase; letter-spacing: 0.03em;
	}
	.col-count { color: #6b7280; font-weight: 400; }
	.col-only-a h3 { color: #f59e0b; }
	.col-shared h3 { color: #10b981; }
	.col-only-b h3 { color: #8b9cf7; }

	.naming-item {
		padding: 0.25rem 0.4rem; margin: 0.1rem 0;
		font-size: 0.82rem; color: #c9cdd5;
		border-radius: 3px;
	}
	.item-a { border-left: 2px solid rgba(245, 158, 11, 0.3); padding-left: 0.5rem; }
	.item-shared { border-left: 2px solid rgba(16, 185, 129, 0.3); padding-left: 0.5rem; }
	.item-b { border-left: 2px solid rgba(139, 156, 247, 0.3); padding-left: 0.5rem; }

	.empty { color: #4b5563; font-size: 0.75rem; font-style: italic; }
</style>
