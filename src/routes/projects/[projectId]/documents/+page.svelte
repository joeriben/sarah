<script lang="ts">
	let { data } = $props();
	let uploading = $state(false);
	let dragOver = $state(false);

	// DocNet state
	let docnets = $state(data.docnets || []);
	let creatingDocNet = $state(false);
	let newDocNetLabel = $state('');
	let expandedDocNet = $state<string | null>(null);
	let docnetDocuments = $state<Record<string, any[]>>({});
	let addingToDocNet = $state<string | null>(null);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	async function uploadFiles(files: FileList | File[]) {
		uploading = true;
		for (const file of files) {
			const fd = new FormData();
			fd.append('file', file);
			await fetch(`/api/upload?projectId=${data.projectId}`, { method: 'POST', body: fd });
		}
		uploading = false;
		window.location.reload();
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files);
	}

	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) uploadFiles(input.files);
	}

	// DocNet operations
	async function createDocNet() {
		if (!newDocNetLabel.trim()) return;
		const res = await fetch(`/api/projects/${data.projectId}/docnets`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: newDocNetLabel.trim() })
		});
		if (res.ok) {
			const docnet = await res.json();
			docnets = [{ ...docnet, label: newDocNetLabel.trim(), document_count: 0 }, ...docnets];
			newDocNetLabel = '';
			creatingDocNet = false;
		}
	}

	async function deleteDocNet(docnetId: string) {
		await fetch(`/api/projects/${data.projectId}/docnets/${docnetId}`, { method: 'DELETE' });
		docnets = docnets.filter(d => d.id !== docnetId);
		if (expandedDocNet === docnetId) expandedDocNet = null;
	}

	async function toggleDocNet(docnetId: string) {
		if (expandedDocNet === docnetId) {
			expandedDocNet = null;
			return;
		}
		expandedDocNet = docnetId;
		if (!docnetDocuments[docnetId]) {
			const res = await fetch(`/api/projects/${data.projectId}/docnets/${docnetId}/documents`);
			docnetDocuments[docnetId] = await res.json();
		}
	}

	async function addToDocNet(docnetId: string, documentId: string) {
		const res = await fetch(`/api/projects/${data.projectId}/docnets/${docnetId}/documents`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ documentId })
		});
		if (res.ok) {
			// Refresh the docnet's documents
			const docsRes = await fetch(`/api/projects/${data.projectId}/docnets/${docnetId}/documents`);
			docnetDocuments[docnetId] = await docsRes.json();
			// Update count
			const dn = docnets.find(d => d.id === docnetId);
			if (dn) dn.document_count = docnetDocuments[docnetId].length;
			addingToDocNet = null;
		}
	}

	async function removeFromDocNet(docnetId: string, documentId: string) {
		await fetch(`/api/projects/${data.projectId}/docnets/${docnetId}/documents`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ documentId })
		});
		docnetDocuments[docnetId] = (docnetDocuments[docnetId] || []).filter(d => d.id !== documentId);
		const dn = docnets.find(d => d.id === docnetId);
		if (dn) dn.document_count = docnetDocuments[docnetId].length;
	}

	// Documents not yet in the expanded docnet
	const availableDocuments = $derived(() => {
		if (!expandedDocNet || !docnetDocuments[expandedDocNet]) return data.documents;
		const inNet = new Set(docnetDocuments[expandedDocNet].map((d: any) => d.id));
		return data.documents.filter((d: any) => !inNet.has(d.id));
	});
</script>

<div class="documents-page">
	<div class="header">
		<h1>Documents</h1>
		<label class="btn-primary">
			Upload
			<input type="file" multiple hidden onchange={onFileInput} accept=".pdf,.txt,.md,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp" />
		</label>
	</div>

	<!-- DocNets Section -->
	<div class="docnets-section">
		<div class="docnets-header">
			<h2>DocNets <span class="count">({docnets.length})</span></h2>
			{#if !creatingDocNet}
				<button class="btn-sm" onclick={() => creatingDocNet = true}>+ DocNet</button>
			{/if}
		</div>

		{#if creatingDocNet}
			<form class="docnet-create" onsubmit={e => { e.preventDefault(); createDocNet(); }}>
				<input type="text" placeholder="DocNet name..." bind:value={newDocNetLabel} autofocus />
				<button type="submit" class="btn-sm" disabled={!newDocNetLabel.trim()}>create</button>
				<button type="button" class="btn-sm btn-cancel" onclick={() => { creatingDocNet = false; newDocNetLabel = ''; }}>cancel</button>
			</form>
		{/if}

		{#each docnets as dn (dn.id)}
			<div class="docnet-card" class:expanded={expandedDocNet === dn.id}>
				<div class="docnet-main">
					<button class="docnet-toggle" onclick={() => toggleDocNet(dn.id)}>
						{expandedDocNet === dn.id ? '▾' : '▸'}
					</button>
					<span class="docnet-label" onclick={() => toggleDocNet(dn.id)}>{dn.label}</span>
					<span class="docnet-count">{dn.document_count} doc{dn.document_count !== 1 ? 's' : ''}</span>
					<button class="btn-xs btn-danger" onclick={() => deleteDocNet(dn.id)}>remove</button>
				</div>

				{#if expandedDocNet === dn.id}
					<div class="docnet-documents">
						{#if docnetDocuments[dn.id]?.length > 0}
							{#each docnetDocuments[dn.id] as doc}
								<div class="docnet-doc-entry">
									<a href="/projects/{data.projectId}/documents/{doc.id}">{doc.label}</a>
									<span class="meta">{doc.mime_type?.split('/')[1] || ''}</span>
									<button class="btn-xs" onclick={() => removeFromDocNet(dn.id, doc.id)}>×</button>
								</div>
							{/each}
						{:else}
							<span class="empty">No documents yet</span>
						{/if}

						{#if addingToDocNet === dn.id}
							<div class="add-doc-list">
								{#each availableDocuments() as doc}
									<button class="add-doc-item" onclick={() => addToDocNet(dn.id, doc.id)}>
										+ {doc.label}
									</button>
								{/each}
								{#if availableDocuments().length === 0}
									<span class="empty">All documents already in this DocNet</span>
								{/if}
								<button class="btn-xs btn-cancel" onclick={() => addingToDocNet = null}>close</button>
							</div>
						{:else}
							<button class="btn-sm btn-add-doc" onclick={() => addingToDocNet = dn.id}>+ add documents</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Document List -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop-zone"
		class:drag-over={dragOver}
		ondragover={e => { e.preventDefault(); dragOver = true; }}
		ondragleave={() => dragOver = false}
		ondrop={onDrop}
	>
		{#if uploading}
			<p>Uploading...</p>
		{:else if data.documents.length === 0}
			<p>Drop files here or click Upload</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Size</th>
						<th>Added</th>
					</tr>
				</thead>
				<tbody>
					{#each data.documents as doc}
						<tr>
							<td><a href="/projects/{data.projectId}/documents/{doc.id}">{doc.label}</a></td>
							<td class="meta">{doc.mime_type?.split('/')[1] || 'unknown'}</td>
							<td class="meta">{formatSize(doc.file_size)}</td>
							<td class="meta">{new Date(doc.created_at).toLocaleDateString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.documents-page { max-width: 900px; }

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h1 { font-size: 1.3rem; }
	h2 { font-size: 1rem; color: #e1e4e8; margin: 0; }
	.count { color: #6b7280; font-weight: 400; }

	.btn-primary {
		background: #8b9cf7;
		color: #0f1117;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-sm {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.75rem; padding: 0.2rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #c9cdd5; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #6b7280; font-size: 0.7rem; padding: 0.1rem 0.35rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-cancel { color: #6b7280; }
	.btn-danger { color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
	.btn-danger:hover { border-color: #ef4444; }

	/* DocNets */
	.docnets-section { margin-bottom: 1.5rem; }
	.docnets-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.docnet-create {
		display: flex; gap: 0.4rem; margin-bottom: 0.5rem;
	}
	.docnet-create input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #c9cdd5; font-size: 0.85rem;
	}
	.docnet-create input:focus { border-color: #8b9cf7; outline: none; }

	.docnet-card {
		border: 1px solid #1e2030; border-radius: 6px;
		margin-bottom: 0.4rem; background: #161822;
	}
	.docnet-card.expanded { border-color: #2a2d3a; }
	.docnet-main {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.4rem 0.6rem;
	}
	.docnet-toggle {
		background: none; border: none; color: #6b7280;
		cursor: pointer; font-size: 0.8rem; padding: 0; width: 1rem;
	}
	.docnet-label {
		color: #10b981; font-size: 0.85rem; font-weight: 500; cursor: pointer;
		flex: 1;
	}
	.docnet-label:hover { text-decoration: underline; }
	.docnet-count { color: #6b7280; font-size: 0.75rem; }

	.docnet-documents {
		padding: 0.3rem 0.6rem 0.5rem 1.6rem;
		border-top: 1px solid #1e2030;
	}
	.docnet-doc-entry {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.15rem 0; font-size: 0.8rem;
	}
	.docnet-doc-entry a { color: #c9cdd5; text-decoration: none; flex: 1; }
	.docnet-doc-entry a:hover { color: #8b9cf7; }

	.btn-add-doc { margin-top: 0.3rem; color: #10b981; border-color: rgba(16, 185, 129, 0.3); }
	.btn-add-doc:hover { border-color: #10b981; }

	.add-doc-list { margin-top: 0.3rem; }
	.add-doc-item {
		display: block; width: 100%; text-align: left;
		background: none; border: none; color: #8b8fa3;
		font-size: 0.78rem; padding: 0.2rem 0.3rem; cursor: pointer;
		border-radius: 3px;
	}
	.add-doc-item:hover { background: rgba(16, 185, 129, 0.08); color: #10b981; }

	.empty { color: #4b5563; font-size: 0.75rem; font-style: italic; }

	/* Document table */
	.drop-zone {
		border: 2px dashed #2a2d3a;
		border-radius: 8px;
		padding: 1.5rem;
		min-height: 200px;
		transition: border-color 0.15s;
	}
	.drop-zone.drag-over {
		border-color: #8b9cf7;
		background: rgba(139, 156, 247, 0.05);
	}

	.drop-zone p {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}

	table { width: 100%; border-collapse: collapse; }
	th {
		text-align: left;
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #2a2d3a;
	}
	td {
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid #1e2030;
		font-size: 0.9rem;
	}
	.meta { color: #6b7280; font-size: 0.8rem; }
</style>
