<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();
	const doc = $derived(data.document);
	const codes = $derived(data.codes);
	const isImage = $derived(doc.mime_type?.startsWith('image/'));

	let annotations = $state<any[]>([]);
	$effect(() => { annotations = data.annotations; });

	// Selection state
	let selection = $state<{ pos0: number; pos1: number; text: string } | null>(null);
	let comment = $state('');
	let annotating = $state(false);

	// DOM refs
	let textEl = $state<HTMLPreElement>();
	let dynamicStyle = $state<HTMLStyleElement>();

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

	function createRangeFromOffsets(container: HTMLElement, pos0: number, pos1: number): Range | null {
		const range = document.createRange();
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let offset = 0;
		let startSet = false;
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = node.textContent?.length || 0;
			if (!startSet && offset + len > pos0) {
				range.setStart(node, pos0 - offset);
				startSet = true;
			}
			if (startSet && offset + len >= pos1) {
				range.setEnd(node, pos1 - offset);
				return range;
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

	// Update CSS Custom Highlights when annotations or DOM refs change
	$effect(() => {
		const _anns = annotations;
		const _el = textEl;
		const _style = dynamicStyle;
		if (!_el || !_style || typeof CSS === 'undefined' || !('highlights' in CSS)) return;

		(CSS as any).highlights.clear();
		const codeColors = new Map<string, string>();

		for (const ann of _anns) {
			const anchor = ann.properties?.anchor;
			if (!anchor || anchor.pos0 == null || anchor.pos1 == null) continue;

			const range = createRangeFromOffsets(_el, anchor.pos0, anchor.pos1);
			if (!range) continue;

			const key = `ann${ann.code_id.replace(/-/g, '')}`;
			if (!(CSS as any).highlights.has(key)) {
				(CSS as any).highlights.set(key, new (window as any).Highlight());
			}
			(CSS as any).highlights.get(key)!.add(range);

			if (!codeColors.has(key)) {
				codeColors.set(key, ann.code_properties?.color || '#8b9cf7');
			}
		}

		let css = '';
		for (const [key, color] of codeColors) {
			css += `::highlight(${key}) { background-color: ${hexToRgba(color, 0.25)}; }\n`;
		}
		_style.textContent = css;
	});

	onMount(() => {
		const el = document.createElement('style');
		document.head.appendChild(el);
		dynamicStyle = el;
		return () => {
			el.remove();
			if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
				(CSS as any).highlights.clear();
			}
		};
	});

	async function annotate(codeId: string) {
		if (!selection) return;
		annotating = true;
		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				codeId,
				anchorType: 'text',
				anchor: { pos0: selection.pos0, pos1: selection.pos1, text: selection.text },
				comment: comment.trim() || undefined
			})
		});
		if (res.ok) {
			const annRes = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`);
			annotations = await annRes.json();
			comment = '';
		}
		annotating = false;
	}

	async function deleteAnnotation(annId: string) {
		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			annotations = annotations.filter((a: any) => a.id !== annId);
		}
	}

	function getSnippet(ann: any): string {
		const anchor = ann.properties?.anchor;
		if (!anchor) return '';
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
</script>

<div class="doc-viewer">
	<div class="doc-header">
		<a href="/projects/{data.projectId}/documents" class="back">&larr; Documents</a>
		<h1>{doc.label}</h1>
		<span class="meta">{doc.mime_type} &middot; {formatSize(doc.file_size)}</span>
	</div>

	<div class="doc-body">
		<div class="text-panel">
			{#if isImage}
				<p class="placeholder">[Image annotation — coming soon]</p>
			{:else if doc.full_text}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<pre class="document-text" bind:this={textEl} onmouseup={handleMouseUp}>{doc.full_text}</pre>
			{:else}
				<p class="placeholder">No text content available</p>
			{/if}
		</div>

		<div class="code-panel">
			{#if selection}
				<div class="selection-section">
					<div class="section-header">
						<h3>
							<img src="/icons/ink_highlighter.svg" alt="" class="section-icon" />
							Annotate
						</h3>
						<button class="btn-cancel" onclick={() => { selection = null; comment = ''; window.getSelection()?.removeAllRanges(); }}>
							Cancel
						</button>
					</div>
					<div class="selection-preview">"{truncate(selection.text, 120)}"</div>

					{#if codes.length === 0}
						<p class="empty">No codes yet. <a href="/projects/{data.projectId}/codes">Create codes</a> first.</p>
					{:else}
						<div class="code-chips">
							{#each codes as code (code.id)}
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
					<img src="/icons/ink_highlighter.svg" alt="" class="section-icon" />
					<span>Select text to annotate</span>
				</div>
			{/if}

			<div class="annotations-section">
				<h3>Annotations <span class="count">({annotations.length})</span></h3>
				{#if annotations.length === 0}
					<p class="empty">No annotations yet.</p>
				{:else}
					{#each annotations as ann (ann.id)}
						<div class="annotation-card">
							<div class="ann-header">
								<span class="color-dot" style="background: {ann.code_properties?.color || '#8b9cf7'}"></span>
								<span class="code-name">{ann.code_label}</span>
								<button class="btn-remove" title="Delete annotation" onclick={() => deleteAnnotation(ann.id)}>&times;</button>
							</div>
							{#if getSnippet(ann)}
								<div class="ann-text">"{truncate(getSnippet(ann), 80)}"</div>
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

	.text-panel {
		flex: 1;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		overflow-y: auto;
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

	.code-panel {
		width: 300px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
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
