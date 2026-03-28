<script lang="ts">
	import { untrack } from 'svelte';
	import ImageAnnotationViewer from '$lib/components/ImageAnnotationViewer.svelte';
	import ComparisonPanel from './ComparisonPanel.svelte';

	let { data } = $props();
	const doc = $derived(data.document);
	let candidates = $state<any[]>([]);
	$effect(() => { candidates = data.candidates; });
	const isImage = $derived(doc.mime_type?.startsWith('image/'));

	let annotations = $state<any[]>([]);
	$effect(() => { annotations = data.annotations; });

	// Document elements (parsed structure)
	const elements = $derived(data.elements || []);

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
	const canCreateInVivo = $derived(
		codeFilter.trim().length > 0 &&
		!candidates.some((c: any) => c.label.toLowerCase() === codeFilter.trim().toLowerCase())
	);

	// Group candidates by source map for display
	const candidateGroups = $derived.by(() => {
		const groups = new Map<string, { label: string; items: any[] }>();
		for (const c of scopedCandidates) {
			const key = c.source_map_id || '__orphan__';
			if (!groups.has(key)) {
				groups.set(key, { label: c.source_map_label || 'Project', items: [] });
			}
			groups.get(key)!.items.push(c);
		}
		return groups;
	});

	// Annotation highlight on hover
	let highlightedAnnotationId = $state<string | null>(null);

	// Naming stacks (designation history + memos) keyed by code ID
	const namingStacks = $derived.by(() => {
		const map = new Map<string, Array<{ designation: string | null; inscription: string | null; memo_text: string | null; seq: number }>>();
		for (const act of (data.namingStacks || [])) {
			if (!map.has(act.naming_id)) map.set(act.naming_id, []);
			map.get(act.naming_id)!.push(act);
		}
		return map;
	});

	// Scope: 'this' = current document, 'all' = all documents, or a specific document ID
	let namingsScope = $state<string>('this');
	let passagesScope = $state<string>('this');
	const projectDocuments = $derived(data.documents || []);
	const projectAnnotations = $derived(data.projectAnnotations || []);

	// Scoped namings: 'this' filters to codes used in this document
	const scopedCandidates = $derived.by(() => {
		const base = codeFilter.trim()
			? candidates.filter((c: any) => c.label.toLowerCase().includes(codeFilter.trim().toLowerCase()))
			: candidates;
		if (namingsScope === 'this') {
			const docCodeIds = new Set(annotations.map((a: any) => a.code_id));
			return base.filter((c: any) => docCodeIds.has(c.id));
		}
		if (namingsScope === 'all') return base;
		// Specific document
		const docCodeIds = new Set(projectAnnotations.filter((a: any) => a.document_id === namingsScope).map((a: any) => a.code_id));
		return base.filter((c: any) => docCodeIds.has(c.id));
	});

	// Scoped passages
	const scopedAnnotations = $derived.by(() => {
		if (passagesScope === 'this') return annotations;
		if (passagesScope === 'all') return projectAnnotations;
		return projectAnnotations.filter((a: any) => a.document_id === passagesScope);
	});

	// Similar passages from ComparisonPanel (replaces Passages list when active)
	let similarPassages = $state<any[] | null>(null);

	// Passages panel filter + expand
	let annFilter = $state('');
	// Namings panel: expanded naming (shows memos)
	let expandedNamingId = $state<string | null>(null);
	// Passage memo: inline memo input on a passage card
	let memoingAnnId = $state<string | null>(null);
	let passageMemoText = $state('');
	let namingTooltipText = $state('');
	let namingTooltipStyle = $state('display:none');
	let expandedAnnId = $state<string | null>(null);
	const filteredAnnotations = $derived(
		annFilter.trim()
			? scopedAnnotations.filter((a: any) => a.code_label.toLowerCase().includes(annFilter.trim().toLowerCase())
				|| (a.properties?.anchor?.text || '').toLowerCase().includes(annFilter.trim().toLowerCase()))
			: scopedAnnotations
	);

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
			// Don't clear selection when focus moves elsewhere (e.g. to input field)
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
		// Walk only visible text nodes, skipping tooltip spans (which contain code labels)
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentElement;
				if (parent?.classList.contains('code-tooltip')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});
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

	// Build text segments for color-coded annotation display
	type TextSegment = { text: string; codes: { id: string; annId: string; label: string; color: string }[]; elementId?: string };
	const textSegments = $derived.by((): TextSegment[] => {
		const text = doc.full_text;
		if (!text) return [];

		const textAnns = annotations.filter((a: any) => {
			const anchor = a.properties?.anchor;
			return anchor && anchor.pos0 != null && anchor.pos1 != null;
		});
		if (textAnns.length === 0) return [{ text, codes: [] }];

		// Build boundary points (annotations + element boundaries)
		const points = new Set<number>();
		points.add(0);
		points.add(text.length);
		for (const ann of textAnns) {
			const { pos0, pos1 } = ann.properties.anchor;
			if (pos0 >= 0 && pos0 <= text.length) points.add(pos0);
			if (pos1 >= 0 && pos1 <= text.length) points.add(pos1);
		}
		// Add element boundaries for data-element-id mapping
		for (const el of elements) {
			if (el.char_start >= 0 && el.char_start <= text.length) points.add(el.char_start);
			if (el.char_end >= 0 && el.char_end <= text.length) points.add(el.char_end);
		}
		const sorted = [...points].sort((a, b) => a - b);

		// Build lookup: leaf elements (sentences) sorted by char_start
		const leafElements = elements
			.filter((e: any) => e.content !== null)
			.sort((a: any, b: any) => a.char_start - b.char_start);

		const segments: TextSegment[] = [];
		for (let i = 0; i < sorted.length - 1; i++) {
			const start = sorted[i];
			const end = sorted[i + 1];
			if (start === end) continue;

			const activeCodes: TextSegment['codes'] = [];
			for (const ann of textAnns) {
				const { pos0, pos1 } = ann.properties.anchor;
				if (pos0 <= start && pos1 > start) {
					activeCodes.push({ id: ann.code_id, annId: ann.id, label: ann.code_label, color: ann.code_color || '#8b9cf7' });
				}
			}

			// Find which element this segment belongs to
			const el = leafElements.find((e: any) => e.char_start <= start && e.char_end >= end);

			segments.push({ text: text.slice(start, end), codes: activeCodes, elementId: el?.id });
		}
		return segments;
	});

	// Margin annotations: positioned by actual DOM coordinates
	function shortLabel(label: string): string {
		const words = label.split(/\s+/);
		return words.length <= 2 ? label : words.slice(0, 2).join(' ') + '…';
	}

	// Margin labels with measured Y positions + tooltip data
	let marginLabels = $state<Array<{
		annId: string; label: string; fullLabel: string; color: string; top: number;
		comment: string; snippet: string;
	}>>([]);
	let tooltipStyle = $state('');

	function showTooltip(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tooltipStyle = `left: ${rect.right + 8}px; top: ${rect.top}px;`;
	}
	function hideTooltip() { tooltipStyle = ''; }
	let marginEl = $state<HTMLDivElement>();

	function measureMarginPositions() {
		if (!textEl || !marginEl) return;

		const annSpans = textEl.querySelectorAll<HTMLSpanElement>('.coded-text[data-ann-start]');
		const marginRect = marginEl.getBoundingClientRect();
		const marginHeight = marginRect.height;
		const labels: typeof marginLabels = [];
		const seen = new Set<string>();
		const labelHeight = 14; // approximate height of a margin label in px

		for (const span of annSpans) {
			const annId = span.dataset.annStart!;
			if (seen.has(annId)) continue;
			seen.add(annId);

			const ann = annotations.find((a: any) => a.id === annId);
			if (!ann) continue;

			const spanRect = span.getBoundingClientRect();
			let top = spanRect.top - marginRect.top;

			// Skip labels outside visible area
			if (top < -20 || top > marginHeight) continue;

			// Avoid overlap: push down if previous label occupies this position
			for (const prev of labels) {
				if (Math.abs(top - prev.top) < labelHeight) {
					top = prev.top + labelHeight;
				}
			}

			labels.push({
				annId,
				label: shortLabel(ann.code_label),
				fullLabel: ann.code_label,
				color: ann.code_color || '#8b9cf7',
				top,
				comment: ann.stack_memo || ann.properties?.comment || '',
				snippet: truncate(getSnippet(ann), 100)
			});
		}

		untrack(() => { marginLabels = labels; });
	}

	// Document memo
	let docMemoText = $state('');
	let docMemoSaving = $state(false);

	// Document stats
	const uniqueCodeCount = $derived(new Set(annotations.map((a: any) => a.code_id)).size);

	async function saveDocMemo() {
		if (!docMemoText.trim()) return;
		docMemoSaving = true;
		const firstLine = docMemoText.trim().split('\n')[0];
		const label = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
		try {
			const res = await fetch(`/api/projects/${data.projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label,
					content: `[Document: ${doc.label}]\n\n${docMemoText.trim()}`,
					linkedElementIds: [doc.id]
				})
			});
			if (res.ok) {
				docMemoText = '';
			}
		} finally {
			docMemoSaving = false;
		}
	}

	// Re-measure after DOM updates (annotations change)
	$effect(() => {
		void annotations.length; // minimal dependency — only re-measure when count changes

		const raf = requestAnimationFrame(() => measureMarginPositions());
		return () => cancelAnimationFrame(raf);
	});


	// Get surrounding context for an annotation passage
	function getPassageContext(ann: any): string {
		const anchor = ann.properties?.anchor;
		if (!anchor || anchor.pos0 == null || !doc.full_text) return '';
		const contextBefore = 80;
		const contextAfter = 80;
		const start = Math.max(0, anchor.pos0 - contextBefore);
		const end = Math.min(doc.full_text.length, anchor.pos1 + contextAfter);
		const before = start > 0 ? '…' + doc.full_text.slice(start, anchor.pos0) : doc.full_text.slice(0, anchor.pos0);
		const passage = doc.full_text.slice(anchor.pos0, anchor.pos1);
		const after = end < doc.full_text.length ? doc.full_text.slice(anchor.pos1, end) + '…' : doc.full_text.slice(anchor.pos1, end);
		return before + passage + after;
	}

	function getPassageParts(ann: any): { before: string; passage: string; after: string } {
		const anchor = ann.properties?.anchor;
		if (!anchor || anchor.pos0 == null || !doc.full_text) return { before: '', passage: '', after: '' };

		// Use OO elements for context: find surrounding sentences
		const leaves = elements
			.filter((e: any) => e.content !== null)
			.sort((a: any, b: any) => a.char_start - b.char_start);

		if (leaves.length > 0) {
			// Find elements that overlap with the annotation
			const annStart = anchor.pos0;
			const annEnd = anchor.pos1;
			const idx = leaves.findIndex((e: any) => e.char_end > annStart);
			if (idx >= 0) {
				const ctxBefore = 12;
				const ctxAfter = 12;
				// Find last element that overlaps with annotation end
				let endIdx = idx;
				while (endIdx < leaves.length - 1 && leaves[endIdx].char_start < annEnd) endIdx++;
				const firstIdx = Math.max(0, idx - ctxBefore);
				const lastIdx = Math.min(leaves.length - 1, endIdx + ctxAfter);
				const beforeStart = leaves[firstIdx].char_start;
				const afterEnd = leaves[lastIdx].char_end;
				return {
					before: (firstIdx > 0 ? '…' : '') + doc.full_text.slice(beforeStart, annStart),
					passage: doc.full_text.slice(annStart, annEnd),
					after: doc.full_text.slice(annEnd, afterEnd) + (lastIdx < leaves.length - 1 ? '…' : '')
				};
			}
		}

		// Fallback: character-based context
		const ctx = 120;
		const start = Math.max(0, anchor.pos0 - ctx);
		const end = Math.min(doc.full_text.length, anchor.pos1 + ctx);
		return {
			before: (start > 0 ? '…' : '') + doc.full_text.slice(start, anchor.pos0),
			passage: doc.full_text.slice(anchor.pos0, anchor.pos1),
			after: doc.full_text.slice(anchor.pos1, end) + (end < doc.full_text.length ? '…' : '')
		};
	}

	// Re-measure on resize (debounced — ResizeObserver fires frequently)
	$effect(() => {
		if (!textEl) return;
		let timeout: ReturnType<typeof setTimeout>;
		const observer = new ResizeObserver(() => {
			clearTimeout(timeout);
			timeout = setTimeout(() => measureMarginPositions(), 150);
		});
		observer.observe(textEl);
		return () => { observer.disconnect(); clearTimeout(timeout); };
	});

	// Re-measure on scroll (margin is sticky, labels must track visible annotations)
	$effect(() => {
		if (!marginEl) return;
		const scrollContainer = document.querySelector('.content');
		if (!scrollContainer) return;
		let raf: number;
		function onScroll() {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => measureMarginPositions());
		}
		scrollContainer.addEventListener('scroll', onScroll, { passive: true });
		return () => { scrollContainer.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
	});

	// Resizable code margin
	let marginWidth = $state(100);

	function startMarginResize(e: MouseEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = marginWidth;
		function onMove(ev: MouseEvent) {
			marginWidth = Math.max(60, Math.min(300, startWidth - (ev.clientX - startX)));
		}
		function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	function scrollToPassage(annId: string) {
		if (!textEl) return;
		const span = textEl.querySelector(`.coded-text[data-ann-start="${annId}"]`);
		if (!span) return;
		span.scrollIntoView({ behavior: 'smooth', block: 'center' });
		highlightedAnnotationId = annId;
		setTimeout(() => { highlightedAnnotationId = null; }, 2000);
	}

	async function annotate(codeId: string) {
		if (annotating) return;
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
			// Refresh candidates list
			const candidatesRes = await fetch(`/api/projects/${data.projectId}/codes`);
			if (candidatesRes.ok) {
				candidates = await candidatesRes.json();
			}
			codeFilter = '';
			await annotate(newCode.id);
		}
		creatingCode = false;
	}

	async function savePassageMemo(annId: string, codeId: string) {
		if (!passageMemoText.trim()) { memoingAnnId = null; return; }
		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ annotationId: annId, codeId, memo: passageMemoText.trim() })
		});
		if (res.ok) {
			// Refresh annotations to show new memo
			const annRes = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`);
			annotations = await annRes.json();
			passageMemoText = '';
			memoingAnnId = null;
		}
	}

	async function deleteAnnotation(annId: string, codeId: string, codeLabel: string) {
		// First check: would this also delete the code?
		const checkRes = await fetch(
			`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}&check=1&codeId=${codeId}`,
			{ method: 'DELETE' }
		);
		if (!checkRes.ok) return;
		const { wouldDeleteCode } = await checkRes.json();

		const msg = wouldDeleteCode
			? `Remove passage AND delete naming "${codeLabel}"?\n\nThis naming has no other passages — it will be permanently deleted.`
			: `Remove this passage of "${codeLabel}"?\n\nThe naming itself is used elsewhere and will be kept.`;

		if (!confirm(msg)) return;

		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			const result = await res.json();
			annotations = annotations.filter((a: any) => a.id !== annId);
			if (result.codeDeleted) {
				candidates = candidates.filter((c: any) => c.id !== codeId);
			}
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
	<div class="doc-body">
		<div class="doc-with-margin">
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
					<pre class="document-text" bind:this={textEl} onmouseup={handleMouseUp}>{#each textSegments as seg, i}{#if seg.codes.length > 0}{@const isAnnStart = i === 0 || !textSegments[i - 1].codes.some(c => c.annId === seg.codes[0].annId)}<span
						class="coded-text"
						class:coded-highlighted={seg.codes.some(c => c.annId === highlightedAnnotationId)}
						style="background: {codedBackground(seg.codes)}; border-bottom: 2px solid {seg.codes[0].color};"
						data-element-id={seg.elementId || undefined}
						data-ann-start={isAnnStart ? seg.codes[0].annId : undefined}
						onmouseenter={() => { highlightedAnnotationId = seg.codes[0].annId; }}
						onmouseleave={() => { highlightedAnnotationId = null; }}
					>{seg.text}<span class="code-tooltip">{seg.codes.map(c => c.label).join(', ')}</span></span>{:else}<span data-element-id={seg.elementId || undefined}>{seg.text}</span>{/if}{/each}</pre>
				{:else}
					<p class="placeholder">No text content available</p>
				{/if}
			</div>

			{#if !isImage}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="margin-divider" onmousedown={startMarginResize}></div>
				<div class="code-margin" bind:this={marginEl} style="width: {marginWidth}px;">
					{#each marginLabels as ml (ml.annId)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="margin-label"
							class:margin-highlighted={highlightedAnnotationId === ml.annId}
							style="color: {ml.color}; top: {ml.top}px;"
							onmouseenter={(e) => { highlightedAnnotationId = ml.annId; showTooltip(e); }}
							onmouseleave={() => { highlightedAnnotationId = null; hideTooltip(); }}
						>{ml.label}<span class="margin-tooltip" style={tooltipStyle}><strong>{ml.fullLabel}</strong>{#if ml.comment}<em>{ml.comment}</em>{/if}{#if ml.snippet}<span class="mt-snippet">{ml.snippet}</span>{/if}</span></span>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Namings: permanent code overview -->
		<div class="namings-panel">
			<div class="panel-header">
				<h3>Namings <span class="count">({scopedCandidates.length})</span></h3>
				<div class="scope-toggle">
					<button class="scope-btn" class:active={namingsScope === 'this'} onclick={() => namingsScope = 'this'}>Document</button>
					<div class="scope-right">
						<button class="scope-btn" class:active={namingsScope !== 'this'} onclick={() => namingsScope = 'all'}>All</button>
						<select class="scope-doc-pick" value="" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) namingsScope = v; (e.target as HTMLSelectElement).value = ''; }}>
							<option value="">▾</option>
							{#each projectDocuments.filter(d => d.id !== doc.id) as d}
								<option value={d.id}>{d.label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>

			{#if hasSelection}
				<div class="selection-section">
					<div class="selection-top">
						<div class="selection-preview">{getSelectionPreview()}</div>
						<button class="btn-cancel" onclick={cancelSelection}>&times;</button>
					</div>
					<form class="invivo-form" onsubmit={e => { e.preventDefault(); if (canCreateInVivo) createCodeAndAnnotate(); }}>
						<input
							type="text"
							class="code-filter-input"
							placeholder="Apply naming..."
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
					<input
						type="text"
						class="comment-input"
						placeholder="Code-Memo (optional)"
						bind:value={comment}
					/>
				</div>
			{:else}
				<form class="invivo-form" onsubmit={e => { e.preventDefault(); }}>
					<input
						type="text"
						class="code-filter-input"
						placeholder="Filter namings..."
						bind:value={codeFilter}
					/>
				</form>
			{/if}

			<div class="namings-scroll">
				{#if scopedCandidates.length > 0}
					{#each [...candidateGroups] as [key, group] (key)}
						<div class="naming-group">
							<span class="naming-group-label">{group.label}</span>
							{#each group.items as c (c.id)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="naming-row" class:naming-expanded={expandedNamingId === c.id}>
									<div class="naming-main" onclick={() => { if (hasSelection) annotate(c.id); }}>
										<span class="color-dot" style="background: {c.color || '#8b9cf7'}"></span>
										<span
										class="naming-label"
										onmouseenter={(e) => { namingTooltipText = c.label; const r = (e.target as HTMLElement).getBoundingClientRect(); namingTooltipStyle = `left:${r.right + 6}px;top:${r.top}px;display:block`; }}
										onmouseleave={() => { namingTooltipStyle = 'display:none'; }}
									>{c.label}</span>
										<button
											class="naming-action"
											class:has-memos={scopedAnnotations.some((a) => a.code_id === c.id && (a.stack_memo || a.properties?.comment))}
											title="Show memos"
											onclick={(e) => { e.stopPropagation(); expandedNamingId = expandedNamingId === c.id ? null : c.id; }}
										>{expandedNamingId === c.id ? '▽' : '▼'}</button>
										<button
											class="naming-action"
											title="Filter passages"
											onclick={(e) => { e.stopPropagation(); annFilter = annFilter === c.label ? '' : c.label; }}
										>▶</button>
									</div>
									{#if expandedNamingId === c.id}
										{#each [scopedAnnotations.filter((a) => a.code_id === c.id)] as codeAnns}
											{#each [namingStacks.get(c.id) || []] as stack}
												<div class="naming-detail">
													<span class="naming-stat">{codeAnns.length} passage{codeAnns.length !== 1 ? 's' : ''}</span>
													{#if stack.some(a => a.designation || a.inscription)}
														<div class="naming-section-label">Stack</div>
														{#each stack as act}
															{#if act.designation || act.inscription}
																<div class="naming-stack-entry">
																	{#if act.designation}<span class="stack-ccs">{act.designation}</span>{/if}
																	{#if act.inscription}<span class="stack-inscription">{act.inscription}</span>{/if}
																</div>
															{/if}
														{/each}
													{/if}
													{#if stack.some(a => a.memo_text) || codeAnns.some(a => a.stack_memo || a.properties?.comment)}
														<div class="naming-section-label">Memos</div>
														{#each stack as act}
															{#if act.memo_text}
																<div class="naming-memo">{act.memo_text}</div>
															{/if}
														{/each}
														{#each codeAnns as ann}
															{#if ann.stack_memo || ann.properties?.comment}
																<div class="naming-memo">{ann.stack_memo || ann.properties.comment}</div>
															{/if}
														{/each}
													{/if}
												</div>
											{/each}
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				{:else if codeFilter.trim() && !canCreateInVivo}
					<p class="empty">No namings match.</p>
				{/if}
			</div>

			<div class="panel-footer">
				<div class="doc-stats">
					<span class="stat">{annotations.length} passages</span>
					<span class="stat-sep">&middot;</span>
					<span class="stat">{uniqueCodeCount} namings</span>
				</div>
				<div class="doc-memo-inline">
					<textarea
						class="doc-memo-textarea"
						placeholder="Memo..."
						bind:value={docMemoText}
						rows="2"
					></textarea>
					{#if docMemoText.trim()}
						<button class="btn-doc-memo-save" onclick={saveDocMemo} disabled={docMemoSaving}>
							{docMemoSaving ? 'Saving…' : 'Save Memo'}
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Passages: permanent overview of coded text passages -->
		<div class="passages-panel">
			<div class="panel-header">
				<h3>{similarPassages ? 'Similar' : 'Passages'} <span class="count">({similarPassages ? similarPassages.length : `${filteredAnnotations.length}/${scopedAnnotations.length}`})</span></h3>
				<div class="scope-toggle">
					<button class="scope-btn" class:active={passagesScope === 'this'} onclick={() => passagesScope = 'this'}>Document</button>
					<div class="scope-right">
						<button class="scope-btn" class:active={passagesScope !== 'this'} onclick={() => passagesScope = 'all'}>All</button>
						<select class="scope-doc-pick" value="" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) passagesScope = v; (e.target as HTMLSelectElement).value = ''; }}>
							<option value="">▾</option>
							{#each projectDocuments.filter(d => d.id !== doc.id) as d}
								<option value={d.id}>{d.label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>
			{#if !isImage && selection}
				<div class="comparison-section">
					<ComparisonPanel
						projectId={data.projectId}
						docId={doc.id}
						{selection}
						onannotate={(codeId) => annotate(codeId)}
						documentTitle={doc.label}
						onsimilar={(passages) => { similarPassages = passages; }}
					/>
				</div>
			{/if}
			{#if similarPassages}
				<!-- Similar mode: shows embedding-similar passages -->
				<div class="passages-scroll">
					{#if similarPassages.length === 0}
						<p class="empty">No similar passages found.</p>
					{:else}
						{#each similarPassages as sp, i (i)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="annotation-card"
								class:ann-expanded={expandedAnnId === `sim-${i}`}
							>
								<div class="ann-header">
									{#if sp.codes?.length > 0}
										<span class="color-dot" style="background: #8b9cf7"></span>
										<span class="code-name">{sp.codes.map((c: any) => c.label).join(', ')}</span>
									{:else}
										<span class="code-name similar-uncoded">{truncate(sp.content, 50)}</span>
									{/if}
									<button
										class="btn-expand-ann"
										onclick={() => { expandedAnnId = expandedAnnId === `sim-${i}` ? null : `sim-${i}`; }}
										title="Show context"
									>{expandedAnnId === `sim-${i}` ? '▽' : '▼'}</button>
									<span class="similar-score">{(sp.similarity * 100).toFixed(0)}%</span>
								</div>
								<div class="ann-doc-label">{sp.documentTitle}</div>
								{#if expandedAnnId === `sim-${i}`}
									<div class="ann-context">{sp.content}</div>
								{:else}
									<div class="ann-text">{truncate(sp.content, 80)}</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<!-- Normal mode: filtered passages -->
				<input
					type="text"
					class="ann-search"
					placeholder="Filter..."
					bind:value={annFilter}
				/>
				<div class="passages-scroll">
					{#if filteredAnnotations.length === 0}
						<p class="empty">{annFilter ? 'No matches.' : 'No passages yet.'}</p>
					{:else}
						{#each filteredAnnotations as ann (ann.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="annotation-card"
								class:ann-highlighted={highlightedAnnotationId === ann.id}
								class:ann-expanded={expandedAnnId === ann.id}
								onmouseenter={() => { highlightedAnnotationId = ann.id; }}
								onmouseleave={() => { highlightedAnnotationId = null; }}
							>
								<div class="ann-header">
									<span class="color-dot" style="background: {ann.code_color || '#8b9cf7'}"></span>
									<span class="code-name">{ann.code_label}</span>
									<button
										class="btn-expand-ann"
										onclick={() => { expandedAnnId = expandedAnnId === ann.id ? null : ann.id; }}
										title="Show context"
									>{expandedAnnId === ann.id ? '▽' : '▼'}</button>
									{#if ann.document_id === doc.id}
										<button
											class="btn-expand-ann"
											onclick={() => scrollToPassage(ann.id)}
											title="Scroll to passage"
										>▶</button>
									{/if}
									<button
										class="btn-delete-ann"
										onclick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id, ann.code_id, ann.code_label); }}
										title="Remove"
									>×</button>
								</div>
								{#if passagesScope !== 'this' && ann.document_label}
									<div class="ann-doc-label">{ann.document_label}</div>
								{/if}
								{#if expandedAnnId === ann.id}
									{@const parts = getPassageParts(ann)}
									<div class="ann-context">
										<span class="ctx-before">{parts.before}</span><span class="ctx-passage">{parts.passage}</span><span class="ctx-after">{parts.after}</span>
									</div>
									{#if ann.stack_memo || ann.properties?.comment}
										<div class="ann-comment">{ann.stack_memo || ann.properties.comment}</div>
									{/if}
									{#if memoingAnnId === ann.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="passage-memo-input"
											placeholder="Memo for this passage..."
											bind:value={passageMemoText}
											autofocus
											onkeydown={(e) => { if (e.key === 'Enter') savePassageMemo(ann.id, ann.code_id); if (e.key === 'Escape') memoingAnnId = null; }}
											onblur={() => { if (passageMemoText.trim()) savePassageMemo(ann.id, ann.code_id); else memoingAnnId = null; }}
										/>
									{:else}
										<button class="btn-add-memo" onclick={() => { memoingAnnId = ann.id; passageMemoText = ''; }}>+ Memo</button>
									{/if}
								{:else if getSnippet(ann)}
									<div class="ann-text">{truncate(getSnippet(ann), 60)}</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>

	</div>
</div>

<!-- Naming tooltip: fixed position, outside overflow containers -->
<div class="naming-tooltip-fixed" style={namingTooltipStyle}>{namingTooltipText}</div>

<style>
	.doc-viewer { }

	.doc-body {
		display: flex;
		gap: 1rem;
	}

	.doc-with-margin {
		flex: 1;
		display: flex;
		min-width: 0;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		z-index: 2;
	}

	.content-panel {
		flex: 1;
		min-width: 0;
		padding: 1.25rem;
	}

	.content-panel.image-mode {
		padding: 0;
		overflow: hidden;
	}

	.document-text {
		flex: 1;
		min-width: 0;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: 'Courier New', 'Consolas', monospace;
		font-size: 0.85rem;
		line-height: 1.7;
		color: #d1d5db;
		cursor: text;
	}

	.document-text::selection {
		background: rgba(139, 156, 247, 0.35);
	}

	/* Resize handle between doc text and code margin */
	.margin-divider {
		width: 3px;
		flex-shrink: 0;
		cursor: col-resize;
		background: #2a2d3a;
		transition: background 0.15s;
		position: sticky;
		top: 0;
		align-self: flex-start;
		height: 100vh;
	}
	.margin-divider:hover { background: #8b9cf7; }

	/* Code margin column — sticky, stays in place while document scrolls */
	.code-margin {
		flex-shrink: 0;
		position: sticky;
		top: 0;
		align-self: flex-start;
		height: 100vh;
		overflow: hidden;
		padding-left: 0.4rem;
	}
	.margin-label {
		position: absolute;
		left: 0.4rem;
		display: block;
		font-family: system-ui, sans-serif;
		font-size: 0.65rem;
		line-height: normal;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: calc(100% - 0.5rem);
		cursor: default;
		opacity: 0.8;
	}
	.margin-label:hover, .margin-label.margin-highlighted {
		opacity: 1;
		font-weight: 600;
	}
	/* Margin tooltip: shows full code + memo on hover */
	.margin-tooltip {
		display: none;
		position: fixed;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 400;
		color: #d1d5db;
		white-space: normal;
		width: 240px;
		z-index: 200;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
		pointer-events: none;
		line-height: 1.5;
	}
	.margin-tooltip strong { color: #e1e4e8; display: block; margin-bottom: 0.2rem; }
	.margin-tooltip em { color: #8b9cf7; font-style: italic; }
	.mt-snippet { color: #6b7280; font-size: 0.7rem; }
	.margin-label:hover > .margin-tooltip[style*="left"] { display: block; }

	/* Coded text: background + underline, no layout shift */
	.coded-text {
		position: relative;
		border-radius: 2px;
		transition: filter 0.15s;
		cursor: default;
	}
	.coded-text.coded-highlighted {
		filter: brightness(1.4);
	}
	.code-tooltip {
		display: none;
		position: absolute;
		bottom: 100%; left: 0;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-family: system-ui, sans-serif;
		font-size: 0.7rem;
		color: #e1e4e8;
		white-space: nowrap;
		z-index: 10;
		pointer-events: none;
		box-shadow: 0 2px 8px rgba(0,0,0,0.4);
	}
	.coded-text:hover > .code-tooltip { display: block; }

	/* Namings panel: permanent code overview */
	.namings-panel {
		width: 260px;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		align-self: flex-start;
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow: hidden;
		z-index: 1;
	}
	.namings-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0;
	}
	.panel-header {
		padding: 0.4rem 0.2rem;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.panel-header h3 {
		font-size: 0.8rem;
		color: #8b8fa3;
		margin: 0;
	}
	.scope-toggle {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		overflow: hidden;
	}
	.scope-btn {
		flex: 1;
		background: none;
		border: none;
		padding: 0.15rem 0.3rem;
		font-size: 0.65rem;
		color: #6b7280;
		cursor: pointer;
		font-family: inherit;
	}
	.scope-btn:hover { color: #c9cdd5; }
	.scope-btn.active {
		background: rgba(139, 156, 247, 0.15);
		color: #a5b4fc;
	}
	.scope-right {
		display: flex;
		align-items: center;
		border-left: 1px solid #2a2d3a;
	}
	.scope-doc-pick {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.15rem 0.15rem;
		width: 1.4rem;
		appearance: none;
	}
	.scope-doc-pick:hover { color: #a5b4fc; }
	.scope-doc-pick:focus { outline: none; }
	.similar-uncoded {
		color: #6b7280;
		font-style: italic;
	}
	.similar-score {
		color: #6b7280;
		font-size: 0.65rem;
		flex-shrink: 0;
		margin-left: auto;
	}
	.ann-doc-label {
		font-size: 0.62rem;
		color: #6b7280;
		padding: 0.1rem 0 0 1.1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.panel-footer {
		flex-shrink: 0;
		border-top: 1px solid #2a2d3a;
		padding-top: 0.5rem;
	}

	/* Passages panel: permanent passage overview */
	.passages-panel {
		width: 320px;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		align-self: flex-start;
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow: hidden;
	}
	.passages-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0.4rem 0.5rem;
	}
	.passages-panel .panel-header,
	.annotations-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #2a2d3a;
		flex-shrink: 0;
	}
	.annotations-header h3 { margin: 0; font-size: 0.8rem; }
	.btn-close-ann {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.btn-close-ann:hover { color: #e1e4e8; }
	.ann-search {
		width: 100%;
		background: #0f1117;
		border: none;
		border-bottom: 1px solid #2a2d3a;
		padding: 0.35rem 0.6rem;
		color: #e1e4e8;
		font-size: 0.75rem;
		box-sizing: border-box;
		flex-shrink: 0;
	}
	.ann-search:focus { outline: none; border-bottom-color: #8b9cf7; }

	.section-icon { width: 16px; height: 16px; opacity: 0.5; }

	/* Selection / annotation section */
	.selection-section {
		background: #161822;
		border: 1px solid #8b9cf7;
		border-radius: 6px;
		padding: 0.4rem;
		flex-shrink: 0;
	}
	.selection-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.3rem;
	}
	.comparison-section {
		flex-shrink: 0;
		border-bottom: 1px solid #2a2d3a;
		padding: 0.3rem 0.4rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
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

	.doc-stats {
		font-size: 0.75rem;
		color: #6b7280;
		padding: 0.3rem 0;
	}
	.stat-sep { margin: 0 0.3rem; }

	.doc-memo-inline {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.doc-memo-textarea {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		color: #e1e4e8;
		font-size: 0.78rem;
		font-family: system-ui, sans-serif;
		resize: vertical;
		box-sizing: border-box;
	}
	.doc-memo-textarea:focus { outline: none; border-color: #4ade80; }
	.btn-doc-memo-save {
		align-self: flex-end;
		padding: 0.3rem 0.6rem;
		background: rgba(76, 175, 80, 0.1);
		border: 1px solid #4ade80;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.btn-doc-memo-save:hover { background: rgba(76, 175, 80, 0.2); }
	.btn-doc-memo-save:disabled { opacity: 0.4; cursor: default; }

	.reading-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: #4b5563;
		padding-top: 0.25rem;
	}

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

	.naming-group { margin-bottom: 0.25rem; }
	.naming-group-label {
		display: block;
		font-size: 0.6rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.3rem 0 0.1rem;
	}
	.naming-row {
		border-bottom: 1px solid rgba(42, 45, 58, 0.5);
	}
	.naming-main {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0;
		cursor: pointer;
	}
	.naming-main:hover { background: rgba(139, 156, 247, 0.05); }
	.naming-label {
		flex: 1;
		font-size: 0.75rem;
		color: #c9cdd5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.naming-action {
		background: none;
		border: none;
		color: #4b5563;
		font-size: 0.6rem;
		cursor: pointer;
		padding: 0 0.15rem;
		flex-shrink: 0;
		line-height: 1;
	}
	.naming-action:hover { color: #8b9cf7; }
	.naming-action.has-memos { color: #c77d1a; }
	.naming-detail {
		padding: 0.15rem 0 0.25rem 1.1rem;
		font-size: 0.7rem;
		color: #6b7280;
	}
	.naming-stat {
		display: block;
		font-size: 0.65rem;
		color: #4b5563;
		margin-bottom: 0.1rem;
	}
	/* Fixed tooltip for naming hover (outside overflow containers) */
	.naming-tooltip-fixed {
		position: fixed;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
		font-size: 0.72rem;
		color: #d1d5db;
		white-space: nowrap;
		z-index: 200;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.naming-section-label {
		font-size: 0.58rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-top: 0.2rem;
	}
	.naming-stack-entry {
		font-size: 0.65rem;
		color: #9ca3af;
		line-height: 1.3;
	}
	.stack-ccs {
		color: #a5b4fc;
		font-size: 0.6rem;
		margin-right: 0.3rem;
	}
	.stack-inscription {
		color: #d1d5db;
	}
	.naming-memo {
		font-size: 0.68rem;
		color: #c77d1a;
		font-style: italic;
		margin-top: 0.1rem;
		line-height: 1.3;
	}

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

	/* (hint styles removed — replaced by .reading-mode) */

	.annotations-header h3 {
		font-size: 0.8rem;
		color: #8b8fa3;
		margin: 0;
	}

	.count { color: #6b7280; }
	.empty { font-size: 0.8rem; color: #6b7280; }

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

	/* Expand button + expanded annotation */
	.btn-expand-ann {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0 0.2rem;
		margin-left: auto;
		flex-shrink: 0;
	}
	.btn-expand-ann:hover { color: #8b9cf7; }
	.btn-delete-ann {
		background: none;
		border: none;
		color: transparent;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0 0.15rem;
		margin-left: auto;
		flex-shrink: 0;
		line-height: 1;
	}
	.annotation-card:hover .btn-delete-ann { color: #4b5563; }
	.btn-delete-ann:hover { color: #ef4444 !important; }
	.annotation-card { cursor: default; }
	.annotation-card.ann-expanded {
		border-color: #4b5563;
	}
	.ann-context {
		font-size: 0.72rem;
		line-height: 1.5;
		margin-top: 0.3rem;
		padding: 0.3rem;
		background: #0f1117;
		border-radius: 4px;
		color: #9ca3af;
	}
	.passage-memo-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #c77d1a;
		border-radius: 4px;
		padding: 0.3rem 0.4rem;
		color: #e1e4e8;
		font-size: 0.72rem;
		font-family: inherit;
		margin-top: 0.25rem;
		box-sizing: border-box;
	}
	.passage-memo-input:focus { outline: none; }
	.btn-add-memo {
		background: none;
		border: none;
		color: #4b5563;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.15rem 0;
		margin-top: 0.1rem;
	}
	.btn-add-memo:hover { color: #c77d1a; }
	.ctx-before, .ctx-after { color: #6b7280; }
	.ctx-passage { color: #e1e4e8; background: rgba(139, 156, 247, 0.12); border-radius: 2px; }

	.placeholder {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}
</style>
