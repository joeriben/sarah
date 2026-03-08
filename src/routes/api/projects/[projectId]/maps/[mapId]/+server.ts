import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getMap,
	getMapStructure,
	addElementToMap,
	relateElements,
	createPhase,
	assignToPhase,
	removeFromPhase,
	getPhaseMembershipHistory,
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
import { createMemo, getMemosForNaming } from '$lib/server/db/queries/memos.js';
import { runMapAgent, setAiEnabled } from '$lib/server/ai/agent.js';

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

	switch (action) {
		case 'addElement': {
			const { inscription, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const element = await addElementToMap(projectId, userId, mapId, inscription.trim(), properties);
			// Fire AI agent asynchronously — never blocks the response
			runMapAgent(projectId, mapId, { action: 'addElement', details: { inscription: inscription.trim() } }).catch(() => {});
			return json(element, { status: 201 });
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

		case 'createPhase': {
			const { inscription, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const phase = await createPhase(projectId, userId, mapId, inscription.trim(), properties);
			return json(phase, { status: 201 });
		}

		case 'assignToPhase': {
			const { phaseId, namingId, mode, properties } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const appearance = await assignToPhase(phaseId, namingId, mode, properties, researcherNamingId);
			return json(appearance);
		}

		case 'removeFromPhase': {
			const { phaseId, namingId } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			await removeFromPhase(phaseId, namingId, researcherNamingId);
			return json({ ok: true });
		}

		case 'getPhaseMembershipHistory': {
			const { phaseId } = body;
			if (!phaseId) return json({ error: 'phaseId required' }, { status: 400 });
			const history = await getPhaseMembershipHistory(phaseId);
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
			const stack = await getNamingStack(namingId);
			return json(stack);
		}

		case 'setCollapse': {
			const { namingId, collapseAt } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const result = await setCollapse(namingId, mapId, collapseAt ?? null);
			return json(result || { ok: true });
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

		case 'getMemosForNaming': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const memos = await getMemosForNaming(namingId, projectId);
			return json({ memos });
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

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
