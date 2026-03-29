import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getMap,
	getMapStructure,
	addElementToMap,
	placeExistingOnMap,
	placeMultipleOnMap,
	searchNamingsForPlacement,
	getOutsideParticipations,
	getDocumentNamingsForPlacement,
	relateElements,
	withdrawRelation,
	createProjectCluster,
	assignToCluster,
	removeFromCluster,
	getClusterMembershipHistory,
	setCollapse,
	getNamingStack
} from '$lib/server/db/queries/maps.js';
import {
	designate,
	getOrCreateResearcherNaming,
	renameNaming,
	getInscriptionHistory,
	getDesignationHistory,
	getNaming
} from '$lib/server/db/queries/namings.js';
import { createMemo, getMemosForNaming, updateMemoStatus, promoteMemoToNaming } from '$lib/server/db/queries/memos.js';
import { getDocNetsByProject, getDocNetGroundedNamings } from '$lib/server/db/queries/docnets.js';
import { runMapAgent, setAiEnabled, discussCue, discussMemo } from '$lib/server/ai/runtime/index.js';
import { saveTopologyBuffer, saveTopologySnapshot, restoreTopologySnapshot, listTopologySnapshots } from '$lib/server/db/queries/topology.js';
import { SW_ROLE_DEFAULTS } from '$lib/shared/constants.js';

export const GET: RequestHandler = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) return json({ error: 'Not found' }, { status: 404 });

	const structure = await getMapStructure(params.mapId, params.projectId);

	return json({ map, ...structure });
};

// POST handles all map mutations via an "action" field
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { action } = body;
	const { projectId, mapId } = params;
	const userId = locals.user!.id;

	// Read-only maps: reject all mutations except read-only queries
	const readOnlyActions = ['getStack', 'getHistory', 'getOutsideParticipations', 'getMemosForNaming',
		'searchForPlacement', 'listDocumentsForImport', 'getDocumentNamings', 'listTopologySnapshots',
		'getClusterMembershipHistory'];
	if (!readOnlyActions.includes(action)) {
		const map = await getMap(mapId, projectId);
		if (map?.properties?.readOnly) {
			return json({ error: 'This map is read-only (template). Copy the project to make changes.' }, { status: 403 });
		}
	}

	switch (action) {
		case 'addElement': {
			const { inscription, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const element = await addElementToMap(projectId, userId, mapId, inscription.trim(), properties);
			// Fire AI agent asynchronously — never blocks the response
			runMapAgent(projectId, mapId, { action: 'addElement', details: { inscription: inscription.trim() } }).catch(() => {});
			return json(element, { status: 201 });
		}

		case 'addFormation': {
			const { inscription, swRole, memoText, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			if (!swRole) return json({ error: 'swRole required' }, { status: 400 });
			const defaults = SW_ROLE_DEFAULTS[swRole as keyof typeof SW_ROLE_DEFAULTS] || SW_ROLE_DEFAULTS['social-world'];
			const element = await addElementToMap(projectId, userId, mapId, inscription.trim(),
				{ ...defaults, ...properties });
			// Classification memo: the naming act that establishes what formation this is
			await createMemo(projectId, userId, `Formation: ${swRole}`,
				memoText?.trim() || '', [element.id]);
			runMapAgent(projectId, mapId, { action: 'addFormation', details: { inscription: inscription.trim(), swRole } }).catch(() => {});
			return json(element, { status: 201 });
		}

		case 'placeExisting': {
			const { namingId, mode, properties } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const placed = await placeExistingOnMap(projectId, userId, mapId, namingId, mode, properties);
			if (!placed) return json({ error: 'Naming not found or already on this map' }, { status: 409 });
			return json(placed, { status: 201 });
		}

		case 'searchForPlacement': {
			const { query: searchQuery } = body;
			if (!searchQuery?.trim()) return json({ results: [] });
			const results = await searchNamingsForPlacement(projectId, mapId, searchQuery.trim());
			return json({ results });
		}

		case 'listDocumentsForImport': {
			const { query: dbQ } = await import('$lib/server/db/index.js');
			const docs = await dbQ(
				`SELECT n.id, n.inscription as label,
				   (SELECT count(DISTINCT ann.directed_from)
				    FROM appearances ann
				    JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
				    WHERE ann.directed_to = n.id AND ann.valence = 'codes'
				      AND NOT EXISTS (
				        SELECT 1 FROM appearances a_map
				        WHERE a_map.naming_id = code.id AND a_map.perspective_id = $2
				      )
				   )::int as importable_count
				 FROM namings n
				 JOIN document_content dc ON dc.naming_id = n.id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				 ORDER BY n.inscription`,
				[projectId, mapId]
			);
			return json({ documents: docs.rows });
		}

		case 'importFromDocument': {
			const { documentId } = body;
			if (!documentId) return json({ error: 'documentId required' }, { status: 400 });
			const candidates = await getDocumentNamingsForPlacement(projectId, mapId, documentId);
			if (candidates.length === 0) return json({ placed: 0, message: 'No new namings to import' });
			const placed = await placeMultipleOnMap(projectId, userId, mapId, candidates.map((c: any) => c.id));
			return json({ placed, total: candidates.length });
		}

		case 'listDocNetsForImport': {
			const docnets = await getDocNetsByProject(projectId);
			// For each docnet, count how many grounded namings are NOT yet on this map
			const enriched = await Promise.all(docnets.map(async (dn: any) => {
				const grounded = await getDocNetGroundedNamings(dn.id, projectId);
				const { query: dbQ } = await import('$lib/server/db/index.js');
				let importableCount = 0;
				for (const g of grounded) {
					const onMap = await dbQ(
						`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 LIMIT 1`,
						[g.id, mapId]
					);
					if (onMap.rows.length === 0) importableCount++;
				}
				return { id: dn.id, label: dn.label, document_count: dn.document_count, importable_count: importableCount };
			}));
			return json({ docnets: enriched });
		}

		case 'importFromDocNet': {
			const { docnetId } = body;
			if (!docnetId) return json({ error: 'docnetId required' }, { status: 400 });
			const grounded = await getDocNetGroundedNamings(docnetId, projectId);
			// Filter to only those not already on this map
			const { query: dbQ } = await import('$lib/server/db/index.js');
			const toPlace: string[] = [];
			for (const g of grounded) {
				const onMap = await dbQ(
					`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 LIMIT 1`,
					[g.id, mapId]
				);
				if (onMap.rows.length === 0) toPlace.push(g.id);
			}
			if (toPlace.length === 0) return json({ placed: 0, message: 'No new namings to import' });
			const placed = await placeMultipleOnMap(projectId, userId, mapId, toPlace);
			return json({ placed, total: toPlace.length });
		}

		case 'getDocumentNamings': {
			const { documentId } = body;
			if (!documentId) return json({ error: 'documentId required' }, { status: 400 });
			const namings = await getDocumentNamingsForPlacement(projectId, mapId, documentId);
			return json({ namings });
		}

		case 'getOutsideParticipations': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const outside = await getOutsideParticipations(mapId, projectId, namingId);
			return json({ participations: outside });
		}

		case 'relate': {
			const { sourceId, targetId, inscription, valence, symmetric, properties } = body;
			if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });
			const relation = await relateElements(projectId, userId, mapId, sourceId, targetId, {
				inscription, valence, symmetric, properties
			});
			// Resolve inscriptions for AI context
			const [srcNaming, tgtNaming] = await Promise.all([getNaming(sourceId, projectId), getNaming(targetId, projectId)]);
			runMapAgent(projectId, mapId, {
				action: 'relate',
				details: {
					sourceInscription: (srcNaming as any)?.inscription || sourceId,
					targetInscription: (tgtNaming as any)?.inscription || targetId,
					inscription, valence
				}
			}).catch(() => {});
			return json(relation, { status: 201 });
		}

		case 'createCluster': {
			const { inscription } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const cluster = await createProjectCluster(projectId, userId, inscription.trim());
			return json(cluster, { status: 201 });
		}

		case 'assignToCluster': {
			const { clusterId, namingId, mode, properties } = body;
			if (!clusterId || !namingId) return json({ error: 'clusterId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const appearance = await assignToCluster(clusterId, namingId, mode, properties, researcherNamingId);
			return json(appearance);
		}

		case 'removeFromCluster': {
			const { clusterId, namingId } = body;
			if (!clusterId || !namingId) return json({ error: 'clusterId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			await removeFromCluster(clusterId, namingId, researcherNamingId);
			return json({ ok: true });
		}

		case 'getClusterMembershipHistory': {
			const { clusterId } = body;
			if (!clusterId) return json({ error: 'clusterId required' }, { status: 400 });
			const history = await getClusterMembershipHistory(clusterId);
			return json({ memberships: history });
		}

		case 'designate': {
			const { namingId, designation, memoText, linkedNamingIds } = body;
			if (!namingId || !designation) return json({ error: 'namingId and designation required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const result = await designate(namingId, designation, researcherNamingId);

			// Create memo-naming for this act of designation
			if (memoText?.trim() || (linkedNamingIds && linkedNamingIds.length > 0)) {
				const links = [namingId, ...(linkedNamingIds || [])];
				await createMemo(
					projectId, userId,
					`Designation → ${designation}`,
					memoText?.trim() || '',
					links
				);
			}

			return json(result);
		}

		case 'rename': {
			const { namingId, inscription, memoText, linkedNamingIds } = body;
			if (!namingId || !inscription?.trim()) return json({ error: 'namingId and inscription required' }, { status: 400 });
			const result = await renameNaming(namingId, projectId, userId, inscription.trim());

			// Create memo-naming for this act of re-naming
			if (memoText?.trim() || (linkedNamingIds && linkedNamingIds.length > 0)) {
				const links = [namingId, ...(linkedNamingIds || [])];
				await createMemo(
					projectId, userId,
					`Rename → ${inscription.trim()}`,
					memoText?.trim() || '',
					links
				);
			}

			return json(result);
		}

		case 'getHistory': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const [inscriptions, designations] = await Promise.all([
				getInscriptionHistory(namingId),
				getDesignationHistory(namingId)
			]);
			return json({ inscriptions, designations });
		}

		case 'getStack': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const stack = await getNamingStack(namingId, projectId);
			return json(stack);
		}

		case 'setCollapse': {
			const { namingId, collapseAt } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const result = await setCollapse(namingId, mapId, collapseAt ?? null);
			return json(result || { ok: true });
		}

		case 'withdraw': {
			const { namingId, withdrawn } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const flag = withdrawn !== false;
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = properties || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify({ withdrawn: flag }), namingId, mapId]
				)
			);
			return json({ ok: true, withdrawn: flag });
		}

		case 'toggleAi': {
			const { enabled } = body;
			await setAiEnabled(mapId, enabled !== false);
			return json({ ok: true, aiEnabled: enabled !== false });
		}

		case 'requestAnalysis': {
			await runMapAgent(projectId, mapId, { action: 'requestAnalysis', details: {} });
			return json({ ok: true });
		}

		case 'discussCue': {
			const { namingId, message } = body;
			if (!namingId || !message?.trim()) return json({ error: 'namingId and message required' }, { status: 400 });
			try {
				const result = await discussCue(projectId, mapId, namingId, message.trim(), userId);
				return json(result);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 500 });
			}
		}

		case 'discussMemo': {
			const { memoId, message } = body;
			if (!memoId || !message?.trim()) return json({ error: 'memoId and message required' }, { status: 400 });
			try {
				const result = await discussMemo(projectId, mapId, memoId, message.trim(), userId);
				return json(result);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 500 });
			}
		}

		case 'getMemosForNaming': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const memos = await getMemosForNaming(namingId, projectId);
			return json({ memos });
		}

		case 'syncSpatialRelations': {
			const { add, remove } = body;
			const results = { added: 0, removed: 0 };

			// Remove stale spatial relations (withdraw, not hard-delete)
			if (remove && Array.isArray(remove)) {
				for (const relId of remove) {
					await withdrawRelation(relId, mapId);
					results.removed++;
				}
			}

			// Add new spatial relations
			if (add && Array.isArray(add)) {
				for (const rel of add) {
					await relateElements(projectId, userId, mapId, rel.sourceId, rel.targetId, {
						valence: rel.valence,
						symmetric: rel.symmetric || false,
						properties: { spatiallyDerived: true },
						skipDesignationAdvance: true,
					});
					results.added++;
				}
			}

			// No AI agent trigger — spatial sync is high-frequency
			return json(results);
		}

		case 'updatePosition': {
			const { namingId, x, y } = body;
			if (!namingId || x == null || y == null) return json({ error: 'namingId, x, y required' }, { status: 400 });
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify({ x, y }), namingId, mapId]
				)
			);
			return json({ ok: true });
		}

		case 'updateProperties': {
			const { namingId, properties } = body;
			if (!namingId || !properties || typeof properties !== 'object') return json({ error: 'namingId and properties object required' }, { status: 400 });
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify(properties), namingId, mapId]
				)
			);
			return json({ ok: true });
		}

		case 'updatePositions': {
			const { positions } = body;
			if (!positions || !Array.isArray(positions)) return json({ error: 'positions array required' }, { status: 400 });
			const { query: dbQuery } = await import('$lib/server/db/index.js');
			for (const pos of positions) {
				await dbQuery(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify({ x: pos.x, y: pos.y }), pos.namingId, mapId]
				);
			}
			return json({ ok: true });
		}

		case 'saveTopologyBuffer': {
			const { positions: posData } = body;
			if (!posData) return json({ error: 'positions required' }, { status: 400 });
			await saveTopologyBuffer(mapId, posData);
			return json({ ok: true });
		}

		case 'saveTopologySnapshot': {
			const { label: snapLabel, positions: snapPositions } = body;
			const snapshot = await saveTopologySnapshot(mapId, snapLabel, snapPositions);
			return json(snapshot, { status: 201 });
		}

		case 'restoreTopologySnapshot': {
			const { seq } = body;
			if (seq == null) return json({ error: 'seq required' }, { status: 400 });
			const restored = await restoreTopologySnapshot(mapId, seq);
			if (!restored) return json({ error: 'Snapshot not found' }, { status: 404 });
			return json({ ok: true, positions: restored.positions });
		}

		case 'listTopologySnapshots': {
			const snapshots = await listTopologySnapshots(mapId);
			return json({ snapshots });
		}

		case 'updateMemoStatus': {
			const { memoId, status } = body;
			if (!memoId || !status) return json({ error: 'memoId and status required' }, { status: 400 });
			const validStatuses = ['active', 'presented', 'discussed', 'acknowledged', 'promoted', 'dismissed'];
			if (!validStatuses.includes(status)) return json({ error: 'Invalid status' }, { status: 400 });
			await updateMemoStatus(memoId, status);
			return json({ ok: true, status });
		}

		case 'promoteMemo': {
			const { memoId } = body;
			if (!memoId) return json({ error: 'memoId required' }, { status: 400 });
			const naming = await promoteMemoToNaming(projectId, userId, memoId, mapId);
			return json(naming, { status: 201 });
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
