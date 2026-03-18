# Documents, DocNets, and Comparative Analysis

Design decision document. Established session 18 (2026-03-18).

## The Problem

The current architecture treats documents as importable, codeable material — which is correct. But the system lacks two capabilities that real research processes require:

1. **Naming → Material (top-down)**: From a naming, see all passages (Sinneinheiten) across all documents where it is grounded. This is the constant comparison operation: "show me everything I've found about this naming."

2. **Documents/Groups → Comparative Views (bottom-up)**: From documents or document groups, generate comparative analytical views — as lists and as maps. This enables systematic comparison: "how does the situational structure of Project 1's publications differ from Project 2's?"

Additionally, there is no concept of document grouping. Documents exist as isolated namings with no way to form virtual sets, aggregate across them, or use them as the basis for comparative analysis.

## Sinneinheiten in Reconstructive Research

The tool must support reconstructive qualitative research (Bohnsack, Oevermann, Clarke, GTM) where the unit of meaning — the Sinneinheit — is NOT pre-defined by the system but **emerges from the researcher's analytical engagement**.

Different methods produce different Sinneinheiten:
- **Oevermann (Objective Hermeneutics)**: The Interakt — a speech act in its sequential position
- **Bohnsack (Documentary Method)**: The Passage — segments of high interactive density (Fokussierungsmetaphern), identified through discourse organization
- **Grounded Theory**: Variable — line-by-line, incident-by-incident, whatever the emerging theory demands
- **Clarke (Situational Analysis)**: Whatever the research question and the structure of the research object require

Atomic Sinneinheiten include not only words but also pauses "(3)", micro-pauses "(.)", prosodic markers "schon::", overlaps, hesitations — all of which carry meaning in reconstructive analysis.

**Consequence**: The system must not impose a granularity. The researcher selects arbitrary spans and creates namings. The current model (free text selection with character offsets, free image region selection) is correct in this regard. The analytical structure comes from the namings, not from the document format.

**Future option**: Optional tokenization of transcripts (parsing transcription systems like GAT2, TiQ, Jefferson into addressable tokens) would enable computational queries (concordance, pattern search across documents). This does not require architectural changes now but should not be foreclosed. A `tokens` JSONB column alongside `full_text` would suffice.

## Data Format Decision

**Plain text + character offsets remains the foundation.** Research data does not mutate after import; offsets are stable. The document is the import format — how material enters the system. Once inside, the analytically relevant units are the namings created by the researcher through coding.

The system is not replicating paper. It enables what paper cannot: non-sequential navigation through the coding structure, dynamic reorganization of material around namings, aggregation across documents, simultaneous multiple views.

**New import formats** are added as needed (SRT/VTT for video transcripts, HTML for web content). Each new format requires a text extraction path and, where applicable, a viewer component. The annotation model (arbitrary span selection → naming) remains the same.

## DocNets: Virtual, Non-Destructive Document Sets

A **DocNet** is a naming that participates with document namings. Nothing more.

- Created by a naming act (like everything in the system)
- Participations link it to documents
- Non-destructive: documents are not modified, not moved, not copied
- Virtual: a DocNet is a relational grouping, not a container
- Freely formed and dissolved: create, add documents, remove documents, delete the DocNet
- A document can be in arbitrarily many DocNets simultaneously
- No hierarchy: DocNets do not nest (if nesting is needed, a DocNet can participate with another DocNet — but this is not a structural requirement)

This is the OO organizing principle: objects linked by relations, not files in folders. It replaces MAXQDA's "Sets" and "Document Groups" with a mechanism consistent with the transactional ontology.

A DocNet, like any naming, has its own CCS gradient: "these belong together" (cue) → "these represent the institutional discourse of X" (specification). Grouping IS analysis.

### DocNets and Phases

DocNets relate to Phases on SitMaps: both are grouping mechanisms. The difference is the basis of grouping:

- **Phase**: Groups namings on a map by analytical affinity (Clarke's in-vivo categories, or emergent themes)
- **DocNet**: Groups documents by provenance, project, data type, sampling logic, or any other criterion the researcher finds relevant

On a SitMap, a DocNet can function **like a Phase**: "show me the namings grounded in this DocNet's documents." A single document can function the same way.

## Two Directions of Navigation

### 1. Naming → Material (Top-Down)

From any naming, the system shows all grounded Sinneinheiten:
- All document passages annotated with this naming, across all documents
- Passage text with surrounding context
- Document name and position (link to original location)
- Grouped by document or by DocNet
- Memos linked to this naming
- Designation history (CCS stack)
- All maps where this naming appears

This is the **constant comparison interface**: the researcher encounters everything known about a naming in one view and decides whether the naming still holds, needs refinement, or should split/merge.

### 2. Documents/DocNets → Comparative Views (Bottom-Up)

From a document or DocNet, the system generates analytical views:

**Comparative List View**: Which namings are grounded in DocNet A? In DocNet B? In both? What is the code frequency? Where are the gaps?

**Comparative Map View**: Two approaches, both valid:
- **(a) Separate SitMaps**: Generate a SitMap from DocNet A's namings, another from DocNet B's. Compare the two maps side by side.
- **(b) One SitMap with DocNet Phases**: Place both DocNets as phases on a single map. Namings grounded in both appear in both phases (overlap). Namings in only one phase are specific to that DocNet.

The researcher chooses the approach that fits their analytical question. Approach (a) gives independent situational analyses that can be compared. Approach (b) gives immediate overlap visibility on one canvas.

**"Generate SitMap from DocNet"** = take all namings grounded in the DocNet's documents, place them as entities on a new SitMap. This extends the existing "Import from document" feature to DocNets.

## Implementation Sequence

1. **This document** — establish the design decisions
2. **Code → Materialsammlung (Naming → Material)** — the aggregated view. Query: all annotations where the code participates. UI: panel or page showing passages with context, grouped by document.
3. **DocNet CRUD** — create DocNet (naming), add/remove document participations. UI in document list or dedicated page.
4. **DocNet → SitMap generation** — "import all namings from this DocNet's documents onto a map." Extends existing import-from-document.
5. **Comparative List View** — DocNet A vs. DocNet B: shared/unique namings, frequencies.
6. **Comparative Map View** — side-by-side maps or DocNet-as-Phase on one map.
7. **New import formats** — SRT/VTT, HTML — as research needs demand.
8. **Optional tokenization** — parser for transcription systems, `tokens` column, concordance queries. Deferred until empirical need.
