<script lang="ts">
	import ImageAnnotationViewer from '$lib/components/ImageAnnotationViewer.svelte';

	let { data } = $props();
	const doc = $derived(data.document);
	let codes = $state<any[]>([]);
	$effect(() => { codes = data.codes; });
	const isImage = $derived(doc.mime_type?.startsWith('image/'));

	let annotations = $state<any[]>([]);
	$effect(() => { annotations = data.annotations; });

	// Text selection state
	let selection = $state<{ pos0: number; pos1: number; text: string } | null>(null);
	// Image region selection state
	let regionSelection = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	let comment = $state('');
	let annotating = $state(false);

	// In-vivo coding state
	let codeFilter = $state('');
	let creatingCode = $state(false);
	let newCodeColor = $state('#8b9cf7');
	const filteredCodes = $derived(
		codeFilter.trim()
			? codes.filter((c: any) => c.label.toLowerCase().includes(codeFilter.trim().toLowerCase()))
			: codes
	);
	const canCreateInVivo = $derived(
		codeFilter.trim().length > 0 &&
		!codes.some((c: any) => c.label.toLowerCase() === codeFilter.trim().toLowerCase())
	);

	// Annotation highlight on hover
	let highlightedAnnotationId = $state<string | null>(null);

	// Image viewer ref
	let imageViewer = $state<{ clearRegion: () => void }>();

	// Unified "has selection" check
	const hasSelection = $derived(!!selection || !!regionSelection);

	// DOM refs (text mode)
	let textEl = $state<HTMLPreElement>();

	function handleMouseUp() {
		if (!textEl) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) {
			selection = null;
			return;
		}
		const range = sel.getRangeAt(0);
		if (!textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) return;

		const offsets = getOffsetsFromRange(textEl, range);
		if (offsets && offsets.pos1 > offsets.pos0) {
			selection = {
				pos0: offsets.pos0,
				pos1: offsets.pos1,
				text: doc.full_text!.slice(offsets.pos0, offsets.pos1)
			};
		}
	}

	function getOffsetsFromRange(container: HTMLElement, range: Range): { pos0: number; pos1: number } | null {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let offset = 0;
		let pos0 = -1;
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = node.textContent?.length || 0;
			if (node === range.startContainer) pos0 = offset + range.startOffset;
			if (node === range.endContainer) {
				return pos0 >= 0 ? { pos0, pos1: offset + range.endOffset } : null;
			}
			offset += len;
		}
		return null;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function codedBackground(codez: { color: string }[]): string {
		if (codez.length === 1) return hexToRgba(codez[0].color, 0.2);
		const stops = codez.map((c, i) => {
			const from = (i * 100 / codez.length);
			const to = ((i + 1) * 100 / codez.length);
			return `${hexToRgba(c.color, 0.25)} ${from}%, ${hexToRgba(c.color, 0.25)} ${to}%`;
		});
		return `linear-gradient(180deg, ${stops.join(', ')})`;
	}

	// Build text segments with inline annotation labels
	type TextSegment = { text: string; codes: { id: string; annId: string; label: string; color: string }[]; startsHere: { label: string; color: string; annId: string }[] };
	const textSegments = $derived.by((): TextSegment[] => {
		const text = doc.full_text;
		if (!text) return [];

		// Collect text annotations only
		const textAnns = annotations.filter((a: any) => {
			const anchor = a.properties?.anchor;
			return anchor && anchor.pos0 != null && anchor.pos1 != null;
		});
		if (textAnns.length === 0) return [{ text, codes: [], startsHere: [] }];

		// Build boundary points
		const points = new Set<number>();
		points.add(0);
		points.add(text.length);
		for (const ann of textAnns) {
			const { pos0, pos1 } = ann.properties.anchor;
			if (pos0 >= 0 && pos0 <= text.length) points.add(pos0);
			if (pos1 >= 0 && pos1 <= text.length) points.add(pos1);
		}
		const sorted = [...points].sort((a, b) => a - b);

		// Build segments
		const segments: TextSegment[] = [];
		for (let i = 0; i < sorted.length - 1; i++) {
			const start = sorted[i];
			const end = sorted[i + 1];
			if (start === end) continue;

			const activeCodes: TextSegment['codes'] = [];
			const startsHere: TextSegment['startsHere'] = [];
			for (const ann of textAnns) {
				const { pos0, pos1 } = ann.properties.anchor;
				if (pos0 <= start && pos1 > start) {
					const info = { id: ann.code_id, annId: ann.id, label: ann.code_label, color: ann.code_properties?.color || '#8b9cf7' };
					activeCodes.push(info);
					if (pos0 === start) startsHere.push(info);
				}
			}
			segments.push({ text: text.slice(start, end), codes: activeCodes, startsHere });
		}
		return segments;
	});

	async function annotate(codeId: string) {
		if (!selection && !regionSelection) return;
		annotating = true;

		const body = isImage
			? {
				codeId,
				anchorType: 'image_region',
				anchor: { type: 'rect', ...regionSelection },
				comment: comment.trim() || undefined
			}
			: {
				codeId,
				anchorType: 'text',
				anchor: { pos0: selection!.pos0, pos1: selection!.pos1, text: selection!.text },
				comment: comment.trim() || undefined
			};

		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (res.ok) {
			const annRes = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`);
			annotations = await annRes.json();
			comment = '';
			if (isImage) {
				regionSelection = null;
				imageViewer?.clearRegion();
			}
		}
		annotating = false;
	}

	async function createCodeAndAnnotate() {
		if (!canCreateInVivo || creatingCode) return;
		creatingCode = true;
		const label = codeFilter.trim();
		const res = await fetch(`/api/projects/${data.projectId}/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label, color: newCodeColor })
		});
		if (res.ok) {
			const newCode = await res.json();
			// Refresh codes list
			const codesRes = await fetch(`/api/projects/${data.projectId}/codes`);
			if (codesRes.ok) {
				codes = await codesRes.json();
			}
			codeFilter = '';
			await annotate(newCode.id);
		}
		creatingCode = false;
	}

	async function deleteAnnotation(annId: string) {
		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			annotations = annotations.filter((a: any) => a.id !== annId);
		}
	}

	function cancelSelection() {
		if (isImage) {
			regionSelection = null;
			imageViewer?.clearRegion();
		} else {
			selection = null;
			window.getSelection()?.removeAllRanges();
		}
		comment = '';
	}

	function getSnippet(ann: any): string {
		const anchor = ann.properties?.anchor;
		if (!anchor) return '';
		// Image region annotation
		if (anchor.type === 'rect') {
			const w = Math.round(anchor.width * 100);
			const h = Math.round(anchor.height * 100);
			return `Region ${w}% \u00d7 ${h}%`;
		}
		// Text annotation
		if (anchor.text) return anchor.text;
		if (anchor.pos0 != null && anchor.pos1 != null && doc.full_text) {
			return doc.full_text.slice(anchor.pos0, anchor.pos1);
		}
		return '';
	}

	function truncate(text: string, len: number): string {
		return text.length > len ? text.slice(0, len) + '\u2026' : text;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function getSelectionPreview(): string {
		if (regionSelection) {
			const w = Math.round(regionSelection.width * 100);
			const h = Math.round(regionSelection.height * 100);
			return `Region ${w}% \u00d7 ${h}%`;
		}
		if (selection) {
			return `"${truncate(selection.text, 120)}"`;
		}
		return '';
	}
</script>

<div class="doc-viewer">
	<div class="doc-header">
		<a href="/projects/{data.projectId}/documents" class="back">&larr; Documents</a>
		<h1>{doc.label}</h1>
		<span class="meta">{doc.mime_type} &middot; {formatSize(doc.file_size)}</span>
	</div>

	<div class="doc-body">
		<div class="content-panel" class:image-mode={isImage}>
			{#if isImage}
				<ImageAnnotationViewer
					bind:this={imageViewer}
					imageUrl="/api/projects/{data.projectId}/documents/{doc.id}/image"
					{annotations}
					bind:highlightedAnnotationId
					onregionselect={(region) => { regionSelection = region; }}
				/>
			{:else if doc.full_text}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<pre class="document-text" bind:this={textEl} onmouseup={handleMouseUp}>{#each textSegments as seg}{#if seg.codes.length > 0}{#each seg.startsHere as c}<span
						class="code-tag"
						class:tag-highlighted={highlightedAnnotationId === c.annId}
						style="background: {c.color};"
						onmouseenter={() => { highlightedAnnotationId = c.annId; }}
						onmouseleave={() => { highlightedAnnotationId = null; }}
					>{c.label}</span>{/each}<span
						class="coded-text"
						class:coded-highlighted={seg.codes.some(c => c.annId === highlightedAnnotationId)}
						style="background: {codedBackground(seg.codes)}; border-bottom: 2px solid {seg.codes[0].color};"
					>{seg.text}</span>{:else}{seg.text}{/if}{/each}</pre>
			{:else}
				<p class="placeholder">No text content available</p>
			{/if}
		</div>

		<div class="code-panel">
			{#if hasSelection}
				<div class="selection-section">
					<div class="section-header">
						<h3>
							<img src="/icons/{isImage ? 'draw' : 'ink_highlighter'}.svg" alt="" class="section-icon" />
							Annotate
						</h3>
						<button class="btn-cancel" onclick={cancelSelection}>
							Cancel
						</button>
					</div>
					<div class="selection-preview">{getSelectionPreview()}</div>

					<form class="invivo-form" onsubmit={e => { e.preventDefault(); if (canCreateInVivo) createCodeAndAnnotate(); }}>
						<input
							type="text"
							class="code-filter-input"
							placeholder="Search or create code..."
							bind:value={codeFilter}
							disabled={annotating || creatingCode}
						/>
						{#if canCreateInVivo}
							<div class="invivo-create-row">
								<input type="color" class="invivo-color" bind:value={newCodeColor} />
								<button type="submit" class="btn-create-code" disabled={creatingCode}>
									+ {codeFilter.trim()}
								</button>
							</div>
						{/if}
					</form>

					{#if filteredCodes.length > 0}
						<div class="code-chips">
							{#each filteredCodes as code (code.id)}
								<button
									class="code-chip"
									disabled={annotating}
									onclick={() => annotate(code.id)}
								>
									<span class="color-dot" style="background: {code.properties?.color || '#8b9cf7'}"></span>
									{code.label}
								</button>
							{/each}
						</div>
					{:else if !canCreateInVivo}
						<p class="empty">No codes match.</p>
					{/if}

					<input
						type="text"
						class="comment-input"
						placeholder="Comment (optional)"
						bind:value={comment}
					/>
				</div>
			{:else}
				<div class="hint">
					<img src="/icons/{isImage ? 'draw' : 'ink_highlighter'}.svg" alt="" class="section-icon" />
					<span>{isImage ? 'Draw a region to annotate' : 'Select text to annotate'}</span>
				</div>
			{/if}

			<div class="annotations-section">
				<h3>Annotations <span class="count">({annotations.length})</span></h3>
				{#if annotations.length === 0}
					<p class="empty">No annotations yet.</p>
				{:else}
					{#each annotations as ann (ann.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="annotation-card"
							class:ann-highlighted={highlightedAnnotationId === ann.id}
							onmouseenter={() => { highlightedAnnotationId = ann.id; }}
							onmouseleave={() => { highlightedAnnotationId = null; }}
						>
							<div class="ann-header">
								<span class="color-dot" style="background: {ann.code_properties?.color || '#8b9cf7'}"></span>
								<span class="code-name">{ann.code_label}</span>
								<button class="btn-remove" title="Delete annotation" onclick={() => deleteAnnotation(ann.id)}>&times;</button>
							</div>
							{#if getSnippet(ann)}
								<div class="ann-text">{getSnippet(ann)}</div>
							{/if}
							{#if ann.properties?.comment}
								<div class="ann-comment">{ann.properties.comment}</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.doc-viewer { display: flex; flex-direction: column; height: 100%; }
	.doc-header { margin-bottom: 1rem; }
	.back { font-size: 0.8rem; color: #6b7280; display: inline-block; margin-bottom: 0.5rem; }
	h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
	.meta { font-size: 0.8rem; color: #6b7280; }

	.doc-body { display: flex; gap: 1rem; flex: 1; min-height: 0; }

	.content-panel {
		flex: 1;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		overflow-y: auto;
	}

	.content-panel.image-mode {
		padding: 0;
		overflow: hidden;
	}

	.document-text {
		white-space: pre-wrap;
		word-break: break-word;
		font-family: 'Georgia', serif;
		font-size: 0.9rem;
		line-height: 1.7;
		color: #d1d5db;
		cursor: text;
	}

	.document-text::selection {
		background: rgba(139, 156, 247, 0.35);
	}

	/* Inline code annotations */
	.code-tag {
		display: inline;
		font-family: system-ui, sans-serif;
		font-size: 0.6rem;
		font-weight: 600;
		color: #0f1117;
		padding: 0.05rem 0.3rem;
		border-radius: 2px;
		margin-right: 1px;
		vertical-align: text-top;
		line-height: 1;
		cursor: default;
		white-space: nowrap;
	}
	.code-tag.tag-highlighted {
		outline: 1px solid #fff;
	}
	.coded-text {
		border-radius: 2px;
		transition: filter 0.15s;
	}
	.coded-text.coded-highlighted {
		filter: brightness(1.4);
	}

	.code-panel {
		width: 300px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
		position: sticky;
		top: 0;
		align-self: flex-start;
		max-height: 100%;
	}

	.section-icon { width: 16px; height: 16px; opacity: 0.5; }

	/* Selection / annotation section */
	.selection-section {
		background: #161822;
		border: 1px solid #8b9cf7;
		border-radius: 8px;
		padding: 0.75rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.section-header h3 {
		font-size: 0.85rem;
		color: #e1e4e8;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}

	.btn-cancel {
		font-size: 0.75rem;
		color: #6b7280;
		background: none;
		border: none;
		cursor: pointer;
	}
	.btn-cancel:hover { color: #e1e4e8; }

	/* In-vivo coding */
	.invivo-form {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}
	.code-filter-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.8rem;
		box-sizing: border-box;
	}
	.code-filter-input:focus { outline: none; border-color: #8b9cf7; }
	.btn-create-code {
		background: rgba(139, 156, 247, 0.1);
		border: 1px dashed #8b9cf7;
		border-radius: 4px;
		padding: 0.3rem 0.5rem;
		color: #8b9cf7;
		font-size: 0.78rem;
		cursor: pointer;
		text-align: left;
	}
	.btn-create-code:hover { background: rgba(139, 156, 247, 0.2); }
	.btn-create-code:disabled { opacity: 0.4; cursor: wait; }
	.invivo-create-row {
		display: flex; align-items: center; gap: 0.35rem;
	}
	.invivo-color {
		width: 26px; height: 26px; padding: 0; border: 1px solid #2a2d3a;
		border-radius: 4px; background: none; cursor: pointer; flex-shrink: 0;
	}
	.invivo-create-row .btn-create-code { flex: 1; }

	.selection-preview {
		font-size: 0.8rem;
		color: #9ca3af;
		font-style: italic;
		margin-bottom: 0.75rem;
		line-height: 1.4;
		max-height: 4.2em;
		overflow: hidden;
	}

	.code-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}

	.code-chip {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.5rem;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		font-size: 0.78rem;
		color: #c9cdd5;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.code-chip:hover { border-color: #8b9cf7; color: #fff; }
	.code-chip:disabled { opacity: 0.4; cursor: wait; }

	.color-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.comment-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.8rem;
		box-sizing: border-box;
	}
	.comment-input:focus { outline: none; border-color: #8b9cf7; }

	/* Hint */
	.hint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: #6b7280;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.75rem;
	}

	/* Annotations list */
	.annotations-section {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.75rem;
		flex: 1;
		overflow-y: auto;
	}

	.annotations-section h3 {
		font-size: 0.85rem;
		color: #8b8fa3;
		margin-bottom: 0.75rem;
	}

	.count { color: #6b7280; }
	.empty { font-size: 0.8rem; color: #6b7280; }
	.empty a { color: #8b9cf7; }

	.annotation-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.4rem;
		transition: border-color 0.15s;
		cursor: default;
	}

	.annotation-card.ann-highlighted {
		border-color: #8b9cf7;
	}

	.ann-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.code-name {
		font-size: 0.82rem;
		font-weight: 500;
		color: #e1e4e8;
		flex: 1;
	}

	.btn-remove {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.btn-remove:hover { color: #ef4444; }

	.ann-text {
		font-size: 0.78rem;
		color: #9ca3af;
		font-style: italic;
		margin-top: 0.25rem;
		line-height: 1.3;
	}

	.ann-comment {
		font-size: 0.75rem;
		color: #6b7280;
		margin-top: 0.2rem;
	}

	.placeholder {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}
</style>
