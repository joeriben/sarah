<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let documents = $state<any[]>(data.documents || []);
	let uploading = $state(false);
	let dragOver = $state(false);
	let parsing = $state<string | null>(null);
	let embedding = $state<string | null>(null);
	let pollingIds = $state(new Set<string>());

	$effect(() => { documents = data.documents || []; });

	function pollEmbeddings(docId: string) {
		if (pollingIds.has(docId)) return;
		pollingIds = new Set([...pollingIds, docId]);
		const interval = setInterval(async () => {
			const doc = documents.find((d: any) => d.id === docId);
			if (!doc) {
				clearInterval(interval);
				pollingIds = new Set([...pollingIds].filter((id) => id !== docId));
				return;
			}
			const res = await fetch(`/api/projects/${data.projectId}/documents/${docId}/status`);
			if (!res.ok) { clearInterval(interval); return; }
			const status = await res.json();
			doc.element_count = status.element_count;
			doc.embedded_count = status.embedded_count;
			documents = [...documents];
			if (status.embedded_count >= status.element_count && status.element_count > 0) {
				clearInterval(interval);
				pollingIds = new Set([...pollingIds].filter((id) => id !== docId));
			}
		}, 3000);
	}

	function formatSize(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function fmtDate(s: string) {
		try { return new Date(s).toLocaleString(); } catch { return s; }
	}

	async function uploadFiles(files: FileList | File[]) {
		uploading = true;
		try {
			for (const file of Array.from(files)) {
				const fd = new FormData();
				fd.append('file', file);
				const res = await fetch(`/api/upload?projectId=${data.projectId}`, {
					method: 'POST',
					body: fd
				});
				if (res.ok) {
					const doc = await res.json();
					if (doc.element_count > 0 && doc.embedded_count < doc.element_count) {
						pollEmbeddings(doc.id);
					}
				}
			}
			await invalidateAll();
		} finally {
			uploading = false;
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
	}
	function onDragOver(e: DragEvent) { e.preventDefault(); dragOver = true; }
	function onDragLeave() { dragOver = false; }
	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) uploadFiles(input.files);
		input.value = '';
	}

	async function parseDocument(docId: string) {
		parsing = docId;
		try {
			const res = await fetch(`/api/projects/${data.projectId}/documents/${docId}/parse`, {
				method: 'POST'
			});
			if (res.ok) {
				const result = await res.json();
				const doc = documents.find((d: any) => d.id === docId);
				if (doc) {
					doc.element_count = result.elements;
					doc.embedded_count = result.embeddings;
					documents = [...documents];
					if (result.elements > 0 && result.embeddings < result.elements) {
						pollEmbeddings(docId);
					}
				}
			}
		} finally {
			parsing = null;
		}
	}

	async function embedDocument(docId: string) {
		embedding = docId;
		try {
			const res = await fetch(`/api/projects/${data.projectId}/documents/${docId}/embed`, {
				method: 'POST'
			});
			if (res.ok) {
				const result = await res.json();
				const doc = documents.find((d: any) => d.id === docId);
				if (doc) {
					doc.embedded_count = result.embeddings;
					documents = [...documents];
				}
			}
		} finally {
			embedding = null;
		}
	}

	async function deleteDocument(docId: string, label: string) {
		if (!confirm(`Delete "${label}"?`)) return;
		const res = await fetch(`/api/projects/${data.projectId}/documents/${docId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			await invalidateAll();
		}
	}

	onMount(() => {
		for (const doc of documents) {
			if (doc.element_count > 0 && doc.embedded_count < doc.element_count) {
				pollEmbeddings(doc.id);
			}
		}
	});
</script>

<div class="docs">
	<h1>Documents</h1>

	<div
		class="dropzone"
		class:active={dragOver}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		role="region"
		aria-label="Drop files here"
	>
		<p>Drop files here, or</p>
		<label class="btn-primary" class:disabled={uploading}>
			{uploading ? 'Uploading…' : 'Choose files'}
			<input type="file" multiple onchange={onFileInput} hidden disabled={uploading} />
		</label>
		<p class="hint">.docx · .pdf · .txt · .md · .html</p>
	</div>

	{#if documents.length > 0}
		<table class="doc-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Type</th>
					<th>Size</th>
					<th>Elements</th>
					<th>Embeddings</th>
					<th>Imported</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each documents as d}
					<tr>
						<td><a href="/projects/{data.projectId}/documents/{d.id}">{d.label}</a></td>
						<td class="mono">{d.mime_type || '—'}</td>
						<td class="mono right">{formatSize(d.file_size)}</td>
						<td class="mono right">{d.element_count}</td>
						<td class="mono right">
							{d.embedded_count}/{d.element_count}
							{#if d.element_count > 0 && d.embedded_count < d.element_count && !pollingIds.has(d.id)}
								<button class="action-btn" disabled={embedding === d.id} onclick={() => embedDocument(d.id)} title="Embed missing">⌁</button>
							{/if}
						</td>
						<td class="mono">{fmtDate(d.created_at)}</td>
						<td class="action-cell">
							{#if d.element_count === 0}
								<button class="action-btn" disabled={parsing === d.id} onclick={() => parseDocument(d.id)} title="Parse">↻</button>
							{/if}
							<button class="action-btn action-delete" onclick={() => deleteDocument(d.id, d.label)} title="Delete">🗑</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="empty">No documents yet. Drop files above to upload.</p>
	{/if}
</div>

<style>
	.docs { max-width: 1100px; padding: 2rem; }
	h1 { font-size: 1.4rem; margin: 0 0 1.25rem; color: #e1e4e8; }

	.dropzone {
		border: 2px dashed #2a2d3a; border-radius: 10px;
		padding: 2rem 1.5rem; text-align: center;
		background: rgba(255,255,255,0.02); margin-bottom: 1.5rem;
	}
	.dropzone.active { border-color: #8b9cf7; background: rgba(139, 156, 247, 0.08); }
	.dropzone p { margin: 0 0 0.5rem; color: #8b8fa3; font-size: 0.9rem; }
	.dropzone .hint { font-size: 0.75rem; color: #4b5563; margin-top: 0.6rem; }

	.btn-primary {
		display: inline-block; background: #8b9cf7; color: #0f1117;
		border: none; border-radius: 6px;
		padding: 0.5rem 1.1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:hover { background: #a5b4fc; }
	.btn-primary.disabled { opacity: 0.5; pointer-events: none; }

	.doc-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
	.doc-table th {
		text-align: left; padding: 0.5rem 0.75rem;
		color: #6b7280; font-weight: 500;
		border-bottom: 1px solid #2a2d3a;
		font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
	}
	.doc-table td {
		padding: 0.5rem 0.75rem; color: #c9cdd5;
		border-bottom: 1px solid #1e2030;
	}
	.doc-table a { color: #a5b4fc; text-decoration: none; }
	.doc-table a:hover { text-decoration: underline; }

	.mono { font-family: 'JetBrains Mono', monospace; }
	.right { text-align: right; }
	.action-cell { text-align: right; white-space: nowrap; }
	.action-btn {
		background: none; border: none; padding: 0.25rem 0.5rem;
		cursor: pointer; opacity: 0.6; border-radius: 4px;
	}
	.action-btn:hover { background: #1e2030; opacity: 1; }
	.action-btn:disabled { opacity: 0.3; pointer-events: none; }
	.action-delete:hover { background: rgba(239, 68, 68, 0.15); }
	.empty { color: #6b7280; font-size: 0.9rem; }
</style>
