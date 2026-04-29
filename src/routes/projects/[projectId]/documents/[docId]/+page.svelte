<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Minimal SARAH document reader. Renders the parsed element tree
  (paragraphs/sentences/headings/...). The QDA annotation/coding UI
  from transact-qda is not included; the SARAH-specific per-paragraph
  hermeneutic reader replaces it in a follow-up.
-->
<script lang="ts">
	let { data } = $props();
	const doc = $derived(data.document);
	const elements = $derived(data.elements as Array<{
		id: string;
		element_type: string;
		content: string | null;
		parent_id: string | null;
		seq: number;
		char_start: number;
		char_end: number;
	}>);

	function formatSize(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const e of elements) m.set(e.element_type, (m.get(e.element_type) || 0) + 1);
		return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
	});

	let showRaw = $state(false);
</script>

<div class="reader">
	<header>
		<h1>{doc.label}</h1>
		<div class="meta">
			<span class="mono">{doc.mime_type || '—'}</span>
			<span class="mono">{formatSize(doc.file_size)}</span>
			<span class="mono">{elements.length} elements</span>
		</div>
		<div class="counts">
			{#each counts as [type, n]}
				<span class="count-pill"><strong>{n}</strong> {type}</span>
			{/each}
		</div>
		<button class="toggle" onclick={() => (showRaw = !showRaw)}>
			{showRaw ? 'Show structure' : 'Show raw text'}
		</button>
	</header>

	{#if showRaw}
		<pre class="raw">{doc.full_text || ''}</pre>
	{:else if elements.length === 0}
		<p class="empty">No parsed elements. Hit Parse on the documents list to populate.</p>
	{:else}
		<div class="elements">
			{#each elements as el}
				<div class="el el-{el.element_type}">
					<span class="badge">{el.element_type}</span>
					<span class="anchor mono">{el.char_start}–{el.char_end}</span>
					{#if el.content}<span class="content">{el.content}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.reader { padding: 2rem; max-width: 1100px; }
	header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.4rem; margin: 0 0 0.5rem; color: #e1e4e8; }
	.meta { display: flex; gap: 1rem; font-size: 0.78rem; color: #6b7280; margin-bottom: 0.5rem; }
	.mono { font-family: 'JetBrains Mono', monospace; }
	.counts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
	.count-pill {
		font-size: 0.72rem; padding: 0.2rem 0.5rem;
		background: rgba(165, 180, 252, 0.08);
		border: 1px solid rgba(165, 180, 252, 0.2);
		border-radius: 4px; color: #a5b4fc;
	}
	.count-pill strong { color: #c9cdd5; font-weight: 600; }

	.toggle {
		background: none; border: 1px solid #2a2d3a; color: #c9cdd5;
		padding: 0.35rem 0.8rem; font-size: 0.78rem;
		border-radius: 4px; cursor: pointer; font-family: inherit;
	}
	.toggle:hover { border-color: #4b5060; }

	.raw {
		white-space: pre-wrap;
		font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 1rem; color: #c9cdd5;
	}

	.elements { display: flex; flex-direction: column; gap: 0.4rem; }
	.el {
		display: grid;
		grid-template-columns: 110px 80px 1fr;
		gap: 0.6rem; align-items: baseline;
		padding: 0.4rem 0.6rem; border-radius: 4px;
		font-size: 0.85rem;
	}
	.el:hover { background: rgba(255,255,255,0.02); }
	.el-heading { background: rgba(165, 180, 252, 0.05); }
	.el-paragraph { color: #c9cdd5; }
	.el-sentence { color: #8b8fa3; padding-left: 1.6rem; font-size: 0.78rem; }

	.badge {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em;
		color: #6b7280; background: #161822;
		border: 1px solid #2a2d3a; border-radius: 3px;
		padding: 0.1rem 0.35rem; text-align: center;
	}
	.anchor { font-size: 0.7rem; color: #4b5563; }
	.content { line-height: 1.5; }

	.empty { color: #6b7280; font-size: 0.9rem; }
</style>
