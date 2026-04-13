<script lang="ts">
	import InfiniteCanvas from '$lib/canvas/InfiniteCanvas.svelte';
	import CanvasElement from '$lib/canvas/CanvasElement.svelte';
	import CanvasConnection from '$lib/canvas/CanvasConnection.svelte';
	import { createViewport } from '$lib/canvas/viewport.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import FormationNode from '$lib/canvas/FormationNode.svelte';

	import { createMapState, setMapState } from '$lib/map/mapState.svelte.js';
	import { createCanvasPositions } from '$lib/map/canvasPositions.svelte.js';
	import MapToolbar from '$lib/map/MapToolbar.svelte';
	import TopoPanel from '$lib/map/TopoPanel.svelte';
	import MemoPanel from '$lib/map/MemoPanel.svelte';
	import NamingActPrompt from '$lib/map/NamingActPrompt.svelte';
	import RelationForm from '$lib/map/RelationForm.svelte';
	import StackPanel from '$lib/map/StackPanel.svelte';
	import ContextMenu from '$lib/map/ContextMenu.svelte';
	import ClustersSidebar from '$lib/map/ClustersSidebar.svelte';
	import ListItemCard from '$lib/map/ListItemCard.svelte';
	import OutsidePanel from '$lib/map/OutsidePanel.svelte';
	import MemoCreateForm from '$lib/map/MemoCreateForm.svelte';
	import CanvasMapNode from '$lib/map/CanvasMapNode.svelte';
	import CanvasRelationNode from '$lib/map/CanvasRelationNode.svelte';

	let { data } = $props();

	const viewport = createViewport();
	const selection = createSelection();
	const ms = createMapState(data, viewport);
	setMapState(ms);
	const cp = createCanvasPositions(ms, viewport);

	// Sync data from server when props change
	$effect(() => { ms.syncData(data); });

	let viewMode = $state<'canvas' | 'list'>('canvas');
	let canvasContainerEl = $state<HTMLDivElement | null>(null);
	let posMapFitted = false;

	// Fit positional map: origin at bottom-left, zoom to show full axis extent
	function fitPosMap() {
		if (!canvasContainerEl) return;
		const w = canvasContainerEl.clientWidth;
		const h = canvasContainerEl.clientHeight;
		if (w <= 0 || h <= 0) return;
		viewport.fitBounds(
			{ minX: -100, minY: -cp.POS_AXIS_LEN - 40, maxX: cp.POS_AXIS_LEN + 40, maxY: 80 },
			w, h, 30
		);
	}

	// Auto-fit when switching to canvas view on positional maps
	$effect(() => {
		if (ms.mapType !== 'positional' || viewMode !== 'canvas' || !canvasContainerEl) return;
		if (!posMapFitted) {
			requestAnimationFrame(() => { fitPosMap(); posMapFitted = true; });
		}
	});

	let displayMode = $state<'entities' | 'relations' | 'full'>('full');
	let listGroupBy = $state<'mode' | 'designation' | 'cluster' | 'provenance' | 'flat'>('mode');

	// Restore preferences from localStorage
	$effect(() => {
		const mapId = data.map.id;
		const savedMode = localStorage.getItem(`map:${mapId}:displayMode`);
		if (savedMode === 'entities' || savedMode === 'relations' || savedMode === 'full') displayMode = savedMode;
		const savedGroup = localStorage.getItem(`map:${mapId}:listGroupBy`);
		if (savedGroup) listGroupBy = savedGroup as typeof listGroupBy;
	});

	// ─── Position init (reset on map navigation) ───

	$effect(() => {
		cp.initIfNeeded(data.map.id);
		posMapFitted = false; // reset fit-to-viewport for new map
	});

	// ─── Canvas interactions ───

	function handleNodeClick(id: string, e: MouseEvent) {
		if (ms.relatingFrom) { ms.completeRelating(id); return; }
		if (ms.assigningToCluster) { ms.assignToCluster(ms.assigningToCluster, id); return; }
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
		ms.highlightedCluster = null;
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

	async function refreshSnapshots() {
		topoSnapshots = await cp.loadTopoSnapshots();
	}

	// Eager load so the toolbar can show the snapshot count
	$effect(() => {
		void data.map.id;
		refreshSnapshots();
	});

	async function openTopoPanel() {
		showTopoPanel = !showTopoPanel;
		if (showTopoPanel) await refreshSnapshots();
	}

	async function handleTopoRestore(seq: number) {
		await cp.restoreTopologySnapshot(seq);
	}

	async function handleTopoSave() {
		await cp.saveTopologySnapshot();
		await refreshSnapshots();
	}

	async function runAutoLayoutWithRefresh() {
		await cp.runAutoLayout();
		await refreshSnapshots();
	}

	function switchView(mode: 'list' | 'canvas') {
		if (viewMode === 'canvas' && mode !== 'canvas') cp.saveTopologyBuffer();
		viewMode = mode;
	}

	// Auto-save topology buffer on page leave
	$effect(() => {
		function onBeforeUnload() {
			if (viewMode === 'canvas' && cp.positions.size > 0) {
				navigator.sendBeacon(
					`/api/projects/${data.projectId}/maps/${data.map.id}`,
					new Blob([JSON.stringify({ action: 'saveTopologyBuffer', positions: cp.positionsToObj() })], { type: 'application/json' })
				);
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

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
					ms.reload().then(() => cp.layoutNewNodes());
				}
			} catch { /* ignore */ }
		});
		return () => evtSource.close();
	});

	// ─── List grouping ───

	const groupedItems = $derived.by(() => {
		const items = ms.allItems.filter((n: any) => !ms.isHiddenByFilter(n)).filter((n: any) => ms.filterItem(n));
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
			case 'cluster': {
				const groups: Array<{ label: string; items: any[] }> = [];
				for (const cluster of ms.clusters) {
					groups.push({ label: cluster.label, items: items.filter((n: any) => n.cluster_ids?.includes(cluster.id)) });
				}
				const assigned = new Set(ms.clusters.flatMap((c: any) => items.filter((n: any) => n.cluster_ids?.includes(c.id)).map((n: any) => n.naming_id)));
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
			ms.assigningToCluster = null;
			ms.highlightedCluster = null;
		}
	}
</script>

<div class="map-page">
	<MapToolbar
		bind:this={toolbarRef}
		{viewMode}
		{displayMode}
		centeredId={cp.centeredId}
		snapshotCount={topoSnapshots.length}
		onswitchview={switchView}
		onsetdisplaymode={(mode) => { displayMode = mode; localStorage.setItem(`map:${data.map.id}:displayMode`, mode); }}
		onrunautolayout={runAutoLayoutWithRefresh}
		onuncenter={cp.uncenter}
		onopentopo={openTopoPanel}
	/>

	{#if showTopoPanel && viewMode === 'canvas'}
		<TopoPanel
			snapshots={topoSnapshots}
			onclose={() => showTopoPanel = false}
			onsave={handleTopoSave}
			onrestore={handleTopoRestore}
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
					{#if srcId && tgtId && ms.findNode(srcId) && ms.findNode(tgtId) && cp.positions.has(srcId) && cp.positions.has(tgtId)}
						{@const srcCenter = cp.nodeCenter(srcId)}
						{@const tgtCenter = cp.nodeCenter(tgtId)}
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
					{@const AL = cp.POS_AXIS_LEN}
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
						<text x={OX + 6} y={OY + 24} fill="#6b7280" font-size="16" font-family="monospace">- - -</text>
						<text x={OX + AL - 60} y={OY + 24} fill="#6b7280" font-size="16" font-family="monospace">+ + +</text>
						<!-- Y axis gradient: --- near origin, +++ at top -->
						<text x={OX - 10} y={OY - 8} fill="#6b7280" font-size="16" font-family="monospace" text-anchor="end">- - -</text>
						<text x={OX - 10} y={OY - AL + 18} fill="#6b7280" font-size="16" font-family="monospace" text-anchor="end">+ + +</text>
					</svg>
					<!-- Axis labels: click opens standard NamingActPrompt rename dialog -->
					{#if axisX}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="pos-axis-label pos-axis-x" style="position:absolute; left:{AL / 2}px; top:28px; white-space:nowrap; transform:translateX(-50%);"
							ondblclick={() => { ms.editingId = axisX.naming_id; ms.editingValue = axisX.inscription; }}>
							{axisX.inscription}
						</div>
					{/if}
					{#if axisY}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="pos-axis-label pos-axis-y"
							style="position:absolute; left:-50px; top:{-AL}px; height:{AL}px; writing-mode:vertical-rl; transform:rotate(180deg); display:flex; align-items:center; justify-content:center;"
							ondblclick={() => { ms.editingId = axisY.naming_id; ms.editingValue = axisY.inscription; }}>
							{axisY.inscription}
						</div>
					{/if}
				{/if}

				<!-- Element nodes (hidden in 'relations' mode) -->
				{#each ms.elements as el}
					{@const pos = cp.positions.get(el.naming_id)}
					{#if pos && !ms.isHiddenByFilter(el) && displayMode !== 'relations'}
						<CanvasElement
							id={el.naming_id}
							x={pos.x} y={pos.y}
							color={ms.designationColor(el.designation)}
							selected={selection.isSelected(el.naming_id)}
							zoom={viewport.zoom}
							ondragend={cp.handleNodeDragEnd}
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
									onresizeend={(newRx, newRy) => cp.handleFormationResize(el.naming_id, newRx, newRy)}
									onrotateend={(newRotation) => cp.handleFormationRotate(el.naming_id, newRotation)}
								/>
							{:else}
								<CanvasMapNode {el} {cp} />
							{/if}
						</CanvasElement>
					{/if}
				{/each}

				<!-- Relation nodes as inline diamonds (hidden in 'entities' mode) — skip spatially derived.
				     The diamond sits at the live midpoint of source/target so it stays glued to
				     the connection line; it is not independently draggable. -->
				{#if displayMode !== 'entities'}
				{#each ms.relations.filter((r: any) => !r.properties?.spatiallyDerived) as rel}
					{@const relSrcId = rel.directed_from || rel.part_source_id}
					{@const relTgtId = rel.directed_to || rel.part_target_id}
					{#if relSrcId && relTgtId && cp.positions.has(relSrcId) && cp.positions.has(relTgtId) && !ms.isHiddenByFilter(rel)}
						{@const sc = cp.nodeCenter(relSrcId)}
						{@const tc = cp.nodeCenter(relTgtId)}
						<CanvasElement
							id={rel.naming_id}
							x={(sc.x + tc.x) / 2} y={(sc.y + tc.y) / 2}
							color={ms.designationColor(rel.designation)}
							selected={selection.isSelected(rel.naming_id)}
							zoom={viewport.zoom}
							draggable={false}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<CanvasRelationNode {rel} {cp} />
						</CanvasElement>
					{/if}
				{/each}
				{/if}

				{#each ms.silences as s}
					{@const pos = cp.positions.get(s.naming_id)}
					{#if pos && !ms.isHiddenByFilter(s)}
						<CanvasElement
							id={s.naming_id}
							x={pos.x} y={pos.y}
							color="#4b5563"
							selected={selection.isSelected(s.naming_id)}
							zoom={viewport.zoom}
							ondragend={cp.handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="silence-node" class:cluster-dimmed={ms.highlightedCluster} class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(s.naming_id)}>
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
					oncenter={cp.centerOn}
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
					<option value="cluster">Cluster</option>
					<option value="provenance">Provenance</option>
					<option value="flat">Flat (all mixed)</option>
				</select>
				{#if ms.isPrimary}
					<select class="grouping-select" value={ms.listFilter} onchange={e => ms.listFilter = (e.target as HTMLSelectElement).value as any}>
						<option value="all">All</option>
						<option value="placed">Placed</option>
						<option value="unresolved">Unresolved</option>
						<option value="declined">Declined</option>
					</select>
				{/if}
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

		<ClustersSidebar {selection} />
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

	/* Positional Map axis labels */
	.pos-axis-label {
		font-size: 14px; color: #8b8fa3; cursor: pointer;
		padding: 0.2rem 0.4rem; border-radius: 4px; font-weight: 500;
	}
	.pos-axis-label:hover { color: #e1e4e8; background: rgba(139, 156, 247, 0.1); }

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

	/* Silence nodes (canvas) */
	.silence-node {
		position: relative; background: #0f1117;
		border: 2px dashed #4b5563; border-radius: 8px;
		padding: 0.4rem 0.6rem; min-width: 80px; max-width: 220px;
		opacity: 0.7;
	}
	.silence-node.cluster-dimmed { opacity: 0.85; transition: opacity 0.3s; }
	.silence-node.centered-dim { opacity: 0.35; transition: opacity 0.3s; }
	.node-label { font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block; }

	/* Shared buttons */
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
