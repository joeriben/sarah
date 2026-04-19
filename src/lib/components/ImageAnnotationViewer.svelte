<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { createViewport } from '$lib/canvas/viewport.svelte.js';

	type Annotation = {
		id: string;
		code_id: string;
		properties?: { anchor?: { type: string; x: number; y: number; width: number; height: number } };
		code_color?: string;
	};

	type RegionSelection = { x: number; y: number; width: number; height: number };

	let {
		imageUrl,
		annotations = [],
		highlightedAnnotationId = $bindable<string | null>(null),
		onregionselect
	}: {
		imageUrl: string;
		annotations: Annotation[];
		highlightedAnnotationId?: string | null;
		onregionselect: (region: RegionSelection | null) => void;
	} = $props();

	const vp = createViewport({ minZoom: 0.01 });

	let containerEl = $state<HTMLDivElement>();
	let imgNaturalWidth = $state(0);
	let imgNaturalHeight = $state(0);
	let imgLoaded = $state(false);

	// Drawing state
	let drawing = $state(false);
	let drawStart = $state<{ x: number; y: number } | null>(null);
	let drawCurrent = $state<{ x: number; y: number } | null>(null);
	let currentRegion = $state<RegionSelection | null>(null);

	// Panning state
	let panning = $state(false);
	let panLastPos = $state<{ x: number; y: number } | null>(null);

	function handleImgLoad(e: Event) {
		const img = e.target as HTMLImageElement;
		imgNaturalWidth = img.naturalWidth;
		imgNaturalHeight = img.naturalHeight;
		imgLoaded = true;
		fitToContainer();
	}

	function fitToContainer() {
		if (!containerEl || !imgNaturalWidth || !imgNaturalHeight) return;
		const rect = containerEl.getBoundingClientRect();
		const scaleX = rect.width / imgNaturalWidth;
		const scaleY = rect.height / imgNaturalHeight;
		// No cap at 1 — large images need small zoom to fit
		const scale = Math.min(scaleX, scaleY) * 0.95;
		vp.zoom = scale;
		vp.x = (rect.width / scale - imgNaturalWidth) / 2;
		vp.y = (rect.height / scale - imgNaturalHeight) / 2;
	}

	/** After zoom, nudge viewport so image center stays within the visible area */
	function constrainViewport() {
		if (!containerEl || !imgNaturalWidth || !imgNaturalHeight) return;
		const rect = containerEl.getBoundingClientRect();
		const viewW = rect.width / vp.zoom;
		const viewH = rect.height / vp.zoom;

		// Image center in canvas coords
		const imgCx = imgNaturalWidth / 2;
		const imgCy = imgNaturalHeight / 2;

		// Visible area in canvas: [−vp.x, −vp.x + viewW] × [−vp.y, −vp.y + viewH]
		// Ensure image center is within visible area (with margin)
		const margin = 50 / vp.zoom; // 50 screen pixels
		const visLeft = -vp.x + margin;
		const visRight = -vp.x + viewW - margin;
		const visTop = -vp.y + margin;
		const visBottom = -vp.y + viewH - margin;

		if (imgCx < visLeft) vp.x = -(imgCx - margin);
		else if (imgCx > visRight) vp.x = -(imgCx - viewW + margin);
		if (imgCy < visTop) vp.y = -(imgCy - margin);
		else if (imgCy > visBottom) vp.y = -(imgCy - viewH + margin);
	}

	function toNormalized(px: number, py: number): { x: number; y: number } {
		const canvas = vp.screenToCanvas(px, py);
		return { x: canvas.x / imgNaturalWidth, y: canvas.y / imgNaturalHeight };
	}

	function getContainerOffset(e: MouseEvent): { x: number; y: number } {
		const rect = containerEl!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function handlePointerDown(e: MouseEvent) {
		if (!containerEl || !imgLoaded) return;

		// Alt+drag or middle button = pan
		if (e.altKey || e.button === 1) {
			panning = true;
			panLastPos = { x: e.clientX, y: e.clientY };
			e.preventDefault();
			return;
		}

		if (e.button !== 0) return;

		const pos = getContainerOffset(e);
		const norm = toNormalized(pos.x, pos.y);

		// Only start drawing if click is within image bounds
		if (norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return;

		drawing = true;
		drawStart = {
			x: Math.max(0, Math.min(1, norm.x)),
			y: Math.max(0, Math.min(1, norm.y))
		};
		drawCurrent = drawStart;
		currentRegion = null;
		onregionselect(null);
		e.preventDefault();
	}

	function handlePointerMove(e: MouseEvent) {
		if (panning && panLastPos) {
			vp.pan(e.clientX - panLastPos.x, e.clientY - panLastPos.y);
			panLastPos = { x: e.clientX, y: e.clientY };
			e.preventDefault();
			return;
		}

		if (!drawing || !drawStart || !containerEl) return;

		const pos = getContainerOffset(e);
		const norm = toNormalized(pos.x, pos.y);
		drawCurrent = {
			x: Math.max(0, Math.min(1, norm.x)),
			y: Math.max(0, Math.min(1, norm.y))
		};
		e.preventDefault();
	}

	function handlePointerUp(e: MouseEvent) {
		if (panning) {
			panning = false;
			panLastPos = null;
			return;
		}

		if (!drawing || !drawStart || !drawCurrent) return;
		drawing = false;

		const x = Math.min(drawStart.x, drawCurrent.x);
		const y = Math.min(drawStart.y, drawCurrent.y);
		const width = Math.abs(drawCurrent.x - drawStart.x);
		const height = Math.abs(drawCurrent.y - drawStart.y);

		// Minimum size threshold (ignore tiny accidental clicks)
		if (width < 0.01 || height < 0.01) {
			drawStart = null;
			drawCurrent = null;
			currentRegion = null;
			onregionselect(null);
			return;
		}

		currentRegion = { x, y, width, height };
		onregionselect(currentRegion);
		drawStart = null;
		drawCurrent = null;
	}

	function handleWheel(e: WheelEvent) {
		if (!containerEl || !imgNaturalWidth) return;
		e.preventDefault();
		const rect = containerEl.getBoundingClientRect();
		const cx = (e.clientX - rect.left) / vp.zoom;
		const cy = (e.clientY - rect.top) / vp.zoom;
		const factor = e.deltaY < 0 ? 1.1 : 0.9;
		vp.zoomAt(factor, cx, cy);
		constrainViewport();
	}

	export function clearRegion() {
		currentRegion = null;
		drawStart = null;
		drawCurrent = null;
		onregionselect(null);
	}

	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// Computed in-progress rect in normalized coords
	let drawRect = $derived.by(() => {
		if (!drawStart || !drawCurrent) return null;
		return {
			x: Math.min(drawStart.x, drawCurrent.x),
			y: Math.min(drawStart.y, drawCurrent.y),
			width: Math.abs(drawCurrent.x - drawStart.x),
			height: Math.abs(drawCurrent.y - drawStart.y)
		};
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
<div
	class="image-viewer"
	bind:this={containerEl}
	onmousedown={handlePointerDown}
	onmousemove={handlePointerMove}
	onmouseup={handlePointerUp}
	onmouseleave={handlePointerUp}
	onwheel={handleWheel}
	role="img"
>
	<div
		class="image-container"
		style="transform: translate({vp.x * vp.zoom}px, {vp.y * vp.zoom}px) scale({vp.zoom})"
	>
		<img
			src={imageUrl}
			alt="Document"
			onload={handleImgLoad}
			draggable="false"
		/>

		{#if imgLoaded}
			<svg
				class="annotation-overlay"
				viewBox="0 0 1 1"
				preserveAspectRatio="none"
				style="width: {imgNaturalWidth}px; height: {imgNaturalHeight}px"
			>
				<!-- Existing annotations -->
				{#each annotations as ann (ann.id)}
					{@const anchor = ann.properties?.anchor}
					{#if anchor?.type === 'rect'}
						{@const color = ann.code_color || '#8b9cf7'}
						<rect
							x={anchor.x}
							y={anchor.y}
							width={anchor.width}
							height={anchor.height}
							fill={hexToRgba(color, highlightedAnnotationId === ann.id ? 0.35 : 0.2)}
							stroke={color}
							stroke-width={highlightedAnnotationId === ann.id ? 0.004 : 0.002}
							class="annotation-rect"
							class:highlighted={highlightedAnnotationId === ann.id}
						/>
					{/if}
				{/each}

				<!-- Current completed selection -->
				{#if currentRegion}
					<rect
						x={currentRegion.x}
						y={currentRegion.y}
						width={currentRegion.width}
						height={currentRegion.height}
						fill="rgba(139, 156, 247, 0.15)"
						stroke="#8b9cf7"
						stroke-width="0.003"
						stroke-dasharray="0.008 0.004"
					/>
				{/if}

				<!-- In-progress drawing -->
				{#if drawRect}
					<rect
						x={drawRect.x}
						y={drawRect.y}
						width={drawRect.width}
						height={drawRect.height}
						fill="rgba(139, 156, 247, 0.1)"
						stroke="#8b9cf7"
						stroke-width="0.002"
						stroke-dasharray="0.006 0.003"
					/>
				{/if}
			</svg>
		{/if}
	</div>

	{#if imgLoaded}
		<div class="pan-hint">Alt + drag to pan</div>
	{/if}
</div>

<style>
	.image-viewer {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		background: #0f1117;
		border-radius: 8px;
	}

	.image-container {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}

	img {
		display: block;
		user-select: none;
		-webkit-user-drag: none;
	}

	.annotation-overlay {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
	}

	.annotation-rect {
		transition: fill 0.15s, stroke-width 0.15s;
	}

	.annotation-rect.highlighted {
		filter: brightness(1.3);
	}

	.pan-hint {
		position: absolute;
		bottom: 0.5rem;
		right: 0.5rem;
		font-size: 0.7rem;
		color: #4b5060;
		pointer-events: none;
		user-select: none;
	}
</style>
