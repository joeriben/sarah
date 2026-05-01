<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	export const WORK_TYPES = [
		'habilitation',
		'dissertation',
		'master_thesis',
		'bachelor_thesis',
		'article',
		'peer_review',
		'corpus_analysis'
	] as const;

	type WorkType = (typeof WORK_TYPES)[number];

	type BriefForm = {
		name: string;
		work_type: WorkType;
		criteria: string;
		persona: string;
		include_formulierend: boolean;
	};

	let {
		initial,
		mode,
		onSubmit,
		busy = false,
		error = null
	}: {
		initial: BriefForm;
		mode: 'new' | 'edit';
		onSubmit: (form: BriefForm) => void | Promise<void>;
		busy?: boolean;
		error?: string | null;
	} = $props();

	let name = $state(initial.name);
	let work_type = $state<WorkType>(initial.work_type);
	let criteria = $state(initial.criteria);
	let persona = $state(initial.persona);
	let include_formulierend = $state(initial.include_formulierend);

	const WORK_TYPE_LABELS: Record<WorkType, string> = {
		habilitation: 'Habilitation',
		dissertation: 'Dissertation',
		master_thesis: 'Master-Arbeit',
		bachelor_thesis: 'Bachelor-Arbeit',
		article: 'Wissenschaftlicher Artikel',
		peer_review: 'Peer-Review (Re-Review)',
		corpus_analysis: 'Korpusanalyse'
	};

	function submit(e: Event) {
		e.preventDefault();
		if (busy) return;
		onSubmit({
			name: name.trim(),
			work_type,
			criteria,
			persona,
			include_formulierend
		});
	}

	const canSubmit = $derived(name.trim().length > 0);
</script>

<form class="brief-form" onsubmit={submit}>
	<div class="field">
		<label for="brief-name">Name</label>
		<input
			id="brief-name"
			type="text"
			bind:value={name}
			placeholder="z.B. BA-Arbeiten EW – Standardbrief"
			required
		/>
	</div>

	<div class="field">
		<label for="brief-work-type">Werktyp</label>
		<select id="brief-work-type" bind:value={work_type}>
			{#each WORK_TYPES as t}
				<option value={t}>{WORK_TYPE_LABELS[t]}</option>
			{/each}
		</select>
	</div>

	<div class="field">
		<label for="brief-persona">Gutachter-Persona</label>
		<textarea
			id="brief-persona"
			bind:value={persona}
			rows="6"
		></textarea>
		<p class="hint">In welcher Rolle, mit welcher fachlichen Verortung soll die Pipeline lesen?</p>
	</div>

	<div class="field">
		<label for="brief-criteria">Bewertungs-Kriterien</label>
		<textarea
			id="brief-criteria"
			bind:value={criteria}
			rows="14"
		></textarea>
		<p class="hint">
			Freitext. Wird in jeden Pipeline-Pass injiziert. <strong>Achtung:</strong> Wenn dieses Feld leer bleibt, bricht der per-Absatz-Pass ab.
		</p>
	</div>

	<div class="field-toggle">
		<label>
			<input type="checkbox" bind:checked={include_formulierend} />
			<span>Zusätzliches formulierendes Memo erzeugen</span>
		</label>
		<p class="hint">
			Aus: Synthese-Memo enthält die Gist implizit (Standard, ~40 % weniger Tokens).
			Ein: Zweites Memo mit textnaher Verdichtung als Audit-Trail.
		</p>
	</div>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	<div class="actions">
		<button type="submit" class="btn-primary" disabled={!canSubmit || busy}>
			{busy ? 'Speichere…' : mode === 'new' ? 'Brief anlegen' : 'Änderungen speichern'}
		</button>
	</div>
</form>

<style>
	.brief-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-width: 760px;
	}
	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	.field-toggle { display: flex; flex-direction: column; gap: 0.3rem; }
	label {
		font-size: 0.82rem;
		font-weight: 500;
		color: #c9cdd5;
	}
	.field-toggle label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	input[type="text"], select, textarea {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.55rem 0.7rem;
		color: #e1e4e8;
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}
	textarea { line-height: 1.5; }
	input[type="text"]:focus, select:focus, textarea:focus {
		outline: none;
		border-color: #8b9cf7;
	}
	.hint {
		font-size: 0.75rem;
		color: #6b7280;
		margin: 0;
		line-height: 1.45;
	}
	.hint strong { color: #f59e0b; font-weight: 500; }
	.error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
		padding: 0.6rem 0.8rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}
	.btn-primary {
		background: #4f46e5;
		color: white;
		border: none;
		padding: 0.6rem 1.25rem;
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.btn-primary:hover { background: #4338ca; }
	.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
