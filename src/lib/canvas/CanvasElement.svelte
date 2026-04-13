<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		id,
		x = 0,
		y = 0,
		label = '',
		color = '#8b9cf7',
		selected = false,
		kind = 'entity',
		zoom = 1,
		draggable = true,
		ondragend,
		onclick,
		oncontextmenu,
		children
	}: {
		id: string;
		x?: number;
		y?: number;
		label?: string;
		color?: string;
		selected?: boolean;
		kind?: string;
		zoom?: number;
		draggable?: boolean;
		ondragend?: (id: string, x: number, y: number) => void;
		onclick?: (id: string, e: MouseEvent) => void;
		oncontextmenu?: (id: string, e: MouseEvent) => void;
		children?: Snippet;
	} = $props();

	let isDragging = $state(false);
	let didDrag = $state(false);
	let dragStart = { x: 0, y: 0 };
	let currentX = $state(x);
	let currentY = $state(y);

	$effect(() => {
		if (!isDragging) {
			currentX = x;
			currentY = y;
		}
	});

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || e.altKey) return;
		if (!draggable) return;
		if ((e.target as Element).closest('.handle, .inline-rename')) return;
		e.stopPropagation();
		isDragging = true;
		didDrag = false;
		dragStart = { x: e.clientX, y: e.clientY };
		(e.target as HTMLElement).closest('.canvas-element')?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		// Divide screen-space delta by zoom to get canvas-space delta
		const dx = (e.clientX - dragStart.x) / zoom;
		const dy = (e.clientY - dragStart.y) / zoom;
		dragStart = { x: e.clientX, y: e.clientY };
		currentX += dx;
		currentY += dy;
		didDrag = true;
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (didDrag) {
			ondragend?.(id, currentX, currentY);
		}
	}

	function handleClick(e: MouseEvent) {
		if (!didDrag) onclick?.(id, e);
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		oncontextmenu?.(id, e);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="canvas-element"
	class:selected
	class:dragging={isDragging}
	style="left: {currentX}px; top: {currentY}px; transform: translate(-50%, -50%); --el-color: {color};"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={handleClick}
	oncontextmenu={handleContextMenu}
>
	{#if children}
		{@render children()}
	{:else}
		<div class="element-body">
			<span class="element-kind">{kind}</span>
			<span class="element-label">{label}</span>
		</div>
	{/if}
</div>

<style>
	.canvas-element {
		position: absolute;
		user-select: none;
		cursor: grab;
		touch-action: none;
	}

	.canvas-element.dragging {
		cursor: grabbing;
		z-index: 100;
	}

	.element-body {
		background: #161822;
		border: 2px solid var(--el-color, #8b9cf7);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		min-width: 80px;
		max-width: 200px;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.selected .element-body {
		box-shadow: 0 0 0 2px var(--el-color, #8b9cf7);
	}

	.element-kind {
		font-size: 0.6rem;
		color: var(--el-color, #8b9cf7);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.element-label {
		font-size: 0.85rem;
		color: #e1e4e8;
		word-break: break-word;
	}
</style>
