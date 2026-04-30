<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  User-Validation der Heading-Hierarchie. Liste aller im Hauptteil
  detektierten Headings mit Numerierung (auto), inline-editierbarem Text,
  Level-Selector und Toggle "ausschließen". Reihenfolge folgt dem
  Dokument (char_start), wird nicht bearbeitet.
-->
<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	const projectId = $derived(data.projectId);
	const docId = $derived(data.docId);
	const document = $derived(data.document);

	type Heading = (typeof data.outline.headings)[number];

	let headings = $state<Heading[]>(data.outline.headings);
	let outlineStatus = $state<'pending' | 'confirmed'>(data.outline.outlineStatus);
	let outlineConfirmedAt = $state<string | null>(data.outline.outlineConfirmedAt);
	let savingId = $state<string | null>(null);
	let confirming = $state(false);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		headings = data.outline.headings;
		outlineStatus = data.outline.outlineStatus;
		outlineConfirmedAt = data.outline.outlineConfirmedAt;
	});

	function recomputeNumbering(list: Heading[]): Heading[] {
		const counter: number[] = [];
		return list.map((h) => {
			if (h.excluded) return { ...h, effectiveNumbering: null };
			const lvl = h.effectiveLevel;
			while (counter.length < lvl) counter.push(0);
			counter.length = lvl;
			counter[lvl - 1] = (counter[lvl - 1] ?? 0) + 1;
			return { ...h, effectiveNumbering: counter.join('.') };
		});
	}

	async function patch(headingId: string, body: Record<string, unknown>) {
		errorMessage = null;
		savingId = headingId;
		try {
			const r = await fetch(
				`/api/projects/${projectId}/documents/${docId}/outline/${headingId}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				}
			);
			if (!r.ok) {
				const err = await r.json().catch(() => ({}));
				throw new Error(err.message || `${r.status}`);
			}
			outlineStatus = 'pending';
			outlineConfirmedAt = null;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			savingId = null;
		}
	}

	async function setLevel(h: Heading, level: number) {
		const newList = headings.map((x) =>
			x.elementId === h.elementId
				? { ...x, userLevel: level, effectiveLevel: level }
				: x
		);
		headings = recomputeNumbering(newList);
		await patch(h.elementId, { user_level: level });
	}

	async function setText(h: Heading, value: string) {
		const trimmed = value.trim();
		const userText = trimmed === h.parserText ? null : trimmed || null;
		const effectiveText = userText ?? h.parserText;
		headings = headings.map((x) =>
			x.elementId === h.elementId ? { ...x, userText, effectiveText } : x
		);
		await patch(h.elementId, { user_text: userText });
	}

	async function setExcluded(h: Heading, excluded: boolean) {
		const newList = headings.map((x) =>
			x.elementId === h.elementId ? { ...x, excluded } : x
		);
		headings = recomputeNumbering(newList);
		await patch(h.elementId, { excluded });
	}

	async function confirm() {
		errorMessage = null;
		confirming = true;
		try {
			const r = await fetch(
				`/api/projects/${projectId}/documents/${docId}/outline/confirm`,
				{ method: 'POST' }
			);
			if (!r.ok) {
				const err = await r.json().catch(() => ({}));
				throw new Error(err.message || `${r.status}`);
			}
			await invalidateAll();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			confirming = false;
		}
	}

	function flagsFor(h: Heading): string[] {
		const flags: string[] = [];
		if (h.hasNoNumberingFromParser && !h.excluded) flags.push('parser-no-num');
		if (h.hasNumberingMismatch) flags.push('num-mismatch');
		if (h.userLevel !== null && h.userLevel !== h.parserLevel) flags.push('level-edited');
		if (h.userText !== null) flags.push('text-edited');
		if (h.excluded) flags.push('excluded');
		return flags;
	}

	const visibleCount = $derived(headings.filter((h) => !h.excluded).length);
	const editedCount = $derived(
		headings.filter(
			(h) => h.userLevel !== null || h.userText !== null || h.excluded
		).length
	);

	function flagLabel(f: string): string {
		switch (f) {
			case 'parser-no-num':
				return 'parser ohne num';
			case 'num-mismatch':
				return 'num mismatch';
			case 'level-edited':
				return 'level edit';
			case 'text-edited':
				return 'text edit';
			case 'excluded':
				return 'aus';
			default:
				return f;
		}
	}
	function flagTitle(f: string): string {
		switch (f) {
			case 'parser-no-num':
				return 'Parser konnte keine Numerierung herleiten — Edge-Case';
			case 'num-mismatch':
				return 'Author-Numerierung weicht von synthetischer Numerierung ab';
			case 'level-edited':
				return 'Level wurde manuell geändert';
			case 'text-edited':
				return 'Heading-Text wurde manuell geändert';
			case 'excluded':
				return 'Aus dem Inhaltsverzeichnis ausgeschlossen';
			default:
				return f;
		}
	}
</script>

<svelte:head>
	<title>Outline — {document.label}</title>
</svelte:head>

<div class="outline-page">
	<header>
		<a class="back" href="/projects/{projectId}/documents/{docId}">← zurück zum Dokument</a>
		<h1>Inhaltsverzeichnis bestätigen</h1>
		<p class="doc-label">{document.label}</p>
	</header>

	<div class="status">
		<div class="status-line">
			<span class="badge {outlineStatus}">
				{outlineStatus === 'confirmed' ? 'bestätigt' : 'unbestätigt'}
			</span>
			<span class="counts">
				{visibleCount} sichtbare Headings · {editedCount} bearbeitet · {headings.length} total
			</span>
		</div>
		{#if outlineStatus === 'confirmed' && outlineConfirmedAt}
			<p class="confirmed-at">
				bestätigt am {new Date(outlineConfirmedAt).toLocaleString('de-DE')}
			</p>
		{/if}
		<button
			class="confirm-btn"
			disabled={confirming || outlineStatus === 'confirmed'}
			onclick={confirm}
		>
			{confirming ? 'speichere…' : outlineStatus === 'confirmed' ? 'bereits bestätigt' : 'Inhaltsverzeichnis bestätigen'}
		</button>
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
	</div>

	<ol class="headings">
		{#each headings as h (h.elementId)}
			{@const flags = flagsFor(h)}
			<li
				class="row level-{h.effectiveLevel}"
				class:excluded={h.excluded}
				class:saving={savingId === h.elementId}
				style="--lvl: {h.effectiveLevel}"
			>
				<span class="num">{h.effectiveNumbering ?? '—'}</span>

				<select
					class="level"
					value={h.effectiveLevel}
					onchange={(e) =>
						setLevel(h, parseInt((e.currentTarget as HTMLSelectElement).value, 10))}
					disabled={h.excluded}
					title="Level"
				>
					{#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as L}
						<option value={L}>L{L}</option>
					{/each}
				</select>

				<input
					class="text"
					type="text"
					value={h.effectiveText}
					onchange={(e) => setText(h, (e.currentTarget as HTMLInputElement).value)}
					disabled={h.excluded}
				/>

				<label class="excl">
					<input
						type="checkbox"
						checked={h.excluded}
						onchange={(e) =>
							setExcluded(h, (e.currentTarget as HTMLInputElement).checked)}
					/>
					ausschließen
				</label>

				{#if flags.length > 0}
					<span class="flags">
						{#each flags as f}
							<span class="flag flag-{f}" title={flagTitle(f)}>{flagLabel(f)}</span>
						{/each}
					</span>
				{/if}
			</li>
		{/each}
	</ol>
</div>

<style>
	.outline-page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px;
		font-family: system-ui, sans-serif;
	}
	header {
		margin-bottom: 16px;
	}
	.back {
		color: #666;
		font-size: 0.85rem;
		text-decoration: none;
	}
	.back:hover {
		color: #000;
	}
	h1 {
		margin: 4px 0 2px;
		font-size: 1.4rem;
	}
	.doc-label {
		margin: 0;
		color: #666;
		font-size: 0.95rem;
	}
	.status {
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 14px 16px;
		margin: 16px 0 24px;
		background: #fafafa;
	}
	.status-line {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-bottom: 8px;
	}
	.badge {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 10px;
		border-radius: 4px;
		font-weight: 600;
	}
	.badge.pending {
		background: #fff3cd;
		color: #7a5800;
	}
	.badge.confirmed {
		background: #d6f0d6;
		color: #1f5a1f;
	}
	.counts {
		font-size: 0.85rem;
		color: #555;
	}
	.confirmed-at {
		margin: 0 0 8px;
		font-size: 0.8rem;
		color: #666;
	}
	.confirm-btn {
		font: inherit;
		padding: 8px 16px;
		border: 1px solid #2563eb;
		background: #2563eb;
		color: white;
		border-radius: 4px;
		cursor: pointer;
	}
	.confirm-btn:hover:not(:disabled) {
		background: #1d4ed8;
	}
	.confirm-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		color: #b91c1c;
		font-size: 0.85rem;
		margin: 8px 0 0;
	}
	.headings {
		list-style: none;
		padding: 0;
		margin: 0;
		font-family: ui-monospace, 'SF Mono', monospace;
	}
	.row {
		display: grid;
		grid-template-columns: 70px 60px 1fr auto auto;
		gap: 10px;
		align-items: center;
		padding: 4px 6px;
		border-bottom: 1px solid #f0f0f0;
		padding-left: calc(var(--lvl) * 18px - 18px);
	}
	.row.saving {
		background: #fffbe5;
	}
	.row.excluded {
		opacity: 0.45;
	}
	.row.level-1 {
		font-weight: 600;
		background: #f7f7f7;
	}
	.row.level-2 {
		font-weight: 500;
	}
	.num {
		color: #666;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.level {
		font: inherit;
		font-size: 0.8rem;
		padding: 2px 4px;
	}
	.text {
		font: inherit;
		font-size: 0.9rem;
		padding: 4px 6px;
		border: 1px solid transparent;
		background: transparent;
		min-width: 0;
	}
	.text:hover:not(:disabled),
	.text:focus {
		border-color: #ccc;
		background: white;
		outline: none;
	}
	.excl {
		font-size: 0.75rem;
		color: #666;
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.excl input {
		margin: 0;
	}
	.flags {
		display: flex;
		gap: 4px;
		font-size: 0.7rem;
	}
	.flag {
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #555;
		white-space: nowrap;
	}
	.flag-parser-no-num {
		background: #fde68a;
		color: #7a5800;
	}
	.flag-num-mismatch {
		background: #fecaca;
		color: #7a1f1f;
	}
	.flag-level-edited,
	.flag-text-edited {
		background: #d6e4ff;
		color: #1e3a8a;
	}
	.flag-excluded {
		background: #ddd;
		color: #444;
	}
</style>
