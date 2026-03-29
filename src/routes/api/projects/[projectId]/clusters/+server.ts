import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getProjectClusters,
	getClusterMembers,
	getClusterPassages,
	createProjectCluster,
	assignToCluster,
	removeFromCluster
} from '$lib/server/db/queries/maps.js';
import { getOrCreateResearcherNaming } from '$lib/server/db/queries/namings.js';

export const GET: RequestHandler = async ({ params }) => {
	const clusters = await getProjectClusters(params.projectId);
	return json({ clusters });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { action } = body;
	const { projectId } = params;
	const userId = locals.user!.id;

	switch (action) {
		case 'create': {
			const { inscription } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const cluster = await createProjectCluster(projectId, userId, inscription.trim());
			return json(cluster, { status: 201 });
		}

		case 'getMembers': {
			const { clusterId } = body;
			if (!clusterId) return json({ error: 'clusterId required' }, { status: 400 });
			const members = await getClusterMembers(clusterId);
			return json({ members });
		}

		case 'getPassages': {
			const { clusterId } = body;
			if (!clusterId) return json({ error: 'clusterId required' }, { status: 400 });
			const passages = await getClusterPassages(clusterId, projectId);
			return json({ passages });
		}

		case 'assign': {
			const { clusterId, namingId } = body;
			if (!clusterId || !namingId) return json({ error: 'clusterId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const appearance = await assignToCluster(clusterId, namingId, undefined, undefined, researcherNamingId);
			return json(appearance);
		}

		case 'remove': {
			const { clusterId, namingId } = body;
			if (!clusterId || !namingId) return json({ error: 'clusterId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			await removeFromCluster(clusterId, namingId, researcherNamingId);
			return json({ ok: true });
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
