// Claude tool definitions for the AI agent.
// Each tool maps to a naming act in the data space.

import type Anthropic from '@anthropic-ai/sdk';

export const AI_TOOLS: Anthropic.Messages.Tool[] = [
	{
		name: 'suggest_element',
		description:
			'Suggest a new element for the situational map. Your suggestion will appear as a cue that the researcher can accept, modify, or reject.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'The name/label for the suggested element'
				},
				reasoning: {
					type: 'string',
					description: 'Why this element might be relevant to the situation'
				}
			},
			required: ['inscription', 'reasoning']
		}
	},
	{
		name: 'suggest_relation',
		description:
			'Suggest a relation between two existing elements on the map. Reference elements by their ID.',
		input_schema: {
			type: 'object' as const,
			properties: {
				source_id: {
					type: 'string',
					description: 'ID of the source element'
				},
				target_id: {
					type: 'string',
					description: 'ID of the target element'
				},
				inscription: {
					type: 'string',
					description: 'Description of the relation'
				},
				valence: {
					type: 'string',
					description: 'Nature of the relation (e.g., enables, constrains, legitimizes, silences)'
				},
				symmetric: {
					type: 'boolean',
					description: 'Whether the relation is undirected (true) or directed from source to target (false)'
				},
				reasoning: {
					type: 'string',
					description: 'Why this relation might be important'
				}
			},
			required: ['source_id', 'target_id', 'reasoning']
		}
	},
	{
		name: 'identify_silence',
		description:
			'Point out a notable absence — something or someone missing from the situational map. In Situational Analysis, silences are as analytically important as presences.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'What is absent/silenced'
				},
				reasoning: {
					type: 'string',
					description: 'Why this absence is notable given the situation'
				}
			},
			required: ['inscription', 'reasoning']
		}
	},
	{
		name: 'write_memo',
		description:
			'Write an analytical memo about the map or specific elements. Use this for observations, questions, tensions, or theoretical connections that don\'t fit into element/relation suggestions.',
		input_schema: {
			type: 'object' as const,
			properties: {
				title: {
					type: 'string',
					description: 'Memo title'
				},
				content: {
					type: 'string',
					description: 'Memo content: analytical observations, questions, theoretical connections'
				},
				linked_element_ids: {
					type: 'array',
					items: { type: 'string' },
					description: 'IDs of elements this memo relates to'
				}
			},
			required: ['title', 'content']
		}
	},
	{
		name: 'create_phase',
		description:
			'Suggest a phase (thematic grouping) for elements on the map. Phases are sub-perspectives that organize elements into meaningful clusters.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'Name of the phase/grouping'
				},
				element_ids: {
					type: 'array',
					items: { type: 'string' },
					description: 'IDs of elements to include in this phase'
				},
				reasoning: {
					type: 'string',
					description: 'Why these elements form a meaningful grouping'
				}
			},
			required: ['inscription', 'element_ids', 'reasoning']
		}
	}
];

// Tool call result types for the executor
export interface SuggestElementInput {
	inscription: string;
	reasoning: string;
}

export interface SuggestRelationInput {
	source_id: string;
	target_id: string;
	inscription?: string;
	valence?: string;
	symmetric?: boolean;
	reasoning: string;
}

export interface IdentifySilenceInput {
	inscription: string;
	reasoning: string;
}

export interface WriteMemoInput {
	title: string;
	content: string;
	linked_element_ids?: string[];
}

export interface CreatePhaseInput {
	inscription: string;
	element_ids: string[];
	reasoning: string;
}
