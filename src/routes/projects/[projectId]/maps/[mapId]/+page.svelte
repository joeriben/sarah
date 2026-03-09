<script lang="ts">
	import { untrack } from 'svelte';
	import InfiniteCanvas from '$lib/canvas/InfiniteCanvas.svelte';
	import CanvasElement from '$lib/canvas/CanvasElement.svelte';
	import CanvasConnection from '$lib/canvas/CanvasConnection.svelte';
	import { createViewport } from '$lib/canvas/viewport.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import { computeLayout } from '$lib/canvas/layout.js';
	import { regionColor } from '$lib/canvas/regions.js';

	let { data } = $props();

	let elements = $state(untrack(() => data.elements));
	let relations = $state(untrack(() => data.relations));
	let silences = $state(untrack(() => data.silences));
	let phases = $state(untrack(() => data.phases));
	let designationProfile = $state(untrack(() => data.designationProfile));

	$effect(() => {
		elements = data.elements;
		relations = data.relations;
		silences = data.silences;
		phases = data.phases;
		designationProfile = data.designationProfile;
	});

	const viewport = createViewport();
	const selection = createSelection();

	let viewMode = $state<'canvas' | 'list'>('list');

	// Positions: naming_id → {x, y}
	let positions = $state<Map<string, { x: number; y: number }>>(new Map());
	let layoutInitialized = false;

	// Initialize positions once on load
	$effect(() => {
		if (layoutInitialized) return;
		const allNodes = [...elements, ...relations, ...silences];
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
			} else {
				needsLayout = true;
			}
		}

		if (needsLayout) {
			const result = await computeLayout(elements, relations, silences);
			const merged = new Map(stored);
			for (const [id, p] of result.positions) {
				if (!merged.has(id)) {
					merged.set(id, { x: p.x, y: p.y });
				}
			}
			positions = merged;
			await saveAllPositions(merged);
		} else {
			positions = stored;
		}
	}

	// Layout unpositioned nodes (e.g. after adding a new element)
	async function layoutNewNodes() {
		const unpositioned = [...elements, ...relations, ...silences]
			.filter(n => !positions.has(n.naming_id));
		if (unpositioned.length === 0) return;

		const result = await computeLayout(
			[...elements],
			[...relations],
			[...silences]
		);
		const merged = new Map(positions);
		for (const [id, p] of result.positions) {
			if (!merged.has(id)) {
				merged.set(id, { x: p.x, y: p.y });
			}
		}
		positions = merged;
		await saveAllPositions(merged);
	}

	// Withdrawn check: works for both AI-withdrawn and researcher-withdrawn
	function isWithdrawn(props: any): boolean {
		return props?.withdrawn === true || props?.aiWithdrawn === true;
	}

	// Interaction state
	let relatingFrom = $state<string | null>(null);
	let newInscription = $state('');
	let adding = $state(false);
	let newPhaseLabel = $state('');
	let showPhaseForm = $state(false);
	let assigningToPhase = $state<string | null>(null);
	let expandedPhase = $state<string | null>(null);
	let phaseContents = $state<any[]>([]);

	// Context menu
	let ctxMenuId = $state<string | null>(null);
	let ctxMenuPos = $state({ x: 0, y: 0 });

	// Naming act prompt
	let actTarget = $state<string | null>(null);
	let actType = $state<'rename' | 'designate' | 'relate'>('rename');
	let actNewValue = $state('');
	let actMemo = $state('');
	let actLinkedIds = $state<string[]>([]);
	let showActLinks = $state(false);
	let actExistingMemos = $state<any[]>([]);

	// Inline editing
	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	// Relation form
	let relInscription = $state('');
	let relValence = $state('');
	let relDirected = $state(true);

	// Stack panel
	let stackId = $state<string | null>(null);
	let stackData = $state<{
		inscriptions: any[]; designations: any[]; memos: any[];
		discussion?: any[]; aiReasoning?: string | null; aiSuggested?: boolean; aiWithdrawn?: boolean;
	} | null>(null);

	// Cue discussion
	let discussInput = $state('');
	let discussLoading = $state(false);

	// AI
	let aiEnabled = $state(true);
	let aiNotification = $state<string | null>(null);
	let aiNotificationTimeout: ReturnType<typeof setTimeout> | undefined;

	// SSE
	$effect(() => {
		const evtSource = new EventSource(`/api/projects/${data.projectId}/maps/${data.map.id}/events`);
		evtSource.addEventListener('message', (e) => {
			try {
				const event = JSON.parse(e.data);
				if (event.type?.startsWith('ai:')) {
					showAiNotification(`AI: ${event.type.split(':')[1]}`);
					reload();
				}
			} catch { /* ignore */ }
		});
		return () => evtSource.close();
	});

	const mapType = $derived(data.map.properties?.mapType || 'situational');

	// ─── Phase highlight filter ───

	const DECLINED_PHASE = '__declined__';
	let highlightedPhase = $state<string | null>(null);
	const isDeclinedFilter = $derived(highlightedPhase === DECLINED_PHASE);

	// Build a lookup: phaseId → color (for consistent coloring)
	const phaseColorMap = $derived(
		new Map(phases.map((p: any, i: number) => [p.id, regionColor(i)]))
	);

	// Count declined items for the virtual phase
	const declinedCount = $derived(
		[...elements, ...relations, ...silences].filter((n: any) => isWithdrawn(n.properties)).length
	);

	// Check if a node is a member of the highlighted phase
	function isPhaseHighlighted(node: any): boolean {
		if (!highlightedPhase) return false;
		return node.phase_ids?.includes(highlightedPhase) ?? false;
	}

	// Should a node be hidden? (declined filter active + node is declined)
	function isHiddenByFilter(node: any): boolean {
		return isDeclinedFilter && isWithdrawn(node.properties);
	}

	// Connection line opacity: declined relations and their endpoints get dimmed
	function connectionOpacity(rel: any, srcNode: any, tgtNode: any): number {
		if (isDeclinedFilter && isWithdrawn(rel.properties)) return 0;
		if (isDeclinedFilter && (isWithdrawn(srcNode?.properties) || isWithdrawn(tgtNode?.properties))) return 0;
		if (isWithdrawn(rel.properties)) return 0.2;
		return 1;
	}


	// ─── Helpers ───

	function designationColor(d: string | undefined) {
		if (d === 'specification') return '#10b981';
		if (d === 'characterization') return '#f59e0b';
		return '#6b7280';
	}

	function designationLabel(d: string | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	function findNode(namingId: string) {
		return [...elements, ...relations, ...silences].find((n: any) => n.naming_id === namingId);
	}

	function findInscription(namingId: string): string {
		if (!namingId) return '?';
		const node = findNode(namingId);
		if (!node) return '?';
		if (node.inscription) return node.inscription;
		if (node.mode === 'relation') {
			const src = findInscription(node.directed_from || node.part_source_id);
			const tgt = findInscription(node.directed_to || node.part_target_id);
			return `(${src} -> ${tgt})`;
		}
		return '?';
	}

	// Width estimation — must match layout.ts estimateWidth
	function estimateNodeWidth(node: any): number {
		if (!node) return 100;
		if (node.mode === 'relation') {
			return node.inscription ? Math.max(100, Math.min(220, node.inscription.length * 8 + 40)) : 36;
		}
		return Math.max(100, Math.min(220, (node.inscription?.length || 5) * 8 + 40));
	}

	// Position helper: get center of a node for connection drawing
	function nodeCenter(namingId: string): { x: number; y: number } {
		const pos = positions.get(namingId);
		if (!pos) return { x: 0, y: 0 };
		return { x: pos.x, y: pos.y };
	}

	// ─── API ───

	async function mapAction(action: string, body: Record<string, unknown> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/maps/${data.map.id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...body })
		});
		if (!res.ok) return null;
		return res.json();
	}

	async function reload() {
		const res = await fetch(`/api/projects/${data.projectId}/maps/${data.map.id}`);
		if (!res.ok) return;
		const fresh = await res.json();
		elements = fresh.elements;
		relations = fresh.relations;
		silences = fresh.silences;
		phases = fresh.phases;
		designationProfile = fresh.designationProfile;
		// Merge new positions (keep existing, add for new nodes)
		const newPos = new Map(positions);
		for (const node of [...fresh.elements, ...fresh.relations, ...fresh.silences]) {
			if (!newPos.has(node.naming_id) && node.properties?.x != null) {
				newPos.set(node.naming_id, { x: node.properties.x, y: node.properties.y });
			}
		}
		positions = newPos;
	}

	async function saveAllPositions(pos: Map<string, { x: number; y: number }>) {
		const arr = [...pos.entries()].map(([namingId, p]) => ({ namingId, x: p.x, y: p.y }));
		if (arr.length > 0) {
			await mapAction('updatePositions', { positions: arr });
		}
	}

	// ─── Node interactions ───

	function handleNodeDragEnd(id: string, x: number, y: number) {
		positions = new Map(positions).set(id, { x, y });
		mapAction('updatePosition', { namingId: id, x, y });
	}

	function handleNodeClick(id: string, e: MouseEvent) {
		if (relatingFrom) {
			completeRelating(id);
			return;
		}
		selection.select(id, e.ctrlKey || e.metaKey);
		ctxMenuId = null;
	}

	function handleNodeContextMenu(id: string, e: MouseEvent) {
		selection.select(id);
		ctxMenuId = id;
		// Position context menu in screen space
		ctxMenuPos = { x: e.clientX, y: e.clientY };
	}

	function handleCanvasClick(x: number, y: number) {
		selection.clear();
		ctxMenuId = null;
		highlightedPhase = null;
		if (relatingFrom) {
			relatingFrom = null;
		}
	}

	// ─── Element CRUD ───

	async function addElement() {
		if (!newInscription.trim()) return;
		adding = true;
		await mapAction('addElement', { inscription: newInscription.trim() });
		newInscription = '';
		adding = false;
		await reload();
		await layoutNewNodes();
	}

	// ─── Relate ───

	function startRelating(fromId: string) {
		relatingFrom = fromId;
		ctxMenuId = null;
	}

	function completeRelating(toId: string) {
		if (!relatingFrom || relatingFrom === toId) return;
		// Show relation form inline
		relInscription = '';
		relValence = '';
		relDirected = true;
		// We need a second target — store it
		relatingTo = toId;
	}

	let relatingTo = $state<string | null>(null);

	async function submitRelation() {
		if (!relatingFrom || !relatingTo) return;
		const result = await mapAction('relate', {
			sourceId: relatingFrom,
			targetId: relatingTo,
			inscription: relInscription.trim() || undefined,
			valence: relValence.trim() || undefined,
			symmetric: !relDirected
		});
		const relationId = result?.id;
		relatingFrom = null;
		relatingTo = null;
		await reload();
		await layoutNewNodes();
		// Open act-prompt for memo on the new relation
		if (relationId) {
			actTarget = relationId;
			actType = 'relate';
			actNewValue = relInscription.trim() || relValence.trim() || '';
			actMemo = '';
			actLinkedIds = [];
			showActLinks = false;
			loadActMemos(relationId);
		}
	}

	function cancelRelation() {
		relatingFrom = null;
		relatingTo = null;
	}

	// ─── Context menu actions ───

	function ctxRename(id: string) {
		const node = findNode(id);
		editingId = id;
		editingValue = node?.inscription || '';
		ctxMenuId = null;
	}

	function ctxDesignate(id: string, designation: string) {
		actTarget = id;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		ctxMenuId = null;
		loadActMemos(id);
	}

	function ctxShowStack(id: string) {
		showStack(id);
		ctxMenuId = null;
	}

	function ctxRelate(id: string) {
		if (relatingFrom) {
			completeRelating(id);
		} else {
			startRelating(id);
		}
		ctxMenuId = null;
	}

	// ─── Rename ───

	async function confirmRename() {
		if (!editingId || !editingValue.trim()) return;
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		loadActMemos(editingId);
		editingId = null;
		editingValue = '';
	}

	async function submitAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'relate') {
			// Relation already created — just add the memo
			const links = [actTarget, ...actLinkedIds];
			await fetch(`/api/projects/${data.projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label: `Relation: ${actNewValue || '(unnamed)'}`,
					content: actMemo.trim(),
					linkedElementIds: links
				})
			});
		}
		cancelAct();
		await reload();
	}

	async function skipAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		// For 'relate': relation already created, nothing more to do
		cancelAct();
		await reload();
	}

	async function loadActMemos(namingId: string) {
		const res = await mapAction('getMemosForNaming', { namingId });
		actExistingMemos = res?.memos || [];
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		actExistingMemos = [];
	}

	function toggleActLink(namingId: string) {
		if (actLinkedIds.includes(namingId)) {
			actLinkedIds = actLinkedIds.filter(id => id !== namingId);
		} else {
			actLinkedIds = [...actLinkedIds, namingId];
		}
	}

	// ─── Stack ───

	async function showStack(namingId: string) {
		if (stackId === namingId) { stackId = null; stackData = null; return; }
		stackId = namingId;
		stackData = await mapAction('getStack', { namingId });
	}

	// ─── Designation (list view) ───

	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		loadActMemos(namingId);
	}

	// ─── Relation (list view) ───

	function startRelation(fromId: string, toId: string) {
		relatingFrom = fromId;
		completeRelating(toId);
	}

	// ─── Perspectival collapse ───

	async function pinToLayer(namingId: string, seq: number) {
		await mapAction('setCollapse', { namingId, collapseAt: seq });
		await reload();
	}

	async function unpinLayer(namingId: string) {
		await mapAction('setCollapse', { namingId, collapseAt: null });
		await reload();
	}

	// ─── Phases ───

	async function removeElementFromPhase(phaseId: string, namingId: string) {
		await mapAction('removeFromPhase', { phaseId, namingId });
		await reload();
		if (expandedPhase === phaseId) {
			const res = await fetch(`/api/projects/${data.projectId}/maps/${phaseId}`);
			if (res.ok) {
				const fresh = await res.json();
				phaseContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	async function addPhase() {
		if (!newPhaseLabel.trim()) return;
		await mapAction('createPhase', { inscription: newPhaseLabel.trim() });
		newPhaseLabel = '';
		showPhaseForm = false;
		await reload();
	}

	async function assignElement(phaseId: string, namingId: string) {
		await mapAction('assignToPhase', { phaseId, namingId });
		await reload();
		if (expandedPhase === phaseId) {
			const res = await fetch(`/api/projects/${data.projectId}/maps/${phaseId}`);
			if (res.ok) {
				const fresh = await res.json();
				phaseContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	async function togglePhase(phaseId: string) {
		if (expandedPhase === phaseId) {
			expandedPhase = null;
			phaseContents = [];
		} else {
			expandedPhase = phaseId;
			const res = await fetch(`/api/projects/${data.projectId}/maps/${phaseId}`);
			if (res.ok) {
				const fresh = await res.json();
				phaseContents = [...(fresh.elements || []), ...(fresh.relations || []), ...(fresh.silences || [])];
			}
		}
	}

	// ─── AI ───

	function showAiNotification(text: string) {
		aiNotification = text;
		clearTimeout(aiNotificationTimeout);
		aiNotificationTimeout = setTimeout(() => { aiNotification = null; }, 4000);
	}

	async function toggleAi() {
		const next = !aiEnabled;
		await mapAction('toggleAi', { enabled: next });
		aiEnabled = next;
	}

	async function requestAnalysis() {
		await mapAction('requestAnalysis');
		showAiNotification('AI analysis requested');
	}

	async function toggleWithdraw(namingId: string, currentlyWithdrawn: boolean) {
		await mapAction('withdraw', { namingId, withdrawn: !currentlyWithdrawn });
		await reload();
	}

	async function submitDiscussion() {
		if (!stackId || !discussInput.trim() || discussLoading) return;
		discussLoading = true;
		try {
			const result = await mapAction('discussCue', { namingId: stackId, message: discussInput.trim() });
			if (!result) { showAiNotification('Discussion failed (server error)'); return; }
			discussInput = '';
			// Refresh stack to show new discussion entries
			const freshStack = await mapAction('getStack', { namingId: stackId });
			if (freshStack) stackData = freshStack;
			// Reload map in case cue was rewritten or withdrawn
			await reload();
		} catch (e) {
			showAiNotification('Discussion failed');
		} finally {
			discussLoading = false;
		}
	}

	// ─── Auto layout ───

	async function runAutoLayout() {
		const result = await computeLayout(elements, relations, silences);
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, p] of result.positions) {
			newPos.set(id, { x: p.x, y: p.y });
		}
		positions = newPos;
		await saveAllPositions(newPos);
	}

	// ─── Topology snapshots ───

	let topoSnapshots = $state<any[]>([]);
	let showTopoPanel = $state(false);

	function positionsToObj(): Record<string, { x: number; y: number }> {
		const obj: Record<string, { x: number; y: number }> = {};
		for (const [id, pos] of positions) {
			obj[id] = { x: pos.x, y: pos.y };
		}
		return obj;
	}

	async function saveTopologyBuffer() {
		if (positions.size === 0) return;
		await mapAction('saveTopologyBuffer', { positions: positionsToObj() });
	}

	async function saveTopologySnapshot() {
		const label = prompt('Snapshot label:');
		if (label === null) return;
		// Send current in-memory positions directly — don't rely on the stale buffer
		await mapAction('saveTopologySnapshot', { label: label || undefined, positions: positionsToObj() });
		await loadTopoSnapshots();
	}

	async function restoreTopologySnapshot(seq: number) {
		const result = await mapAction('restoreTopologySnapshot', { seq });
		if (!result?.positions) { showAiNotification('Restore failed'); return; }
		// Apply positions directly from the snapshot — no reload needed (only positions change)
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of Object.entries(result.positions as Record<string, { x: number; y: number }>)) {
			newPos.set(id, { x: pos.x, y: pos.y });
		}
		// Keep existing positions for nodes not in the snapshot
		for (const [id, pos] of positions) {
			if (!newPos.has(id)) newPos.set(id, pos);
		}
		positions = newPos;
	}

	async function loadTopoSnapshots() {
		const res = await mapAction('listTopologySnapshots');
		topoSnapshots = res?.snapshots || [];
	}

	function switchView(mode: 'list' | 'canvas') {
		if (viewMode === 'canvas' && mode !== 'canvas') {
			saveTopologyBuffer();
		}
		viewMode = mode;
	}

	// Auto-save topology buffer on page leave
	$effect(() => {
		function onBeforeUnload() {
			if (viewMode === 'canvas' && positions.size > 0) {
				// Use sendBeacon for reliable save during unload
				navigator.sendBeacon(
					`/api/projects/${data.projectId}/maps/${data.map.id}`,
					new Blob([JSON.stringify({ action: 'saveTopologyBuffer', positions: positionsToObj() })],
						{ type: 'application/json' })
				);
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	// ─── Escape ───

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			cancelRelation();
			cancelAct();
			selection.clear();
			ctxMenuId = null;
			editingId = null;
			assigningToPhase = null;
			highlightedPhase = null;
		}
	}
</script>

<div class="map-page">
	<!-- Toolbar -->
	<div class="map-toolbar">
		<a href="/projects/{data.projectId}/maps" class="back">&larr; Maps</a>
		<h2>{data.map.label}</h2>
		<span class="map-type-badge">{mapType}</span>

		{#if designationProfile.length > 0}
			<div class="designation-profile">
				{#each designationProfile as dp}
					<span class="dp-item" style="color: {designationColor(dp.designation)}">
						{dp.count} {designationLabel(dp.designation)}
					</span>
				{/each}
			</div>
		{/if}

		<div class="toolbar-actions">
			<form class="add-form" onsubmit={e => { e.preventDefault(); addElement(); }}>
				<input type="text" placeholder="Name something..." bind:value={newInscription} disabled={adding} />
				<button type="submit" class="btn-primary" disabled={adding || !newInscription.trim()}>Add</button>
			</form>
			<div class="view-toggle">
				<button class="btn-view" class:active={viewMode === 'list'} onclick={() => switchView('list')}>List</button>
				<button class="btn-view" class:active={viewMode === 'canvas'} onclick={() => switchView('canvas')}>Canvas</button>
			</div>
			<button class="btn-sm" onclick={runAutoLayout} title="Re-compute layout"
				disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">Layout</button>
			<button class="btn-sm" onclick={() => { showTopoPanel = !showTopoPanel; if (showTopoPanel) loadTopoSnapshots(); }}
				title="Topology snapshots"
				disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">Topo</button>
			<button class="btn-ai-toggle" class:ai-active={aiEnabled} onclick={toggleAi}>AI</button>
			<button class="btn-sm" onclick={requestAnalysis} disabled={!aiEnabled}>Ask AI</button>
		</div>
	</div>

	{#if showTopoPanel && viewMode === 'canvas'}
		<div class="topo-panel">
			<div class="topo-header">
				<span>Topology Snapshots</span>
				<button class="btn-primary btn-sm-primary" onclick={saveTopologySnapshot}>Save</button>
				<button class="btn-link" onclick={() => showTopoPanel = false}>close</button>
			</div>
			{#if topoSnapshots.length === 0}
				<span class="topo-empty">No snapshots yet</span>
			{:else}
				{#each topoSnapshots as snap}
					<div class="topo-entry">
						<span class="topo-label">{snap.label || `#${snap.seq}`}</span>
						<span class="topo-meta">{snap.node_count} nodes · {new Date(snap.created_at).toLocaleString()}</span>
						<button class="btn-xs" onclick={() => restoreTopologySnapshot(snap.seq)}>restore</button>
					</div>
				{/each}
			{/if}
		</div>
	{/if}

	<!-- Status bar (relation mode, etc.) -->
	{#if relatingFrom && !relatingTo}
		<div class="status-bar">
			Relating from: <strong>{findInscription(relatingFrom)}</strong> — click any node to connect
			<button class="btn-link" onclick={cancelRelation}>cancel</button>
		</div>
	{/if}

	{#if aiNotification}
		<div class="ai-notification">{aiNotification}</div>
	{/if}

	<!-- Naming act prompt (shared, always visible) -->
	{#if actTarget}
		{@const actNode = findNode(actTarget)}
		{@const allMapNamings = [...elements, ...relations].filter((e: any) => e.naming_id !== actTarget)}
		<div class="act-prompt-bar">
			<div class="act-header">
				{#if actType === 'rename'}
					Rename: <strong>{actNode?.inscription}</strong> → <strong>{actNewValue}</strong>
				{:else if actType === 'designate'}
					Designation: <strong>{actNode?.inscription}</strong> →
					<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
				{:else if actType === 'relate'}
					Relation: <strong>{actNode?.inscription || actNewValue || '(unnamed)'}</strong>
				{/if}
			</div>
			{#if actExistingMemos.length > 0}
				<div class="act-existing-memos">
					<span class="act-existing-label">Previous memos ({actExistingMemos.length}):</span>
					{#each actExistingMemos as memo}
						<div class="act-existing-memo">
							<span class="act-memo-label">{memo.label}</span>
							{#if memo.content}<span class="act-memo-content">{memo.content}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}
			<textarea placeholder="What influenced this act? What changed in your understanding?" bind:value={actMemo} rows="2"></textarea>
			<div class="act-links-toggle">
				<button class="btn-xs" onclick={() => showActLinks = !showActLinks}>
					{showActLinks ? 'hide' : `namings I have in mind (${actLinkedIds.length})`}
				</button>
			</div>
			{#if showActLinks}
				<div class="act-links-list">
					{#each allMapNamings as n}
						<label class="act-link-item">
							<input type="checkbox" checked={actLinkedIds.includes(n.naming_id)} onchange={() => toggleActLink(n.naming_id)} />
							<span class="designation-dot-sm" style="background: {designationColor(n.designation)}"></span>
							<span>{n.inscription || '(unnamed relation)'}</span>
						</label>
					{/each}
				</div>
			{/if}
			<div class="act-actions">
				<button class="btn-primary btn-sm-primary" onclick={submitAct}>{actType === 'relate' ? 'Save memo' : 'Apply + memo'}</button>
				<button class="btn-link" onclick={skipAct}>skip memo</button>
				{#if actType !== 'relate'}<button class="btn-link" onclick={cancelAct}>cancel</button>{/if}
			</div>
		</div>
	{/if}

	<!-- Relation form (shared, always visible) -->
	{#if relatingFrom && relatingTo}
		<div class="act-prompt-bar">
			<div class="rel-form-header">
				{findInscription(relatingFrom)}
				{#if relDirected}<span class="arrow">→</span>{:else}<span class="arrow">↔</span>{/if}
				{findInscription(relatingTo)}
				<button class="btn-link" onclick={cancelRelation}>cancel</button>
			</div>
			<label>
				<span class="field-label">Valence</span>
				<input type="text" placeholder="e.g. enables, constrains..." bind:value={relValence} />
			</label>
			<label>
				<span class="field-label">Name</span>
				<input type="text" placeholder="Name for this relation (optional)" bind:value={relInscription} />
			</label>
			<label class="toggle-label">
				<input type="checkbox" bind:checked={relDirected} />
				<span>directed</span>
			</label>
			<button class="btn-primary btn-sm-primary" onclick={submitRelation}>Create relation</button>
		</div>
	{/if}

	<div class="map-workspace">
		<!-- Canvas -->
		<div class="canvas-container" style="{viewMode !== 'canvas' ? 'display: none;' : ''}">
			<InfiniteCanvas {viewport} oncanvasclick={handleCanvasClick}>
				<!-- Connections: draw edges between elements and their relation nodes -->
				{#each relations as rel}
					{@const srcId = rel.directed_from || rel.part_source_id}
					{@const tgtId = rel.directed_to || rel.part_target_id}
					{@const isDirected = !!(rel.directed_from && rel.directed_to)}
					{#if srcId && tgtId && findNode(srcId) && findNode(tgtId) && positions.has(srcId) && positions.has(rel.naming_id) && positions.has(tgtId)}
						{@const srcCenter = nodeCenter(srcId)}
						{@const relCenter = nodeCenter(rel.naming_id)}
						{@const tgtCenter = nodeCenter(tgtId)}
						{@const lineOpacity = connectionOpacity(rel, findNode(srcId), findNode(tgtId))}
						<CanvasConnection
							x1={srcCenter.x} y1={srcCenter.y}
							x2={relCenter.x} y2={relCenter.y}
							color={designationColor(rel.designation)}
							directed={isDirected}
							opacity={lineOpacity}
						/>
						<CanvasConnection
							x1={relCenter.x} y1={relCenter.y}
							x2={tgtCenter.x} y2={tgtCenter.y}
							color={designationColor(rel.designation)}
							directed={isDirected}
							opacity={lineOpacity}
						/>
					{/if}
				{/each}

				<!-- Element nodes -->
				{#each elements as el}
					{@const pos = positions.get(el.naming_id)}
					{#if pos && !isHiddenByFilter(el)}
						<CanvasElement
							id={el.naming_id}
							x={pos.x} y={pos.y}
							color={designationColor(el.designation)}
							selected={selection.isSelected(el.naming_id)}
							zoom={viewport.zoom}
							ondragend={handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="map-node" class:ai-suggested={el.properties?.aiSuggested} class:ai-withdrawn={isWithdrawn(el.properties)} class:phase-member={highlightedPhase && isPhaseHighlighted(el)} class:phase-dimmed={highlightedPhase && !isPhaseHighlighted(el)}
								style="{highlightedPhase && isPhaseHighlighted(el) ? `--phase-color: ${phaseColorMap.get(highlightedPhase)};` : ''}">
								<div class="node-header">
									<span class="designation-dot" style="background: {designationColor(el.designation)}"></span>
									{#if el.has_document_anchor}
										<img class="prov-icon" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
									{:else if el.has_memo_link}
										<img class="prov-icon" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
									{:else}
										<img class="prov-icon" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding" />
									{/if}
									<span class="node-designation">{designationLabel(el.designation)}</span>
									{#if el.phase_ids?.length}
										<span class="phase-dots">
											{#each el.phase_ids as pid}
												{@const c = phaseColorMap.get(pid)}
												{#if c}<span class="phase-dot" style="background: {c}" title={phases.find((p: any) => p.id === pid)?.label}></span>{/if}
											{/each}
										</span>
									{/if}
								</div>
								{#if editingId === el.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
										<input type="text" bind:value={editingValue} />
										<button type="submit" class="btn-xs">ok</button>
									</form>
								{:else}
									<span class="node-label">{el.inscription}</span>
								{/if}
								{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
									<span class="collapsed-hint">now: {el.current_inscription}</span>
								{/if}
							</div>
						</CanvasElement>
					{/if}
				{/each}

				<!-- Relation nodes (first-class, smaller) -->
				{#each relations as rel}
					{@const pos = positions.get(rel.naming_id)}
					{#if pos && !isHiddenByFilter(rel)}
						<CanvasElement
							id={rel.naming_id}
							x={pos.x} y={pos.y}
							color={designationColor(rel.designation)}
							selected={selection.isSelected(rel.naming_id)}
							zoom={viewport.zoom}
							ondragend={handleNodeDragEnd}
							onclick={handleNodeClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="map-node relation-node" class:ai-suggested={rel.properties?.aiSuggested} class:ai-withdrawn={isWithdrawn(rel.properties)} class:phase-member={highlightedPhase && isPhaseHighlighted(rel)} class:phase-dimmed={highlightedPhase && !isPhaseHighlighted(rel)}
								style="{highlightedPhase && isPhaseHighlighted(rel) ? `--phase-color: ${phaseColorMap.get(highlightedPhase)};` : ''}">
								{#if rel.valence}
									<span class="rel-valence">{rel.valence}</span>
								{/if}
								{#if rel.inscription}
									<span class="node-label rel-label">{rel.inscription}</span>
								{:else}
									<span class="rel-label unnamed">
										{findInscription(rel.directed_from || rel.part_source_id)} -> {findInscription(rel.directed_to || rel.part_target_id)}
									</span>
								{/if}
								{#if rel.phase_ids?.length}
									<span class="phase-dots">
										{#each rel.phase_ids as pid}
											{@const c = phaseColorMap.get(pid)}
											{#if c}<span class="phase-dot" style="background: {c}"></span>{/if}
										{/each}
									</span>
								{/if}
							</div>
						</CanvasElement>
					{/if}
				{/each}

				<!-- Silence nodes -->
				{#each silences as s}
					{@const pos = positions.get(s.naming_id)}
					{#if pos && !isHiddenByFilter(s)}
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
							<div class="map-node silence-node" class:phase-dimmed={highlightedPhase}>
								<span class="node-label">{s.inscription}</span>
							</div>
						</CanvasElement>
					{/if}
				{/each}
			</InfiniteCanvas>

			<!-- Context menu -->
			{#if ctxMenuId}
				{@const ctxNode = findNode(ctxMenuId)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="context-menu" style="left: {ctxMenuPos.x}px; top: {ctxMenuPos.y}px;"
					onclick={(e) => e.stopPropagation()}>
					<div class="ctx-header">{ctxNode?.inscription || '(unnamed)'}</div>
					<button class="ctx-item" onclick={() => ctxRename(ctxMenuId!)}>Rename</button>
					<div class="ctx-separator"></div>
					<button class="ctx-item" onclick={() => ctxDesignate(ctxMenuId!, 'cue')}>
						<span class="designation-dot-sm" style="background: #6b7280"></span> cue
					</button>
					<button class="ctx-item" onclick={() => ctxDesignate(ctxMenuId!, 'characterization')}>
						<span class="designation-dot-sm" style="background: #f59e0b"></span> characterization
					</button>
					<button class="ctx-item" onclick={() => ctxDesignate(ctxMenuId!, 'specification')}>
						<span class="designation-dot-sm" style="background: #10b981"></span> specification
					</button>
					<div class="ctx-separator"></div>
					<button class="ctx-item" onclick={() => ctxRelate(ctxMenuId!)}>
						{relatingFrom ? 'Connect here' : 'Relate...'}
					</button>
					<button class="ctx-item" onclick={() => ctxShowStack(ctxMenuId!)}>Stack</button>
					{#if assigningToPhase}
						<div class="ctx-separator"></div>
						<button class="ctx-item" onclick={() => assignElement(assigningToPhase!, ctxMenuId!)}>
							+ Phase
						</button>
					{/if}
				</div>
			{/if}

			<!-- Floating stack panel (canvas) -->
			{#if stackId && stackData}
				{@const stackNode = findNode(stackId)}
				<div class="canvas-stack-panel">
					<div class="stack-panel-header">
						<span class="stack-title">{stackNode?.inscription || '(unnamed)'}</span>
						<button class="btn-link" onclick={() => { stackId = null; stackData = null; }}>close</button>
					</div>
					{#if stackNode?.is_collapsed}
						<button class="btn-xs btn-unpin" onclick={() => unpinLayer(stackId!)}>
							unpin (show latest)
						</button>
					{/if}
					{#if stackData.inscriptions.length > 1}
						<div class="history-section">
							<span class="history-label">Inscriptions</span>
							{#each stackData.inscriptions as hi}
								<div class="history-entry" class:pinned-layer={stackNode?.is_collapsed && stackNode?.properties?.collapseAt === hi.seq}>
									<span class="he-value">{hi.inscription}</span>
									<span class="he-by">{hi.by_inscription}</span>
									<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
									<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => pinToLayer(stackId!, hi.seq)}>
										pin
									</button>
								</div>
							{/each}
						</div>
					{/if}
					<div class="history-section">
						<span class="history-label">Designations</span>
						{#each stackData.designations as hd}
							<div class="history-entry">
								<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
								<span class="he-value">{hd.designation}</span>
								<span class="he-by">{hd.by_inscription}</span>
								<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
							</div>
						{/each}
					</div>
					{#if stackData.memos?.length > 0}
						<div class="history-section">
							<span class="history-label">Memos ({stackData.memos.length})</span>
							{#each stackData.memos as memo}
								<div class="memo-entry">
									<span class="memo-label">{memo.label}</span>
									<span class="memo-content">{memo.content}</span>
									<span class="he-date">{new Date(memo.created_at).toLocaleString()}</span>
								</div>
							{/each}
						</div>
					{/if}
					{#if stackData.aiSuggested}
						<div class="history-section ai-discussion-section">
							<span class="history-label">
								<img class="label-icon" src="/icons/comment.svg" alt="" />
								AI Cue {stackData.aiWithdrawn ? '(withdrawn)' : ''}
							</span>
							{#if stackData.aiReasoning}
								<div class="ai-reasoning">{stackData.aiReasoning}</div>
							{/if}
							{#if stackData.discussion && stackData.discussion.length > 0}
								<div class="discussion-thread">
									{#each stackData.discussion as turn}
										<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
											<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'rewrite' ? ' (rewrote)' : turn.type === 'withdrawn' ? ' (withdrew)' : ''}</span>
											<span class="turn-content">{turn.content}</span>
										</div>
									{/each}
								</div>
							{/if}
							{#if !stackData.aiWithdrawn}
								<form class="discuss-form" onsubmit={e => { e.preventDefault(); submitDiscussion(); }}>
									<input type="text" placeholder="Discuss this cue..." bind:value={discussInput} disabled={discussLoading} />
									<button type="submit" class="btn-xs" disabled={discussLoading || !discussInput.trim()}>
										{discussLoading ? '...' : 'send'}
									</button>
								</form>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

		</div>
		<!-- List view (original) -->
		<div class="main-area" style="{viewMode !== 'list' ? 'display: none;' : ''}">
			{#if elements.length === 0 && relations.length === 0}
				<p class="empty">Name what is in the situation. Everything is a cue at first.</p>
			{:else}
				<div class="element-list">
					{#each elements as el}
						{#if !isHiddenByFilter(el)}
						<div class="element-card" class:ai-suggested={el.properties?.aiSuggested === true} class:ai-withdrawn={isWithdrawn(el.properties)} title={el.properties?.aiReasoning || ''}>
							<div class="el-main">
								{#if el.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
								<span class="designation-dot" style="background: {designationColor(el.designation)}"
									title={designationLabel(el.designation)}></span>
								{#if el.has_document_anchor}
									<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
								{:else if el.has_memo_link}
									<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
								{:else}
									<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
								{/if}
								{#if editingId === el.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
										<input type="text" bind:value={editingValue} />
										<button type="submit" class="btn-xs">ok</button>
										<button type="button" class="btn-xs" onclick={() => editingId = null}>×</button>
									</form>
								{:else}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="el-inscription editable" onclick={() => showStack(el.naming_id)} ondblclick={() => ctxRename(el.naming_id, el.inscription)}>
										{el.inscription}
									</span>
									{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
										<span class="collapsed-current">currently: {el.current_inscription}</span>
									{/if}
								{/if}
							</div>
							<div class="el-actions">
								<select
									value={el.designation || 'cue'}
									onchange={e => startDesignation(el.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
								<button class="btn-xs" title="naming stack" onclick={() => showStack(el.naming_id)}>
									stack
								</button>
								<button class="btn-xs btn-withdraw" title={isWithdrawn(el.properties) ? 'Restore this naming' : 'Withdraw this naming'} onclick={() => toggleWithdraw(el.naming_id, isWithdrawn(el.properties))}>
									{isWithdrawn(el.properties) ? 'restore' : 'withdraw'}
								</button>
								{#if relatingFrom && !relatingTo && relatingFrom !== el.naming_id}
									<button class="btn-sm btn-relate" onclick={() => startRelation(relatingFrom!, el.naming_id)}>
										connect
									</button>
								{:else if !relatingFrom}
									<button class="btn-sm" onclick={() => { relatingFrom = el.naming_id; relatingTo = null; }}>
										relate
									</button>
								{/if}
								{#if assigningToPhase}
									<button class="btn-sm btn-phase" onclick={() => assignElement(assigningToPhase!, el.naming_id)}>
										+ phase
									</button>
								{/if}
							</div>
						</div>

						{#if stackId === el.naming_id && stackData}
							<div class="history-panel">
								{#if el.is_collapsed}
									<button class="btn-xs btn-unpin" onclick={() => unpinLayer(el.naming_id)}>
										unpin (show latest)
									</button>
								{/if}
								{#if stackData.inscriptions.length > 1}
									<div class="history-section">
										<span class="history-label">Inscriptions</span>
										{#each stackData.inscriptions as hi}
											<div class="history-entry" class:pinned-layer={el.is_collapsed && el.properties?.collapseAt === hi.seq}>
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
												<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => pinToLayer(el.naming_id, hi.seq)}>
													pin
												</button>
											</div>
										{/each}
									</div>
								{/if}
								<div class="history-section">
									<span class="history-label">Designations</span>
									{#each stackData.designations as hd}
										<div class="history-entry">
											<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
											<span class="he-value">{hd.designation}</span>
											<span class="he-by">{hd.by_inscription}</span>
											<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
										</div>
									{/each}
								</div>
								{#if stackData.memos?.length > 0}
									<div class="history-section">
										<span class="history-label">Memos ({stackData.memos.length})</span>
										{#each stackData.memos as memo}
											<div class="memo-entry">
												<span class="memo-label">{memo.label}</span>
												<span class="memo-content">{memo.content}</span>
												<span class="he-date">{new Date(memo.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.aiSuggested}
									<div class="history-section ai-discussion-section">
										<span class="history-label">
											<img class="label-icon" src="/icons/comment.svg" alt="" />
											AI Cue {stackData.aiWithdrawn ? '(withdrawn)' : ''}
										</span>
										{#if stackData.aiReasoning}
											<div class="ai-reasoning">
												{stackData.aiReasoning}
											</div>
										{/if}
										{#if stackData.discussion && stackData.discussion.length > 0}
											<div class="discussion-thread">
												{#each stackData.discussion as turn}
													<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
														<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'rewrite' ? ' (rewrote)' : turn.type === 'withdrawn' ? ' (withdrew)' : ''}</span>
														<span class="turn-content">{turn.content}</span>
													</div>
												{/each}
											</div>
										{/if}
										{#if !stackData.aiWithdrawn}
											<form class="discuss-form" onsubmit={e => { e.preventDefault(); submitDiscussion(); }}>
												<input type="text" placeholder="Discuss this cue..." bind:value={discussInput} disabled={discussLoading} />
												<button type="submit" class="btn-xs" disabled={discussLoading || !discussInput.trim()}>
													{discussLoading ? '...' : 'send'}
												</button>
											</form>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Relations -->
			{#if relations.length > 0}
				<h3 class="section-header">Relations</h3>
				<div class="element-list">
					{#each relations as rel}
						{@const srcId = rel.directed_from || rel.part_source_id}
						{@const tgtId = rel.directed_to || rel.part_target_id}
						{#if !isHiddenByFilter(rel)}
						<div class="element-card relation-card" class:ai-suggested={rel.properties?.aiSuggested === true} class:ai-withdrawn={isWithdrawn(rel.properties)} title={rel.properties?.aiReasoning || ''}>
							<div class="el-main">
								{#if rel.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
								<span class="designation-dot" style="background: {designationColor(rel.designation)}"></span>
								{#if rel.has_document_anchor}
									<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
								{:else if rel.has_memo_link}
									<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
								{:else}
									<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
								{/if}
								<span class="rel-source">{findInscription(srcId)}</span>
								<span class="rel-arrow">
									{#if rel.directed_from && rel.directed_to}
										{#if rel.valence}—{rel.valence}→{:else}→{/if}
									{:else}
										{#if rel.valence}—{rel.valence}—{:else}↔{/if}
									{/if}
								</span>
								<span class="rel-target">{findInscription(tgtId)}</span>
								{#if editingId === rel.naming_id}
									<form class="inline-rename" onsubmit={e => { e.preventDefault(); confirmRename(); }}>
										<input type="text" bind:value={editingValue} />
										<button type="submit" class="btn-xs">ok</button>
										<button type="button" class="btn-xs" onclick={() => editingId = null}>×</button>
									</form>
								{:else if rel.inscription}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="rel-inscription editable" onclick={() => showStack(rel.naming_id)} ondblclick={() => ctxRename(rel.naming_id, rel.inscription)}>
										{rel.inscription}
									</span>
								{:else}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span class="rel-inscription editable unnamed" onclick={() => showStack(rel.naming_id)} ondblclick={() => ctxRename(rel.naming_id, '')}>
										(name...)
									</span>
								{/if}
								{#if rel.is_collapsed && rel.current_inscription && rel.current_inscription !== rel.inscription}
									<span class="collapsed-current">currently: {rel.current_inscription}</span>
								{/if}
							</div>
							<div class="el-actions">
								<select
									value={rel.designation || 'cue'}
									onchange={e => startDesignation(rel.naming_id, (e.target as HTMLSelectElement).value)}
								>
									<option value="cue">cue</option>
									<option value="characterization">characterization</option>
									<option value="specification">specification</option>
								</select>
								<button class="btn-xs" title="naming stack" onclick={() => showStack(rel.naming_id)}>
									stack
								</button>
								<button class="btn-xs btn-withdraw" title={isWithdrawn(rel.properties) ? 'Restore' : 'Withdraw'} onclick={() => toggleWithdraw(rel.naming_id, isWithdrawn(rel.properties))}>
									{isWithdrawn(rel.properties) ? 'restore' : 'withdraw'}
								</button>
								{#if relatingFrom && !relatingTo && relatingFrom !== rel.naming_id}
									<button class="btn-sm btn-relate" onclick={() => startRelation(relatingFrom!, rel.naming_id)}>
										connect
									</button>
								{:else if !relatingFrom}
									<button class="btn-sm" onclick={() => { relatingFrom = rel.naming_id; relatingTo = null; }}>
										relate
									</button>
								{/if}
								{#if assigningToPhase}
									<button class="btn-sm btn-phase" onclick={() => assignElement(assigningToPhase!, rel.naming_id)}>
										+ phase
									</button>
								{/if}
							</div>
						</div>

						{#if stackId === rel.naming_id && stackData}
							<div class="history-panel">
								{#if rel.is_collapsed}
									<button class="btn-xs btn-unpin" onclick={() => unpinLayer(rel.naming_id)}>
										unpin (show latest)
									</button>
								{/if}
								{#if stackData.inscriptions.length > 1}
									<div class="history-section">
										<span class="history-label">Inscriptions</span>
										{#each stackData.inscriptions as hi}
											<div class="history-entry" class:pinned-layer={rel.is_collapsed && rel.properties?.collapseAt === hi.seq}>
												<span class="he-value">{hi.inscription}</span>
												<span class="he-by">{hi.by_inscription}</span>
												<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
												<button class="btn-xs btn-pin" title="Pin to this layer" onclick={() => pinToLayer(rel.naming_id, hi.seq)}>
													pin
												</button>
											</div>
										{/each}
									</div>
								{/if}
								<div class="history-section">
									<span class="history-label">Designations</span>
									{#each stackData.designations as hd}
										<div class="history-entry">
											<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
											<span class="he-value">{hd.designation}</span>
											<span class="he-by">{hd.by_inscription}</span>
											<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
										</div>
									{/each}
								</div>
								{#if stackData.memos?.length > 0}
									<div class="history-section">
										<span class="history-label">Memos ({stackData.memos.length})</span>
										{#each stackData.memos as memo}
											<div class="memo-entry">
												<span class="memo-label">{memo.label}</span>
												<span class="memo-content">{memo.content}</span>
												<span class="he-date">{new Date(memo.created_at).toLocaleString()}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if stackData.aiSuggested}
									<div class="history-section ai-discussion-section">
										<span class="history-label">
											<img class="label-icon" src="/icons/comment.svg" alt="" />
											AI Cue {stackData.aiWithdrawn ? '(withdrawn)' : ''}
										</span>
										{#if stackData.aiReasoning}
											<div class="ai-reasoning">
												{stackData.aiReasoning}
											</div>
										{/if}
										{#if stackData.discussion && stackData.discussion.length > 0}
											<div class="discussion-thread">
												{#each stackData.discussion as turn}
													<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
														<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'rewrite' ? ' (rewrote)' : turn.type === 'withdrawn' ? ' (withdrew)' : ''}</span>
														<span class="turn-content">{turn.content}</span>
													</div>
												{/each}
											</div>
										{/if}
										{#if !stackData.aiWithdrawn}
											<form class="discuss-form" onsubmit={e => { e.preventDefault(); submitDiscussion(); }}>
												<input type="text" placeholder="Discuss this cue..." bind:value={discussInput} disabled={discussLoading} />
												<button type="submit" class="btn-xs" disabled={discussLoading || !discussInput.trim()}>
													{discussLoading ? '...' : 'send'}
												</button>
											</form>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Silences -->
			{#if silences.length > 0}
				<h3 class="section-header">Silences</h3>
				<div class="element-list">
					{#each silences as s}
						{#if !isHiddenByFilter(s)}
						<div class="element-card silence-card" class:ai-suggested={s.properties?.aiSuggested === true} class:ai-withdrawn={isWithdrawn(s.properties)} title={s.properties?.aiReasoning || ''}>
							{#if s.has_document_anchor}
								<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
							{:else if s.has_memo_link}
								<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
							{:else}
								<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
							{/if}
							<span class="el-inscription">{s.inscription}</span>
						</div>
						{/if}
					{/each}
				</div>
			{/if}

		</div>

		<!-- Sidebar: Phases -->
		<div class="sidebar">
			<div class="sidebar-header">
				<h3>Phases</h3>
				<button class="btn-sm" onclick={() => showPhaseForm = !showPhaseForm}>
					{showPhaseForm ? 'x' : '+'}
				</button>
			</div>

			{#if showPhaseForm}
				<form class="phase-form" onsubmit={e => { e.preventDefault(); addPhase(); }}>
					<input type="text" placeholder="Phase label..." bind:value={newPhaseLabel} />
					<button type="submit" class="btn-sm">Create</button>
				</form>
			{/if}

			{#if phases.length === 0}
				<p class="empty-small">No phases yet.</p>
			{:else}
				{#each phases as phase, i}
					<div class="phase-card" class:assigning={assigningToPhase === phase.id} class:phase-active={highlightedPhase === phase.id}
						style="border-left: 3px solid {regionColor(i)}">
						<div class="phase-header">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span class="phase-label clickable" onclick={() => { highlightedPhase = highlightedPhase === phase.id ? null : phase.id; togglePhase(phase.id); }}>{phase.label}</span>
							<span class="phase-count">{phase.element_count}</span>
						</div>
						<button class="btn-xs"
							onclick={() => assigningToPhase = assigningToPhase === phase.id ? null : phase.id}>
							{assigningToPhase === phase.id ? 'done' : 'assign'}
						</button>
						{#if expandedPhase === phase.id}
							<div class="phase-contents">
								{#each phaseContents as pc}
									<div class="phase-element">
										<span class="designation-dot-sm" style="background: {designationColor(pc.designation)}"></span>
										<span class="phase-el-label">{pc.inscription}</span>
										<button class="btn-xs btn-remove" title="Remove from phase"
											onclick={() => removeElementFromPhase(phase.id, pc.naming_id)}>×</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			{/if}

			{#if declinedCount > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="phase-card declined-phase" class:phase-active={isDeclinedFilter}
					style="border-left: 3px solid #6b7280">
					<div class="phase-header">
						<span class="phase-label clickable" onclick={() => { highlightedPhase = isDeclinedFilter ? null : DECLINED_PHASE; }}>Declined</span>
						<span class="phase-count">{declinedCount}</span>
					</div>
					<span class="declined-hint">{isDeclinedFilter ? 'showing' : 'click to hide'}</span>
				</div>
			{/if}

			<!-- Selected node info -->
			{#if selection.count > 0}
				<div class="selection-info">
					<h4>Selected ({selection.count})</h4>
					{#each [...selection.ids] as id}
						{@const node = findNode(id)}
						{#if node}
							<div class="selected-item">
								<span class="designation-dot-sm" style="background: {designationColor(node.designation)}"></span>
								<span>{node.inscription || '(unnamed)'}</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>

</div>

<svelte:window onkeydown={handleKeydown} />

<style>
	.map-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 6rem);
		margin: -2rem;
	}

	/* Toolbar */
	.map-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #2a2d3a;
		background: #13151e;
		flex-shrink: 0;
	}
	.back { font-size: 0.8rem; color: #6b7280; text-decoration: none; }
	h2 { font-size: 1rem; font-weight: 600; color: #e1e4e8; margin: 0; }
	.map-type-badge {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 4px;
	}
	.designation-profile { display: flex; gap: 0.75rem; font-size: 0.8rem; }
	.dp-item { font-weight: 500; }
	.toolbar-actions { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
	.view-toggle { display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden; }
	.btn-view {
		background: transparent; border: none; color: #6b7280; padding: 0.25rem 0.5rem;
		font-size: 0.75rem; cursor: pointer;
	}
	.btn-view.active { background: #2a2d3a; color: #e1e4e8; }
	.btn-view:hover:not(.active) { color: #c9cdd5; }
	.add-form { display: flex; gap: 0.4rem; }
	.add-form input {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.6rem; color: #e1e4e8; font-size: 0.85rem; width: 200px;
	}
	.add-form input:focus { outline: none; border-color: #8b9cf7; }

	/* Status bar */
	.status-bar {
		background: #1e2030; border-bottom: 1px solid #2a2d3a;
		padding: 0.4rem 1rem; font-size: 0.85rem; color: #c9cdd5;
	}

	/* Buttons */
	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
	.btn-sm-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}
	.btn-ai-toggle {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #6b7280; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem;
		cursor: pointer; letter-spacing: 0.04em;
	}
	.btn-ai-toggle.ai-active {
		background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; color: #8b9cf7;
	}

	/* Workspace */
	.map-workspace { display: flex; flex: 1; min-height: 0; }
	.canvas-container { flex: 1; position: relative; overflow: hidden; }

	/* List view */
	.main-area { flex: 1; padding: 1.25rem; overflow-y: auto; }
	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
	.section-header {
		font-size: 0.75rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.05em; margin: 1.5rem 0 0.5rem;
	}
	.element-list { display: flex; flex-direction: column; gap: 0.35rem; }
	.element-card {
		display: flex; align-items: center; justify-content: space-between;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}
	.element-card:hover { border-color: #3a3d4a; }
	.element-card.ai-withdrawn { opacity: 0.4; }
	.element-card.ai-withdrawn .el-inscription { text-decoration: line-through; }
	.btn-withdraw { border-color: #6b7280; color: #6b7280; font-size: 0.65rem; }
	.btn-withdraw:hover { background: rgba(107, 114, 128, 0.1); }
	.relation-card { background: #141620; }
	.silence-card { border-style: dashed; opacity: 0.7; }
	.el-main { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
	.el-inscription { font-size: 0.9rem; color: #e1e4e8; }
	.el-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
	.el-actions select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.2rem 0.3rem; cursor: pointer;
	}
	.rel-source, .rel-target { font-size: 0.85rem; color: #c9cdd5; }
	.rel-arrow { font-size: 0.8rem; color: #6b7280; margin: 0 0.25rem; }
	.rel-inscription { font-size: 0.75rem; color: #8b8fa3; margin-left: 0.5rem; font-style: italic; }
	.editable { cursor: pointer; }
	.editable:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
	.unnamed { color: #4b5563; font-style: italic; }
	.btn-relate { border-color: #f59e0b; color: #f59e0b; }
	.btn-phase { border-color: #10b981; color: #10b981; }
	.provenance-indicator { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.5; cursor: default; }
	.collapsed-indicator { width: 12px; height: 12px; flex-shrink: 0; margin-right: 0.2rem; opacity: 0.7; }
	.collapsed-current { font-size: 0.7rem; color: #6b7280; font-style: italic; margin-left: 0.5rem; }

	/* History panel (inline in list view) */
	.history-panel {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; margin-top: -0.1rem; margin-bottom: 0.2rem;
	}
	.history-section { margin-bottom: 0.4rem; }
	.history-section:last-child { margin-bottom: 0; }
	.history-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.2rem;
	}
	.history-entry {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.75rem; color: #8b8fa3; padding: 0.1rem 0;
	}
	.he-value { color: #c9cdd5; }
	.he-by { color: #6b7280; }
	.he-by::before { content: '— '; }
	.he-date { color: #4b5563; margin-left: auto; font-size: 0.7rem; }
	.memo-entry {
		padding: 0.3rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.75rem;
	}
	.memo-entry:last-child { border-bottom: none; }
	.memo-label { color: #f59e0b; font-size: 0.72rem; display: block; }
	.memo-content {
		display: block; color: #a0a4b0; font-size: 0.75rem;
		margin-top: 0.15rem; white-space: pre-wrap;
		max-height: 4.5em; overflow-y: auto;
	}
	.btn-pin { margin-left: auto; border-color: #f59e0b; color: #f59e0b; }
	.btn-pin:hover { background: rgba(245, 158, 11, 0.1); }
	.btn-unpin { border-color: #f59e0b; color: #f59e0b; margin-bottom: 0.4rem; }
	.btn-unpin:hover { background: rgba(245, 158, 11, 0.1); }
	.pinned-layer { background: rgba(245, 158, 11, 0.1); border-radius: 3px; padding: 0.1rem 0.3rem; }

	/* AI cue discussion */
	.ai-discussion-section {
		border-top: 1px solid rgba(139, 156, 247, 0.2);
		padding-top: 0.5rem;
		margin-top: 0.3rem;
	}
	.label-icon { width: 14px; height: 14px; vertical-align: middle; margin-right: 0.2rem; opacity: 0.7; }
	.ai-reasoning {
		font-size: 0.75rem; color: #8b9cf7; font-style: italic;
		padding: 0.3rem 0.5rem; margin: 0.2rem 0;
		background: rgba(139, 156, 247, 0.06); border-radius: 4px;
		border-left: 2px solid rgba(139, 156, 247, 0.3);
	}
	.discussion-thread { margin: 0.3rem 0; }
	.discussion-turn {
		padding: 0.25rem 0.4rem; margin: 0.15rem 0;
		border-radius: 4px; font-size: 0.75rem;
	}
	.turn-researcher {
		background: rgba(245, 158, 11, 0.08);
		border-left: 2px solid rgba(245, 158, 11, 0.4);
	}
	.turn-ai {
		background: rgba(139, 156, 247, 0.06);
		border-left: 2px solid rgba(139, 156, 247, 0.3);
	}
	.turn-role {
		font-size: 0.68rem; font-weight: 600; display: block;
		margin-bottom: 0.1rem;
	}
	.turn-researcher .turn-role { color: #f59e0b; }
	.turn-ai .turn-role { color: #8b9cf7; }
	.turn-content { color: #c9cdd5; display: block; white-space: pre-wrap; }
	.discuss-form {
		display: flex; gap: 0.3rem; margin-top: 0.3rem;
	}
	.discuss-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a;
		border-radius: 4px; padding: 0.3rem 0.5rem;
		color: #c9cdd5; font-size: 0.75rem;
	}
	.discuss-form input:focus { border-color: #8b9cf7; outline: none; }
	.discuss-form button { border-color: #8b9cf7; color: #8b9cf7; }
	.discuss-form button:hover:not(:disabled) { background: rgba(139, 156, 247, 0.1); }
	.discuss-form button:disabled { opacity: 0.4; }

	/* Naming act prompt */
	.act-prompt-bar, .act-prompt {
		background: #161822; border: 1px solid #f59e0b; border-radius: 8px;
		padding: 0.75rem 1rem; margin: 0 1rem 0.5rem;
	}
	.act-header { font-size: 0.85rem; color: #c9cdd5; margin-bottom: 0.4rem; }
	.act-existing-memos {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.4rem;
		max-height: 120px; overflow-y: auto;
	}
	.act-existing-label { font-size: 0.75rem; color: #8b9cf7; }
	.act-existing-memo {
		padding: 0.2rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.8rem; color: #c9cdd5;
	}
	.act-existing-memo:last-child { border-bottom: none; }
	.act-memo-label { color: #f59e0b; font-size: 0.75rem; }
	.act-memo-content { display: block; color: #a0a4b0; font-size: 0.78rem; margin-top: 0.1rem; }
	.act-prompt-bar textarea, .act-prompt textarea {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; color: #e1e4e8; font-size: 0.85rem; resize: vertical;
		font-family: inherit;
	}
	.act-prompt-bar textarea:focus, .act-prompt textarea:focus { outline: none; border-color: #8b9cf7; }
	.act-links-toggle { margin-top: 0.35rem; }
	.act-links-list {
		display: flex; flex-direction: column; gap: 0.15rem;
		max-height: 150px; overflow-y: auto;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem; margin-top: 0.25rem;
	}
	.act-link-item {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #c9cdd5; cursor: pointer;
		padding: 0.15rem 0.2rem; border-radius: 3px;
	}
	.act-link-item:hover { background: #1e2030; }
	.act-link-item input[type="checkbox"] { accent-color: #8b9cf7; }
	.act-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }

	/* Map nodes */
	.map-node {
		background: #161822;
		border: 2px solid var(--el-color, #8b9cf7);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		min-width: 80px;
		max-width: 220px;
	}
	.map-node.ai-suggested {
		border-style: dashed;
		border-color: rgba(139, 156, 247, 0.5);
		background: rgba(139, 156, 247, 0.04);
	}
	.map-node.ai-withdrawn {
		opacity: 0.3;
		border-color: rgba(139, 156, 247, 0.2);
	}
	.map-node.phase-dimmed { opacity: 0.85; transition: opacity 0.3s; }
	.map-node.phase-member {
		animation: phase-pulse 2s ease-in-out infinite;
		--pulse-color: var(--phase-color, #8b9cf7);
	}
	@keyframes phase-pulse {
		0%, 100% { box-shadow: 0 0 6px var(--pulse-color); }
		50% { box-shadow: 0 0 20px var(--pulse-color), inset 0 0 0 2px var(--pulse-color); }
	}
	.node-header {
		display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.15rem;
	}
	.designation-dot {
		width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
	}
	.prov-icon { width: 12px; height: 12px; opacity: 0.5; }
	.node-designation {
		font-size: 0.6rem; color: var(--el-color); text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.phase-dots {
		display: inline-flex; gap: 2px; margin-left: auto;
	}
	.phase-dot {
		width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0;
	}
	.node-label {
		font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block;
	}
	.collapsed-hint {
		font-size: 0.65rem; color: #4b5563; font-style: italic;
	}

	/* Relation nodes */
	.relation-node {
		border-radius: 16px;
		padding: 0.25rem 0.5rem;
		min-width: 36px;
		text-align: center;
		background: #141620;
	}
	.rel-valence {
		font-size: 0.7rem; color: #8b8fa3; display: block;
	}
	.rel-label {
		font-size: 0.75rem; color: #c9cdd5;
	}
	.rel-label.unnamed {
		color: #4b5563; font-style: italic; font-size: 0.65rem;
	}

	/* Silence nodes */
	.silence-node {
		border-style: dashed;
		border-color: #4b5563;
		opacity: 0.7;
		background: #0f1117;
	}

	/* Inline rename */
	.inline-rename { display: flex; gap: 0.3rem; align-items: center; }
	.inline-rename input {
		background: #0f1117; border: 1px solid #8b9cf7; border-radius: 4px;
		padding: 0.15rem 0.35rem; color: #e1e4e8; font-size: 0.85rem; width: 140px;
	}

	/* Context menu */
	.context-menu {
		position: fixed; z-index: 200;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.35rem 0; min-width: 160px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.ctx-header {
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #6b7280;
		border-bottom: 1px solid #2a2d3a; margin-bottom: 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.ctx-item {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.ctx-item:hover { background: #2a2d3a; }
	.ctx-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }

	/* Overlay forms */
	.overlay-form {
		position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%);
		background: #161822; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.75rem 1rem; min-width: 320px; z-index: 150;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.overlay-form label { display: flex; flex-direction: column; gap: 0.1rem; margin-bottom: 0.4rem; }
	.overlay-form input[type="text"], .overlay-form textarea {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.35rem 0.5rem; color: #e1e4e8; font-size: 0.85rem; font-family: inherit;
		width: 100%; box-sizing: border-box;
	}
	.overlay-form input:focus, .overlay-form textarea:focus { outline: none; border-color: #8b9cf7; }
	.field-label { font-size: 0.65rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
	.toggle-label {
		flex-direction: row !important; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #8b8fa3; cursor: pointer;
	}
	.toggle-label input[type="checkbox"] { accent-color: #8b9cf7; }
	.rel-form-header {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.9rem; color: #e1e4e8; margin-bottom: 0.5rem;
	}
	.arrow { color: #8b9cf7; }
	.act-header { font-size: 0.85rem; color: #c9cdd5; margin-bottom: 0.4rem; }
	.act-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }

	/* Floating stack panel (canvas) */
	.canvas-stack-panel {
		position: absolute; top: 0.75rem; right: 0.75rem;
		width: 320px; max-height: calc(100% - 1.5rem);
		overflow-y: auto;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem; z-index: 20;
		box-shadow: 0 4px 12px rgba(0,0,0,0.4);
	}
	.stack-panel-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.stack-title { font-size: 0.9rem; font-weight: 600; color: #e1e4e8; }
	.btn-remove { color: #ef4444; border-color: #ef4444; font-size: 0.7rem; padding: 0 0.3rem; margin-left: auto; }
	.btn-remove:hover { background: rgba(239, 68, 68, 0.1); }
	.stack-header {
		display: flex; align-items: center; justify-content: space-between;
		font-size: 0.85rem; color: #c9cdd5; margin-bottom: 0.4rem;
	}
	.stack-section { margin-bottom: 0.3rem; }
	.stack-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.15rem;
	}
	.stack-entry {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.75rem; color: #8b8fa3; padding: 0.1rem 0;
	}
	.se-value { color: #c9cdd5; }
	.se-by { color: #6b7280; }
	.se-by::before { content: '- '; }
	.se-date { color: #4b5563; margin-left: auto; font-size: 0.7rem; }

	/* Sidebar */
	.sidebar {
		width: 220px; background: #13151e; border-left: 1px solid #2a2d3a;
		padding: 1rem; overflow-y: auto; flex-shrink: 0;
	}
	.sidebar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
	.sidebar-header h3 { font-size: 0.85rem; color: #8b8fa3; margin: 0; }
	.phase-form { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
	.phase-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.phase-form input:focus { outline: none; border-color: #8b9cf7; }
	.empty-small { color: #6b7280; font-size: 0.8rem; }
	.phase-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.3rem;
	}
	.phase-card.assigning { border-color: #10b981; }
	.phase-card.phase-active { background: #1e2030; }
	.declined-phase { margin-top: 0.5rem; border-style: dashed; }
	.declined-hint { font-size: 0.65rem; color: #6b7280; }
	.phase-header { display: flex; justify-content: space-between; align-items: center; }
	.phase-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	.phase-label.clickable { cursor: pointer; }
	.phase-label.clickable:hover { color: #8b9cf7; }
	.phase-count { font-size: 0.7rem; color: #6b7280; }
	.phase-contents { border-top: 1px solid #2a2d3a; padding-top: 0.3rem; margin-top: 0.25rem; }
	.phase-element {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0; font-size: 0.75rem; color: #c9cdd5;
	}
	.phase-el-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Selection info */
	.selection-info {
		margin-top: 1rem; border-top: 1px solid #2a2d3a; padding-top: 0.75rem;
	}
	.selection-info h4 { font-size: 0.75rem; color: #6b7280; margin: 0 0 0.3rem; text-transform: uppercase; }
	.selected-item {
		display: flex; align-items: center; gap: 0.3rem;
		font-size: 0.8rem; color: #c9cdd5; padding: 0.1rem 0;
	}

	/* AI notification */
	.ai-notification {
		position: fixed; bottom: 1.5rem; right: 240px; z-index: 100;
		background: #1e2030; border: 1px solid #8b9cf7; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.8rem; color: #c9cdd5;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}
	.topo-panel {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.6rem 0.8rem; margin: 0 1rem 0.5rem;
		max-height: 200px; overflow-y: auto;
	}
	.topo-header {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.8rem; color: #c9cdd5; margin-bottom: 0.4rem;
	}
	.topo-header span:first-child { flex: 1; }
	.topo-empty { font-size: 0.75rem; color: #4b5563; }
	.topo-entry {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.25rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.78rem;
	}
	.topo-entry:last-child { border-bottom: none; }
	.topo-label { color: #f59e0b; flex: 1; }
	.topo-meta { color: #4b5563; font-size: 0.7rem; }
</style>
