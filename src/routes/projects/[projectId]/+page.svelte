<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let { data } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
</script>

<div class="overview">
	<h1>{p.name}</h1>
	{#if p.description}<p class="desc">{p.description}</p>{/if}

	<div class="stats">
		<a href="/projects/{p.id}/documents" class="stat-card">
			<div class="num">{c.documents}</div>
			<div class="lbl">Documents</div>
		</a>
		<a href="/projects/{p.id}/memos" class="stat-card">
			<div class="num">{c.memos}</div>
			<div class="lbl">Memos</div>
		</a>
	</div>
</div>

<style>
	.overview { max-width: 800px; padding: 2rem; }
	h1 { font-size: 1.6rem; margin: 0 0 0.5rem; color: #e1e4e8; }
	.desc { color: #8b8fa3; font-size: 0.95rem; margin: 0 0 2rem; }
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
	}
	.stat-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 1.25rem; text-decoration: none; color: inherit;
		transition: border-color 0.15s;
	}
	.stat-card:hover { border-color: #8b9cf7; }
	.num { font-size: 1.6rem; font-weight: 600; color: #a5b4fc; }
	.lbl { font-size: 0.85rem; color: #8b8fa3; margin-top: 0.2rem; }
</style>
