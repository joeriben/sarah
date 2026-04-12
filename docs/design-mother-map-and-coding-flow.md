# Mother Map, Doc-Clusters, and the Coding→Mapping Flow

Design decision document. Established session 30 (2026-04-12).

## The Problem

Situational Analysis describes two activities without specifying their operational relationship:

1. **GTM Coding**: Line-by-line, incident-by-incident engagement with documents — produces codes (namings grounded in passages)
2. **Situational Mapping**: "Dump everything in the situation" onto a map — produces a spatial/relational analytical view

Clarke (2005) assumes coding happens first and maps come "on top." Clarke (2018) treats maps as the primary method. Neither provides a process template for how coding and mapping interact in practice.

The transact-qda ontology already resolves this at the data level (codes ARE namings, the CCS gradient replaces the open/axial/selective phase distinction), but the UI has no workflow that connects coding a document to building the situational map. The two activities live on separate pages with no bridge.

## Design Decision: One Mother Map per Project

### Clarke's actual practice

Clarke describes ONE situational map that grows and evolves:

1. Messy Map — first dump, everything as cues
2. Ordered/Working Map — revisions of the same map, clustering, relating
3. Relational Maps — analytical operations on pairs of elements FROM the situational map

Relational Maps are not independent maps. They are focused interrogations of the one map. Social Worlds/Arenas Maps and Positional Maps are different map TYPES, not additional situational maps.

### The Situational Map (Primary/Mother Map)

Each project has one primary Situational Map — simply called **"Situational Map"** in the UI. It is the accumulating analytical space where all namings converge. Like Clarke's definite article ("the situational map"), it needs no qualifying name — it IS the analysis.

- Created automatically with the project (or on first coding act)
- Marked as primary (`is_mother: true`); cannot be deleted while project has namings
- All namings from document coding default to this map — no "which map?" prompt
- The map starts messy (all cues, no relations, no clusters) and becomes ordered through CCS progress
- The stack IS the revision history (messy → ordered is not a mode switch but the aggregate designation state)
- The Situational Map is never "done" — it grows as long as analysis continues

Additional SitMaps are permitted (e.g., for different research questions within one corpus), but only ONE is the primary — the default target for all coding. The primary is visually marked (● in map list). Switching the primary is a deliberate act with a confirmation prompt ("All future coding will target map X").

### What "landing on the Mother Map" means

When a researcher codes a document passage and creates a naming, that naming:

1. Gets an Appearance on the Mother Map's perspective
2. Has **no canvas coordinates** — it exists in the list but not on the canvas
3. Is visible in the left-column list, marked as "unplaced"
4. Waits for the researcher to deliberately drag it onto the canvas

**Placement is a conscious analytical act, not a layout operation.** When the researcher picks up a naming and positions it relative to other namings, they are making an analytical claim about the situation's structure. This act can trigger:

- **Confirmation**: "Yes, this belongs here, near these other elements"
- **Revision**: "Actually, this naming doesn't hold up when I try to relate it — I need to rename/split/merge it"
- **Decline**: "This naming is not relevant to the situation after all" (→ declined status)

The failure to place is analytically valuable: "this naming fits nowhere" is a finding about the situation.

### Unresolved Namings: Visibility and Analytical Goal

The methodological goal is that **every naming is decided upon**: either placed on the canvas or consciously declined. "Unresolved" means: neither placed nor declined — the researcher has not yet made an analytical judgment about this naming's place in the situation.

The term is "unresolved" rather than "unplaced" because the resolution can be placement OR decline. A naming that "fits nowhere" is analytically valuable — but the decision must be conscious, not accidental neglect.

**UI elements:**

1. **Toolbar status indicator**: Prominent, always visible. Shows unresolved count:
   ```
   Situational Map          7 unresolved     [show]
   ```
   Clicking [show] filters the list to unresolved namings. When all namings are resolved: `✓ all resolved`.

2. **Filter in the list panel**: Toggle between "all" / "placed" / "unresolved" / "declined"

3. **Visual distinction**: Unresolved namings in the list have a different visual treatment (e.g., dashed border, ○ vs. ● for placed, strikethrough for declined)

4. **Resolution acts**:
   - **Place**: Drag from list onto canvas — analytical claim about situational structure
   - **Decline**: Context menu → "Decline" — conscious judgment that this naming does not belong in the situation (retained in data, hidden from canvas, visible under "declined" filter)
   - **Revise**: Placement attempt reveals the naming doesn't hold up → rename, split, merge, or decline

The indicator is deliberately prominent. The analytical process aims for full resolution — every naming examined, every naming decided. This does not mean rushed: dozens of unresolved namings during active coding phases are normal. But the system communicates that resolution is the direction of travel.

## Doc-Clusters: Provenance as Lens

### The concept

A **Doc-Cluster** is a query-based cluster that shows all namings on the Mother Map grounded in a specific document. It is not manually assigned — it is derived from the document-anchor relationship.

```
Manual Cluster:  cluster_memberships → naming_ids → highlight on map
Doc-Cluster:     annotations WHERE document = X → naming_ids → highlight on map
```

### UI integration

Doc-Clusters appear in the ClustersSidebar alongside manual clusters, visually distinguished (e.g., 📄 icon, different border style):

```
Clusters
  ├── [manual] Selbstwirksamkeit (5)
  ├── [manual] Institutionelle Diskurse (3)
  ├── ─── Documents ───
  ├── [📄] Interview_Meier.txt (8)
  ├── [📄] Policy_Brief_2024.pdf (4)
  └── [📄] Foucault_Ch3.txt (2)
```

Clicking a Doc-Cluster applies the same highlight/dim logic as manual clusters: elements grounded in that document are highlighted, everything else dims. This answers: "Which elements on my map came from this document?"

### Overlap visibility

A naming can be grounded in multiple documents. Doc-Clusters naturally overlap. This is analytically meaningful: a naming grounded in both Interview_Meier and Policy_Brief is an element that bridges those data sources.

## Secondary Maps: Projections, Not Parallel Worlds

The Situational Map is the primary analytical space. Other maps are **projections** — not independent worlds but focused views derived from the same naming pool.

| Map Type | Function | Relation to Situational Map |
|----------|----------|----------------------------|
| Situational Map (primary) | Accumulating analytical space | — |
| Relational Map | Focus on a pair/group of elements | Draws elements FROM Situational Map |
| Social Worlds/Arenas | Higher aggregation level | Groups Situational Map elements |
| Positional Map | Positions on controversy axes | Different projection of same namings |
| Comparative Map | DocNet A vs. B | Filtered views of Situational Map |

All secondary maps share namings with the Situational Map. A naming placed on a Relational Map is the same naming — it just appears in a different spatial arrangement for a specific analytical purpose.

**Consequence**: Secondary maps do not have their own "unresolved namings." They draw from the Situational Map's pool. Creating a Relational Map = selecting elements from the Situational Map and arranging them in a new spatial configuration.

### Why not "Phase" for secondary maps

D/B define Phase as: "Aspect of fact in sufficiently developed statement to exhibit definite spatial and temporal localizations." Secondary maps ARE aspects of the same analytical fact. However:

1. **The UX problem persists.** "Phase" was renamed to "Cluster" precisely because users read "Phase 1, Phase 2" as sequential. Using "Phase" for map types reintroduces the same ambiguity.
2. **D/B's Phase is ontological, not methodological.** A fact presents itself in phases — that describes reality. A Relational Map is a researcher's deliberate analytical reduction — that describes method. Conflating the two levels would be the kind of reification D/B criticize.
3. **The term is codebase-burned.** `phase_memberships` → `cluster_memberships` was a conscious migration. Reintroducing "Phase" for a different concept invites confusion in code and docs.

Secondary maps are simply **maps with a type**. No umbrella term needed.

## The Coding→Mapping Workflow (Model C: Fluid)

There is no fixed sequence. The workflow is bidirectional:

### Coding → Map (grounding-first)

```
1. Open document, select passage, create naming (= grounded cue)
2. Naming appears in Mother Map list (unplaced)
3. Switch to Mother Map (or open in second tab)
4. See new unplaced namings in list
5. Drag onto canvas — analytical placement act
6. Clustering and relating follow naturally
```

### Map → Coding (theory-first)

```
1. On Mother Map, create naming from analytical intuition (= ungrounded cue, ∅)
2. Provenance indicator shows: ∅ (no document anchor)
3. Open documents, look for evidence
4. Code passages with the existing naming (= grounding the cue)
5. Provenance indicator updates: 📄
```

### The provenance matrix as compass

| State | Meaning | Action |
|-------|---------|--------|
| ∅ ungrounded, unplaced | Fresh idea, not yet situated | Ground in documents, place on map |
| 📄 grounded, unplaced | Coded but not yet analytically situated | Place on map |
| ∅ ungrounded, placed | Analytically positioned but no evidence | Find evidence in documents |
| 📄 grounded, placed | Fully situated | Continue specifying (CCS) |

The system shows these states. The researcher decides the order. "Messy" is when most namings are ∅/cue. "Ordered" is when most are 📄/characterized/specified. The transition is gradual, not a mode switch.

## Implementation Considerations

### Situational Map creation
- Auto-created with project, or on first naming act that needs a map
- Marked as `is_mother: true` in the perspectives/maps table
- Default inscription: "Situational Map"
- Cannot be deleted while project has namings
- Additional SitMaps permitted; only one can be `is_mother: true` at a time

### Unresolved namings
- Appearance record exists (naming is on this map's perspective) but `properties.x` and `properties.y` are null AND not declined
- Declined namings: `properties.declined: true` (or similar flag) — resolved but not placed
- List panel filters: "all" / "placed" / "unresolved" / "declined"
- Toolbar status: prominent unresolved count with [show] action; "✓ all resolved" when count = 0

### Doc-Clusters
- Not stored in `cluster_memberships` — computed at query time
- Query: `SELECT DISTINCT code_id FROM annotations WHERE document_id = $1`
- Intersected with current map's appearances to produce the highlight set
- Cached per page load, invalidated on annotation changes

### Coding page integration
- When creating an annotation, the naming automatically gets an Appearance on the Mother Map (if not already present)
- No UI prompt for map selection
- The document page could show a subtle indicator: "3 new namings → Mother Map" after a coding session

## Relation to Existing Design Documents

- **design-provenance-and-codes.md**: Codes as derived view from maps — the Mother Map IS where codes live. The "code list" is a query on the Mother Map's grounded namings.
- **design-clusters.md**: Clusters as characterization — manual clusters on the Mother Map are the primary clustering mechanism. Doc-Clusters extend this with query-based provenance clusters.
- **design-documents-and-docnets.md**: DocNets group documents. A DocNet-Cluster would be the union of its documents' Doc-Clusters. The "Generate SitMap from DocNet" operation (point 4) becomes: "Generate a secondary map from the Mother Map, filtered to namings grounded in this DocNet's documents."

## Resolved Questions (Session 30)

1. **Name**: "Situational Map" — definite article, like Clarke. No qualifying name needed for the primary. Additional SitMaps (if created) require names.
2. **Multiple SitMaps**: Permitted, but only one is primary (`is_mother: true`). The primary is the default target for all coding. Switching primary requires confirmation.
3. **Unresolved indicator**: Prominent. Full resolution (placed or declined) is the methodological goal. The system communicates this clearly: `7 unresolved [show]` → `✓ all resolved`.
4. **No "Phase" for secondary maps**: Rejected after critical examination. D/B's "Phase" is ontological (aspects of fact), not methodological (researcher's analytical operations). The UX confusion that motivated Phase→Cluster rename applies equally here. Secondary maps are simply maps with a type attribute.

## Open Questions

1. **Doc-Cluster performance**: For projects with many documents, computing Doc-Clusters on every page load may be expensive. Consider materialized view or caching strategy.
2. **Unresolved → Aidele integration**: Should the didactic persona (Phase 4 roadmap) reference the unresolved count? E.g., "You have 12 unresolved namings — in Clarke's process, this would be a good moment to work on your situational map."
3. **Secondary map creation UX**: How does a researcher create a Relational Map from the Situational Map? Select two elements → "Create Relational Map"? Or a dedicated "New Map from selection" action?
