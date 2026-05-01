<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BriefEditor from '$lib/components/BriefEditor.svelte';

	let { data } = $props();
	const brief = $derived(data.brief);

	let busy = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);

	let formInitial = $derived({
		name: brief.name,
		work_type: brief.work_type,
		criteria: brief.criteria,
		persona: brief.persona,
		include_formulierend: brief.include_formulierend
	});

	async function handleSubmit(form: typeof formInitial) {
		busy = true;
		error = null;
		saved = false;
		const res = await fetch(`/api/briefs/${brief.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			error = body.message || body.error || `Speichern fehlgeschlagen (${res.status})`;
		} else {
			await invalidateAll();
			saved = true;
		}
		busy = false;
	}
</script>

<div class="edit-brief-page">
	<header>
		<a class="back" href="/settings?tab=briefs">← Briefs</a>
		<h1>{brief.name}</h1>
		<p class="meta">Erstellt {new Date(brief.created_at).toLocaleDateString('de-DE')}</p>
	</header>

	{#if saved}
		<div class="saved">Gespeichert.</div>
	{/if}

	{#key brief.id}
		<BriefEditor initial={formInitial} mode="edit" onSubmit={handleSubmit} {busy} {error} />
	{/key}
</div>

<style>
	.edit-brief-page {
		max-width: 920px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}
	.back {
		font-size: 0.78rem;
		color: #6b7280;
		text-decoration: none;
		display: block;
		margin-bottom: 0.5rem;
	}
	.back:hover { color: #c9cdd5; }
	h1 {
		font-size: 1.4rem;
		margin: 0 0 0.3rem;
		color: #e1e4e8;
	}
	.meta {
		font-size: 0.78rem;
		color: #6b7280;
		margin: 0 0 1.25rem;
	}
	.saved {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: #4ade80;
		padding: 0.55rem 0.8rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}
</style>
