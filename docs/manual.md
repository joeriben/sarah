# transact-qda — Manual -- Claude Opus 4.6, derived from full coding session protocols (expt technical bughunting), redacted by Benjamin Jörissen. March 14, 2026 - Manual Version: 2.0 (March 24, 2026)

A qualitative data analysis platform grounded in Situational Analysis (Clarke) and transactional philosophy (Dewey/Bentley), designed for research at the intersection of Science and Technology Studies and educational theory (*Erziehungswissenschaft*, Sünkel). Open-source, self-hosted, with an AI co-researcher that operates within the same data ontology as the human analyst.

---

## Contents

1. [Why Another QDA Tool?](#1-why-another-qda-tool)
2. [Foundations](#2-foundations)
   - [2.1 Transactional Ontology](#21-transactional-ontology-deweybentley)
   - [2.2 The Designation Gradient](#22-the-designation-gradient-ccs)
   - [2.3 Clarke's Situational Analysis — And Its Limits](#23-clarkes-situational-analysis--and-its-limits)
   - [2.4 The Unmarked](#24-the-unmarked)
   - [2.5 Provenance](#25-provenance-two-orthogonal-dimensions)
3. [The Data Model](#3-the-data-model)
4. [The Three-Layer Hierarchy](#4-the-three-layer-hierarchy)
5. [Working With transact-qda](#5-working-with-transact-qda)
   - [5.1 Situational Mapping](#51-situational-mapping)
   - [5.2 Social Worlds/Arenas Maps](#52-social-worldsarenas-maps)
   - [5.3 Positional Maps](#53-positional-maps)
   - [5.4 The Grounding Layer](#54-the-grounding-layer)
   - [5.5 Clusters](#55-clusters)
   - [5.6 Memos](#56-memos)
   - [5.7 The AI Co-Researcher](#57-the-ai-co-researcher)
   - [5.8 Collaboration](#58-collaboration)
   - [5.9 Project Management](#59-project-management)
6. [Design Commitments Beyond Clarke](#6-design-commitments-beyond-clarke)
7. [Technical Overview](#7-technical-overview)

---

## 1. Why transact-qda?

transact-qda is a purpose-built tool for Situational Analysis (SA). General-purpose QDA software like ATLAS.ti, MAXQDA, or NVivo serves many methodologies well, but SA — particularly when read through Dewey and Bentley's transactional philosophy — has specific requirements that call for a dedicated platform. transact-qda is also open-source and self-hosted, making SA-grounded analysis accessible without license costs or cloud dependency.

Two requirements drove the design:

### Analytical objects without fixed kinds

In SA practice, an element that begins as a discrete "thing" often turns out to be better understood as a relation, or a relation between two elements becomes an analytically interesting object in its own right. transact-qda supports this by giving analytical objects no fixed `kind`: the same naming can appear as an entity on one map, function as a relation on another, and show up as a silence on a third. What it *is* depends on the analytical perspective from which it is observed.

### Meta-relations

Clarke's relational analysis regularly produces analytically significant relations. Sünkel's educational theory (*Eta-Beziehung*) treats the relation between a teaching relation and a learning relation as the core structure of educational processes. Meta-relations — relations about relations — are central to this work. In transact-qda, a relation IS a naming: it has its own inscription chain, its own designation history, its own stack of analytical acts — and it can participate in further relations, because participations are themselves namings.

---

## 2. Foundations

### 2.1 Transactional Ontology (Dewey/Bentley)

The basic unit in transact-qda is the **naming act** — an event, not an entity. This follows Dewey and Bentley's *Knowing and the Known* (1949), which distinguishes three levels of organizing observation:

- **Self-action**: Things act under their own powers (Aristotelian substance)
- **Inter-action**: Pre-given entities causally affect each other (Newtonian mechanics)
- **Trans-action**: System-level processes where participants and outcomes are co-constituted (quantum observation, ecological systems, meaning-making)

Conventional QDA operates at the inter-actional level: codes exist, documents exist, researchers apply codes to documents. transact-qda operates trans-actionally: a **naming** is neither entity nor relation intrinsically. It is a superposition that collapses into entity, relation, silence, constellation, process, or perspective only when observed from a specific analytical standpoint.

The same naming can appear as an entity on one map ("neoliberal accountability"), as a relation on another (connecting "standardized testing" and "teacher autonomy"), and as a silence on a third (a position not taken in a discourse). These are not contradictions but perspectival collapses of the same virtual object.

### 2.2 The Designation Gradient (CCS)

Dewey and Bentley's naming taxonomy (*Knowing and the Known*, Chapter 10) distinguishes stages of sign-process. transact-qda operationalizes the three linguistic stages — CCS:

- **Cue**: The most primitive language-behavior — already verbal, but vague and undifferentiated. (The pre-linguistic, perceptive-manipulative stage is what Dewey/Bentley call **Signal**, which precedes Cue and falls outside the naming process proper.)
- **Characterization**: Develops out of cue through the clustering of cues and the growth of language. Provisional naming — everyday language, functional but loose.
- **Specification**: The perfected (and ever-perfecting) stage of naming. Analytical precision achieved through sustained engagement, never final.

This gradient is **bidirectional**: a well-specified naming can dissolve back into a cue when new evidence or a new perspective destabilizes the specification. It is also **append-only**: every designation change is recorded as a naming act, preserving the full analytical history. A naming IS its designation history — it does not *have* a history the way a file has metadata.

"Messy" and "ordered" — Clarke's two phases of situational mapping — are not modes or toggles. They are the **aggregated designation state** of all elements at a given moment. A map where most elements are at cue-level is messy; a map where most have reached characterization or specification is ordered. The transition is continuous, not binary.

### 2.3 Clarke's Situational Analysis — And Its Limits

Clarke's central methodological move is powerful: **the situation itself is the unit of analysis.** Not actors, not processes, not social worlds — the situation of action and inquiry. This replaces Strauss's Conditional Matrix (concentric micro-to-macro layers implying hierarchy and inside/outside) with a flat topology: everything is on one plane, inside the situation.

Clarke's five formal properties of "situation":

1. **No outside.** "There is no such thing as context." What traditional research calls context — institutions, discourses, politics, history — is constitutive of the situation, not external framing.
2. **Relational constitution.** Elements do not pre-exist the situation. They are constituted through their relations within it.
3. **Heterogeneous composition.** Human actors, nonhuman actants, discourses, political-economic forces, symbols — all on the same ontological footing.
4. **Empirical determination.** The situation is not given a priori — it must be analytically articulated. The situational map IS the method for this.
5. **The conditional IS the situational.** Conditions are not layers around the situation; they are elements within it.

Clarke offers 12 heuristic categories to ensure analytical comprehensiveness: human elements, nonhuman elements, discursive constructions of actors, political-economic elements, organizational elements, major contested issues, local-to-global elements, sociocultural elements, symbolic elements, popular and other discourses, spatial and temporal elements, and other empirical elements.

**The critique.** These categories are heuristic prompts, not ontological kinds — Clarke says so explicitly and provides three escape hatches: the ordered map is optional ("some people may not even want to do the ordered working version — that's fine"), the categories can be modified or extended, and elements may be "multiply ordered" across categories (Friese, in Evans-Jordan 2023). Clarke's messy map — the primary analytical tool — genuinely resists pre-analytical ontologization: it has no pre-given categories and no required sorting.

However, the escape hatches resolve the tension pragmatically, not theoretically. The moment an analyst *uses* the ordered map, they must have already decided what counts as "human" and what as "nonhuman" — the very distinction that Clarke's poststructuralist commitments (Foucault, Haraway) should problematize rather than presuppose. Mathar (2008) identifies this as a structural epistemological problem: the ordered map's relational analysis "first looks at what elements exist and then analyses how these can be brought in relation to each other" but "does not ask how these different elements are being produced and how they condense themselves into elements." Bibbert (2025) extends this critique from an assemblage-theory perspective, arguing that Clarke treats human and nonhuman elements as pre-given entities rather than as products of heterogeneous processes.

The epistemological tension is real and well-documented in the secondary literature: Clarke's messy map and discursive map (especially her attention to implicated actors and silences) are powerful tools for naming the unnamed. But the ordered map risks undermining this by introducing a default categorical grammar — inherited from Strauss's "general orders" — that shapes what can be seen. Clarke oscillates between these poles and is aware of the tension, but the resolution remains at the level of pragmatic optionality rather than theoretical integration.

More fundamentally, Clarke's analytical procedure is **inter-actional, not trans-actional**. Elements are listed first (they "exist"), then relations are asked about second (as interpretive overlays between pre-given entities). This presupposes exactly the pre-given entities that Dewey and Bentley's trans-action refuses.

#### Material-mediality: paper as unacknowledged actant

These limitations are not only conceptual — they are materially enforced. Clarke's method was developed for paper, and paper's affordances shape the method in ways Clarke does not theorize:

- **On paper, a label IS a thing.** Once written in a box, it cannot transform into a relation. The entity/relation distinction is materially fixed by the medium.
- **On paper, a line between boxes is NOT a nameable object.** It has no stack, no inscription chain, no designation history. Relations are second-class: ink connecting pre-given entities.
- **The messy → ordered → relational sequence is medium-determined.** You cannot reorder a paper map without redrawing it. The procedure is shaped by what the material can and cannot do.
- **Iteration is materially costly.** Redrawing a paper map means starting over. This material resistance reinforces path dependency.

Clarke's procedure is a method-for-paper that was theorized as method-as-such. Recognizing the material-mediality of the analytical medium is itself an SA-consistent move: attending to nonhuman actants in the research situation. A digital platform does not merely make SA more convenient — it makes a *different* SA possible.

This problem has been recognized from within SA scholarship. Knopp (2021) identifies maps as "media of visualization" whose design shapes what becomes analytically visible, and proposes *flip maps* — sequences of slides where each new element is added in temporal order, creating a Daumenkino-like animation of the situational map. This is a productive extension that addresses SA's difficulty with temporal processes. Knopp works from a practice-theoretical paradigm (Schatzki, Reckwitz, Foucault) where elements are historically produced objectivations that are "mobilized, activated, or turned passive" during processes — identity-stable entities with changing activation states. transact-qda takes a different paradigmatic starting point: elements are not identity-stable objects that get switched on or off, but non-identical superpositions whose very nature changes depending on the analytical perspective. Where Knopp addresses the temporal flatness of maps by multiplying them into sequences, transact-qda addresses the ontological flatness of elements by building non-identity into the data structure itself.

The key to this difference is the **data structure**. Paper enforces identity: a label written in a box is that label, in that box, being that kind of thing. A digital data structure can be **non-identical** — the same object can appear differently depending on the perspective from which it is observed. This is the core design insight of transact-qda: the data structure itself must be non-identical, superpositional, perspectival. The inspirations for this are direct — Dewey/Bentley's naming as trans-action (not a thing but an event), Barad's superposition and diffraction, Adorno's non-identity thinking (*Negative Dialektik*: the object is not exhausted by its concept). When the data structure embodies non-identity, the analytical possibilities change: a naming on the screen reveals its stack of constitutive acts on interaction; a relation is a naming with its own provenance chain; the same naming can appear as entity on one map and relation on another; iteration is cheap and each iteration is a perspective, not a superseded draft.

### 2.4 The Unmarked

Every naming act draws a distinction (Spencer-Brown, *Laws of Form*). Every distinction simultaneously produces a **marked space** (what is named) and an **unmarked space** (what the naming leaves undesignated). The unmarked is not homogeneous — it has structure:

1. **Named exclusion**: explicitly excluded from the category but recognized within the distinction's horizon. "Non-stakeholders" who are known to exist and known not to be stakeholders. Countable but excluded.
2. **The uncounted** (Ranciere, *Dissensus*): everything that does not "count" within the frame. Not excluded (exclusion presupposes countability) but structurally not counting. Consider the 2024 campaign "Snæfellsjökull fyrir forseta" (kjosumjokul.com), which nominated the Icelandic glacier Snæfellsjökull for president. The point was not that the glacier would be a good president — it was that the constitutional frame of political representation renders glaciers structurally uncountable as political subjects, even as they are materially present and consequential. The nomination did not argue within the existing counting frame; it disrupted the frame itself, making visible what "citizenship" renders uncountable.

Two observation levels must not be conflated:

- **Observed unmarked**: what actors and discourses *in the researched situation* leave uncounted. A policy document naming "stakeholders" produces an unmarked space — this is in the data.
- **Analytical unmarked**: what *our own naming efforts* leave uncounted. Second-order observation of our observation. Clarke's categories fix our counting frame, which then determines what we can observe as uncounted in the researched situation.

Inquiry therefore consists of two complementary operations: **(a) re-naming observed namings** — CCS movement along the designation gradient, from cue through characterization to specification; and **(b) naming observed unnameds** — a constitutive act that brings something into countability for the first time. The unnamed cannot be derived from a single document passage because the unmarked is a structural property of the *pattern* of namings. It arises through the between of namings — a structural hole visible through the constellation (Benjamin, Adorno) of relational patterns. It is grounded not through document anchors but through its participations: the silence names the hole; its relations point to the namings whose pattern produces it.

### 2.5 Provenance: Two Orthogonal Dimensions

|  | CCS Gradient | Grounding |
|--|-------------|-----------|
| **What it tracks** | Designation processing | Empirical anchoring |
| **Values** | cue <-> characterization <-> specification | document-anchored / ungrounded |
| **Key principle** | Bidirectional, append-only | "There is no such thing as context" |

These dimensions are orthogonal: a cue CAN be document-anchored (a passage was marked but not yet named); a specification CAN be ungrounded (a theoretical construct not yet tied to empirical material).

Memos document reflexive reasoning — CCS movement, analytical process. They are NOT grounding. Only a document anchor (a link to a specific passage or image region in the corpus) constitutes empirical grounding. All material — interview transcripts, photographs, policy documents, theoretical texts, media artifacts — belongs in the corpus and is equally codeable. There is no primary/secondary distinction.

---

## 3. The Data Model

The philosophical foundations translate into a minimal schema of three core tables and one stack table. The schema is deliberately sparse — complexity emerges from composition, not from proliferating entity types.

### Namings

The virtual object. Pure potentiality. Has an inscription (the mark of its constitution) but no inherent `kind` field. Whether it appears as entity, relation, silence, or perspective is determined by its appearances, not by an intrinsic property.

```
namings(id, project_id, inscription, created_by, created_at, deleted_at, seq)
```

### Participations

Undirected, non-qualified bonds between namings — **relating-cues**. A participation registers that a bond exists between two namings without determining what kind of bond it is. It is the relational equivalent of "I noticed something": the structural registration that two namings are co-constituted, prior to any interpretation of how.

Participations form an **autonomous structural layer** — the *between*. A participation does not belong to either of its endpoints. It exists as a third thing, irreducible to the namings it connects: delete one endpoint and the participation is orphaned — not because the other lost a property, but because a bond lost a constituent. This independence means the participation layer cannot be reconstructed from the namings table alone (you would lose which things are bonded) or from the appearances table alone (the same participation may appear differently — or not at all — from different perspectives).

Qualification — direction, valence, mode — is added through **appearances**. A participation that receives an appearance with `mode = 'relation'`, `directed_from`, `directed_to`, and a `valence` has moved from relating-cue toward relational characterization. The CCS gradient thus applies to bonds as well as to entities: a participation is a cue-level bond; a fully characterized relation-appearance with specified valence is a bond at specification level. The analytical determination of *what connects* follows the same designation logic as the determination of *what is*.

Critically, a participation IS itself a naming — its `id` exists in the `namings` table. This means a participation can itself participate in further relations. Meta-relations — Sünkel's *Eta-Beziehung*, the relation of relations — require no special mechanism; they are participations of participations.

```
participations(id [= a naming_id], naming_id, participant_id)
```

### Appearances

Perspectival collapse. This is where entity, relation, constellation, process, silence, or perspective **emerges**. Direction, valence, and context-bound properties exist only under a perspective. A map is a naming whose appearance-mode is `perspective` — a naming observing other namings.

```
appearances(naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
```

Collapse modes: `entity` | `relation` | `constellation` | `process` | `silence` | `perspective`

### Naming Acts (The Unified Stack)

A naming IS its stack of acts. Each act can carry changes across multiple dimensions simultaneously: inscription, designation, mode, valence. A NULL value means "unchanged in this dimension." The current state of any naming is the latest non-NULL value per dimension across its act history.

```
naming_acts(naming_id, seq, by, inscription, designation, mode, valence, memo_text, linked_naming_ids)
```

The `by` field references another naming — typically a researcher-naming or an AI-naming. Every analytical act is attributed not to a user account but to a naming in the data space. This is not a logging convenience; it is an ontological commitment: the researcher is a participant in the situation they study (Barad: intra-action; Haraway: situated knowledges).

---

## 4. The Three-Layer Hierarchy

1. **Data structure** (database tables) = **ground truth.** This is what IS. Namings, participations, appearances, naming acts.
2. **List** (Namings page) = **privileged representation.** Complete, dimensionally non-reductive. Shows all namings with their current designation state, stack depth, provenance indicators, participation counts. No arbitrary spatial collapse. This is the primary analytical workspace.
3. **Canvas / Maps** = **derivative projections.** Cognitively helpful (humans need spatial layout to perceive patterns) but epistemically subordinate. Trade complete coverage for intelligibility.

Three constraints follow from this hierarchy:

- No operation may exist only on the canvas.
- No analytically relevant state may be visible only on the canvas.
- The list must be able to show everything the canvas shows (cluster membership, provenance, designation, stack depth).

A critical clarification: core operations — designate, rename, relate, withdraw, inspect stack — operate on the **naming itself**, not on its appearance on a specific map. The `naming_acts` table has no `perspective_id` column. Designation belongs to the naming; participations are global bonds; the inscription chain belongs to the naming. Appearances determine how a naming *looks* from a perspective, but the operations that constitute analytical work act on the naming directly.

The Namings page is therefore not a derivative view of maps. It is the **least-reduced perspective** — complete, dimensionless, most faithful to the data structure itself. Maps are more reduced: they select a subset of namings, collapse them into 2D space, and filter by perspective. The Namings page is where the data structure speaks most directly.

---

## 5. Working With transact-qda

### 5.1 Situational Mapping

A **map** is a naming that serves as a perspective. Creating a map creates a naming with a self-referential appearance (`perspective_id = naming_id`, `mode = 'perspective'`). Everything "on the map" is a naming that has an appearance from this perspective.

**Multiple maps** are both supported and expected. The Namings list (Section 4) is the complete, dimensionless representation; maps are curated perspectives on that ground truth. A project may have several situational maps (one per document explored, one for the overall situation), social worlds maps, positional maps — all sharing the same naming pool.

**Adding elements** creates a naming with an initial designation of `cue` and an entity-appearance on the map. At this stage, nothing is determined — the element is a pointing gesture, a registered signal. The map's designation profile (aggregate counts per CCS stage) shows predominantly cues: the map is in its messy phase. The input searches existing project namings: you can **place an existing naming** on this map (creating an appearance without a new naming) or **create a new naming**. This prevents unintended duplication across maps.

**Relating elements** creates a participation-naming that bonds two namings. The relation itself gets an inscription ("constrains," "enables," "constitutes"), a designation, and its own stack. Because the relation is a naming, it can be related to other namings — including other relations. Clarke's relational analysis ("what is the nature of the relationship?") produces namings, not annotations on edges. **Structural integrity** is enforced: when a relation is created on a map, both endpoints are guaranteed to have appearances on that map.

**Cross-boundary signaling**: when a naming on a map has participations with namings *not* on that map, an indicator shows the count. This marks what the current perspective leaves outside — without auto-expanding the map. The user decides whether to "pull" outside namings onto the map or leave them beyond the current frame.

**Naming merge**: when two namings turn out to be the same entity (a collaboration or memory error), they can be merged. The survivor absorbs the merged naming's participations, appearances, and annotations. A memo documents what was absorbed. This is ground-truth surgery — irreversible by design, transparent by memo.

**Import from document**: all annotation-namings (codes) from a specific document can be batch-placed on a map. This supports the workflow: create a map → import from a document → begin relational analysis.

**Clusters** group related namings by analytical affinity. A cluster is a naming with `mode = 'perspective'` — Dewey/Bentley: "Characterization develops out of cue through the clustering of cues and the growth of language." Clustering IS characterizing; accordingly, a new cluster's initial designation is `characterization`, not `cue`. Clusters are project-level: they appear on any map where at least one member is present, and they are managed on the Namings page independently of maps. On maps, cluster membership is visualized through colored dots and highlight filtering. Cluster membership is tracked in an append-only history table (`cluster_memberships`) for full analytical provenance.

**Pairwise interrogation** — Clarke's procedure of centering on one element and systematically examining its relation to every other — is available as a workflow mode. A transactional extension is equally available: center on a *relation* and ask which entities it connects, which other relations it participates in, what its inscription history reveals.

**Topology snapshots** preserve the spatial layout of a map at a given moment. These enable temporal comparison (how did the map look before this round of analysis?) without overwriting the current state.

### 5.2 Social Worlds/Arenas Maps

Clarke's second map type moves from "What is in the situation?" to **"How is the situation organized, stabilized, contested?"** Social Worlds/Arenas (SW/A) maps operate at the mesolevel of social organization.

**Formations** are the primary analytical objects on SW/A maps. They are not groups of elements but **universes of discourse** (Strauss), **dispositif configurations** (Foucault), performatively constituted through ongoing activity. A social world exists because actors DO it — commit to shared activities, produce discourse, maintain boundaries. Formations carry four roles:

- **Social world** (dashed ellipse): A universe of discourse — shared activity, commitment, identity. *What holds them together?*
- **Arena** (long-dashed ellipse): A site of contestation where multiple worlds meet over shared issues. *What is at stake?*
- **Discourse** (filled ellipse): A discursive formation — a system of statements that produces objects, subjects, concepts. *What does this discourse make sayable/unsayable?*
- **Organization** (dashed rectangle): A formal organization that may host, constrain, or enable worlds and arenas. *How does organizational structure shape participation?*

**Spatial semantics** on SW/A maps carry analytical meaning: containment (element inside formation) = membership/participation in that world; formation-in-formation = nesting (a discourse operating within an arena); overlap between formations = contested or shared boundary territory. This spatial meaning is distinct from the purely layout-oriented positioning on situational maps.

**Clarke's heuristic questions** structure the analytical work. For social worlds: 14 questions about activities, commitments, technologies, boundaries, segments, implicated actors. For arenas: 11 questions about contested issues, positions, power dynamics, boundary objects. These are sensitizing prompts, not a mandatory checklist.

**Analytical deepening** proceeds through five moments (non-sequential, used when productive):

1. **Stabilization**: How is this formation held together? What commitments, routines, or material arrangements stabilize it?
2. **Conflict**: What is contested here? Where do worlds collide, and what is at stake?
3. **Dispositif**: What apparatus of knowledge/power operates through this formation? What discursive and material arrangements enable it?
4. **Discursive constitution**: How is this formation discursively constituted? Which discourses produce it as a recognizable entity?
5. **Cross-map**: How do situational map elements map onto this formation? Which SitMap entities are constitutive of this world/arena?

**Cross-map context** connects SW/A maps to situational maps: when a naming from a situational map participates in a formation on a SW/A map, this cross-map participation is tracked and displayed. The researcher can see which concrete situational elements constitute or participate in each social world or arena.

### 5.3 Positional Maps

Clarke's third map type projects **comparative discourse analysis into 2D** (Clarke, Chapter 7). Positional maps answer: **"What positions are taken — and NOT taken — on contested issues?"**

The fundamental shift: positions are **discursive positions**, not entities or actors. The goal is disarticulation — separating positions from the actors who hold them. Multiple actors can hold the same position; one actor can hold contradictory positions. Clarke insists: "map what people SAY, not who people ARE."

**Axes** define the analytical space. Two axes represent dimensions of difference, concern, or controversy. Each axis runs from "less so" (---) to "more so" (+++). Choosing and refining axes IS the analytical work — Clarke reports 12+ iterations are typical. Axes are themselves namings with CCS designation: an axis at cue-level is a first attempt at naming a dimension of the controversy; at specification, it is a precisely articulated analytical dimension.

**Positions** are placed in the 2D field defined by the axes. Coordinates indicate qualitative placement, not quantitative measurement. Each position is a naming: it has an inscription, a designation, a stack of acts. The analytical questions for positions: Can you point to specific data? What makes this position distinct from nearby ones? Is this genuinely a discursive stance, or is it still tied to a specific actor?

**Absences** are analytically crucial. Empty quadrants demand systematic questioning: what would a position there look like? Is this silence accidental or structural? Why might no one say this? The platform marks absent positions distinctly and supports systematic quadrant analysis.

**Multiple positional maps per project** are expected — one per contested issue. Each reveals a different dimension of the discursive field.

### 5.4 The Grounding Layer

Documents — interview transcripts, photographs, policy texts, theoretical chapters, media artifacts — form the empirical corpus. "There is no such thing as context": a Foucault chapter is data, not external framing. It belongs in the corpus and is codeable.

**Text annotation** uses character-offset anchors (`pos0`, `pos1`) to mark passages. **Image annotation** uses rectangle regions in normalized coordinates (`[0,1]`), resolution-independent. Both produce the same analytical object: an annotation linking a naming to a specific location in the corpus. This is where empirical grounding is produced.

**In-vivo coding** creates a naming inline during annotation: select a passage or image region, type a name, and in one act a naming is created and anchored to the corpus. The naming immediately appears on the active map as a cue.

**Codes are not a separate ontological domain.** They are namings — from any map, from any perspective — that have been used to annotate documents. The "code list" is a derived view: a query showing "namings with document anchors." This eliminates the artificial boundary between map elements and document codes that existing QDA tools enforce.

**Documents are stored in project directories** (`projekte/{slug}/files/`), with relative paths in the database. This ensures portability: a project directory contains everything needed to reconstruct the project, including all media files.

### 5.5 Clusters

Clusters are the bridge between document coding and situational mapping. Dewey/Bentley: "Characterization develops out of cue through the **clustering** of cues and the growth of language." Clustering IS characterization — grouping related cues and naming the group is the act that moves from cue to characterization on the CCS gradient.

**A cluster is a naming** with `mode = 'perspective'`. It has its own inscription, designation (starts at `characterization`), and stack. Cluster membership is tracked in an append-only history table for full provenance.

**Project-level, not map-bound.** Clusters belong to the project, not to a specific map. They appear automatically on any map where at least one of their members is present. This means a researcher can create clusters during coding and find them on the map when they move to relational analysis.

**Cluster management** lives on the **Namings page** — the privileged representation (Section 4). The right panel shows all clusters; clicking one reveals its members and all their passages, grouped by naming and document. Namings are assigned to clusters by entering assign mode and clicking. This is an analytical operation on naming-level, not a passage-level operation.

**Cluster filter in the Document view.** The Passages panel (right column in the document viewer) provides a cluster filter dropdown. Selecting a cluster narrows the passage list to codes that belong to that cluster — enabling focused review of the empirical basis for a cluster while coding.

**Recursive clustering** is supported: a cluster can itself be a member of another cluster. This enables multi-level analytical organization without imposing a fixed hierarchy.

### 5.6 Memos

Memos are the **shared inquiry medium** of the analytical process. They capture observations, questions, tensions, and theoretical connections that span the research situation. In transact-qda, a memo is a first-class naming — it participates in the core data model alongside entities, relations, and documents.

**Memo creation** produces a naming with content stored in a dedicated `memo_content` table. Memos can be linked to any number of namings (elements, relations, silences, other memos) via participations. The linked elements provide analytical context: a memo about a tension between two formations links to both.

**Status lifecycle.** Memos follow a lifecycle that tracks how the researcher engages with them:

- **Active**: Default for newly created researcher memos. A live observation awaiting engagement.
- **Presented**: An AI-generated memo or a restored dismissed memo. Awaiting researcher attention.
- **Discussed**: Has an active discussion thread between researcher and AI.
- **Acknowledged**: The researcher confirmed reading and engagement. The observation is absorbed into the analytical process.
- **Promoted**: Elevated to a naming on a map — the memo's insight becomes a cue-designation entity. This is the transition from reflexive observation to analytical substance.
- **Dismissed**: Archived. Can be restored to "presented" if later relevant.

**Memo discussions** use the same infrastructure as cue discussions (Section 5.7): the researcher can engage the AI in dialogue about a memo's content. Discussion turns are themselves memo-namings linked to the parent memo. The AI can respond with analytical depth or revise the memo if the discussion warrants it.

**Memos are NOT grounding.** They document reflexive reasoning — CCS movement, analytical process, theoretical connections. Only document anchors constitute empirical grounding. This distinction is epistemologically important: a memo about a pattern of silences is an analytical observation, not evidence.

### 5.7 The AI Co-Researcher

The AI is not an external tool that responds on command. It is a **naming in the data space** — it has its own researcher-naming per project, and its analytical acts (suggestions, memos, withdrawals) are naming acts attributed to this AI-naming. The AI is a co-actor in the analytical situation, not an instrument applied to it.

The AI's operational constraint: it can only produce **cues**. Every AI suggestion — a new element, a relation, a pattern observation — enters the map as a cue with `by = ai_naming_id`. Only the researcher can elevate a cue to characterization (acceptance) or leave it as a cue (implicit non-engagement). Designation authority remains with the researcher; cue production is shared.

**Socratic posture.** The AI's fundamental posture across all map types is Socratic accompaniment:

1. **Ask** — questions that help the researcher articulate their analytical choices
2. **Remind** — of Clarke's methodological principles when relevant
3. **Reflect** — in justified cases, prompt critical self-reflection about the researcher's decisions

The AI does NOT proactively suggest elements, relations, or analytical content by default. The researcher is the epistemic authority. AI suggestions are available when explicitly requested, but the default mode is questioning, not answering.

**Deconstructive questioning.** The AI does not reproduce Clarke's categories as slots to fill. It does not ask "did you consider nonhuman actors?" — which reinstates the category. Instead, it questions the distinctions the researcher has drawn:

- "What are the hybrid human/nonhuman moments in this element?"
- "What is the genealogy of this categorization?"
- "What does this naming make uncountable?"
- "Which discourse constitutes this as a 'human' element?"
- "What is the relational pattern around this absence?"

**Discussion, not accept/reject.** When the AI produces a cue, the researcher does not face a binary accept/decline button. Instead, they can enter dialogue *at the cue itself*: question the AI's reasoning, request revision, challenge the framing. This discussion is a memo chain linked to the naming. A discussion can result in: the AI rewriting the cue (new inscription in the stack, old preserved), the AI withdrawing the cue (soft-delete with discussion history preserved), or the AI responding with a deepening memo (no rewrite, but richer analytical context).

The AI sees the full map context — all elements, relations, designations, participations, clusters, discussion histories, withdrawn cues — so its questions emerge from the actual analytical state, not from a fixed checklist.

**Map-type awareness.** The AI adapts its posture and available operations to the map type:

- On **situational maps**: primary tool is `write_memo` for questions and observations; `suggest_element`, `suggest_relation`, `identify_silence` available on explicit request.
- On **SW/A maps**: uses `suggest_formation` (not `suggest_element`) for social worlds, arenas, discourses, and organizations; attends to relations between formations; draws from Clarke's 14 social world and 11 arena questions; applies the five analytical deepening moments.
- On **positional maps**: attends to axis refinement, disarticulation (separating positions from actors), empty quadrants, clustering, and grounding. Does NOT proactively suggest positions.

**Provider-agnostic AI.** The AI client supports seven providers: Ollama (local, DSGVO-compliant), Mistral AI (EU), IONOS (EU, Berlin), Mammouth AI (EU), Anthropic (US), OpenAI (US), and OpenRouter (US). One model is configured for all use cases. Provider and model are selected in the settings page; API keys are stored in `.key` files (gitignored). All providers except Anthropic use the OpenAI-compatible API format.

**Usage tracking.** Every AI interaction is logged to the `ai_interactions` table with provider, model, request type, and token counts (input/output). The settings page provides aggregated usage data by model, request type, and time period for cost control.

### 5.8 Collaboration

Multiple researchers can work on the same project. Each user receives a **researcher-naming** in the data space — a naming whose inscription is the researcher's name. All naming acts record `by = researcher_naming_id`, not a user account ID. This means the analytical provenance chain tracks namings, not system users. The researcher's acts are events in the same relational fabric as the data they study.

Roles follow a hierarchy: owner (immutable, full control), admin (can manage members), member (can work on maps and documents), viewer (read-only). Discussion between team members uses the same memo-chain infrastructure as AI discussions — no separate communication layer.

### 5.9 Project Management

#### Native format

The canonical project format is **PostgreSQL COPY files** — one file per table — stored in project directories (`projekte/{slug}/`). Media files live in `projekte/{slug}/files/`. This is a lossless format: it preserves the full transactional data model including naming acts, appearances, designations, and AI metadata.

**Periodic sync** automatically exports the database state to the project directory every 60 seconds while a project is active. This provides continuous backup without manual intervention. Sync starts automatically when entering a project.

**Operations:**

- **Save**: Manual sync from database to project directory.
- **Load**: Import a project directory into the database for active work.
- **Unload**: Final sync, then remove from database. Data stays safe in the project directory.
- **Delete**: Remove from both database and disk, with safety confirmation (loaded projects require double-confirm; on-disk projects require typing the project slug).
- **Duplicate**: Full transactional copy with fresh UUIDs, including media files.

#### QDPX interoperability

QDPX is the open exchange format for qualitative data analysis projects (supported by ATLAS.ti, MAXQDA, NVivo, and others). transact-qda supports both import and export.

**Export** uses a dual-namespace approach: a standard QDPX namespace (readable by any compliant tool) plus a custom `urn:transact-qda:1.0` namespace for lossless re-import. A **pre-export loss report dialog** shows what external tools will and will not see:

- **Preserved for external tools**: All codes, documents, annotations, memos, relations, one map with positions.
- **Lost for external tools**: Naming history (collapsed to latest inscription), CCS gradient (only in description text), clusters, silences, AI metadata, map snapshot history, researcher identities.
- **Lossless**: The native format (save to directory) preserves everything.

**Import** detects the namespace: transact-qda exports are reimported with full fidelity; standard QDPX files from other tools are imported as cues on a default map, with codes becoming namings and document annotations becoming grounding anchors. All GUIDs are remapped to fresh UUIDs to prevent collisions.

---

## 6. Design Commitments Beyond Clarke

Three commitments reinterpret Clarke's SA through the transactional ontology:

**1. Categories as relational différances.** Clarke's 12 categories become questions *about* distinctions, not prompts to fill in distinctions. Many of them (discursive constructions, political elements, temporal elements, major issues) are already relational in nature — they are relational namings, not entities. The architecture supports this: relation-namings connecting to relation-namings require no special treatment.

Clarke's relational analysis ("center on one element, draw lines to all others") is available — but with a transactional extension: "center on a relation and attach entities to it" is equally valid. The entity/relation distinction is perspectival, not sequential.

**2. No enforced procedure — diffractory methods.** The platform does not enforce Clarke's messy-ordered-relational sequence. It is available for those who want it, but not normative. The platform encourages exploring the non-identical, superpositional nature of namings through multiple methods:

- Multiple competing narrative drafts about the same map/cluster (differing narrations)
- Map iterations understood as superpositions, not linear progress — each version a perspective, not a superseded draft
- Diffraction (Barad): making difference patterns visible, not reflecting the same

This is architecturally supported: different `collapseAt` values on the same naming, different clusters of the same map, are literally different superposition collapses placed side by side.

**3. Theories as visible namings on the map.** Theoretical commitments are placed ON the map as explicit namings — with their own inscription chains, designation histories, and provenance. This prevents hidden social theories from entering the analytical process as unexamined dogmata. From the transactional standpoint, the distinction between "empirical situation" and "research situation" does not need to be imposed a priori — it will emerge through the analytical process itself, through different clusters, maps, and perspectival collapses.

---

## 7. Technical Overview

For researchers who want to run or contribute to transact-qda:

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | SvelteKit 5 (Node adapter) | Full-stack, shared types, reactive model for interactive maps |
| Database | PostgreSQL with JSONB | Self-hosted, GIN-indexed JSONB for flexible properties |
| AI | Provider-agnostic client (7 providers) | No vendor lock-in; Ollama (local) + EU/US cloud providers |
| Auth | Argon2id + server-side sessions | Simple, secure, no external dependency |
| Layout | ELK.js | Hierarchical/stress/force graph layout for canvas |
| Storage | PostgreSQL COPY + project directories | Lossless native format, automatic periodic sync |
| Interop | QDPX (dual-namespace) | Import/export for ATLAS.ti, MAXQDA, NVivo compatibility |
| Deployment | Self-hosted server, Cloudflare tunnel | Full control, no cloud dependency |

No ORM — direct SQL with `pg` to preserve full control over the transactional data model. An ORM would impose its own ontology. API keys in `*.key` files (gitignored), never in configuration. AI settings (provider, model) in `ai-settings.json` (gitignored).

---

## References

- Bibbert, M. (2025). Assembling the Situation: Situational Analysis After the Nonhuman Turn. *Forum Qualitative Sozialforschung / FQS*, 26(2). https://doi.org/10.17169/fqs-26.2.4306
- Clarke, A. E. (2005). *Situational Analysis: Grounded Theory After the Postmodern Turn*. Sage.
- Clarke, A. E., Friese, C., & Washburn, R. S. (2018). *Situational Analysis: Grounded Theory After the Interpretive Turn* (2nd ed.). Sage.
- Dewey, J., & Bentley, A. F. (1949). *Knowing and the Known*. Beacon Press.
- Evans-Jordan, S. B. (2023). Mapping a Way Into Qualitative Inquiry: Reflections on Learning and Teaching Clarke's Situational Analysis. *Forum Qualitative Sozialforschung / FQS*, 24(2).
- Knopp, P. (2021). Mapping Temporalities and Processes With Situational Analysis: Methodological Issues and Advances. *Forum Qualitative Sozialforschung / FQS*, 22(3).
- Mathar, T. (2008). Making a Mess with Situational Analysis? Review Essay. *Forum Qualitative Sozialforschung / FQS*, 9(2), Art. 4.
- Spencer-Brown, G. (1969). *Laws of Form*. Allen & Unwin.

---

*transact-qda is developed at Friedrich-Alexander-Universitat Erlangen-Nurnberg (FAU) as part of research in educational theory and Science and Technology Studies.*
