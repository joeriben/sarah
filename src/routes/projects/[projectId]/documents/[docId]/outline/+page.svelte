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
	import {
		OUTLINE_FUNCTION_TYPES,
		GRANULARITY_LEVELS,
		OUTLINE_FUNCTION_TYPE_LABELS,
		GRANULARITY_LEVEL_LABELS,
		type OutlineFunctionType,
		type GranularityLevel
	} from '$lib/shared/h3-vocabulary.js';

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
	let suggesting = $state(false);
	let errorMessage = $state<string | null>(null);

	// Funktionstypen-Auswahl ist nur für non-WERK_STRUKTUR sinnvoll —
	// WERK_STRUKTUR wird nicht über Outline-Knoten gesetzt, sondern auf
	// Werk-Ebene durch eine spätere H3-Heuristik. Wir blenden es hier aus.
	const FT_OPTIONS_FOR_OUTLINE = OUTLINE_FUNCTION_TYPES.filter((t) => t !== 'WERK_STRUKTUR');

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
			// Counter ist Master (s. Server outline.ts). Bei User-Edit am
			// Level wandert der Counter, parserNumbering bleibt stale — daher
			// muss hasNumberingMismatch hier neu gegen den frischen Counter
			// geprüft werden, nicht aus dem Initial-Load übernommen.
			const effectiveNumbering = counter.join('.');
			const hasNumberingMismatch =
				h.parserNumbering !== null && h.parserNumbering !== effectiveNumbering;
			return { ...h, effectiveNumbering, hasNumberingMismatch };
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

	async function setFunctionType(h: Heading, value: string) {
		const ft = value === '' ? null : (value as OutlineFunctionType);
		headings = headings.map((x) =>
			x.elementId === h.elementId
				? {
					...x,
					outlineFunctionType: ft,
					outlineFunctionTypeUserSet: ft !== null,
					outlineFunctionTypeConfidence: null
				}
				: x
		);
		await patch(h.elementId, { outline_function_type: ft });
	}

	async function setGranularity(h: Heading, value: string) {
		const gl = value === '' ? null : (value as GranularityLevel);
		headings = headings.map((x) =>
			x.elementId === h.elementId ? { ...x, granularityLevel: gl } : x
		);
		await patch(h.elementId, { granularity_level: gl });
	}

	async function suggestFunctionTypes() {
		errorMessage = null;
		suggesting = true;
		try {
			const r = await fetch(
				`/api/projects/${projectId}/documents/${docId}/outline/suggest-function-types`,
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
			suggesting = false;
		}
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

	async function reopen() {
		errorMessage = null;
		confirming = true;
		try {
			const r = await fetch(
				`/api/projects/${projectId}/documents/${docId}/outline/reopen`,
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

	async function insertHeadingAfter(afterElementId: string | null) {
		const text = window.prompt(
			afterElementId === null
				? 'Heading-Text (wird am Anfang eingefügt):'
				: 'Heading-Text:'
		);
		if (text === null) return;
		const trimmed = text.trim();
		if (!trimmed) return;
		const lvlStr = window.prompt('Level (1–9):', '2');
		if (lvlStr === null) return;
		const level = parseInt(lvlStr, 10);
		if (!Number.isInteger(level) || level < 1 || level > 9) {
			errorMessage = `Level muss eine ganze Zahl zwischen 1 und 9 sein (war "${lvlStr}")`;
			return;
		}
		errorMessage = null;
		savingId = afterElementId ?? '__top__';
		try {
			const r = await fetch(
				`/api/projects/${projectId}/documents/${docId}/outline/insert`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ afterElementId, text: trimmed, level })
				}
			);
			if (!r.ok) {
				const err = await r.json().catch(() => ({}));
				throw new Error(err.message || `${r.status}`);
			}
			await invalidateAll();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			savingId = null;
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

	function functionTypeStateFor(h: Heading): {
		kind: 'unset' | 'suggested' | 'user_set';
		confidenceText: string | null;
	} {
		if (h.outlineFunctionType === null) return { kind: 'unset', confidenceText: null };
		if (h.outlineFunctionTypeUserSet) return { kind: 'user_set', confidenceText: null };
		const conf = h.outlineFunctionTypeConfidence;
		const confText = conf !== null ? `Conf. ${Math.round(conf * 100)}%` : null;
		return { kind: 'suggested', confidenceText: confText };
	}

	const visibleCount = $derived(headings.filter((h) => !h.excluded).length);
	const editedCount = $derived(
		headings.filter(
			(h) => h.userLevel !== null || h.userText !== null || h.excluded
		).length
	);
	const functionTypedCount = $derived(
		headings.filter((h) => !h.excluded && h.outlineFunctionType !== null).length
	);
	const visibleNonExcludedTotal = $derived(headings.filter((h) => !h.excluded).length);

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
		{#if outlineStatus === 'confirmed'}
			<button
				class="reopen-btn"
				disabled={confirming}
				onclick={reopen}
				title="Setzt outline_status auf 'pending', sodass Klassifikationen wieder bearbeitbar werden"
			>
				{confirming ? 'speichere…' : 'wieder zur Bearbeitung freigeben'}
			</button>
		{:else}
			<button
				class="confirm-btn"
				disabled={confirming}
				onclick={confirm}
			>
				{confirming ? 'speichere…' : 'Inhaltsverzeichnis bestätigen'}
			</button>
		{/if}
		<button
			class="suggest-btn"
			disabled={suggesting || outlineStatus === 'confirmed'}
			onclick={suggestFunctionTypes}
			title="Heuristischer Vorschlag pro Outline-Knoten (Heading-Regex + Position). User-Setzungen bleiben unangetastet."
		>
			{suggesting ? 'rechne…' : 'Funktionstypen heuristisch vorschlagen'}
		</button>
		<span class="ft-counts" title="Wieviele Outline-Knoten haben einen Funktionstyp gesetzt (User oder Heuristik)">
			Funktionstyp: {functionTypedCount} / {visibleNonExcludedTotal}
		</span>
		<span class="export-group" title="Aktuellen Outline-Stand herunterladen. DOCX trägt native Heading-Styles (Word-Navigationsbereich), PDF native Outline-Bookmarks (PDF-Reader-Sidebar).">
			Export:
			<a
				class="export-link"
				href={`/api/projects/${projectId}/documents/${docId}/outline/export?format=docx`}
				download
				title="Word-Dokument mit nativen Heading-Styles 1–6"
			>↓ DOCX</a>
			<a
				class="export-link"
				href={`/api/projects/${projectId}/documents/${docId}/outline/export?format=pdf`}
				download
				title="PDF mit nativen Outline-Bookmarks"
			>↓ PDF</a>
			<a
				class="export-link"
				href={`/api/projects/${projectId}/documents/${docId}/outline/export?format=md`}
				download
				title="Markdown-Liste"
			>↓ MD</a>
			<a
				class="export-link"
				href={`/api/projects/${projectId}/documents/${docId}/outline/export?format=json`}
				download
				title="EffectiveOutline als JSON"
			>↓ JSON</a>
		</span>
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
	</div>

	<ol class="headings">
		{#if outlineStatus === 'pending'}
			<li class="insert-row">
				<button
					class="insert-btn"
					disabled={savingId !== null}
					onclick={() => insertHeadingAfter(null)}
					title="Heading vor dem ersten Eintrag einfügen — falls der Parser einen strukturellen Heading am Dokumentanfang verfehlt hat"
				>
					+ Heading am Anfang einfügen
				</button>
			</li>
		{/if}
		{#each headings as h (h.elementId)}
			{@const flags = flagsFor(h)}
			{@const ftState = functionTypeStateFor(h)}
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
			{#if !h.excluded}
				<li
					class="row-h3 level-{h.effectiveLevel}"
					class:saving={savingId === h.elementId}
					style="--lvl: {h.effectiveLevel}"
				>
					<span class="h3-label">Funktionstyp</span>
					<select
						class="ft"
						value={h.outlineFunctionType ?? ''}
						onchange={(e) => setFunctionType(h, (e.currentTarget as HTMLSelectElement).value)}
						title="Funktionstyp dieses Outline-Bestandteils im Werk"
					>
						<option value="">— nicht gesetzt</option>
						{#each FT_OPTIONS_FOR_OUTLINE as ft}
							<option value={ft}>{OUTLINE_FUNCTION_TYPE_LABELS[ft]}</option>
						{/each}
					</select>
					<select
						class="gl"
						value={h.granularityLevel ?? ''}
						onchange={(e) => setGranularity(h, (e.currentTarget as HTMLSelectElement).value)}
						title="Granularitäts-Ebene des Funktionstyps"
					>
						<option value="">—</option>
						{#each GRANULARITY_LEVELS as gl}
							<option value={gl}>{GRANULARITY_LEVEL_LABELS[gl]}</option>
						{/each}
					</select>
					{#if ftState.kind === 'suggested'}
						<span class="ft-marker ft-suggested" title="Heuristischer Vorschlag — bestätige oder überschreibe ihn">
							Vorschlag{ftState.confidenceText ? ` · ${ftState.confidenceText}` : ''}
						</span>
					{:else if ftState.kind === 'user_set'}
						<span class="ft-marker ft-user-set" title="Vom User gesetzt; Heuristik überschreibt das nicht">
							User-Setzung
						</span>
					{:else}
						<span class="ft-marker ft-unset">—</span>
					{/if}
				</li>
			{/if}
			{#if outlineStatus === 'pending'}
				<li class="insert-row">
					<button
						class="insert-btn"
						disabled={savingId !== null}
						onclick={() => insertHeadingAfter(h.elementId)}
						title="Heading nach dieser Zeile einfügen — falls der Parser an dieser Stelle einen strukturellen Heading verfehlt hat"
					>
						+ Heading hier einfügen
					</button>
				</li>
			{/if}
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
	.confirm-btn,
	.reopen-btn,
	.suggest-btn {
		font: inherit;
		padding: 0.5rem 1rem;
		border: 1px solid rgba(165, 180, 252, 0.4);
		background: rgba(165, 180, 252, 0.12);
		color: #c7d2fe;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.suggest-btn {
		border-color: rgba(125, 211, 252, 0.4);
		background: rgba(125, 211, 252, 0.08);
		color: #bae6fd;
	}
	.suggest-btn:hover:not(:disabled) {
		background: rgba(125, 211, 252, 0.16);
		border-color: rgba(125, 211, 252, 0.6);
	}
	.suggest-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.ft-counts {
		font-size: 0.78rem;
		color: #8b9199;
		margin-left: 0.4rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}
	.export-group {
		display: inline-flex;
		gap: 0.45rem;
		align-items: center;
		font-size: 0.78rem;
		color: #8b9199;
		margin-left: 0.2rem;
	}
	.export-link {
		color: #c7d2fe;
		text-decoration: none;
		padding: 0.18rem 0.5rem;
		border: 1px solid rgba(165, 180, 252, 0.3);
		border-radius: 3px;
		background: rgba(165, 180, 252, 0.06);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.74rem;
	}
	.export-link:hover {
		background: rgba(165, 180, 252, 0.16);
		border-color: rgba(165, 180, 252, 0.55);
	}
	.reopen-btn {
		border-color: rgba(251, 191, 36, 0.4);
		background: rgba(251, 191, 36, 0.12);
		color: #fcd34d;
	}
	.confirm-btn:hover:not(:disabled) {
		background: rgba(165, 180, 252, 0.2);
		border-color: rgba(165, 180, 252, 0.6);
	}
	.reopen-btn:hover:not(:disabled) {
		background: rgba(251, 191, 36, 0.2);
		border-color: rgba(251, 191, 36, 0.6);
	}
	.confirm-btn:disabled,
	.reopen-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.insert-row {
		list-style: none;
		display: flex;
		justify-content: center;
		padding: 0.15rem 0;
	}
	.insert-btn {
		font: inherit;
		font-size: 0.72rem;
		color: #6b7280;
		background: transparent;
		border: 1px dashed rgba(107, 114, 128, 0.3);
		border-radius: 3px;
		padding: 0.15rem 0.6rem;
		cursor: pointer;
		opacity: 0.4;
		transition: opacity 0.15s, color 0.15s, border-color 0.15s;
	}
	.insert-row:hover .insert-btn,
	.insert-btn:focus {
		opacity: 1;
		color: #c7d2fe;
		border-color: rgba(165, 180, 252, 0.5);
	}
	.insert-btn:disabled {
		opacity: 0.2;
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

	.row-h3 {
		display: grid;
		grid-template-columns: 60px 64px minmax(0, 1fr) auto auto;
		gap: 0.7rem;
		align-items: center;
		padding: 0.25rem 0.7rem 0.5rem calc(0.7rem + (var(--lvl) - 1) * 18px + 60px + 0.7rem);
		border-bottom: 1px solid #1f2128;
		font-size: 0.82rem;
		background: rgba(255, 255, 255, 0.012);
	}
	.row-h3.saving { background: rgba(251, 191, 36, 0.05); }
	.row-h3 .h3-label {
		font-size: 0.72rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}
	.row-h3 .ft,
	.row-h3 .gl {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.2rem 0.4rem;
		background: #14161c;
		border: 1px solid #2a2d3a;
		color: #c9cdd5;
		border-radius: 3px;
		max-width: 18rem;
	}
	.ft-marker {
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 3px;
		border: 1px solid transparent;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		white-space: nowrap;
	}
	.ft-suggested {
		background: rgba(125, 211, 252, 0.1);
		color: #bae6fd;
		border-color: rgba(125, 211, 252, 0.25);
	}
	.ft-user-set {
		background: rgba(165, 180, 252, 0.1);
		color: #c7d2fe;
		border-color: rgba(165, 180, 252, 0.25);
	}
	.ft-unset {
		color: #6b7280;
		background: rgba(255, 255, 255, 0.04);
		border-color: #2a2d3a;
	}
</style>
