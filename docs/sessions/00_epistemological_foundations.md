# Epistemological Foundations — Transact-QDA

Compressed reference from Sessions 00–02 + key clarifications from Session 09.
Every fresh session MUST read this before making architectural decisions.

---

## 1. Transactional Ontology (Dewey/Bentley)

The basic unit is the **naming act** (Ereignis), not the entity and not the relation.
A naming IS neither entity nor relation intrinsically — it is a **superposition** that collapses under observation from a perspective.

Dewey/Bentley (*Knowing and the Known*, 1949): **trans-actions**, not inter-actions between pre-given entities. The system does not presuppose fixed entities that then enter relations. Entity/relation distinction emerges **perspectivally**.

Traditional QDA (ATLAS.ti): entities (codes, categories) are pre-defined, then applied.
Here: a naming **is the event itself**. It has no inherent "kind" until it appears under a perspective.

## 2. The 3-Table Model

| Table | Role | Ontological Status |
|-------|------|-------------------|
| **namings** | Virtual objects, superpositions. A naming IS the event of its constitution — inscription chain + designation chain. No fixed `kind` field. | Ground truth atoms |
| **participations** | Undirected bonds. Symmetric, co-constitutive. A participation IS itself a naming. | Relational fabric (pure, unobserved) |
| **appearances** | Perspectival collapse. Entity/relation/silence **emerges** here. Direction, valence, properties exist only under a perspective. | Collapsed view from somewhere |

Key: same naming can appear as entity, relation, silence, or perspective — depending on observer's position. A perspective is itself a naming.

## 3. Designation Gradient (CCS)

Dewey/Bentley's naming taxonomy, implemented as **bidirectional, append-only chain**:

- **Cue**: Vague signal. Something registered but not yet named.
- **Characterization**: Provisional naming. Everyday language. Functional but loose.
- **Specification**: Most determined. Scientific/analytical precision (never final).

"Messy vs. Ordered" is NOT a mode — it's the **aggregated designation state** of elements at a given point.

The gradient is **reversible**. A well-specified naming can dissolve back (de-specification). This honors Barad's destructive interference: the zero-point is not absence but a concrete effect.

## 4. Three-Layer Hierarchy

1. **Datenstruktur** (DB tables) = **ground truth**. This is what IS.
2. **Liste** = privileged representation. Complete, dimensionally non-reductive. Shows all namings with current state. No arbitrary dimensional collapse.
3. **Canvas/Maps** = derivative projections. Cognitively helpful but epistemically subordinate. Trade complete coverage for intelligibility.

"The database IS the ground truth. The list best maps its logic because it doesn't dimensionally reduce. But humans need cognitive help — that's why we have maps."

## 5. Researcher-as-Naming

No ontological break between subject and object. Every user is a **naming in the data space** (`researcher_namings` table). The `by` field in naming acts references a naming — which may be a researcher-naming.

Barad: "intra-action" — participants mutually constitute each other.
Haraway: "situated perspectives" — knowledge always comes from somewhere.

The researcher's naming acts (designations, inscriptions, memos) are **traceable events in the relational fabric**, not external annotations.

## 6. Silences

Barad-inspired: "Empirically reconstructable because they leave traces — not as presence, but as patterns of non-presence."

- `mode: 'silence'` in appearances
- A silence can have participations (what dynamics produce this non-presence)
- Silences are **positive findings**, not absences to ignore
- Mathematical analogy: zero in wave interference is a specific state (overlapping crests and troughs)

## 7. Perspectival Collapse

A naming does **not have** a history; a naming **IS** its history (its stack).

Stack = inscription chain + designation chain + participations + appearances.
NOT "history" but "constitution."

Different perspectives collapse this stack differently via `collapseAt` (sequence number). Phase A sees cue at level 1, Phase B sees specification at level 3 — neither is more "true."

## 8. Provenance: Two Orthogonal Axes

| Dimension | Axis | Values |
|-----------|------|--------|
| **CCS Gradient** | Designation processing | cue <-> characterization <-> specification |
| **Grounding** | Empirical anchoring | doc-anchored / memo-linked / ungrounded |

Orthogonal: a cue CAN be document-anchored; a specification CAN be ungrounded.
Memo = CCS movement (analytical work), NOT grounding.
Document anchor = concrete attachment to corpus material.

Clarke: "There is no such thing as context." All material belongs in the corpus.

## 9. The Namings-Page Ontology (Session 09 — Critical Clarification)

**Initial (wrong) claim**: "Designate, Relate, Withdraw are perspectivally bound — they need a Map context."

**Correction by examining the data structure**:
- `naming_acts` has `naming_id`, `designation`, `by`. **No `perspective_id`**. Designation belongs to the naming itself — NOT perspectivally bound.
- `deleted_at` on namings — global, not perspective-bound.
- `participations` — global bonds. The appearance of a relation is perspectival, but the participation itself is not.
- Inscription chain and designation chain belong to the naming. Perspective-independent.

**Consequence**: Core operations (designate, rename, relate, withdraw, stack) operate **on the naming itself**, not on its appearance on a map. A Namings page with mutations is NOT a contradiction — it's consequent: operating directly on namings, independent of any specific perspective.

**But**: An HTML page IS always a perspective. There is no perspectiveless access to data. The Namings page is the **least-reduced** perspective — complete, dimensionless, most faithful to the data structure. Maps are more reduced (2D, visual filters, collapseAt).

**The Namings page is a privileged perspective**: it shows uncollapsed stacks, all namings, no dimensional reduction. It is the closest a UI can get to the data structure itself. Maps are derivative. The Namings page is the primary workspace.

## 10. Key Theoretical References

- **Dewey/Bentley** (*Knowing and the Known*): Transactional philosophy, CCS taxonomy, trans-action vs. inter-action
- **Karen Barad** (*Meeting the Universe Halfway*): Intra-action, destructive interference, silences as positive findings
- **Adele Clarke** (*Situational Analysis*): "There is no context"; situational mapping; relational pragmatism
- **Donna Haraway**: Situated knowledges, positioned perspectives, accountability
- **Harrison C. White**: Relational domains, identities from positions in networks

---

## Naming Acts (unified stack, Migration 009)

`naming_acts` replaces the former separate `naming_inscriptions` + `naming_designations` tables.
Each act carries all dimensions: inscription, designation, mode, valence — NULL = unchanged.
The current state = latest non-NULL value per dimension.
Mode and valence changes are first-class naming acts.
