# Cluster Design (Rename Phase → Cluster)

## Theoretical Foundation

Dewey/Bentley, "Knowing and the Known" (Ch. X):

> "Characterization develops out of cue through the **clustering** of cues and the growth of language."

Clustering IS characterization. When a researcher groups related cues and names the group, that name is a characterization — a higher-order naming that truncates the descriptions of its members into a single designation.

In GTA terms: Open Coding produces Cues. Axial Coding is clustering — identifying relational regions within the data. The CCS gradient replaces the methodological phase distinction: there is no mode switch between "open" and "axial," only movement along the designation gradient.

### Why "Cluster" not "Phase"

"Phase" was originally chosen to evoke superpositional states (physics), not sequential process steps. But for users without that background, "Phase" inevitably suggests sequence ("Phase 1, Phase 2"). "Cluster" is:

- D/B-correct ("clustering of cues")
- Physically consistent (clusters of subatomic particles are superpositional)
- Methodologically neutral (no sequential connotation)
- Descriptively accurate (a named group of related namings)

## Existing Data Structure

The infrastructure for clusters already exists as "phases":

### Table: `phase_memberships`
```sql
CREATE TABLE phase_memberships (
  phase_id UUID NOT NULL REFERENCES namings(id),   -- the cluster naming
  naming_id UUID NOT NULL REFERENCES namings(id),   -- the member naming
  action TEXT NOT NULL CHECK (action IN ('assign', 'remove')),
  mode TEXT DEFAULT 'entity',
  by UUID NOT NULL REFERENCES namings(id),          -- who assigned (researcher naming)
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL                                     -- append-only history
);
```

### How Clusters Work

A cluster is a **naming** that:
1. Has its own inscription (the cluster's name, e.g. "Selbstwirksamkeit")
2. Has its own CCS designation (starts at `characterization` — clustering IS characterizing)
3. Appears as a sub-perspective on maps (`mode: 'perspective'`)
4. Has members tracked via `phase_memberships` (append-only, traceable)
5. Can itself be clustered (recursive — clusters of clusters)

### Properties on Cluster Appearances

Clusters on maps carry visual properties in `appearances.properties`:
- `color`: visual identifier
- `mapType`-related props inherited from the map perspective

## What Needs to Change

### 1. Rename (DB + Code + UI)

| Current | New |
|---------|-----|
| `phase_memberships` | `cluster_memberships` |
| `phase_id` column | `cluster_id` column |
| `phase` in variable names | `cluster` |
| "Phase" in UI labels | "Cluster" |

Migration: `ALTER TABLE phase_memberships RENAME TO cluster_memberships; ALTER TABLE cluster_memberships RENAME COLUMN phase_id TO cluster_id;`

### 2. Open Clusters for Document Coding

Currently clusters exist only within map perspectives. For coding workflow:

- **Namings panel (Spalte 3)**: Show cluster membership per naming (color badge or grouping)
- **Create cluster from coding context**: Select multiple namings → "Create Cluster" → name it
- **Assign to cluster**: Drag naming to cluster, or dropdown/picker
- **Grounding Workspace**: Clusters can exist without a map, on the project's grounding workspace perspective

### 3. Bring Coding and SitMapping Closer

The cluster is the bridge between document coding and situational mapping:

- **Coding creates Cues** (grounded in passages)
- **Clustering characterizes** (groups cues, names the group)
- **Map placement visualizes** the clusters and their relations
- **Relational interrogation** between clusters produces specification

The Namings panel already shows all project namings. Adding cluster grouping there makes the coding→mapping transition seamless — no need to switch to a map to start clustering.

### 4. Cluster Visibility

| Context | What to Show |
|---------|-------------|
| Namings panel (Spalte 3) | Group namings by cluster, show cluster name as header |
| Passages panel (Spalte 4) | Cluster badge on passage cards (which cluster does this code belong to?) |
| Maps | Clusters as visual groups (existing phase rendering) |
| `/namings/[namingId]` | Cluster membership in the naming's detail view |

## Open Questions

1. **Cluster creation from Similar results**: When embedding similarity reveals a group of related passages, should the system suggest cluster formation?
2. **Embedding-based cluster proposals**: Use the Cluster-Analysis method (from embedding analysis table) to propose clusters automatically — researcher confirms/rejects.
3. **Cluster ↔ Relation**: A cluster of related namings implies relations between them. Should clustering auto-create relations, or are clusters and relations orthogonal?
4. **Cross-map clusters**: A naming can appear on multiple maps. Should its cluster membership be per-perspective or global?

## References

- Session 29 (2026-03-28/29): Design discussion — Phases → Clusters, D/B foundation
- Session 15: Relation-creation advances Cue → Characterization
- Session 25: "well-grounded cue" criteria (2+ passages or analytically articulated)
- Migration 006: `phase_memberships` table
- `docs/design-memo-ontology.md`: Memo types (Description/Analytical)
- Memory: `project_embedding_analysis_methods.md` — 6 embedding-based analysis methods
