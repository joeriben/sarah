<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Cases-Liste im Projekt. Architektur-Setzung 2026-05-03: jedes Doc gehört zu
  einem Case (no caseless docs). Diese Liste ist der Eingangspunkt zum
  Anlegen / Auswählen eines Case innerhalb des Projekts.
-->
<script lang="ts">
	import type { CaseRow } from './+page.server.js';

	let { data } = $props();
	const cases = $derived(data.cases as CaseRow[]);
	const projectId = $derived(data.projectId as string);

	function fmtDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="page">
	<header class="head">
		<div>
			<h1>Cases</h1>
			<p class="sub">Jeder Case bündelt ein zentrales Dokument mit dem Bewertungs-Brief, an dem die Pipeline arbeitet.</p>
		</div>
		<a class="primary-btn" href="/projects/{projectId}/cases/new">+ Neuer Case</a>
	</header>

	{#if cases.length === 0}
		<div class="empty">
			<p>Noch keine Cases in diesem Projekt. Lege einen an, um die Pipeline zu starten.</p>
			<a class="primary-btn" href="/projects/{projectId}/cases/new">+ Neuer Case</a>
		</div>
	{:else}
		<ul class="case-list">
			{#each cases as c (c.id)}
				<li class="case-row">
					<a class="case-link" href="/projects/{projectId}/documents/{c.centralDocumentId}">
						<div class="case-name">{c.name}</div>
						<div class="case-meta">
							<span class="doc-label">{c.centralDocumentLabel}</span>
							{#if c.briefName}
								<span class="brief-tag">{c.briefName}</span>
							{:else}
								<span class="brief-missing">kein Brief</span>
							{/if}
							<span class="date">angelegt {fmtDate(c.createdAt)}</span>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page { padding: 2rem; max-width: 1100px; margin: 0 auto; }
	.head {
		display: flex; align-items: flex-start; gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.head h1 { margin: 0 0 0.4rem; font-size: 1.4rem; color: #e1e4e8; }
	.sub { margin: 0; font-size: 0.85rem; color: #8b8fa3; max-width: 60ch; line-height: 1.45; }
	.primary-btn {
		margin-left: auto;
		display: inline-block;
		background: rgba(165, 180, 252, 0.10);
		border: 1px solid rgba(165, 180, 252, 0.4);
		color: #c7d2fe;
		padding: 0.5rem 1rem; font-size: 0.85rem;
		border-radius: 4px; text-decoration: none;
		font-family: inherit;
	}
	.primary-btn:hover {
		background: rgba(165, 180, 252, 0.18);
		border-color: rgba(165, 180, 252, 0.65);
	}

	.empty {
		padding: 2.5rem 1.5rem;
		background: rgba(165, 180, 252, 0.03);
		border: 1px dashed rgba(165, 180, 252, 0.2);
		border-radius: 6px;
		display: flex; flex-direction: column; gap: 1rem;
		align-items: flex-start;
	}
	.empty p { margin: 0; color: #c9cdd5; line-height: 1.55; font-size: 0.9rem; }

	.case-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
	.case-row {}
	.case-link {
		display: block;
		padding: 0.85rem 1rem;
		background: rgba(255,255,255,0.015);
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s;
	}
	.case-link:hover {
		border-color: rgba(165, 180, 252, 0.5);
		background: rgba(165, 180, 252, 0.04);
	}
	.case-name { font-size: 0.95rem; font-weight: 600; color: #e1e4e8; margin-bottom: 0.25rem; }
	.case-meta { display: flex; flex-wrap: wrap; gap: 0.7rem; font-size: 0.78rem; color: #8b8fa3; }
	.doc-label { color: #c9cdd5; font-style: italic; }
	.brief-tag {
		background: rgba(165, 180, 252, 0.08);
		color: #a5b4fc;
		border: 1px solid rgba(165, 180, 252, 0.2);
		padding: 0.05rem 0.4rem; border-radius: 3px;
	}
	.brief-missing {
		color: #fbbf24;
		font-style: italic;
	}
	.date { margin-left: auto; color: #6b7280; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; }
</style>
