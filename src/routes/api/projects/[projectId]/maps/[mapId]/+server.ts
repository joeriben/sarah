import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getMap,
	getMapStructure,
	addElementToMap,
	relateElements,
	createPhase,
	assignToPhase,
	removeFromPhase
} from '$lib/server/db/queries/maps.js';
import { designate } from '$lib/server/db/queries/namings.js';
import { getOrCreateResearcherNaming } from '$lib/server/db/queries/namings.js';

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
			return json(element, { status: 201 });
		}

		case 'relate': {
			const { sourceId, targetId, inscription, valence, symmetric, properties } = body;
			if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });
			const relation = await relateElements(projectId, userId, mapId, sourceId, targetId, {
				inscription, valence, symmetric, properties
			});
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
			const appearance = await assignToPhase(phaseId, namingId, mode, properties);
			return json(appearance);
		}

		case 'removeFromPhase': {
			const { phaseId, namingId } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			await removeFromPhase(phaseId, namingId);
			return json({ ok: true });
		}

		case 'designate': {
			const { namingId, designation } = body;
			if (!namingId || !designation) return json({ error: 'namingId and designation required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const result = await designate(namingId, designation, researcherNamingId);
			return json(result);
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
