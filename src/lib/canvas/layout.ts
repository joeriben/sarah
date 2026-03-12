// ELK-based automatic layout for map namings.
// Converts map data → ELK graph → computes positions → returns position map.
// Relations are modeled as intermediate nodes (first-class objects, not edges).

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';

const elk = new ELK();

export interface LayoutNode {
	naming_id: string;
	inscription: string;
	mode: string;
	directed_from?: string | null;
	directed_to?: string | null;
	part_source_id?: string | null;
	part_target_id?: string | null;
	properties?: Record<string, unknown>;
}

export interface LayoutPosition {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutEdge {
	id: string;
	sourceId: string;
	targetId: string;
	points: Array<{ x: number; y: number }>;
}

export interface LayoutResult {
	positions: Map<string, LayoutPosition>;
	edges: LayoutEdge[];
}

function estimateWidth(text: string): number {
	return Math.max(100, Math.min(220, text.length * 8 + 40));
}

// Build an ELK graph from map data.
// Elements → full-size nodes
// Relations → small intermediate nodes with edges to their participants
// Silences → peripheral nodes
function buildElkGraph(
	elements: LayoutNode[],
	relations: LayoutNode[],
	silences: LayoutNode[],
	algorithm: 'layered' | 'stress' | 'force' = 'stress'
): ElkNode {
	const graph: ElkNode = {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': algorithm,
			'elk.spacing.nodeNode': '120',
			'elk.spacing.edgeNode': '40',
		},
		children: [],
		edges: []
	};

	// Algorithm-specific options
	if (algorithm === 'layered') {
		graph.layoutOptions!['elk.direction'] = 'RIGHT';
		graph.layoutOptions!['elk.layered.spacing.nodeNodeBetweenLayers'] = '120';
		graph.layoutOptions!['elk.edgeRouting'] = 'POLYLINE';
	} else if (algorithm === 'stress') {
		graph.layoutOptions!['elk.stress.desiredEdgeLength'] = '250';
	}

	// Track which naming_ids are elements vs relations (for meta-relation detection)
	const relationIds = new Set(relations.map(r => r.naming_id));

	// Elements as regular nodes
	for (const el of elements) {
		graph.children!.push({
			id: el.naming_id,
			width: estimateWidth(el.inscription || ''),
			height: 50,
		});
	}

	// Relations as intermediate nodes + edges to participants
	for (const rel of relations) {
		const relNodeId = `rel:${rel.naming_id}`;
		const relWidth = rel.inscription ? estimateWidth(rel.inscription) : 36;

		graph.children!.push({
			id: relNodeId,
			width: relWidth,
			height: 36,
		});

		const sourceId = rel.directed_from || rel.part_source_id;
		const targetId = rel.directed_to || rel.part_target_id;

		if (sourceId) {
			// If source is a relation, point to its intermediate node
			const srcElkId = relationIds.has(sourceId) ? `rel:${sourceId}` : sourceId;
			graph.edges!.push({
				id: `e:${rel.naming_id}:in`,
				sources: [srcElkId],
				targets: [relNodeId]
			} as ElkExtendedEdge);
		}

		if (targetId) {
			const tgtElkId = relationIds.has(targetId) ? `rel:${targetId}` : targetId;
			graph.edges!.push({
				id: `e:${rel.naming_id}:out`,
				sources: [relNodeId],
				targets: [tgtElkId]
			} as ElkExtendedEdge);
		}
	}

	// Silences as peripheral nodes (disconnected)
	for (const s of silences) {
		graph.children!.push({
			id: s.naming_id,
			width: estimateWidth(s.inscription || ''),
			height: 40,
		});
	}

	return graph;
}

// Recursively collect absolute positions from a laid-out ELK graph
function collectPositions(parent: ElkNode, offsetX: number, offsetY: number): Map<string, LayoutPosition> {
	const positions = new Map<string, LayoutPosition>();
	if (!parent.children) return positions;

	for (const child of parent.children) {
		const w = child.width ?? 0;
		const h = child.height ?? 0;
		// Convert ELK top-left to center (CanvasElement uses center-based positioning)
		const absX = offsetX + (child.x ?? 0) + w / 2;
		const absY = offsetY + (child.y ?? 0) + h / 2;
		positions.set(child.id, {
			x: absX,
			y: absY,
			width: w,
			height: h
		});
		// Recurse for compound nodes
		for (const [id, pos] of collectPositions(child, absX, absY)) {
			positions.set(id, pos);
		}
	}

	return positions;
}

// Collect edge routing from a laid-out ELK graph
function collectEdges(parent: ElkNode, offsetX: number, offsetY: number): LayoutEdge[] {
	const edges: LayoutEdge[] = [];

	if (parent.edges) {
		for (const edge of parent.edges) {
			const ext = edge as ElkExtendedEdge;
			const points: Array<{ x: number; y: number }> = [];
			if (ext.sections) {
				for (const section of ext.sections) {
					points.push({
						x: offsetX + section.startPoint.x,
						y: offsetY + section.startPoint.y
					});
					if (section.bendPoints) {
						for (const bp of section.bendPoints) {
							points.push({ x: offsetX + bp.x, y: offsetY + bp.y });
						}
					}
					points.push({
						x: offsetX + section.endPoint.x,
						y: offsetY + section.endPoint.y
					});
				}
			}
			edges.push({
				id: ext.id,
				sourceId: ext.sources[0],
				targetId: ext.targets[0],
				points
			});
		}
	}

	if (parent.children) {
		for (const child of parent.children) {
			edges.push(...collectEdges(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0)));
		}
	}

	return edges;
}

// Main entry point: compute layout for map data
export async function computeLayout(
	elements: LayoutNode[],
	relations: LayoutNode[],
	silences: LayoutNode[],
	algorithm: 'layered' | 'stress' | 'force' = 'stress'
): Promise<LayoutResult> {
	if (elements.length === 0 && relations.length === 0 && silences.length === 0) {
		return { positions: new Map(), edges: [] };
	}

	const graph = buildElkGraph(elements, relations, silences, algorithm);
	const layouted = await elk.layout(graph);
	const positions = collectPositions(layouted, 0, 0);
	const edges = collectEdges(layouted, 0, 0);

	// Map relation node IDs back: "rel:xxx" → "xxx"
	const normalizedPositions = new Map<string, LayoutPosition>();
	for (const [id, pos] of positions) {
		const normalId = id.startsWith('rel:') ? id.slice(4) : id;
		normalizedPositions.set(normalId, pos);
	}

	return { positions: normalizedPositions, edges };
}

// Radial layout centered on a selected naming.
// Center node at origin, directly connected nodes in inner ring,
// everything else in outer ring. Relation nodes midway between center and target.
// Pure geometry — no ELK, synchronous, deterministic.
export function computeRadialLayout(
	centerId: string,
	elements: LayoutNode[],
	relations: LayoutNode[],
	silences: LayoutNode[]
): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();

	// Find which nodes are directly connected to center via participations
	const directlyConnected = new Set<string>();
	const relationsBetween = new Map<string, string>(); // relationId → connected node
	for (const rel of relations) {
		const src = rel.directed_from || rel.part_source_id;
		const tgt = rel.directed_to || rel.part_target_id;
		if (src === centerId && tgt) {
			directlyConnected.add(tgt);
			relationsBetween.set(rel.naming_id, tgt);
		} else if (tgt === centerId && src) {
			directlyConnected.add(src);
			relationsBetween.set(rel.naming_id, src);
		}
	}

	// Center node at origin
	positions.set(centerId, { x: 0, y: 0 });

	// Inner ring: directly connected nodes (elements + silences, not relation nodes)
	const innerNodes = [...elements, ...silences].filter(
		n => n.naming_id !== centerId && directlyConnected.has(n.naming_id)
	);
	const innerRadius = Math.max(250, innerNodes.length * 40);
	placeInRing(innerNodes, innerRadius, positions);

	// Relation nodes: halfway between center and their connected node
	for (const [relId, connectedId] of relationsBetween) {
		const connPos = positions.get(connectedId);
		if (connPos) {
			positions.set(relId, { x: connPos.x * 0.5, y: connPos.y * 0.5 });
		}
	}

	// Relations not involving center: place near their participants if possible
	for (const rel of relations) {
		if (relationsBetween.has(rel.naming_id)) continue; // already placed
		const src = rel.directed_from || rel.part_source_id;
		const tgt = rel.directed_to || rel.part_target_id;
		const srcPos = src ? positions.get(src) : null;
		const tgtPos = tgt ? positions.get(tgt) : null;
		if (srcPos && tgtPos) {
			positions.set(rel.naming_id, {
				x: (srcPos.x + tgtPos.x) / 2,
				y: (srcPos.y + tgtPos.y) / 2
			});
		}
		// Otherwise handled as outer node below
	}

	// Outer ring: everything not yet positioned
	const allNodes = [...elements, ...relations, ...silences];
	const outerNodes = allNodes.filter(
		n => n.naming_id !== centerId && !positions.has(n.naming_id)
	);
	const outerRadius = innerRadius + Math.max(200, outerNodes.length * 30);
	placeInRing(outerNodes, outerRadius, positions);

	return positions;
}

function placeInRing(
	nodes: LayoutNode[],
	radius: number,
	positions: Map<string, { x: number; y: number }>
) {
	if (nodes.length === 0) return;
	const angleStep = (2 * Math.PI) / nodes.length;
	for (let i = 0; i < nodes.length; i++) {
		const angle = -Math.PI / 2 + i * angleStep;
		positions.set(nodes[i].naming_id, {
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius
		});
	}
}
