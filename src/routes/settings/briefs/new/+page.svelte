<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import BriefEditor from '$lib/components/BriefEditor.svelte';

	const initial = {
		name: '',
		work_type: 'bachelor_thesis' as const,
		criteria: '',
		persona: '',
		include_formulierend: false,
		validity_check: false
	};

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function handleSubmit(form: typeof initial) {
		busy = true;
		error = null;
		const res = await fetch('/api/briefs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			error = body.message || body.error || `Anlegen fehlgeschlagen (${res.status})`;
			busy = false;
			return;
		}
		const { brief } = await res.json();
		await goto(`/settings/briefs/${brief.id}`);
	}
</script>

<div class="new-brief-page">
	<header>
		<a class="back" href="/settings?tab=briefs">← Briefs</a>
		<h1>Neuer Brief</h1>
	</header>

	<BriefEditor {initial} mode="new" onSubmit={handleSubmit} {busy} {error} />
</div>

<style>
	.new-brief-page {
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
		margin: 0 0 1.5rem;
		color: #e1e4e8;
	}
</style>
