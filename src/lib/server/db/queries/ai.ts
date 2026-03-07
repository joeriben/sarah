import { query, queryOne, transaction } from '../index.js';

// Get or create the AI's naming identity for a project.
// Parallel to getOrCreateResearcherNaming: the AI is a naming in the data space.
export async function getOrCreateAiNaming(
	projectId: string,
	model: string
): Promise<string> {
	const existing = await queryOne<{ naming_id: string }>(
		`SELECT naming_id FROM ai_namings WHERE project_id = $1`,
		[projectId]
	);
	if (existing) return existing.naming_id;

	return transaction(async (client) => {
		// Create the naming
		const naming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, `Claude (Analyst)`, '00000000-0000-0000-0000-000000000000']
		);
		const namingId = naming.rows[0].id;

		// Self-referential appearance: the AI appears as perspective from itself
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', '{"role": "ai-analyst"}')`,
			[namingId]
		);

		// Register the link
		await client.query(
			`INSERT INTO ai_namings (project_id, naming_id, model)
			 VALUES ($1, $2, $3)`,
			[projectId, namingId, model]
		);

		// Initial designation: the AI characterizes itself
		await client.query(
			`INSERT INTO naming_designations (naming_id, designation, by)
			 VALUES ($1, 'characterization', $1)`,
			[namingId]
		);

		return namingId;
	});
}

export async function logAiInteraction(
	projectId: string,
	aiNamingId: string,
	requestType: string,
	model: string,
	inputContext: Record<string, unknown>,
	response: Record<string, unknown>,
	tokensUsed: number
) {
	await query(
		`INSERT INTO ai_interactions (project_id, naming_id, request_type, model, input_context, response, tokens_used)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[projectId, aiNamingId, requestType, model, JSON.stringify(inputContext), JSON.stringify(response), tokensUsed]
	);
}
