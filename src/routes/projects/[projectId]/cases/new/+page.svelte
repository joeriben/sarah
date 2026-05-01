<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Anlege-Dialog für einen neuen Case. Drei Pflichtfelder: Name, Brief,
  zentrales Dokument (Picker aus den caseless Docs des Projekts).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { CaselessDoc, BriefOption } from './+page.server.js';

	let { data } = $props();
	const projectId = $derived(data.projectId as string);
	const caselessDocs = $derived(data.caselessDocs as CaselessDoc[]);
	const briefOptions = $derived(data.briefOptions as BriefOption[]);

	let name = $state('');
	let briefId = $state('');
	let centralDocumentId = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	const canSubmit = $derived(
		name.trim().length > 0 && briefId !== '' && centralDocumentId !== ''
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		submitError = null;
		try {
			const r = await fetch(`/api/projects/${projectId}/cases`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), briefId, centralDocumentId }),
			});
			if (!r.ok) {
				const text = await r.text().catch(() => '');
				throw new Error(`HTTP ${r.status}${text ? ': ' + text.slice(0, 200) : ''}`);
			}
			const result = (await r.json()) as { caseId: string };
			await goto(`/projects/${projectId}/documents/${centralDocumentId}?view=pipeline`);
			void result;
		} catch (err) {
			submitError = (err as Error).message;
		} finally {
			submitting = false;
		}
	}
</script>

<div class="page">
	<header>
		<h1>Neuer Case</h1>
		<p class="sub">
			Ein Case verknüpft ein zentrales Dokument mit dem Bewertungs-Brief.
			Die hermeneutische Pipeline läuft am Case, nicht am Projekt.
		</p>
	</header>

	<form onsubmit={handleSubmit}>
		<label class="field">
			<span class="label">Case-Name <span class="req">*</span></span>
			<input type="text" bind:value={name} placeholder="z.B. Müller, BA-Arbeit Frühjahr 2026" required />
		</label>

		<label class="field">
			<span class="label">Bewertungs-Brief <span class="req">*</span></span>
			<select bind:value={briefId} required>
				<option value="" disabled>— Brief auswählen —</option>
				{#each briefOptions as b (b.id)}
					<option value={b.id}>
						{b.name}{#if b.isSystemTemplate} · Vorlage{/if}{#if b.workType} · {b.workType}{/if}
					</option>
				{/each}
			</select>
			<a class="hint-link" href="/settings?tab=briefs">Brief-Library verwalten →</a>
		</label>

		<label class="field">
			<span class="label">Zentrales Dokument <span class="req">*</span></span>
			{#if caselessDocs.length === 0}
				<p class="empty-docs">
					Im Projekt sind keine ungebundenen Dokumente. Lade eines hoch unter
					<a href="/projects/{projectId}/documents">Documents</a>.
				</p>
			{:else}
				<select bind:value={centralDocumentId} required>
					<option value="" disabled>— Dokument auswählen —</option>
					{#each caselessDocs as d (d.id)}
						<option value={d.id}>{d.label}</option>
					{/each}
				</select>
				<p class="hint">
					Aufgelistet sind nur Dokumente, die noch keinem Case zugeordnet sind
					({caselessDocs.length}).
				</p>
			{/if}
		</label>

		{#if submitError}
			<div class="error">Anlegen fehlgeschlagen: {submitError}</div>
		{/if}

		<div class="actions">
			<a class="cancel" href="/projects/{projectId}/cases">Abbrechen</a>
			<button type="submit" class="submit" disabled={!canSubmit || submitting}>
				{submitting ? 'Lege an…' : 'Anlegen'}
			</button>
		</div>
	</form>
</div>

<style>
	.page { padding: 2rem; max-width: 720px; margin: 0 auto; }
	header { margin-bottom: 1.5rem; }
	header h1 { margin: 0 0 0.5rem; font-size: 1.4rem; color: #e1e4e8; }
	.sub { margin: 0; color: #8b8fa3; font-size: 0.9rem; line-height: 1.5; max-width: 60ch; }

	form { display: flex; flex-direction: column; gap: 1.2rem; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	.label {
		font-size: 0.78rem; color: #c9cdd5; font-weight: 500;
		text-transform: uppercase; letter-spacing: 0.04em;
	}
	.req { color: #fbbf24; }

	input[type="text"], select {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #e1e4e8; padding: 0.55rem 0.7rem; font-size: 0.9rem;
		font-family: inherit;
	}
	input[type="text"]:focus, select:focus {
		outline: none; border-color: rgba(165, 180, 252, 0.6);
		box-shadow: 0 0 0 1px rgba(165, 180, 252, 0.3);
	}

	.hint, .hint-link {
		font-size: 0.75rem; color: #6b7280;
	}
	.hint-link {
		color: #a5b4fc; text-decoration: none;
		align-self: flex-start;
	}
	.hint-link:hover { text-decoration: underline; }

	.empty-docs {
		font-size: 0.85rem; color: #c9cdd5;
		background: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.25);
		border-radius: 4px;
		padding: 0.6rem 0.8rem;
		margin: 0; line-height: 1.5;
	}
	.empty-docs a { color: #a5b4fc; }

	.error {
		padding: 0.6rem 0.8rem;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 4px;
		color: #fca5a5; font-size: 0.85rem;
	}

	.actions { display: flex; gap: 0.7rem; justify-content: flex-end; margin-top: 0.5rem; }
	.cancel {
		color: #8b8fa3; padding: 0.55rem 1rem; font-size: 0.85rem;
		text-decoration: none; border-radius: 4px;
	}
	.cancel:hover { color: #c9cdd5; }
	.submit {
		background: rgba(165, 180, 252, 0.15);
		border: 1px solid rgba(165, 180, 252, 0.55);
		color: #c7d2fe;
		padding: 0.55rem 1.4rem; font-size: 0.9rem; font-weight: 500;
		border-radius: 4px; cursor: pointer; font-family: inherit;
	}
	.submit:hover:not(:disabled) {
		background: rgba(165, 180, 252, 0.25);
		border-color: rgba(165, 180, 252, 0.8);
	}
	.submit:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
