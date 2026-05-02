<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Anlege-Dialog für einen neuen Case. Drei Pflichtfelder: Name, Brief,
  zentrales Dokument. Letzteres entweder per Upload (primär) oder als
  Auswahl aus dem Pool noch nicht zugewiesener Dokumente (Fallback).

  UX-Setzung 2026-05-02: Hauptflow ist "Case anlegen MIT Doc-Upload".
  Vorher musste man erst caseless hochladen und dann den Case anlegen —
  das hat den Doc-Upload-Schritt visuell vom Case getrennt.
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

	type DocSource =
		| { kind: 'upload'; file: File }
		| { kind: 'existing'; id: string }
		| { kind: 'none' };
	let docSource = $state<DocSource>({ kind: 'none' });
	let dragOver = $state(false);
	let showCaselessPicker = $state(false);

	let submitting = $state(false);
	let submitStage = $state<'idle' | 'uploading' | 'creating' | 'done'>('idle');
	let submitError = $state<string | null>(null);

	const canSubmit = $derived(
		name.trim().length > 0 &&
			briefId !== '' &&
			(docSource.kind === 'upload' || docSource.kind === 'existing')
	);

	function pickFile(file: File) {
		docSource = { kind: 'upload', file };
		showCaselessPicker = false;
	}
	function pickExisting(id: string) {
		docSource = id === '' ? { kind: 'none' } : { kind: 'existing', id };
	}
	function clearDocChoice() {
		docSource = { kind: 'none' };
	}

	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (f) pickFile(f);
		input.value = '';
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) pickFile(f);
	}
	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}
	function onDragLeave() {
		dragOver = false;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		submitError = null;
		try {
			let centralDocumentId: string;
			if (docSource.kind === 'upload') {
				submitStage = 'uploading';
				const fd = new FormData();
				fd.append('file', docSource.file);
				const ur = await fetch(`/api/upload?projectId=${projectId}`, {
					method: 'POST',
					body: fd
				});
				if (!ur.ok) {
					const text = await ur.text().catch(() => '');
					throw new Error(`Upload fehlgeschlagen (HTTP ${ur.status})${text ? ': ' + text.slice(0, 200) : ''}`);
				}
				const uploaded = (await ur.json()) as { id: string };
				centralDocumentId = uploaded.id;
			} else if (docSource.kind === 'existing') {
				centralDocumentId = docSource.id;
			} else {
				throw new Error('Kein Dokument ausgewählt');
			}

			submitStage = 'creating';
			const r = await fetch(`/api/projects/${projectId}/cases`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), briefId, centralDocumentId })
			});
			if (!r.ok) {
				const text = await r.text().catch(() => '');
				throw new Error(`Case-Anlage fehlgeschlagen (HTTP ${r.status})${text ? ': ' + text.slice(0, 200) : ''}`);
			}
			submitStage = 'done';
			await goto(`/projects/${projectId}/documents/${centralDocumentId}?view=pipeline`);
		} catch (err) {
			submitError = (err as Error).message;
			submitStage = 'idle';
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
			Die argumentanalytische Pipeline läuft am Case, nicht am Projekt.
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

		<div class="field">
			<span class="label">Zentrales Dokument <span class="req">*</span></span>

			{#if docSource.kind === 'upload'}
				<div class="doc-chosen">
					<div class="chosen-info">
						<span class="chosen-icon">📄</span>
						<div class="chosen-text">
							<div class="chosen-name">{docSource.file.name}</div>
							<div class="chosen-meta">
								{formatSize(docSource.file.size)} · wird beim Anlegen hochgeladen + automatisch anonymisiert
							</div>
						</div>
					</div>
					<button type="button" class="chosen-clear" onclick={clearDocChoice} disabled={submitting}>
						Ändern
					</button>
				</div>
			{:else if docSource.kind === 'existing'}
				{@const picked = caselessDocs.find((d) => d.id === docSource.id)}
				<div class="doc-chosen">
					<div class="chosen-info">
						<span class="chosen-icon">🔗</span>
						<div class="chosen-text">
							<div class="chosen-name">{picked?.label ?? '(unbekannt)'}</div>
							<div class="chosen-meta">bereits hochgeladenes Dokument im Projekt</div>
						</div>
					</div>
					<button type="button" class="chosen-clear" onclick={clearDocChoice} disabled={submitting}>
						Ändern
					</button>
				</div>
			{:else}
				<!-- Upload-Zone als Primary-Path. -->
				<label
					class="dropzone"
					class:active={dragOver}
					ondrop={onDrop}
					ondragover={onDragOver}
					ondragleave={onDragLeave}
				>
					<input
						type="file"
						accept=".docx,.pdf,.txt,.md,.html"
						onchange={onFileInput}
						disabled={submitting}
					/>
					<div class="dz-icon">⬆</div>
					<div class="dz-prim">Datei hier ablegen oder klicken</div>
					<div class="dz-sec">.docx empfohlen · PII wird beim Upload automatisch anonymisiert</div>
				</label>

				{#if caselessDocs.length > 0}
					<button
						type="button"
						class="link-btn"
						onclick={() => (showCaselessPicker = !showCaselessPicker)}
					>
						{#if showCaselessPicker}
							– Vorhandenes Dokument doch nicht …
						{:else}
							… oder vorhandenes Dokument im Projekt verwenden ({caselessDocs.length})
						{/if}
					</button>
					{#if showCaselessPicker}
						<select
							class="caseless-select"
							onchange={(e) => pickExisting((e.target as HTMLSelectElement).value)}
						>
							<option value="">— Dokument auswählen —</option>
							{#each caselessDocs as d (d.id)}
								<option value={d.id}>{d.label}</option>
							{/each}
						</select>
					{/if}
				{/if}
			{/if}
		</div>

		{#if submitError}
			<div class="error">{submitError}</div>
		{/if}

		{#if submitting}
			<div class="progress">
				{#if submitStage === 'uploading'}
					Hochladen + Anonymisieren …
				{:else if submitStage === 'creating'}
					Case wird angelegt …
				{:else}
					…
				{/if}
			</div>
		{/if}

		<div class="actions">
			<a class="cancel" href="/projects/{projectId}/cases">Abbrechen</a>
			<button type="submit" class="submit" disabled={!canSubmit || submitting}>
				{submitting ? 'Lege an …' : 'Anlegen'}
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

	.hint-link {
		font-size: 0.75rem; color: #a5b4fc; text-decoration: none;
		align-self: flex-start;
	}
	.hint-link:hover { text-decoration: underline; }

	.dropzone {
		display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
		padding: 1.6rem 1rem;
		background: rgba(165, 180, 252, 0.04);
		border: 2px dashed rgba(165, 180, 252, 0.30);
		border-radius: 6px;
		cursor: pointer;
		transition: background 120ms, border-color 120ms;
	}
	.dropzone:hover, .dropzone.active {
		background: rgba(165, 180, 252, 0.10);
		border-color: rgba(165, 180, 252, 0.65);
	}
	.dropzone input[type="file"] { display: none; }
	.dz-icon { font-size: 1.8rem; color: #a5b4fc; line-height: 1; }
	.dz-prim { font-size: 0.92rem; color: #c7d2fe; font-weight: 500; }
	.dz-sec { font-size: 0.75rem; color: #8b8fa3; }

	.link-btn {
		background: none; border: none; padding: 0;
		color: #a5b4fc; font-size: 0.78rem; cursor: pointer;
		text-align: left; align-self: flex-start;
		font-family: inherit;
	}
	.link-btn:hover { text-decoration: underline; }
	.caseless-select { margin-top: 0.3rem; }

	.doc-chosen {
		display: flex; align-items: center; gap: 0.7rem;
		padding: 0.7rem 0.9rem;
		background: rgba(110, 231, 183, 0.06);
		border: 1px solid rgba(110, 231, 183, 0.28);
		border-radius: 5px;
	}
	.chosen-info { display: flex; align-items: center; gap: 0.7rem; flex: 1; min-width: 0; }
	.chosen-icon { font-size: 1.2rem; }
	.chosen-text { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.chosen-name {
		font-size: 0.88rem; color: #e1e4e8; font-weight: 500;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.chosen-meta { font-size: 0.72rem; color: #8b8fa3; }
	.chosen-clear {
		background: transparent; border: 1px solid #2a2d3a;
		color: #8b8fa3; padding: 0.3rem 0.7rem;
		font-size: 0.75rem; border-radius: 3px; cursor: pointer;
		font-family: inherit;
	}
	.chosen-clear:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.04);
		color: #c9cdd5;
	}
	.chosen-clear:disabled { opacity: 0.5; cursor: not-allowed; }

	.error {
		padding: 0.6rem 0.8rem;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 4px;
		color: #fca5a5; font-size: 0.85rem;
	}
	.progress {
		padding: 0.5rem 0.8rem;
		background: rgba(165, 180, 252, 0.06);
		border: 1px solid rgba(165, 180, 252, 0.25);
		border-radius: 4px;
		color: #c7d2fe; font-size: 0.82rem;
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
