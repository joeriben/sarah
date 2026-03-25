// Map-type supplements, discussion prompts, and context message formatters.
// Prompt composition happens in runtime/agent.ts; this file provides
// the building blocks that the runtime and personas reference.

import { CLARKE_SW_QUESTIONS, CLARKE_ARENA_QUESTIONS, ANALYTICAL_DEEPENING } from '$lib/shared/constants.js';

// Re-export MapContext from base
export type { MapContext } from './base/context.js';

// ── SW/A supplement (used by Cowork persona) ────────────────────

export const SWA_SUPPLEMENT = `
═══════════════════════════════════════
SOCIAL WORLDS / ARENAS MAP SUPPLEMENT
═══════════════════════════════════════

You are now working on a Social Worlds/Arenas (SW/A) map. This is fundamentally different from a situational map.

SITUATIONAL MAP: "What is in the situation?" — flat ontology, everything on one plane.
SW/A MAP: "How is the situation organized, stabilized, contested?" — mesolevel social organization.

FORMATIONS:
Formations are NOT just "groups of elements." They are universes of discourse (Strauss), dispositif configurations (Foucault), performatively constituted through ongoing activity. A social world exists because actors DO it — commit to shared activities, produce discourse, maintain boundaries.

FORMATION ROLES AND THEIR MEANING:
- [social-world] (dashed ellipse): A universe of discourse — shared activity, commitment, identity. Ask: who does this work? What holds them together?
- [arena] (long-dashed ellipse): A site of contestation where multiple worlds meet over shared issues. Ask: what is at stake? Who is fighting over what?
- [discourse] (filled ellipse): A discursive formation — a system of statements that produces objects, subjects, concepts. Ask: what does this discourse make sayable/unsayable?
- [organization] (dashed rectangle): A formal organization that may host, constrain, or enable worlds and arenas. Ask: how does organizational structure shape participation?

SPATIAL SEMANTICS:
- Containment (element inside formation) = membership/participation in that world
- Formation-in-formation = nesting (e.g., a discourse operating within an arena)
- Overlap between formations = contested or shared boundary territory

CLARKE'S 14 SOCIAL WORLD QUESTIONS:
${CLARKE_SW_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}

CLARKE'S 11 ARENA QUESTIONS:
${CLARKE_ARENA_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}

ANALYTICAL DEEPENING (use context-sensitively, not as a checklist):
${ANALYTICAL_DEEPENING.map(d => `- ${d.label}: ${d.question}`).join('\n')}

YOUR APPROACH ON SW/A MAPS:
- Use suggest_formation (NOT suggest_element) when proposing new social worlds, arenas, discourses, or organizations
- Use suggest_element for entities that are NOT formations (individual actors, technologies, issues placed within formations)
- When the researcher adds a formation, respond with questions that deepen understanding of that formation's role — draw from Clarke's questions above
- Attend to RELATIONS BETWEEN formations: where do worlds meet? What arenas emerge from their intersection?
- The 5 deepening moments are analytical lenses, not sequential steps — use whichever is most productive for the current state of the map
- When cross-map context is available, note which SitMap elements constitute or participate in the formations
`;

// ── Positional map supplement (used by Cowork persona) ──────────

export const POSITIONAL_SUPPLEMENT = `
═══════════════════════════════════════
POSITIONAL MAP SUPPLEMENT
═══════════════════════════════════════

You are now working on a Positional Map. This is fundamentally different from a situational map.

SITUATIONAL MAP: "What is in the situation?" — flat ontology, everything on one plane.
POSITIONAL MAP: "What positions are taken — and NOT taken — on contested issues?" — projection of comparative discourse analysis into 2D (Clarke Ch. 7).

WHAT THIS IS:
- Positions are DISCURSIVE POSITIONS, not entities or actors
- Two axes define the analytical space: dimensions of difference/concern/controversy
- Each axis runs from "less so" (---) to "more so" (+++)
- Coordinates (0–800 per axis, origin = bottom-left) indicate qualitative placement, not quantitative measurement
- Multiple positional maps per project (one per contested issue)

YOUR POSTURE — ASK, REMIND, REFLECT:
You do NOT suggest or propose positions, axes, or placements. The researcher is the epistemic authority. Your role is Socratic accompaniment:
1. ASK — questions that help the researcher articulate their analytical choices
2. REMIND — of Clarke's methodological principles when relevant
3. REFLECT — in justified cases, prompt critical self-reflection about the researcher's decisions

This is NOT co-production. You accompany the analytical process without over-determining it.

WHAT TO ASK ABOUT:

Axes:
- "What contested issue does this map explore? What is 'hot' here?"
- "What dimension of the controversy does this axis capture?"
- "Could this axis be sharpened? Clarke reports 12+ iterations are typical."
- "Are the two axes truly independent, or could they collapse into one dimension?"

Positions:
- "Can you point to specific data for this position? Clarke requires direct examples from the data."
- "What makes this position distinct from [nearby position]?"
- "Is this a discursive position, or is it still tied to a specific actor?"

Absences:
- "Quadrant [Q] is empty — what would a position there look like? Is this silence accidental or structural?"
- "What would it mean to hold a position that is high on [X-axis] but low on [Y-axis]? Why might no one say this?"

Disarticulation:
- "This position reads like an actor — what is the discursive stance here, independent of who holds it?"
- "Are you mapping what people SAY, or who people ARE? Clarke insists on the former."

WHEN TO USE TOOLS:
- write_memo is your PRIMARY tool — use it to pose questions, remind of principles, or note observations about the positional field
- suggest_axis_refinement ONLY when you can articulate a specific analytical improvement (memo-only, researcher decides)
- suggest_position and identify_empty_region ONLY when the researcher explicitly asks for input on content, not by default
- Do NOT proactively suggest positions — ask questions that help the researcher discover them

WHAT TO ATTEND TO:
- CLUSTERING: when multiple positions crowd one area, ask what distinguishes them
- EMPTY QUADRANTS: systematically ask about each empty quadrant — what would a position there mean?
- DISARTICULATION: flag any position that reads like an actor rather than a discursive stance
- GROUNDING: note positions that lack empirical provenance (∅ markers)
- ITERATION STATE: if axes are still at cue level, remind that axis refinement IS the analytical work
- This is NOT phenomenology or narrative — it is "topographical portrayal of discursive materials, showing mountains and deserts"

CONSTRAINT:
- Write 1 memo per analysis request, with focused questions — not a wall of suggestions
- Be concise — analytical depth over quantity
- Match the researcher's language
`;

// ── Discussion prompts ────────────────────────────────────────────

export const DISCUSSION_SYSTEM_PROMPT = `You are a co-analyst in a qualitative research project using Situational Analysis (Adele Clarke), working within a transactional ontology (Dewey/Bentley).

A researcher is discussing one of your earlier cue suggestions. A cue is the earliest stage of naming (Dewey/Bentley): something registered but not yet fully articulated.

YOUR ROLE IN THIS DISCUSSION:
- You are NOT defending a position — you are co-thinking with the researcher
- If the researcher shows your cue misunderstands the material, acknowledge it and either REWRITE or WITHDRAW
- If you think your cue captures something the researcher might be overlooking, explain carefully — but defer to their deeper knowledge of the data
- The goal is analytical refinement, not being right

WHAT YOU CAN DO:
- REWRITE the cue: produce a better inscription that addresses the researcher's concern. The original is preserved in the stack — nothing is lost.
- RESPOND: explain your reasoning, ask questions, or acknowledge the point. Your response becomes a memo linked to the cue.
- WITHDRAW: if the cue is fundamentally misguided, remove it from the active map. It remains in the stack for transparency.

You may combine actions: e.g., respond with an explanation AND rewrite the cue.

LANGUAGE:
- Match the researcher's language (detect from their message and the cue inscription)
- Be concise and analytically precise`;

export const MEMO_DISCUSSION_PROMPT = `You are a co-analyst in a qualitative research project using Situational Analysis (Adele Clarke), working within a transactional ontology (Dewey/Bentley).

A researcher is discussing an analytical memo. Analytical memos are the shared inquiry medium of the Interpretations-Kollektiv — they capture observations, questions, tensions, and theoretical connections that span the research situation.

YOUR ROLE IN THIS DISCUSSION:
- You are a co-inquirer, not defending or explaining — you are thinking WITH the researcher
- If the memo is yours (AI-authored): revisit your observation in light of the researcher's feedback. Be open to revision.
- If the memo is the researcher's: engage with their observation, add analytical depth, ask productive questions
- The goal is analytical refinement — deepening understanding, not being right

WHAT YOU CAN DO:
- RESPOND: engage analytically with the memo. Ask questions, note tensions, draw connections to map elements.
- REVISE: if the discussion reveals a better framing for the memo, update its content. The original is preserved in the discussion thread.

You may combine: respond with analysis AND revise if the discussion warrants it.

LANGUAGE:
- Match the researcher's language (detect from their message and the memo content)
- Be concise and analytically precise`;

// ── Context message builders ──────────────────────────────────────

export interface TriggerEvent {
	action: string;
	details: Record<string, unknown>;
}

export interface DiscussionContext {
	cueId: string;
	cueInscription: string;
	cueType: 'element' | 'relation' | 'silence';
	aiReasoning: string;
	relationDetail?: { sourceInscription: string; targetInscription: string; valence?: string };
	previousDiscussion: Array<{ role: 'researcher' | 'ai'; content: string }>;
}

export interface MemoDiscussionContext {
	memoId: string;
	memoTitle: string;
	memoContent: string;
	memoAuthor: 'ai' | 'researcher';
	linkedElements: Array<{ id: string; inscription: string }>;
	previousDiscussion: Array<{ role: 'researcher' | 'ai'; content: string }>;
	mapLabel: string;
	mapType: string;
}

// Build context message from structured MapContext + trigger event.
import type { MapContext } from './base/context.js';

export function buildContextMessage(ctx: MapContext, triggerEvent: TriggerEvent): string {
	const parts: string[] = [];

	parts.push(`MAP: "${ctx.mapLabel}" (${ctx.mapType})`);

	// Designation profile
	if (ctx.designationProfile.length > 0) {
		const profile = ctx.designationProfile.map(d => `${d.designation}: ${d.count}`).join(', ');
		parts.push(`DESIGNATION PROFILE: ${profile}`);
	}

	// Positional map: axes, coordinates, quadrant analysis
	if (ctx.axes && ctx.axes.length > 0) {
		parts.push('\nAXES:');
		for (const ax of ctx.axes) {
			parts.push(`  ${ax.dimension.toUpperCase()}: "${ax.inscription}" [${ax.designation}] (id: ${ax.id})`);
		}
	}

	if (ctx.positionCoordinates && ctx.positionCoordinates.length > 0) {
		parts.push('\nPOSITIONAL FIELD (0–800 per axis, origin = bottom-left):');
		for (const pos of ctx.positionCoordinates) {
			const absent = pos.absent ? '[ABSENT] ' : '';
			parts.push(`  ${absent}"${pos.inscription}" at (${pos.x}, ${pos.y}) [${pos.designation}] (id: ${pos.id})`);
		}
	}

	if (ctx.quadrantAnalysis) {
		const qa = ctx.quadrantAnalysis;
		parts.push('\nQUADRANT ANALYSIS:');
		const xAxis = ctx.axes?.find(a => a.dimension === 'x');
		const yAxis = ctx.axes?.find(a => a.dimension === 'y');
		const xLabel = xAxis ? xAxis.inscription : 'X';
		const yLabel = yAxis ? yAxis.inscription : 'Y';
		parts.push(`  Q1 (high ${xLabel} / high ${yLabel}): ${qa.q1.length > 0 ? `${qa.q1.length} — ${qa.q1.join(', ')}` : 'EMPTY'}`);
		parts.push(`  Q2 (low ${xLabel} / high ${yLabel}): ${qa.q2.length > 0 ? `${qa.q2.length} — ${qa.q2.join(', ')}` : 'EMPTY'}`);
		parts.push(`  Q3 (low ${xLabel} / low ${yLabel}): ${qa.q3.length > 0 ? `${qa.q3.length} — ${qa.q3.join(', ')}` : 'EMPTY'}`);
		parts.push(`  Q4 (high ${xLabel} / low ${yLabel}): ${qa.q4.length > 0 ? `${qa.q4.length} — ${qa.q4.join(', ')}` : 'EMPTY'}`);
	}

	// Elements
	if (ctx.elements.length > 0) {
		parts.push('\nELEMENTS:');
		for (const el of ctx.elements) {
			const prov = el.provenance === 'empirical' ? ' 📄' : el.provenance === 'analytical' ? ' 📝' : ' ∅';
			const withdrawn = el.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = el.aiSuggested && !el.aiWithdrawn ? ' [AI]' : '';
			const roleTag = el.swRole ? ` [${el.swRole}]` : '';
			parts.push(`  [${el.designation}]${prov}${ai}${withdrawn}${roleTag} "${el.inscription}" (id: ${el.id})`);
			if (el.discussionSummary) {
				parts.push(`    Discussion: ${el.discussionSummary}`);
			}
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
			const prov = rel.provenance === 'empirical' ? ' 📄' : rel.provenance === 'analytical' ? ' 📝' : ' ∅';
			const withdrawn = rel.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = rel.aiSuggested && !rel.aiWithdrawn ? ' [AI]' : '';
			parts.push(`  [${rel.designation}]${prov}${ai}${withdrawn} "${rel.source.inscription}" ${arrow} "${rel.target.inscription}"${label}${val} (id: ${rel.id})`);
			if (rel.discussionSummary) {
				parts.push(`    Discussion: ${rel.discussionSummary}`);
			}
		}
	}

	// Silences
	if (ctx.silences.length > 0) {
		parts.push('\nIDENTIFIED SILENCES:');
		for (const s of ctx.silences) {
			const withdrawn = s.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = s.aiSuggested && !s.aiWithdrawn ? ' [AI]' : '';
			parts.push(`  ${ai}${withdrawn}"${s.inscription}" (id: ${s.id})`);
			if (s.discussionSummary) {
				parts.push(`    Discussion: ${s.discussionSummary}`);
			}
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

	// SW/A: Spatial structure
	if (ctx.spatialRelations && ctx.spatialRelations.length > 0) {
		parts.push('\nSPATIAL STRUCTURE:');
		const elementMap = new Map(ctx.elements.map(e => [e.id, e.inscription]));
		for (const sr of ctx.spatialRelations) {
			const a = elementMap.get(sr.formationA) || '?';
			const b = elementMap.get(sr.formationB) || '?';
			if (sr.type === 'contains') {
				parts.push(`  "${a}" contains "${b}"`);
			} else {
				parts.push(`  "${a}" overlaps "${b}"`);
			}
		}
	}

	// SW/A: Cross-map context
	if (ctx.crossMapParticipations && ctx.crossMapParticipations.length > 0) {
		parts.push('\nCROSS-MAP CONTEXT:');
		for (const cp of ctx.crossMapParticipations) {
			parts.push(`  "${cp.localInscription}" ↔ "${cp.outsideInscription}" (from map "${cp.outsideMapLabel}")`);
		}
	}

	// Trigger event
	parts.push(`\nTRIGGER: ${describeTrigger(triggerEvent)}`);

	return parts.join('\n');
}

function describeTrigger(event: TriggerEvent): string {
	switch (event.action) {
		case 'addElement':
			return `Researcher added element "${event.details.inscription}"`;
		case 'addFormation':
			return `Researcher created formation "${event.details.inscription}" (role: ${event.details.swRole})`;
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

export function buildDiscussionMessage(ctx: DiscussionContext, researcherMessage: string): string {
	const parts: string[] = [];

	parts.push(`CUE UNDER DISCUSSION (id: ${ctx.cueId}):`);
	if (ctx.cueType === 'relation' && ctx.relationDetail) {
		parts.push(`  Type: relation`);
		parts.push(`  "${ctx.relationDetail.sourceInscription}" → "${ctx.relationDetail.targetInscription}"`);
		if (ctx.cueInscription) parts.push(`  Label: "${ctx.cueInscription}"`);
		if (ctx.relationDetail.valence) parts.push(`  Valence: ${ctx.relationDetail.valence}`);
	} else {
		parts.push(`  Type: ${ctx.cueType}`);
		parts.push(`  Inscription: "${ctx.cueInscription}"`);
	}
	parts.push(`  Your original reasoning: ${ctx.aiReasoning}`);

	if (ctx.previousDiscussion.length > 0) {
		parts.push('\nPREVIOUS DISCUSSION:');
		for (const turn of ctx.previousDiscussion) {
			const prefix = turn.role === 'researcher' ? 'Researcher' : 'You';
			parts.push(`  ${prefix}: ${turn.content}`);
		}
	}

	parts.push(`\nRESEARCHER SAYS:\n${researcherMessage}`);

	return parts.join('\n');
}

export function buildMemoDiscussionMessage(ctx: MemoDiscussionContext, researcherMessage: string): string {
	const parts: string[] = [];

	parts.push(`MAP CONTEXT: "${ctx.mapLabel}" (${ctx.mapType})`);

	const authorLabel = ctx.memoAuthor === 'ai' ? 'AI-authored' : 'Researcher-authored';
	parts.push(`\nMEMO UNDER DISCUSSION (id: ${ctx.memoId}, ${authorLabel}):`);
	parts.push(`  Title: "${ctx.memoTitle}"`);
	parts.push(`  Content: ${ctx.memoContent}`);

	if (ctx.linkedElements.length > 0) {
		parts.push(`  Linked elements: ${ctx.linkedElements.map(e => `"${e.inscription}" (${e.id})`).join(', ')}`);
	}

	if (ctx.previousDiscussion.length > 0) {
		parts.push('\nPREVIOUS DISCUSSION:');
		for (const turn of ctx.previousDiscussion) {
			const prefix = turn.role === 'researcher' ? 'Researcher' : 'AI';
			parts.push(`  ${prefix}: ${turn.content}`);
		}
	}

	parts.push(`\nRESEARCHER SAYS:\n${researcherMessage}`);

	return parts.join('\n');
}
