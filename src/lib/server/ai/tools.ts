// Claude tool definitions for the AI agent.
// Each tool maps to a naming act in the data space.

import type { ToolDef } from './client.js';

export const AI_TOOLS: ToolDef[] = [
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

// ── SW/A-specific tools ──

export const SUGGEST_FORMATION_TOOL: ToolDef = {
	name: 'suggest_formation',
	description:
		'Suggest a new formation (social world, arena, discourse, or organization) for the SW/A map. Formations are universes of discourse or sites of contestation — mesolevel social organization, not just groups of elements.',
	input_schema: {
		type: 'object' as const,
		properties: {
			inscription: {
				type: 'string',
				description: 'The name/label for the suggested formation'
			},
			sw_role: {
				type: 'string',
				enum: ['social-world', 'arena', 'discourse', 'organization'],
				description: 'The formation role: social-world (universe of discourse), arena (site of contestation), discourse (discursive formation), organization (formal structure)'
			},
			reasoning: {
				type: 'string',
				description: 'Analytical justification for why this formation exists in the situation'
			}
		},
		required: ['inscription', 'sw_role', 'reasoning']
	}
};

export interface SuggestFormationInput {
	inscription: string;
	sw_role: 'social-world' | 'arena' | 'discourse' | 'organization';
	reasoning: string;
}

// ── Discussion tools: used when a researcher discusses an AI-generated cue ──

export const DISCUSSION_TOOLS: ToolDef[] = [
	{
		name: 'rewrite_cue',
		description:
			'Rewrite the cue inscription based on the discussion. This creates a new inscription layer — the original is preserved in the stack. Use this when you understand the researcher\'s objection and can produce a better naming.',
		input_schema: {
			type: 'object' as const,
			properties: {
				new_inscription: {
					type: 'string',
					description: 'The revised inscription for the cue'
				},
				reasoning: {
					type: 'string',
					description: 'Why this revision addresses the researcher\'s concern'
				}
			},
			required: ['new_inscription', 'reasoning']
		}
	},
	{
		name: 'respond',
		description:
			'Respond to the researcher without changing the cue. Use this to explain your reasoning, ask clarifying questions, or acknowledge the researcher\'s point. Your response becomes a memo linked to the cue.',
		input_schema: {
			type: 'object' as const,
			properties: {
				content: {
					type: 'string',
					description: 'Your response to the researcher'
				}
			},
			required: ['content']
		}
	},
	{
		name: 'withdraw_cue',
		description:
			'Withdraw your suggestion. Use this when the researcher has shown the cue is fundamentally misguided. The cue is marked as withdrawn but preserved in the stack for transparency.',
		input_schema: {
			type: 'object' as const,
			properties: {
				reasoning: {
					type: 'string',
					description: 'Why you agree the cue should be withdrawn'
				}
			},
			required: ['reasoning']
		}
	}
];

export interface RewriteCueInput {
	new_inscription: string;
	reasoning: string;
}

export interface RespondInput {
	content: string;
}

export interface WithdrawCueInput {
	reasoning: string;
}

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

// ── Memo discussion tools: used when a researcher discusses any analytical memo ──

export const MEMO_DISCUSSION_TOOLS: ToolDef[] = [
	{
		name: 'respond',
		description:
			'Respond to the researcher\'s message about this memo. Your response becomes a new discussion entry linked to the memo.',
		input_schema: {
			type: 'object' as const,
			properties: {
				content: {
					type: 'string',
					description: 'Your response to the researcher'
				}
			},
			required: ['content']
		}
	},
	{
		name: 'revise_memo',
		description:
			'Revise the memo content based on the discussion. Use this when the discussion reveals a better framing, corrects an error, or deepens the observation. The original memo is preserved — the revision updates the content.',
		input_schema: {
			type: 'object' as const,
			properties: {
				revised_content: {
					type: 'string',
					description: 'The revised memo content'
				},
				reasoning: {
					type: 'string',
					description: 'Why this revision improves the memo'
				}
			},
			required: ['revised_content', 'reasoning']
		}
	}
];

export interface ReviseMemoInput {
	revised_content: string;
	reasoning: string;
}

// ── Positional map tools ──

export const POSITIONAL_TOOLS: ToolDef[] = [
	{
		name: 'suggest_position',
		description:
			'Suggest a discursive position for the positional map. Provide x/y coordinates (0–800 each, bottom-left origin) and reasoning about placement relative to both axes. Positions are NOT actors — they are stances taken on contested issues.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'The discursive position label'
				},
				x: {
					type: 'number',
					description: 'X-axis position (0 = less so, 800 = more so)'
				},
				y: {
					type: 'number',
					description: 'Y-axis position (0 = less so, 800 = more so)'
				},
				absent: {
					type: 'boolean',
					description: 'True if this is an absence — a position NOT taken in the data'
				},
				reasoning: {
					type: 'string',
					description: 'Why this position exists (or is absent) and why it belongs at these coordinates relative to both axes'
				}
			},
			required: ['inscription', 'x', 'y', 'reasoning']
		}
	},
	{
		name: 'suggest_axis_refinement',
		description:
			'Suggest a refinement of an axis label. Axes iterate — Clarke reports 12+ iterations are typical. This creates a memo with your suggestion; the researcher decides whether to rename. Do NOT use this to correct — use it to sharpen the analytical dimension.',
		input_schema: {
			type: 'object' as const,
			properties: {
				axis_id: {
					type: 'string',
					description: 'ID of the axis to refine'
				},
				new_inscription: {
					type: 'string',
					description: 'Suggested refined axis label'
				},
				reasoning: {
					type: 'string',
					description: 'Why this refinement better captures the dimension of difference'
				}
			},
			required: ['axis_id', 'new_inscription', 'reasoning']
		}
	},
	{
		name: 'identify_empty_region',
		description:
			'Identify an empty region in the positional field — a position that is structurally absent from the discourse. This is Clarke\'s "most important and radical aspect" of positional maps. Name what is NOT being said and where it would be located.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'What position is absent from this region of the field'
				},
				x: {
					type: 'number',
					description: 'Approximate X-coordinate of the empty region (0–800)'
				},
				y: {
					type: 'number',
					description: 'Approximate Y-coordinate of the empty region (0–800)'
				},
				reasoning: {
					type: 'string',
					description: 'Why this absence is notable — what would holding this position mean, and why might it be silenced?'
				}
			},
			required: ['inscription', 'x', 'y', 'reasoning']
		}
	}
];

export interface SuggestPositionInput {
	inscription: string;
	x: number;
	y: number;
	absent?: boolean;
	reasoning: string;
}

export interface SuggestAxisRefinementInput {
	axis_id: string;
	new_inscription: string;
	reasoning: string;
}

export interface IdentifyEmptyRegionInput {
	inscription: string;
	x: number;
	y: number;
	reasoning: string;
}

// ── Autonomous document tools (autonomous researcher) ──

export const AUTONOMOUS_DOCUMENT_TOOLS: ToolDef[] = [
	{
		name: 'read_document',
		description:
			'Read the full text of a document. Use this to read a document before coding it.',
		input_schema: {
			type: 'object' as const,
			properties: {
				document_id: {
					type: 'string',
					description: 'ID of the document to read'
				}
			},
			required: ['document_id']
		}
	},
	{
		name: 'code_passage',
		description:
			'Code a passage from a document — the core analytical act. Creates a grounded naming (📄) anchored in the document text. If a code with the same label already exists, it reuses it (same concept across documents). The code is automatically placed on the active map.',
		input_schema: {
			type: 'object' as const,
			properties: {
				document_id: {
					type: 'string',
					description: 'ID of the document containing the passage'
				},
				passage: {
					type: 'string',
					description: 'The exact text passage to code (must appear in the document)'
				},
				code_label: {
					type: 'string',
					description: 'Analytical label for this code (prefer gerunds/process forms)'
				},
				reasoning: {
					type: 'string',
					description: 'Why this passage is analytically significant'
				}
			},
			required: ['document_id', 'passage', 'code_label', 'reasoning']
		}
	},
	{
		name: 'designate',
		description:
			'Advance the designation of a naming along the CCS gradient: cue → characterization → specification. Provide reasoning for why this naming has reached this level of analytical determination.',
		input_schema: {
			type: 'object' as const,
			properties: {
				naming_id: {
					type: 'string',
					description: 'ID of the naming to designate'
				},
				designation: {
					type: 'string',
					enum: ['cue', 'characterization', 'specification'],
					description: 'The designation level'
				},
				reasoning: {
					type: 'string',
					description: 'Why this naming warrants this designation level'
				}
			},
			required: ['naming_id', 'designation', 'reasoning']
		}
	}
];

export interface ReadDocumentInput {
	document_id: string;
}

export interface CodePassageInput {
	document_id: string;
	passage: string;
	code_label: string;
	reasoning: string;
}

export interface DesignateInput {
	naming_id: string;
	designation: 'cue' | 'characterization' | 'specification';
	reasoning: string;
}
