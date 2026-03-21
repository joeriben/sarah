import { computeLayout, computeRadialLayout } from '$lib/canvas/layout.js';
import { computeSpatialRelations, type Formation } from '$lib/canvas/geometry.js';
import type { MapState } from './mapState.svelte.js';

export type CanvasPositions = ReturnType<typeof createCanvasPositions>;

/**
 * Canvas position management: layout, radial center-on, spatial sync (SW/A),
 * topology snapshots, and position persistence.
 *
 * Extracted from +page.svelte to isolate the ~250 lines of position/layout
 * logic that have no business in the page orchestrator.
 */
export function createCanvasPositions(
	ms: MapState,
	viewport: { x: number; y: number; zoom: number },
) {
	const POS_AXIS_LEN = 800;

	// ─── Positions ───

	let positions = $state<Map<string, { x: number; y: number }>>(new Map());
	let layoutInitialized = false;

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

	// ─── Spatial relation sync (SW/A maps) ───

	let spatialSyncPending = false;
	let spatialSyncQueued = false;

	// ─── Init & layout ───

	function initIfNeeded() {
		if (layoutInitialized) return;
		const allNodes = [...ms.elements, ...ms.relations, ...ms.silences];
		if (allNodes.length === 0) return;
		layoutInitialized = true;
		initPositions(allNodes);
	}

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
				const px = node.properties?.x;
				const py = node.properties?.y;
				if (typeof px === 'number' && typeof py === 'number') {
					merged.set(node.naming_id, { x: px, y: py });
					continue;
				}
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
			const merged = new Map(positions);
			for (const node of unpositioned) {
				const px = node.properties?.x;
				const py = node.properties?.y;
				if (typeof px === 'number' && typeof py === 'number') {
					merged.set(node.naming_id, { x: px, y: py });
				}
			}
			const stillUnpositioned = unpositioned.filter((n: any) => !merged.has(n.naming_id));
			if (stillUnpositioned.length > 0) {
				const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
				for (const [id, p] of result.positions) {
					if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y });
				}
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

	// ─── Radial center-on ───

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

	// ─── Drag handler (clamps for positional maps) ───

	function handleNodeDragEnd(id: string, x: number, y: number) {
		if (ms.mapType === 'positional') {
			x = Math.max(10, Math.min(POS_AXIS_LEN - 10, x));
			y = Math.max(-POS_AXIS_LEN + 10, Math.min(-10, y));
		}
		positions = new Map(positions).set(id, { x, y });
		if (!centeredId) ms.mapAction('updatePosition', { namingId: id, x, y }).then(() => syncSpatialRelations());
	}

	// ─── Topology ───

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

	async function loadTopoSnapshots(): Promise<any[]> {
		const res = await ms.mapAction('listTopologySnapshots');
		return res?.snapshots || [];
	}

	// ─── Auto-layout ───

	async function runAutoLayout() {
		centeredId = null; preRadialPositions = null;
		const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, p] of result.positions) newPos.set(id, { x: p.x, y: p.y });
		positions = newPos;
		await saveAllPositions(newPos);
	}

	// ─── Formation resize/rotate (SW/A maps, needs spatial sync) ───

	async function handleFormationResize(namingId: string, newRx: number, newRy: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rx: newRx, ry: newRy } });
		await ms.reload(); syncSpatialRelations();
	}

	async function handleFormationRotate(namingId: string, newRotation: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rotation: newRotation } });
		await ms.reload(); syncSpatialRelations();
	}

	return {
		POS_AXIS_LEN,

		// Position data
		get positions() { return positions; },
		nodeCenter,

		// Center-on
		get centeredId() { return centeredId; },
		get centeredConnections() { return centeredConnections; },
		centerOn,
		uncenter,

		// Layout
		initIfNeeded,
		layoutNewNodes,
		runAutoLayout,
		handleNodeDragEnd,

		// Formation operations (SW/A)
		handleFormationResize,
		handleFormationRotate,

		// Topology
		saveTopologyBuffer,
		saveTopologySnapshot,
		restoreTopologySnapshot,
		loadTopoSnapshots,
		positionsToObj,
	};
}
