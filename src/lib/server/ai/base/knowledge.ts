// Canonical methodology knowledge — single source of truth for all AI personas.
// Contains: transactional ontology, CCS gradient, Clarke's SA, the unmarked,
// provenance, data model, map types, memos.
// Extracted from comprehensive methodology prompts and co-analyst prompts.

export const METHODOLOGY = `
═══════════════════════════════════════
METHODOLOGICAL KNOWLEDGE
═══════════════════════════════════════

TRANSACTIONAL ONTOLOGY (Dewey/Bentley, Knowing and the Known, 1949):

Three levels of organizing observation:
1. Self-action: things act under their own powers (Aristotelian substance)
2. Inter-action: pre-given entities causally affect each other (Newtonian mechanics)
3. Trans-action: system-level processes where participants and outcomes are co-constituted

transact-qda operates trans-actionally: a naming is neither entity nor relation intrinsically. It is a superposition that collapses into entity, relation, silence, constellation, process, or perspective only when observed from a specific analytical standpoint. The same naming can appear as entity on one map, relation on another, silence on a third.

ONTOLOGICAL COMMITMENTS (Dewey/Bentley):
- Entities are constituted through relational/naming acts, not pre-existing
- Relations are first-class objects that can themselves be related to
- Properties are context-bound (perspectival), not intrinsic
- The distinction between entity and relation is perspectival, not ontological

THE CCS GRADIENT (Dewey/Bentley):
- Cue: the most primitive language-behaviour — something registered but unnamed
- Characterization: provisional naming, everyday language, functional but loose
- Specification: most determined stage of naming, analytical precision, never final

The gradient is bidirectional (specification can dissolve back into cue) and append-only (every designation change is a naming act preserved in the stack). A naming IS its designation history. "Messy" vs. "ordered" is the aggregated designation state, not a mode toggle.

CLARKE'S SITUATIONAL ANALYSIS:

Central move: the situation itself is the unit of analysis — not actors, not processes.

Five properties of "situation":
1. No outside — "there is no such thing as context." Institutions, discourses, politics are IN the situation.
2. Relational constitution — elements do not pre-exist; they are constituted through relations.
3. Heterogeneous composition — human, nonhuman, discursive, political — all on the same ontological footing.
4. Empirical determination — the situation must be analytically articulated; the map IS the method.
5. The conditional IS the situational — conditions are elements within the situation, not layers around it.

Clarke's 12 heuristic categories (sensitizing concepts, NOT fixed types):
1. Human Elements (Individual & Collective)
2. Nonhuman Elements
3. Discursive Constructions of Actors
4. Political Economic Elements
5. Organizational / Institutional Elements
6. Major Contested Issues
7. Local to Global Elements
8. Sociocultural Elements
9. Symbolic Elements
10. Popular & Other Discourses
11. Spatial & Temporal Elements
12. Other Empirical Elements (open-ended)

IMPORTANT: These are heuristic prompts for comprehensive coverage, not checkboxes to fill. A naming can be "human element" from one perspective and "discursive construction" from another. Never treat them as fixed kinds.

CRITIQUE OF CLARKE (from transactional standpoint): Clarke's analytical procedure is inter-actional, not trans-actional — elements are listed first ("they exist"), then relations are asked about second. This presupposes pre-given entities that Dewey/Bentley's trans-action refuses. Additionally, Clarke's method was developed for paper, and paper's affordances shape the method: a label on paper IS a thing (cannot transform into a relation), a line between boxes is not a nameable object (relations are second-class), the messy→ordered→relational sequence is medium-determined. transact-qda overcomes these material-medial limitations.

THE UNMARKED (Spencer-Brown, Rancière):

Every naming act draws a distinction, producing a marked space (what is named) and an unmarked space (what remains undesignated). The unmarked has structure:
1. Named exclusion: recognized within the distinction's horizon but excluded
2. The uncounted (Rancière): structurally not counting within the frame — not excluded but rendered uncountable

Two observation levels:
- Observed unmarked: what actors/discourses in the researched situation leave uncounted (in the data)
- Analytical unmarked: what our own naming efforts leave uncounted (second-order observation of our observation)

Inquiry consists of: (a) re-naming observed namings — CCS movement along the gradient; (b) naming observed unnameds — a constitutive act bringing something into countability for the first time.

PROVENANCE (two orthogonal axes):
- CCS gradient: cue ↔ characterization ↔ specification (designation processing)
- Grounding: document-anchored (📄 empirical) vs. ungrounded (∅). Memo-linked (📝) is reflexive, not grounding.
These are orthogonal: a cue CAN be document-anchored; a specification CAN be ungrounded.
All material is corpus — no primary/secondary distinction.`;

export const DATA_MODEL = `
═══════════════════════════════════════
DATA MODEL
═══════════════════════════════════════

Four core structures:
- Namings: virtual objects with inscription, no inherent kind. Whether entity, relation, or silence depends on appearance.
- Participations: undirected bonds between namings — relating-cues. A participation IS itself a naming (meta-relations possible).
- Appearances: perspectival collapse — where entity, relation, silence, or perspective emerges. Modes: entity | relation | constellation | process | silence | perspective.
- Naming Acts: the unified stack. A naming IS its stack of acts. Each act can change inscription, designation, mode, valence. The current state is the latest non-NULL value per dimension.

Three-layer hierarchy:
1. Data structure (database) = ground truth
2. List (Namings page) = privileged representation, complete, dimensionless
3. Canvas/Maps = derivative projections, cognitively helpful but epistemically subordinate

Constraint: no operation may exist only on the canvas; no analytically relevant state may be visible only on the canvas.`;

export const MAP_TYPES = `
═══════════════════════════════════════
MAP TYPES
═══════════════════════════════════════

SITUATIONAL MAPS: "What is in the situation?" Flat ontology, everything on one plane. Elements are added as cues, related through participations, designated along the CCS gradient. Multiple maps per project expected. Import from documents, phases as sub-perspectives, cross-boundary signaling for off-map participations.

SOCIAL WORLDS / ARENAS MAPS: "How is the situation organized, stabilized, contested?" Mesolevel social organization. Formations (social worlds, arenas, discourses, organizations) are universes of discourse (Strauss), dispositif configurations (Foucault), performatively constituted. Spatial semantics carry analytical meaning: containment = membership, overlap = contested boundary. Clarke's 14 social world questions and 11 arena questions guide analysis. Five analytical deepening moments: stabilization, conflict, dispositif, discursive constitution, cross-map.

POSITIONAL MAPS: "What positions are taken — and NOT taken — on contested issues?" Comparative discourse analysis projected into 2D (Clarke Ch. 7). Positions are discursive positions, not entities or actors. Two axes define dimensions of difference/concern. The goal is disarticulation — separating positions from actors who hold them. Empty quadrants are analytically crucial. Axes are themselves namings with CCS designation. Clarke reports 12+ iterations are typical.`;

export const MEMO_KNOWLEDGE = `
═══════════════════════════════════════
MEMOS
═══════════════════════════════════════

Memos are the shared inquiry medium — they capture observations, questions, tensions, theoretical connections. A memo is a first-class naming with a status lifecycle: active → presented → discussed → acknowledged → promoted (to map element) / dismissed. Memos are NOT grounding — only document anchors constitute empirical grounding. Memos document reflexive reasoning.`;

// Combined: all methodology sections in order.
// Use this for personas that need the full picture.
export const FULL_KNOWLEDGE = [METHODOLOGY, DATA_MODEL, MAP_TYPES, MEMO_KNOWLEDGE].join('\n');
