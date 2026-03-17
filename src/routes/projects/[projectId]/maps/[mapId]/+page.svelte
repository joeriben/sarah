<script lang="ts">
	import { untrack } from 'svelte';
	import InfiniteCanvas from '$lib/canvas/InfiniteCanvas.svelte';
	import CanvasElement from '$lib/canvas/CanvasElement.svelte';
	import CanvasConnection from '$lib/canvas/CanvasConnection.svelte';
	import { createViewport } from '$lib/canvas/viewport.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import { computeLayout, computeRadialLayout } from '$lib/canvas/layout.js';
	import { regionColor } from '$lib/canvas/regions.js';
	import FormationNode from '$lib/canvas/FormationNode.svelte';
	import { computeSpatialRelations, type Formation } from '$lib/canvas/geometry.js';

	import { createMapState, setMapState } from '$lib/map/mapState.svelte.js';
	import MapToolbar from '$lib/map/MapToolbar.svelte';
	import TopoPanel from '$lib/map/TopoPanel.svelte';
	import MemoPanel from '$lib/map/MemoPanel.svelte';
	import NamingActPrompt from '$lib/map/NamingActPrompt.svelte';
	import RelationForm from '$lib/map/RelationForm.svelte';
	import StackPanel from '$lib/map/StackPanel.svelte';
	import ContextMenu from '$lib/map/ContextMenu.svelte';
	import PhasesSidebar from '$lib/map/PhasesSidebar.svelte';
	import ListItemCard from '$lib/map/ListItemCard.svelte';
	import OutsidePanel from '$lib/map/OutsidePanel.svelte';
	import MemoCreateForm from '$lib/map/MemoCreateForm.svelte';

	let { data } = $props();

	const viewport = createViewport();
	const selection = createSelection();
	const ms = createMapState(data, viewport);
	setMapState(ms);

	// Sync data from server when props change
	$effect(() => { ms.syncData(data); });

	let viewMode = $state<'canvas' | 'list'>('list');
	let canvasContainerEl = $state<HTMLDivElement | null>(null);
	let posMapFitted = false;

	const POS_AXIS_LEN = 1600;

	// Fit positional map: origin at bottom-left, zoom to show full axis extent
	function fitPosMap() {
		if (!canvasContainerEl) return;
		const w = canvasContainerEl.clientWidth;
		const h = canvasContainerEl.clientHeight;
		if (w <= 0 || h <= 0) return;
		// Canvas bounds: include axis labels + gradient indicators outside the axes
		viewport.fitBounds(
			{ minX: -200, minY: -POS_AXIS_LEN - 60, maxX: POS_AXIS_LEN + 60, maxY: 160 },
			w, h, 30
		);
	}

	// Auto-fit when switching to canvas view on positional maps
	$effect(() => {
		if (ms.mapType !== 'positional' || viewMode !== 'canvas' || !canvasContainerEl) return;
		if (!posMapFitted) {
			// Small delay to let the container render at full size
			requestAnimationFrame(() => { fitPosMap(); posMapFitted = true; });
		}
	});
	let displayMode = $state<'entities' | 'relations' | 'full'>('full');
	let listGroupBy = $state<'mode' | 'designation' | 'phase' | 'provenance' | 'flat'>('mode');

	// Restore preferences from localStorage
	$effect(() => {
		const mapId = data.map.id;
		const savedMode = localStorage.getItem(`map:${mapId}:displayMode`);
		if (savedMode === 'entities' || savedMode === 'relations' || savedMode === 'full') displayMode = savedMode;
		const savedGroup = localStorage.getItem(`map:${mapId}:listGroupBy`);
		if (savedGroup) listGroupBy = savedGroup as typeof listGroupBy;
	});

	// ─── Positions ───

	let positions = $state<Map<string, { x: number; y: number }>>(new Map());
	let layoutInitialized = false;

	$effect(() => {
		if (layoutInitialized) return;
		const allNodes = [...ms.elements, ...ms.relations, ...ms.silences];
		if (allNodes.length === 0) return;
		layoutInitialized = true;
		initPositions(allNodes);
	});

	async function initPositions(allNodes: any[]) {
		const stored = new Map<string, { x: number; y: number }>();
		let needsLayout = false;
		for (const node of allNodes) {
			const x = node.properties?.x;
			const y = node.properties?.y;
			if (typeof x === 'number' && typeof y === 'number') {
				stored.set(node.naming_id, { x, y });
			} else { needsLayout = true; }
		}
		if (needsLayout) {
			if (ms.mapType === 'positional') {
				// Positional maps: no auto-layout, place unpositioned nodes in a scatter near origin
				const merged = new Map(stored);
				let offset = 0;
				for (const node of allNodes) {
					if (!merged.has(node.naming_id)) {
						merged.set(node.naming_id, { x: 50 + (offset % 4) * 120, y: -50 - Math.floor(offset / 4) * 100 });
						offset++;
					}
				}
				positions = merged;
				await saveAllPositions(merged);
			} else {
				try {
					const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
					const merged = new Map(stored);
					for (const [id, p] of result.positions) {
						if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y });
					}
					placeRelationMidpoints(merged);
					positions = merged;
					await saveAllPositions(merged);
				} catch (err) {
					console.warn('ELK layout failed, using stored positions:', err);
					placeRelationMidpoints(stored);
					positions = stored;
				}
			}
		} else { positions = stored; }
	}

	function placeRelationMidpoints(pos: Map<string, { x: number; y: number }>) {
		for (const rel of ms.relations) {
			if (pos.has(rel.naming_id)) continue;
			const srcId = rel.directed_from || rel.part_source_id;
			const tgtId = rel.directed_to || rel.part_target_id;
			const srcPos = srcId ? pos.get(srcId) : undefined;
			const tgtPos = tgtId ? pos.get(tgtId) : undefined;
			if (srcPos && tgtPos) {
				pos.set(rel.naming_id, { x: (srcPos.x + tgtPos.x) / 2, y: (srcPos.y + tgtPos.y) / 2 });
			}
		}
	}

	async function layoutNewNodes() {
		const unpositioned = [...ms.elements, ...ms.relations, ...ms.silences]
			.filter((n: any) => !positions.has(n.naming_id));
		if (unpositioned.length === 0) return;
		if (unpositioned.length <= 2 && positions.size > 0) {
			const merged = new Map(positions);
			for (const node of unpositioned) {
				if (node.mode === 'relation') {
					const srcId = node.directed_from || node.part_source_id;
					const tgtId = node.directed_to || node.part_target_id;
					const srcPos = srcId ? merged.get(srcId) : undefined;
					const tgtPos = tgtId ? merged.get(tgtId) : undefined;
					if (srcPos && tgtPos) {
						merged.set(node.naming_id, { x: (srcPos.x + tgtPos.x) / 2, y: (srcPos.y + tgtPos.y) / 2 });
						continue;
					}
				}
			}
			const cx = viewport.x ? -viewport.x / viewport.zoom + 400 : 400;
			const cy = viewport.y ? -viewport.y / viewport.zoom + 300 : 300;
			for (const node of unpositioned.filter((n: any) => n.mode !== 'relation')) {
				if (merged.has(node.naming_id)) continue;
				merged.set(node.naming_id, { x: cx + (Math.random() - 0.5) * 200, y: cy + (Math.random() - 0.5) * 200 });
			}
			placeRelationMidpoints(merged);
			positions = merged;
			await saveAllPositions(merged);
		} else {
			const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
			const merged = new Map(positions);
			for (const [id, p] of result.positions) {
				if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y });
			}
			placeRelationMidpoints(merged);
			positions = merged;
			await saveAllPositions(merged);
		}
	}

	async function saveAllPositions(pos: Map<string, { x: number; y: number }>) {
		const arr = [...pos.entries()].map(([namingId, p]) => ({ namingId, x: p.x, y: p.y }));
		if (arr.length > 0) await ms.mapAction('updatePositions', { positions: arr });
	}

	function nodeCenter(namingId: string): { x: number; y: number } {
		const pos = positions.get(namingId);
		return pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
	}

	// ─── Center-on (radial layout) ───

	let centeredId = $state<string | null>(null);
	let preRadialPositions: Map<string, { x: number; y: number }> | null = null;

	const centeredConnections = $derived.by(() => {
		if (!centeredId) return null;
		const connected = new Set<string>([centeredId]);
		for (const rel of ms.relations) {
			const src = rel.directed_from || rel.part_source_id;
			const tgt = rel.directed_to || rel.part_target_id;
			if (src === centeredId || tgt === centeredId) {
				if (src) connected.add(src);
				if (tgt) connected.add(tgt);
				connected.add(rel.naming_id);
			}
		}
		return connected;
	});

	function centerOn(id: string) {
		preRadialPositions = new Map(positions);
		const newPositions = computeRadialLayout(id, ms.elements as any, ms.relations as any, ms.silences as any);
		const cx = viewport.x ? -viewport.x / viewport.zoom + 400 : 400;
		const cy = viewport.y ? -viewport.y / viewport.zoom + 300 : 300;
		const adjusted = new Map<string, { x: number; y: number }>();
		for (const [nid, pos] of newPositions) {
			adjusted.set(nid, { x: pos.x + cx, y: pos.y + cy });
		}
		positions = adjusted;
		centeredId = id;
	}

	function uncenter() {
		if (preRadialPositions) { positions = preRadialPositions; preRadialPositions = null; }
		centeredId = null;
	}

	// ─── Spatial relation sync (SW/A maps) ───

	let spatialSyncPending = false;
	let spatialSyncQueued = false;

	async function syncSpatialRelations() {
		if (ms.mapType !== 'social-worlds' || centeredId) return;
		if (spatialSyncPending) { spatialSyncQueued = true; return; }
		spatialSyncPending = true;
		try {
			const formations: Formation[] = [];
			const plainElements: Array<{ id: string; x: number; y: number }> = [];
			for (const el of ms.elements) {
				const pos = positions.get(el.naming_id);
				if (!pos) continue;
				if (el.sw_role) {
					formations.push({ id: el.naming_id, x: pos.x, y: pos.y, rx: el.properties?.rx || 150, ry: el.properties?.ry || 100, rotation: el.properties?.rotation || 0, swRole: el.sw_role });
				} else { plainElements.push({ id: el.naming_id, x: pos.x, y: pos.y }); }
			}
			if (formations.length === 0) return;
			const computed = computeSpatialRelations(plainElements, formations);
			const existingContains = new Map<string, string>();
			const existingOverlaps = new Map<string, string>();
			for (const rel of ms.relations) {
				if (!rel.properties?.spatiallyDerived || ms.isWithdrawn(rel.properties)) continue;
				if (rel.valence === 'contains' && rel.directed_from && rel.directed_to) {
					existingContains.set(`${rel.directed_from}:${rel.directed_to}`, rel.naming_id);
				} else if (rel.valence === 'overlaps') {
					const src = rel.part_source_id; const tgt = rel.part_target_id;
					if (src && tgt) existingOverlaps.set([src, tgt].sort().join(':'), rel.naming_id);
				}
			}
			const toAdd: Array<{ sourceId: string; targetId: string; valence: string; symmetric: boolean }> = [];
			const toRemove: string[] = [];
			const computedContains = new Set<string>();
			const computedOverlaps = new Set<string>();
			for (const { elementId, formationId } of computed.elementInFormation) {
				const key = `${formationId}:${elementId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: formationId, targetId: elementId, valence: 'contains', symmetric: false });
			}
			for (const { innerId, outerId } of computed.formationInFormation) {
				const key = `${outerId}:${innerId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: outerId, targetId: innerId, valence: 'contains', symmetric: false });
			}
			for (const { formationA, formationB } of computed.formationOverlaps) {
				const key = [formationA, formationB].sort().join(':'); computedOverlaps.add(key);
				if (!existingOverlaps.has(key)) toAdd.push({ sourceId: formationA, targetId: formationB, valence: 'overlaps', symmetric: true });
			}
			for (const [key, relId] of existingContains) { if (!computedContains.has(key)) toRemove.push(relId); }
			for (const [key, relId] of existingOverlaps) { if (!computedOverlaps.has(key)) toRemove.push(relId); }
			if (toAdd.length > 0 || toRemove.length > 0) {
				await ms.mapAction('syncSpatialRelations', { add: toAdd, remove: toRemove });
				await ms.reload();
			}
		} finally {
			spatialSyncPending = false;
			if (spatialSyncQueued) { spatialSyncQueued = false; syncSpatialRelations(); }
		}
	}

	// ─── Canvas interactions ───

	function handleNodeDragEnd(id: string, x: number, y: number) {
		positions = new Map(positions).set(id, { x, y });
		if (!centeredId) ms.mapAction('updatePosition', { namingId: id, x, y }).then(() => syncSpatialRelations());
	}

	function handleNodeClick(id: string, e: MouseEvent) {
		if (ms.relatingFrom) { ms.completeRelating(id); return; }
		if (ms.assigningToPhase) { ms.assignElement(ms.assigningToPhase, id); return; }
		selection.select(id, e.ctrlKey || e.metaKey);
		ctxMenuId = null;
	}

	let ctxMenuId = $state<string | null>(null);
	let ctxMenuPos = $state({ x: 0, y: 0 });

	function handleNodeContextMenu(id: string, e: MouseEvent) {
		selection.select(id);
		ctxMenuId = id;
		ctxMenuPos = { x: e.clientX, y: e.clientY };
	}

	function handleCanvasClick() {
		selection.clear();
		ctxMenuId = null;
		canvasCtxMenu = null;
		ms.highlightedPhase = null;
		if (ms.relatingFrom) ms.relatingFrom = null;
	}

	// Canvas-level context menu (right-click on empty space)
	let canvasCtxMenu = $state<{ x: number; y: number } | null>(null);

	function handleCanvasContextMenu(e: MouseEvent) {
		ctxMenuId = null;
		canvasCtxMenu = { x: e.clientX, y: e.clientY };
	}

	function ctxRename(id: string) {
		const node = ms.findNode(id);
		ms.editingId = id;
		ms.editingValue = node?.inscription || '';
	}

	// ─── Topology snapshots ───

	let topoSnapshots = $state<any[]>([]);
	let showTopoPanel = $state(false);

	function positionsToObj(): Record<string, { x: number; y: number }> {
		const obj: Record<string, { x: number; y: number }> = {};
		for (const [id, pos] of positions) obj[id] = { x: pos.x, y: pos.y };
		return obj;
	}

	async function saveTopologyBuffer() {
		if (positions.size === 0) return;
		await ms.mapAction('saveTopologyBuffer', { positions: positionsToObj() });
	}

	async function saveTopologySnapshot() {
		const label = prompt('Snapshot label:');
		if (label === null) return;
		await ms.mapAction('saveTopologySnapshot', { label: label || undefined, positions: positionsToObj() });
		await loadTopoSnapshots();
	}

	async function restoreTopologySnapshot(seq: number) {
		const result = await ms.mapAction('restoreTopologySnapshot', { seq });
		if (!result?.positions) { ms.showAiNotification('Restore failed'); return; }
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of Object.entries(result.positions as Record<string, { x: number; y: number }>)) {
			newPos.set(id, { x: pos.x, y: pos.y });
		}
		for (const [id, pos] of positions) { if (!newPos.has(id)) newPos.set(id, pos); }
		positions = newPos;
	}

	async function loadTopoSnapshots() {
		const res = await ms.mapAction('listTopologySnapshots');
		topoSnapshots = res?.snapshots || [];
	}

	function switchView(mode: 'list' | 'canvas') {
		if (viewMode === 'canvas' && mode !== 'canvas') saveTopologyBuffer();
		viewMode = mode;
	}

	// Auto-save topology buffer on page leave
	$effect(() => {
		function onBeforeUnload() {
			if (viewMode === 'canvas' && positions.size > 0) {
				navigator.sendBeacon(
					`/api/projects/${data.projectId}/maps/${data.map.id}`,
					new Blob([JSON.stringify({ action: 'saveTopologyBuffer', positions: positionsToObj() })], { type: 'application/json' })
				);
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	// Auto layout
	async function runAutoLayout() {
		centeredId = null; preRadialPositions = null;
		const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, p] of result.positions) newPos.set(id, { x: p.x, y: p.y });
		positions = newPos;
		await saveAllPositions(newPos);
	}

	// ─── SSE ───

	$effect(() => {
		const evtSource = new EventSource(`/api/projects/${data.projectId}/maps/${data.map.id}/events`);
		evtSource.addEventListener('message', (e) => {
			try {
				const event = JSON.parse(e.data);
				if (event.type === 'ai:memo') {
					const p = event.payload;
					ms.memoPanel = { id: p.memo?.id || '', title: p.title || '', content: p.content || '', linkedIds: p.linkedIds || [], authorId: p.authorId || '' };
					ms.reload();
				} else if (event.type?.startsWith('ai:')) {
					ms.showAiNotification(`AI: ${event.type.split(':')[1]}`);
					ms.reload().then(() => layoutNewNodes());
				}
			} catch { /* ignore */ }
		});
		return () => evtSource.close();
	});

	// layoutNewNodes is called explicitly after SSE and toolbar add actions.

	// ─── List grouping ───

	const groupedItems = $derived.by(() => {
		const items = ms.allItems.filter((n: any) => !ms.isHiddenByFilter(n));
		switch (listGroupBy) {
			case 'mode':
				return [
					{ label: 'Elements', items: items.filter((n: any) => n.mode === 'entity') },
					{ label: 'Relations', items: items.filter((n: any) => n.mode === 'relation') },
					{ label: 'Silences', items: items.filter((n: any) => n.mode === 'silence') }
				].filter(g => g.items.length > 0);
			case 'designation':
				return ['cue', 'characterization', 'specification'].map(d => ({
					label: d.charAt(0).toUpperCase() + d.slice(1) + 's',
					items: items.filter((n: any) => (n.designation || 'cue') === d)
				})).filter(g => g.items.length > 0);
			case 'phase': {
				const groups: Array<{ label: string; items: any[] }> = [];
				for (const phase of ms.phases) {
					groups.push({ label: phase.label, items: items.filter((n: any) => n.phase_ids?.includes(phase.id)) });
				}
				const assigned = new Set(ms.phases.flatMap((p: any) => items.filter((n: any) => n.phase_ids?.includes(p.id)).map((n: any) => n.naming_id)));
				const unassigned = items.filter((n: any) => !assigned.has(n.naming_id));
				if (unassigned.length > 0) groups.push({ label: 'Unassigned', items: unassigned });
				return groups.filter(g => g.items.length > 0);
			}
			case 'provenance':
				return [
					{ label: 'Empirically grounded', items: items.filter((n: any) => n.has_document_anchor) },
					{ label: 'Memo-linked', items: items.filter((n: any) => !n.has_document_anchor && n.has_memo_link) },
					{ label: 'Ungrounded', items: items.filter((n: any) => !n.has_document_anchor && !n.has_memo_link) }
				].filter(g => g.items.length > 0);
			case 'flat':
			default:
				return [{ label: '', items }];
		}
	});

	// ─── Keyboard ───

	let toolbarRef = $state<MapToolbar | null>(null);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (toolbarRef?.closeDropdowns()) return;
			ms.cancelRelation();
			ms.cancelAct();
			ms.cancelMemoCreate();
			selection.clear();
			ctxMenuId = null;
			canvasCtxMenu = null;
			ms.editingId = null;
			ms.assigningToPhase = null;
			ms.highlightedPhase = null;
		}
	}
</script>

<div class="map-page">
	<MapToolbar
		bind:this={toolbarRef}
		{viewMode}
		{displayMode}
		{centeredId}
		onswitchview={switchView}
		onsetdisplaymode={(mode) => { displayMode = mode; localStorage.setItem(`map:${data.map.id}:displayMode`, mode); }}
		onrunautolayout={runAutoLayout}
		onuncenter={uncenter}
		onopentopo={() => { showTopoPanel = !showTopoPanel; if (showTopoPanel) loadTopoSnapshots(); }}
	/>

	{#if showTopoPanel && viewMode === 'canvas'}
		<TopoPanel
			snapshots={topoSnapshots}
			onclose={() => showTopoPanel = false}
			onsave={saveTopologySnapshot}
			onrestore={restoreTopologySnapshot}
		/>
	{/if}

	{#if ms.relatingFrom && !ms.relatingTo}
		<div class="status-bar">
			Relating from: <strong>{ms.findInscription(ms.relatingFrom)}</strong> — click any node to connect
			<button class="btn-link" onclick={ms.cancelRelation}>cancel</button>
		</div>
	{/if}

	{#if ms.aiNotification}
		<div class="ai-notification">{ms.aiNotification}</div>
	{/if}

	<MemoPanel />
	<MemoCreateForm />
	<NamingActPrompt />
	<RelationForm />

	<div class="map-workspace">
		<!-- Canvas -->
		<div class="canvas-container" bind:this={canvasContainerEl} style="{viewMode !== 'canvas' ? 'display: none;' : ''}">
			<InfiniteCanvas {viewport} oncanvasclick={handleCanvasClick} oncanvascontextmenu={handleCanvasContextMenu}
				onreset={ms.mapType === 'positional' ? fitPosMap : undefined}>
				{#if displayMode === 'full'}
				{#each ms.relations.filter((r: any) => !r.properties?.spatiallyDerived) as rel}
					{@const srcId = rel.directed_from || rel.part_source_id}
					{@const tgtId = rel.directed_to || rel.part_target_id}
					{@const isDirected = !!(rel.directed_from && rel.directed_to)}
					{#if srcId && tgtId && ms.findNode(srcId) && ms.findNode(tgtId) && positions.has(srcId) && positions.has(tgtId)}
						{@const srcCenter = nodeCenter(srcId)}
						{@const tgtCenter = nodeCenter(tgtId)}
						{@const lineOpacity = ms.connectionOpacity(rel, ms.findNode(srcId), ms.findNode(tgtId))}
						<CanvasConnection
							x1={srcCenter.x} y1={srcCenter.y}
							x2={tgtCenter.x} y2={tgtCenter.y}
							color={ms.designationColor(rel.designation)}
							directed={isDirected}
							opacity={lineOpacity}
						/>
					{/if}
				{/each}
				{/if}

				<!-- Positional Map: axis overlay (L-shape from origin, Clarke convention) -->
				{#if ms.mapType === 'positional'}
					{@const AL = 1600}
					{@const OX = 40}
					{@const OY = AL + 40}
					{@const axisX = ms.axes.find((a: any) => a.properties?.axisDimension === 'x')}
					{@const axisY = ms.axes.find((a: any) => a.properties?.axisDimension === 'y')}
					<!-- Origin at canvas (0,0). X goes right, Y goes up (negative canvas-y). -->
					<svg class="pos-axis-overlay" style="position:absolute; left:-{OX}px; top:-{OY}px; width:{AL + OX * 2}px; height:{AL + OY}px; pointer-events:none; overflow:visible;">
						<!-- X axis: origin → right -->
						<line x1={OX} y1={OY} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + AL - 8} y1={OY - 5} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + AL - 8} y1={OY + 5} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<!-- Y axis: origin → up -->
						<line x1={OX} y1={OY} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX - 5} y1={OY - AL + 8} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + 5} y1={OY - AL + 8} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<!-- X axis gradient: --- near origin, +++ at end -->
						<text x={OX + 10} y={OY + 50} fill="#6b7280" font-size="36" font-family="monospace">- - -</text>
						<text x={OX + AL - 120} y={OY + 50} fill="#6b7280" font-size="36" font-family="monospace">+ + +</text>
						<!-- Y axis gradient: --- near origin, +++ at top -->
						<text x={OX - 20} y={OY - 14} fill="#6b7280" font-size="36" font-family="monospace" text-anchor="end">- - -</text>
						<text x={OX - 20} y={OY - AL + 40} fill="#6b7280" font-size="36" font-family="monospace" text-anchor="end">+ + +</text>
					</svg>
					<!-- Axis labels as interactive divs -->
					{#if axisX}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="pos-axis-label pos-axis-x" style="position:absolute; left:{AL / 2}px; top:38px; white-space:nowrap; transform:translateX(-50%);"
							onclick={() => { if (ms.editingId !== axisX.naming_id) { ms.editingId = axisX.naming_id; ms.editingValue = axisX.inscription; } }}>
							{#if ms.editingId === axisX.naming_id}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<form class="inline-rename" onclick={(e) => e.stopPropagation()} onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
									<input type="text" bind:value={ms.editingValue} style="width:360px; font-size:1.3rem;" />
									<button type="submit" class="btn-xs">ok</button>
								</form>
							{:else}
								{axisX.inscription}
							{/if}
						</div>
					{/if}
					{#if axisY}
						{#if ms.editingId === axisY.naming_id}
							<!-- Y-axis edit form: horizontal, floated left of axis -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<form class="inline-rename" style="position:absolute; left:-420px; top:{-AL / 2 - 20}px; white-space:nowrap;"
								onclick={(e) => e.stopPropagation()} onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
								<input type="text" bind:value={ms.editingValue} style="width:360px; font-size:28px;" />
								<button type="submit" class="btn-xs">ok</button>
								<button type="button" class="btn-xs" onclick={() => ms.editingId = null}>×</button>
							</form>
						{:else}
							<!-- Y-axis label: vertical text via writing-mode, no rotation math -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="pos-axis-label pos-axis-y"
								style="position:absolute; left:-80px; top:{-AL}px; height:{AL}px; writing-mode:vertical-rl; transform:rotate(180deg); display:flex; align-items:center; justify-content:center;"
								onclick={() => { ms.editingId = axisY.naming_id; ms.editingValue = axisY.inscription; }}>
								{axisY.inscription}
							</div>
						{/if}
					{/if}
				{/if}

				<!-- Element nodes (hidden in 'relations' mode) -->
				{#each ms.elements as el}
					{@const pos = positions.get(el.naming_id)}
					{#if pos && !ms.isHiddenByFilter(el) && displayMode !== 'relations'}
						<CanvasElement
							id={el.naming_id}
							x={pos.x} y={pos.y}
							color={ms.designationColor(el.designation)}
							selected={selection.isSelected(el.naming_id)}
							zoom={viewport.zoom}
							ondragend={handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							{#if ms.mapType === 'social-worlds' && el.sw_role}
								<FormationNode
									label={el.inscription}
									swRole={el.sw_role}
									designation={el.designation}
									color={ms.designationColor(el.designation)}
									memoCount={el.memo_previews?.length || 0}
									rx={el.properties?.rx || 150}
									ry={el.properties?.ry || 100}
									rotation={el.properties?.rotation || 0}
									selected={selection.isSelected(el.naming_id)}
									withdrawn={ms.isWithdrawn(el.properties)}
									zoom={viewport.zoom}
									onresizeend={async (newRx, newRy) => {
										await ms.mapAction('updateProperties', { namingId: el.naming_id, properties: { rx: newRx, ry: newRy } });
										await ms.reload(); syncSpatialRelations();
									}}
									onrotateend={async (newRotation) => {
										await ms.mapAction('updateProperties', { namingId: el.naming_id, properties: { rotation: newRotation } });
										await ms.reload(); syncSpatialRelations();
									}}
								/>
							{:else}
							<div class="map-node" class:absent={el.properties?.absent} class:ai-suggested={el.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(el.properties)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(el)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(el)} class:centered-dim={centeredConnections && !centeredConnections.has(el.naming_id)} class:centered-anchor={centeredId === el.naming_id}
								style="{ms.highlightedPhase && ms.isPhaseHighlighted(el) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}">
								<div class="node-header">
									<span class="designation-dot" style="background: {ms.designationColor(el.designation)}"></span>
									{#if el.has_document_anchor}
										<img class="prov-icon" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
									{:else if el.has_memo_link}
										<img class="prov-icon" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
									{:else}
										<img class="prov-icon" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding" />
									{/if}
									<span class="node-designation">{ms.designationLabel(el.designation)}</span>
									{#if el.memo_previews?.length > 0}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span class="memo-badge" title="{el.memo_previews.length} memo(s)" onclick={(e) => { e.stopPropagation(); ms.showStack(el.naming_id); }}>
											{el.memo_previews.length}
										</span>
									{/if}
									{#if el.phase_ids?.length}
										<span class="phase-dots">
											{#each el.phase_ids as pid}
												{@const c = ms.phaseColorMap.get(pid)}
												{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === pid)?.label}></span>{/if}
											{/each}
										</span>
									{/if}
								</div>
								{#if ms.editingId === el.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); ms.confirmRename(); }}>
										<input type="text" bind:value={ms.editingValue} />
										<button type="submit" class="btn-xs">ok</button>
									</form>
								{:else}
									<span class="node-label">{el.inscription}</span>
								{/if}
								{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
									<span class="collapsed-hint">now: {el.current_inscription}</span>
								{/if}
								{#if el.memo_previews?.length}
									<div class="memo-tooltip">
										{#each el.memo_previews.slice(0, 4) as mp}
											<div class="memo-tip-entry">
												<div class="memo-tip-header">
													<span class="memo-tip-provenance" class:tip-ai={mp.isAi}>{mp.isAi ? 'AI' : 'R'}</span>
													<span class="memo-tip-label">{mp.label}</span>
													{#if mp.status && mp.status !== 'active'}
														<span class="memo-tip-status tip-status-{mp.status}">{mp.status}</span>
													{/if}
												</div>
												{#if mp.content}<span class="memo-tip-content">{mp.content.slice(0, 150)}{mp.content.length > 150 ? '…' : ''}</span>{/if}
											</div>
										{/each}
										{#if el.memo_previews.length > 4}
											<span class="memo-tip-more">+{el.memo_previews.length - 4} more</span>
										{/if}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span class="memo-tip-open" onclick={(e) => { e.stopPropagation(); ms.showStack(el.naming_id); }}>open stack</span>
									</div>
								{/if}
							</div>
							{/if}
						</CanvasElement>
					{/if}
				{/each}

				<!-- Relation nodes as inline diamonds (hidden in 'entities' mode) — skip spatially derived -->
				{#if displayMode !== 'entities'}
				{#each ms.relations.filter((r: any) => !r.properties?.spatiallyDerived) as rel}
					{@const pos = positions.get(rel.naming_id)}
					{#if pos && !ms.isHiddenByFilter(rel)}
						<CanvasElement
							id={rel.naming_id}
							x={pos.x} y={pos.y}
							color={ms.designationColor(rel.designation)}
							selected={selection.isSelected(rel.naming_id)}
							zoom={viewport.zoom}
							ondragend={handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="relation-diamond" class:ai-suggested={rel.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(rel.properties)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(rel)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(rel)} class:centered-dim={centeredConnections && !centeredConnections.has(rel.naming_id)} class:centered-anchor={centeredId === rel.naming_id}
								style="{ms.highlightedPhase && ms.isPhaseHighlighted(rel) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}">
								<svg class="diamond-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
									<polygon points="12,0 88,0 100,50 88,100 12,100 0,50" fill="#161822" stroke="#2a2d3a" stroke-width="1.5"/>
								</svg>
								<div class="diamond-content">
									{#if rel.valence}<span class="rd-valence">{rel.valence}</span>{/if}
									{#if rel.inscription}
										<span class="rd-text">{rel.inscription}</span>
									{:else}
										<span class="rd-text unnamed">
											{ms.findInscription(rel.directed_from || rel.part_source_id)} → {ms.findInscription(rel.directed_to || rel.part_target_id)}
										</span>
									{/if}
								</div>
							</div>
						</CanvasElement>
					{/if}
				{/each}
				{/if}

				{#each ms.silences as s}
					{@const pos = positions.get(s.naming_id)}
					{#if pos && !ms.isHiddenByFilter(s)}
						<CanvasElement
							id={s.naming_id}
							x={pos.x} y={pos.y}
							color="#4b5563"
							selected={selection.isSelected(s.naming_id)}
							zoom={viewport.zoom}
							ondragend={handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="map-node silence-node" class:phase-dimmed={ms.highlightedPhase} class:centered-dim={centeredConnections && !centeredConnections.has(s.naming_id)}>
								<span class="node-label">{s.inscription}</span>
							</div>
						</CanvasElement>
					{/if}
				{/each}
			</InfiniteCanvas>

			{#if ctxMenuId}
				<ContextMenu
					namingId={ctxMenuId}
					position={ctxMenuPos}
					onclose={() => ctxMenuId = null}
					oncenter={centerOn}
					onrename={ctxRename}
				/>
			{/if}

			{#if canvasCtxMenu}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="canvas-context-menu" style="left: {canvasCtxMenu.x}px; top: {canvasCtxMenu.y}px;"
					onclick={(e) => e.stopPropagation()}>
					<div class="ctx-header">{ms.mapLabel}</div>
					<button class="ctx-item" onclick={() => { ms.openMemoCreate([ms.mapId]); canvasCtxMenu = null; }}>Write memo (this map)</button>
					<button class="ctx-item" onclick={() => { ms.openMemoCreate([]); canvasCtxMenu = null; }}>Write free memo</button>
				</div>
			{/if}

			{#if ms.stackId}
				<StackPanel mode="floating" />
			{/if}
		</div>

		<!-- List view -->
		<div class="main-area" style="{viewMode !== 'list' ? 'display: none;' : ''}">
			<div class="list-grouping-bar">
				<span class="grouping-label">Group by</span>
				<select class="grouping-select" value={listGroupBy} onchange={e => { listGroupBy = (e.target as HTMLSelectElement).value as typeof listGroupBy; localStorage.setItem(`map:${data.map.id}:listGroupBy`, listGroupBy); }}>
					<option value="mode">Mode (entity / relation / silence)</option>
					<option value="designation">Designation (cue / char / spec)</option>
					<option value="phase">Phase</option>
					<option value="provenance">Provenance</option>
					<option value="flat">Flat (all mixed)</option>
				</select>
			</div>
			{#if ms.allItems.length === 0}
				<p class="empty">Name what is in the situation. Everything is a cue at first.</p>
			{:else}
				{#each groupedItems as group}
					{#if group.label}
						<h3 class="section-header">{group.label}</h3>
					{/if}
					<div class="element-list">
						{#each group.items as item}
							<ListItemCard {item} {listGroupBy} />
							{#if ms.stackId === item.naming_id && ms.stackData}
								<StackPanel mode="inline" {item} />
							{/if}
							{#if ms.outsideId === item.naming_id}
								<OutsidePanel />
							{/if}
						{/each}
					</div>
				{/each}
			{/if}
		</div>

		<PhasesSidebar {selection} />
	</div>
</div>

<svelte:window onkeydown={handleKeydown} />

<style>
	.map-page {
		display: flex; flex-direction: column;
		height: calc(100vh - 6rem); margin: -2rem;
	}

	/* Status bar */
	.status-bar {
		background: #1e2030; border-bottom: 1px solid #2a2d3a;
		padding: 0.4rem 1rem; font-size: 0.85rem; color: #c9cdd5;
	}

	/* Workspace */
	.map-workspace { display: flex; flex: 1; min-height: 0; }
	.canvas-container { flex: 1; position: relative; overflow: hidden; }

	/* List view */
	.main-area { flex: 1; padding: 1.25rem; overflow-y: auto; }
	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
	.list-grouping-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
	.grouping-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
	.grouping-select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.2rem 0.4rem; cursor: pointer;
	}
	.grouping-select:focus { outline: none; border-color: #8b9cf7; }
	.section-header {
		font-size: 0.75rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.05em; margin: 1.5rem 0 0.5rem;
	}
	.element-list { display: flex; flex-direction: column; gap: 0.35rem; }

	/* AI notification */
	.ai-notification {
		position: fixed; bottom: 1.5rem; right: 240px; z-index: 100;
		background: #1e2030; border: 1px solid #8b9cf7; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.8rem; color: #c9cdd5;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	/* Canvas map nodes */
	.map-node {
		position: relative; background: #161822;
		border: 2px solid var(--el-color, #8b9cf7); border-radius: 8px;
		padding: 0.4rem 0.6rem; min-width: 80px; max-width: 220px;
	}

	/* Absent position modifier (positional maps) */
	.map-node.absent {
		border-style: dashed; border-color: #4b5563;
		background: rgba(22, 24, 34, 0.6); opacity: 0.7;
	}
	.map-node.absent .node-label { color: #6b7280; font-style: italic; }

	/* Positional Map axis labels */
	.pos-axis-label {
		font-size: 28px; color: #8b8fa3; cursor: pointer;
		padding: 0.3rem 0.6rem; border-radius: 4px; font-weight: 500;
	}
	.pos-axis-label:hover { color: #e1e4e8; background: rgba(139, 156, 247, 0.1); }
	.memo-badge {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 4px; min-width: 16px; height: 16px; line-height: 16px;
		text-align: center; cursor: pointer; flex-shrink: 0; margin-left: auto;
	}
	.memo-badge:hover { background: rgba(245, 158, 11, 0.25); }
	.memo-tooltip {
		display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
		min-width: 280px; max-width: 320px;
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem; z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
	}
	.map-node:hover > .memo-tooltip { display: block; }
	.memo-tip-entry { padding: 0.25rem 0; border-bottom: 1px solid #161822; }
	.memo-tip-entry:last-child { border-bottom: none; }
	.memo-tip-header { display: flex; align-items: center; gap: 0.3rem; }
	.memo-tip-provenance {
		font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0;
	}
	.memo-tip-provenance.tip-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-tip-label { font-size: 0.7rem; color: #f59e0b; }
	.memo-tip-status {
		font-size: 0.55rem; font-weight: 600; text-transform: uppercase;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0; margin-left: auto;
	}
	.tip-status-presented { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.tip-status-discussed { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.tip-status-acknowledged { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.tip-status-dismissed { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-tip-content { font-size: 0.75rem; color: #a0a4b0; display: block; margin-top: 0.1rem; }
	.memo-tip-more { font-size: 0.7rem; color: #6b7280; margin-top: 0.2rem; display: block; }
	.memo-tip-open {
		font-size: 0.68rem; color: #8b9cf7; cursor: pointer; display: block;
		margin-top: 0.3rem; padding-top: 0.2rem; border-top: 1px solid #2a2d3a;
	}
	.memo-tip-open:hover { text-decoration: underline; }

	/* Canvas context menu (empty space right-click) */
	.canvas-context-menu {
		position: fixed; z-index: 200;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.35rem 0; min-width: 180px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.canvas-context-menu .ctx-header {
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #6b7280;
		border-bottom: 1px solid #2a2d3a; margin-bottom: 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.canvas-context-menu .ctx-item {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.canvas-context-menu .ctx-item:hover { background: #2a2d3a; }
	.map-node.ai-suggested { border-style: dashed; border-color: rgba(139, 156, 247, 0.5); background: rgba(139, 156, 247, 0.04); }
	.map-node.ai-withdrawn { opacity: 0.3; border-color: rgba(139, 156, 247, 0.2); }
	.map-node.phase-dimmed { opacity: 0.85; transition: opacity 0.3s; }
	.map-node.centered-dim { opacity: 0.35; transition: opacity 0.3s; }
	.map-node.centered-anchor { box-shadow: 0 0 12px rgba(245, 158, 11, 0.6), 0 0 4px rgba(245, 158, 11, 0.3); }
	.map-node.phase-member { animation: phase-pulse 2s ease-in-out infinite; --pulse-color: var(--phase-color, #8b9cf7); }
	@keyframes phase-pulse {
		0%, 100% { box-shadow: 0 0 6px var(--pulse-color); }
		50% { box-shadow: 0 0 20px var(--pulse-color), inset 0 0 0 2px var(--pulse-color); }
	}
	.node-header { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.15rem; }
	.designation-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.prov-icon { width: 12px; height: 12px; opacity: 0.5; }
	.node-designation { font-size: 0.6rem; color: var(--el-color); text-transform: uppercase; letter-spacing: 0.04em; }
	.phase-dots { display: inline-flex; gap: 2px; margin-left: auto; }
	.phase-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
	.node-label { font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block; }
	.collapsed-hint { font-size: 0.65rem; color: #4b5563; font-style: italic; }

	/* Relation diamond */
	.relation-diamond {
		position: relative; min-width: 90px; max-width: 200px; min-height: 36px;
		display: flex; align-items: center; justify-content: center; text-align: center;
	}
	.diamond-bg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.diamond-content { position: relative; z-index: 1; padding: 0.3rem 1.2rem; display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
	.relation-diamond.ai-suggested .diamond-bg polygon { fill: #1a1d2e; }
	.relation-diamond.ai-withdrawn { opacity: 0.3; }
	.relation-diamond.phase-member { filter: drop-shadow(0 0 3px var(--phase-color)); }
	.relation-diamond.phase-dimmed { opacity: 0.25; }
	.relation-diamond.centered-dim { opacity: 0.15; }
	.relation-diamond.centered-anchor .diamond-bg polygon { stroke: #f59e0b; }
	.rd-valence { font-size: 0.65rem; color: #8b8fa3; font-style: italic; }
	.rd-text { color: #c9cdd5; font-size: 0.75rem; }
	.rd-text.unnamed { color: #4b5563; font-size: 0.65rem; font-style: italic; }

	/* Silence nodes */
	.silence-node { border-style: dashed; border-color: #4b5563; opacity: 0.7; background: #0f1117; }

	/* Inline rename */
	.inline-rename { display: flex; gap: 0.3rem; align-items: center; }
	.inline-rename input {
		background: #0f1117; border: 1px solid #8b9cf7; border-radius: 4px;
		padding: 0.15rem 0.35rem; color: #e1e4e8; font-size: 0.85rem; width: 140px;
	}

	/* Shared buttons */
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
