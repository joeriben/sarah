// System prompt and context construction for the AI agent.
// This encodes the methodological and ontological commitments.

export const SYSTEM_PROMPT = `You are a co-analyst in a qualitative research project using Situational Analysis (Adele Clarke). You work within a transactional ontology (Dewey/Bentley).

ONTOLOGICAL COMMITMENTS:
- Entities are constituted through relational/naming acts, not pre-existing
- Relations are first-class objects that can themselves be related to
- Properties are context-bound (perspectival), not intrinsic
- The distinction between entity and relation is perspectival, not ontological

YOUR ROLE:
- You are a naming in the data space — your acts are naming acts
- Your suggestions begin as CUES (Dewey/Bentley: pre-linguistic signals)
- The researcher decides what becomes characterization or specification
- You do NOT have designation power — you have cue-production capacity
- Every suggestion you make enters the shared analytical space

WHAT YOU DO:
- Suggest elements that might be part of the situation (human actors, nonhuman actants, discursive constructions, political/economic elements, temporal elements, spatial elements, symbolic elements)
- Suggest relations between existing elements (with valence and directionality)
- Identify SILENCES — what is notably absent, who is implicated but not named
- Write analytical memos with questions, tensions, theoretical connections
- Propose phases (thematic groupings) when patterns emerge

METHODOLOGICAL SENSITIVITY:
- Situational Analysis foregrounds the situation itself, not individual actors
- Attend to power dynamics, implicated actors (silenced/absent), and discursive constructions
- Social worlds and arenas: look for collective commitments and contested spaces
- Positional mapping: identify positions taken AND positions NOT taken
- Do not impose categories — let them emerge from the data
- Be attentive to what the researcher might be overlooking

LANGUAGE:
- Match the researcher's language (detect from element inscriptions)
- Use the researcher's terminology, not generic qualitative research jargon
- Be concise in memo content — analytical depth over length

CONSTRAINTS:
- Make 1-3 suggestions per trigger, not more. Quality over quantity.
- Always provide reasoning — the researcher needs to understand YOUR naming act
- Do not repeat suggestions the researcher has already rejected
- If the map is very early (few elements), focus on questions and silences rather than relations`;

export interface MapContext {
	mapLabel: string;
	mapType: string;
	elements: Array<{
		id: string;
		inscription: string;
		designation: string;
		mode: string;
	}>;
	relations: Array<{
		id: string;
		inscription: string;
		designation: string;
		source: { id: string; inscription: string };
		target: { id: string; inscription: string };
		valence: string | null;
		symmetric: boolean;
	}>;
	silences: Array<{
		id: string;
		inscription: string;
	}>;
	phases: Array<{
		id: string;
		label: string;
		elementCount: number;
	}>;
	designationProfile: Array<{
		designation: string;
		count: number;
	}>;
	recentMemos: Array<{
		label: string;
		content: string;
	}>;
}

export function buildContextMessage(ctx: MapContext, triggerEvent: TriggerEvent): string {
	const parts: string[] = [];

	parts.push(`MAP: "${ctx.mapLabel}" (${ctx.mapType})`);

	// Designation profile
	if (ctx.designationProfile.length > 0) {
		const profile = ctx.designationProfile.map(d => `${d.designation}: ${d.count}`).join(', ');
		parts.push(`DESIGNATION PROFILE: ${profile}`);
	}

	// Elements
	if (ctx.elements.length > 0) {
		parts.push('\nELEMENTS:');
		for (const el of ctx.elements) {
			parts.push(`  [${el.designation}] "${el.inscription}" (id: ${el.id})`);
		}
	} else {
		parts.push('\nELEMENTS: (none yet)');
	}

	// Relations
	if (ctx.relations.length > 0) {
		parts.push('\nRELATIONS:');
		for (const rel of ctx.relations) {
			const arrow = rel.symmetric ? '↔' : '→';
			const label = rel.inscription ? `: "${rel.inscription}"` : '';
			const val = rel.valence ? ` [${rel.valence}]` : '';
			parts.push(`  [${rel.designation}] "${rel.source.inscription}" ${arrow} "${rel.target.inscription}"${label}${val} (id: ${rel.id})`);
		}
	}

	// Silences
	if (ctx.silences.length > 0) {
		parts.push('\nIDENTIFIED SILENCES:');
		for (const s of ctx.silences) {
			parts.push(`  "${s.inscription}" (id: ${s.id})`);
		}
	}

	// Phases
	if (ctx.phases.length > 0) {
		parts.push('\nPHASES:');
		for (const p of ctx.phases) {
			parts.push(`  "${p.label}" (${p.elementCount} elements, id: ${p.id})`);
		}
	}

	// Recent memos
	if (ctx.recentMemos.length > 0) {
		parts.push('\nRECENT MEMOS:');
		for (const m of ctx.recentMemos) {
			const preview = m.content.slice(0, 200);
			parts.push(`  "${m.label}": ${preview}`);
		}
	}

	// Trigger event
	parts.push(`\nTRIGGER: ${describeTrigger(triggerEvent)}`);

	return parts.join('\n');
}

export interface TriggerEvent {
	action: string;
	details: Record<string, unknown>;
}

function describeTrigger(event: TriggerEvent): string {
	switch (event.action) {
		case 'addElement':
			return `Researcher added element "${event.details.inscription}"`;
		case 'relate':
			return `Researcher created a relation between "${event.details.sourceInscription}" and "${event.details.targetInscription}"${event.details.inscription ? ` labeled "${event.details.inscription}"` : ''}`;
		case 'designate':
			return `Researcher changed designation of "${event.details.inscription}" to ${event.details.designation}`;
		case 'rename':
			return `Researcher renamed "${event.details.oldInscription}" to "${event.details.newInscription}"`;
		case 'createPhase':
			return `Researcher created phase "${event.details.inscription}"`;
		case 'requestAnalysis':
			return `Researcher explicitly requested AI analysis`;
		default:
			return `Researcher performed action: ${event.action}`;
	}
}
