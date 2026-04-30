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
		max-width: 1400px;
		margin: 0 auto;
		padding: 1.5rem 2rem 4rem;
		color: #e1e4e8;
	}
	header {
		margin-bottom: 1rem;
	}
	.back {
		color: #6b7280;
		font-size: 0.78rem;
		text-decoration: none;
	}
	.back:hover { color: #a5b4fc; }
	h1 {
		margin: 0.25rem 0 0.15rem;
		font-size: 1.4rem;
		color: #e1e4e8;
	}
	.doc-label {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem 1.2rem;
		align-items: center;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.9rem 1.1rem;
		margin: 1.25rem 0 1.5rem;
		background: rgba(165, 180, 252, 0.04);
	}
	.status-line {
		display: flex;
		gap: 0.9rem;
		align-items: center;
		flex: 1 1 auto;
	}
	.badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.18rem 0.6rem;
		border-radius: 3px;
		font-weight: 600;
	}
	.badge.pending {
		background: rgba(251, 191, 36, 0.12);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.3);
	}
	.badge.confirmed {
		background: rgba(110, 231, 183, 0.12);
		color: #6ee7b7;
		border: 1px solid rgba(110, 231, 183, 0.3);
	}
	.counts { font-size: 0.82rem; color: #8b9199; }
	.confirmed-at {
		margin: 0;
		font-size: 0.78rem;
		color: #6b7280;
		flex-basis: 100%;
	}
	.confirm-btn {
		font: inherit;
		padding: 0.5rem 1rem;
		border: 1px solid rgba(165, 180, 252, 0.4);
		background: rgba(165, 180, 252, 0.12);
		color: #c7d2fe;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.confirm-btn:hover:not(:disabled) {
		background: rgba(165, 180, 252, 0.2);
		border-color: rgba(165, 180, 252, 0.6);
	}
	.confirm-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.error {
		color: #f87171;
		font-size: 0.82rem;
		margin: 0;
		flex-basis: 100%;
	}

	.headings {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		overflow: hidden;
	}
	.row {
		display: grid;
		grid-template-columns: 60px 64px minmax(0, 1fr) auto auto;
		gap: 0.7rem;
		align-items: center;
		padding: 0.4rem 0.7rem 0.4rem calc(0.7rem + (var(--lvl) - 1) * 18px);
		border-bottom: 1px solid #1f2128;
		font-size: 0.88rem;
	}
	.row:last-child { border-bottom: none; }
	.row.saving { background: rgba(251, 191, 36, 0.08); }
	.row.excluded { opacity: 0.4; }
	.row.level-1 {
		background: rgba(165, 180, 252, 0.06);
		font-weight: 600;
	}
	.row.level-2 { font-weight: 500; }

	.num {
		color: #6b7280;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		white-space: nowrap;
	}
	.level {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.18rem 0.35rem;
		background: #14161c;
		border: 1px solid #2a2d3a;
		color: #c9cdd5;
		border-radius: 3px;
	}
	.level:disabled { opacity: 0.5; }
	.text {
		font: inherit;
		font-size: 0.92rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid transparent;
		background: transparent;
		color: #e1e4e8;
		min-width: 0;
		width: 100%;
	}
	.text:hover:not(:disabled),
	.text:focus {
		border-color: #2a2d3a;
		background: #14161c;
		outline: none;
	}
	.text:focus { border-color: rgba(165, 180, 252, 0.5); }
	.excl {
		font-size: 0.72rem;
		color: #6b7280;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		white-space: nowrap;
		user-select: none;
	}
	.excl input { margin: 0; cursor: pointer; }
	.excl:hover { color: #c9cdd5; }
	.flags {
		display: flex;
		gap: 0.25rem;
		font-size: 0.66rem;
	}
	.flag {
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.05);
		color: #8b9199;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}
	.flag-parser-no-num {
		background: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
		border: 1px solid rgba(251, 191, 36, 0.25);
	}
	.flag-num-mismatch {
		background: rgba(248, 113, 113, 0.15);
		color: #f87171;
		border: 1px solid rgba(248, 113, 113, 0.25);
	}
	.flag-level-edited,
	.flag-text-edited {
		background: rgba(165, 180, 252, 0.12);
		color: #a5b4fc;
		border: 1px solid rgba(165, 180, 252, 0.25);
	}
	.flag-excluded {
		background: rgba(255, 255, 255, 0.05);
		color: #6b7280;
		border: 1px solid #2a2d3a;
	}
</style>
