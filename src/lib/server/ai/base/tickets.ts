// AI ticket system: bots report bugs, improvements, and suggestions.
// All personas have write access to this system.

import type { ToolDef } from '../client.js';
import { query } from '../../db/index.js';
import type { PersonaName } from '../personas/types.js';

// ── Tool definition ───────────────────────────────────────────────

export const TICKET_TOOL: ToolDef = {
	name: 'create_ticket',
	description:
		'Report a bug, suggest an improvement, or make a suggestion about the transact-qda platform. Use this when you encounter unexpected behavior, have ideas for better UX, or notice inconsistencies in the system. Your ticket will be reviewed by the development team.',
	input_schema: {
		type: 'object' as const,
		properties: {
			type: {
				type: 'string',
				enum: ['bug', 'improvement', 'suggestion'],
				description: 'Type of ticket: bug (something broken), improvement (existing feature could be better), suggestion (new idea)'
			},
			title: {
				type: 'string',
				description: 'Short, descriptive title for the ticket'
			},
			description: {
				type: 'string',
				description: 'Detailed description: what happened, what was expected, steps to reproduce (for bugs), or rationale (for improvements/suggestions)'
			}
		},
		required: ['type', 'title', 'description']
	}
};

// ── Ticket operations ─────────────────────────────────────────────

export async function createTicket(
	persona: PersonaName,
	type: 'bug' | 'improvement' | 'suggestion',
	title: string,
	description: string,
	context?: Record<string, unknown>
): Promise<{ id: string; title: string }> {
	const result = await query(
		`INSERT INTO ai_tickets (persona, type, title, description, context)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, title`,
		[persona, type, title, description, JSON.stringify(context || {})]
	);
	return result.rows[0] as { id: string; title: string };
}

export async function getOpenTickets(): Promise<Array<{
	id: string;
	persona: string;
	type: string;
	title: string;
	description: string;
	created_at: string;
}>> {
	const result = await query(
		`SELECT id, persona, type, title, description, created_at
		 FROM ai_tickets
		 WHERE status = 'open'
		 ORDER BY created_at DESC`
	);
	return result.rows as Array<{ id: string; persona: string; type: string; title: string; description: string; created_at: string }>;
}

export async function updateTicketStatus(
	ticketId: string,
	status: 'acknowledged' | 'resolved' | 'dismissed'
): Promise<void> {
	await query(
		`UPDATE ai_tickets
		 SET status = $1, resolved_at = CASE WHEN $1 IN ('resolved', 'dismissed') THEN now() ELSE NULL END
		 WHERE id = $2`,
		[status, ticketId]
	);
}
