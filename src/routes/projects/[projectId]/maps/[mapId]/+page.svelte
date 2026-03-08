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
	let actType = $state<'rename' | 'designate'>('rename');
	let actNewValue = $state('');
	let actMemo = $state('');

	// Inline editing
	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	// Relation form
	let relInscription = $state('');
	let relValence = $state('');
	let relDirected = $state(true);

	// Stack panel
	let stackId = $state<string | null>(null);
	let stackData = $state<{ inscriptions: any[]; designations: any[] } | null>(null);

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

	let highlightedPhase = $state<string | null>(null);

	// Build a lookup: phaseId → color (for consistent coloring)
	const phaseColorMap = $derived(
		new Map(phases.map((p: any, i: number) => [p.id, regionColor(i)]))
	);

	// Check if a node is a member of the highlighted phase
	function isPhaseHighlighted(node: any): boolean {
		if (!highlightedPhase) return false;
		return node.phase_ids?.includes(highlightedPhase) ?? false;
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
		const node = findNode(namingId);
		const w = estimateNodeWidth(node);
		const h = node?.mode === 'relation' ? 36 : 50;
		return { x: pos.x + w / 2, y: pos.y + h / 2 };
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
		await mapAction('relate', {
			sourceId: relatingFrom,
			targetId: relatingTo,
			inscription: relInscription.trim() || undefined,
			valence: relValence.trim() || undefined,
			symmetric: !relDirected
		});
		relatingFrom = null;
		relatingTo = null;
		await reload();
		await layoutNewNodes();
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
		editingId = null;
		editingValue = '';
	}

	async function submitAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue, memoText: actMemo.trim() || undefined });
		} else {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue, memoText: actMemo.trim() || undefined });
		}
		cancelAct();
		await reload();
	}

	async function skipAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		cancelAct();
		await reload();
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
	}

	// ─── Stack ───

	async function showStack(namingId: string) {
		if (stackId === namingId) { stackId = null; stackData = null; return; }
		stackId = namingId;
		stackData = await mapAction('getStack', { namingId });
	}

	// ─── Phases ───

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
			<button class="btn-sm" onclick={runAutoLayout} title="Re-compute layout">Layout</button>
			<button class="btn-ai-toggle" class:ai-active={aiEnabled} onclick={toggleAi}>AI</button>
			<button class="btn-sm" onclick={requestAnalysis} disabled={!aiEnabled}>Ask AI</button>
		</div>
	</div>

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

	<div class="map-workspace">
		<!-- Canvas -->
		<div class="canvas-container">
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
						<CanvasConnection
							x1={srcCenter.x} y1={srcCenter.y}
							x2={relCenter.x} y2={relCenter.y}
							color={designationColor(rel.designation)}
							directed={isDirected}
						/>
						<CanvasConnection
							x1={relCenter.x} y1={relCenter.y}
							x2={tgtCenter.x} y2={tgtCenter.y}
							color={designationColor(rel.designation)}
							directed={isDirected}
						/>
					{/if}
				{/each}

				<!-- Element nodes -->
				{#each elements as el}
					{@const pos = positions.get(el.naming_id)}
					{#if pos}
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
							<div class="map-node" class:ai-suggested={el.properties?.aiSuggested} class:phase-member={highlightedPhase && isPhaseHighlighted(el)} class:phase-dimmed={highlightedPhase && !isPhaseHighlighted(el)}
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
					{#if pos}
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
							<div class="map-node relation-node" class:ai-suggested={rel.properties?.aiSuggested} class:phase-member={highlightedPhase && isPhaseHighlighted(rel)} class:phase-dimmed={highlightedPhase && !isPhaseHighlighted(rel)}
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
					{#if pos}
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

			<!-- Relation form overlay -->
			{#if relatingFrom && relatingTo}
				<div class="overlay-form">
					<div class="rel-form-header">
						{findInscription(relatingFrom)}
						{#if relDirected}<span class="arrow">-></span>{:else}<span class="arrow">&lt;-&gt;</span>{/if}
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

			<!-- Naming act prompt -->
			{#if actTarget}
				{@const actNode = findNode(actTarget)}
				<div class="overlay-form act-prompt">
					<div class="act-header">
						{#if actType === 'rename'}
							Rename: <strong>{actNode?.inscription}</strong> -> <strong>{actNewValue}</strong>
						{:else}
							Designate: <strong>{actNode?.inscription}</strong> ->
							<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
						{/if}
					</div>
					<textarea placeholder="What influenced this act?" bind:value={actMemo} rows="2"></textarea>
					<div class="act-actions">
						<button class="btn-primary btn-sm-primary" onclick={submitAct}>Apply + memo</button>
						<button class="btn-link" onclick={skipAct}>skip memo</button>
						<button class="btn-link" onclick={cancelAct}>cancel</button>
					</div>
				</div>
			{/if}

			<!-- Stack panel -->
			{#if stackId && stackData}
				{@const stackNode = findNode(stackId)}
				<div class="overlay-form stack-panel">
					<div class="stack-header">
						Stack: <strong>{stackNode?.inscription || '?'}</strong>
						<button class="btn-xs" onclick={() => { stackId = null; stackData = null; }}>close</button>
					</div>
					{#if stackData.inscriptions.length > 1}
						<div class="stack-section">
							<span class="stack-label">Inscriptions</span>
							{#each stackData.inscriptions as hi}
								<div class="stack-entry">
									<span class="se-value">{hi.inscription}</span>
									<span class="se-by">{hi.by_inscription}</span>
									<span class="se-date">{new Date(hi.created_at).toLocaleString()}</span>
								</div>
							{/each}
						</div>
					{/if}
					<div class="stack-section">
						<span class="stack-label">Designations</span>
						{#each stackData.designations as hd}
							<div class="stack-entry">
								<span class="designation-dot-sm" style="background: {designationColor(hd.designation)}"></span>
								<span class="se-value">{hd.designation}</span>
								<span class="se-by">{hd.by_inscription}</span>
							</div>
						{/each}
					</div>
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
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
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
	.act-prompt { border-color: #f59e0b; }
	.act-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }

	/* Stack panel */
	.stack-panel { bottom: auto; top: 1rem; right: 240px; left: auto; transform: none; min-width: 280px; }
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
</style>
