// Persona system: defines the interface and registry for AI personas.
// Each persona shares the same knowledge base but has different tools and instructions.

import type { ToolDef } from '../client.js';

export type PersonaName = 'coach' | 'cowork' | 'autonomous';

export type MapType = 'situational' | 'social-worlds' | 'positional';

export interface Persona {
	/** Unique persona identifier */
	name: PersonaName;

	/** Display name for UI and logging */
	displayName: string;

	/** Short description of the persona's role */
	description: string;

	/** Persona-specific system prompt additions (appended to shared knowledge) */
	systemPromptAdditions: string;

	/** Get tools available to this persona for a given map type.
	 *  Returns empty array if the persona has no tools (e.g. coach). */
	getTools(mapType?: MapType): ToolDef[];

	/** Map-type-specific prompt supplements (SWA, Positional, etc.) */
	getMapSupplement?(mapType: MapType): string;

	/** Whether this persona can write to project data */
	canWrite: boolean;

	/** Whether this persona can delegate to sub-agents */
	canDelegate: boolean;

	/** Context needs — what the runtime should gather before calling the persona */
	contextNeeds: {
		projectOverview: boolean;
		mapDetail: boolean;
		memos: boolean;
		library: boolean;
		documents: boolean;
	};
}

// Registry of all personas
const registry = new Map<PersonaName, Persona>();

export function registerPersona(persona: Persona): void {
	registry.set(persona.name, persona);
}

export function getPersona(name: PersonaName): Persona {
	const persona = registry.get(name);
	if (!persona) throw new Error(`Unknown persona: ${name}`);
	return persona;
}

export function getAllPersonas(): Persona[] {
	return Array.from(registry.values());
}
