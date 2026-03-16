# transact-qda Development Log

QDA platform grounded in Situational Analysis (Clarke) and transactional philosophy (Dewey/Bentley).
Core principle: the fundamental unit is the event (naming/relating act), not the entity.

---

## Session 00 — 2026-03-07

**Focus**: Project bootstrap and data model design

- Established transactional ontology: **namings**, **participations**, **appearances**
- Defined three-tier architecture:
  - Datenstruktur = ground truth (namings, appearances, designations, participations)
  - Liste = privileged representation (complete, dimensionless)
  - Canvas = derivative projection (convenient but epistemically subordinate)
- Set up SvelteKit 5 + PostgreSQL + Argon2id auth
- Deployed to transact.ucdcae.org via Cloudflare tunnel

| Commit | Description |
|--------|-------------|
| `d2a8fa1` | Initial scaffold: transact-qda |

---

## Session 01 — 2026-03-07

**Focus**: Transactional ontology implementation

- Renamed core tables from events/elements to **namings/participations/appearances**
- Implemented designation process: cue → characterization → specification
- Introduced **researcher-as-naming**: each user is a naming in the data space
- Every rename/designation creates transparency via memo + co-actor linking

| Commit | Description |
|--------|-------------|
| `0b56997` | Refactor to transactional ontology: namings, participations, appearances |
| `b1f8386` | Add designation process and researcher-as-naming |

---

## Session 02 — 2026-03-07

**Focus**: Situational Map as data-driven workflow

- Map as a naming that serves as a perspective
- Messy vs. Ordered: not modes, but aggregate designation states
- Phase emergence: phases as sub-perspectives
- Perspectival collapse: expressions appear differently from different perspectives
- Relation form with symmetry, valence, inscription
- Inscription history, inline rename, memo on designation change
- Naming act transparency: every analytical act gets a linkable memo

| Commit | Description |
|--------|-------------|
| `b239c6f` | Situational map: data-driven workflow with designation gradient |
| `d0d27e6` | Fix map detail 500, live reload reactivity, start script port cleanup |
| `1231597` | Relation form: inline UI with symmetry, valence, inscription, auto-designation |
| `340ebd0` | Inscription history, inline rename, memo on designation change |
| `072ce39` | Naming act transparency: every rename/designation creates a linkable memo |
| `f0ec7bb` | Fix invalid date in memos list: use created_at instead of updated_at |

---

## Session 03 — 2026-03-08

**Focus**: AI agent integration with ontological consistency

- AI as hybrid Naming: AI suggestions begin as Cues, researcher elevates via Accept/Reject
- Provider-agnostic AI client (OpenRouter primary, Anthropic fallback)
- Enabled meta-relations: relations can relate to other relations
- Perspectival collapse: a naming IS its stack, not its latest state
- Phases as embedded perspectives with auto-collapse on assignment
- Provenance indicators: empirical, analytical, or ungrounded
- Replaced emoji with Google Material Icons

| Commit | Description |
|--------|-------------|
| `9cafb5a` | AI agent as naming: proactive co-analyst with tool-use |
| `10b9b0c` | Enable meta-relations: relate to relations, not just entities |
| `ff12214` | Add system user migration for AI-created namings |
| `4537d5d` | Switch AI client to OpenRouter with Anthropic fallback |
| `31b4358` | Refactor AI client: provider-agnostic wrapper for OpenRouter + Anthropic |
| `9cb0978` | Perspectival collapse: a naming IS its stack, not its latest state |
| `892b8d7` | Phases as embedded perspectives with auto-collapse on assignment |
| `a794c55` | Keep assign mode active after adding element to phase |
| `867c62e` | Provenance indicators: empirical, analytical, or ungrounded |
| `d973071` | Replace emoji with Google Material Icons |
| `f3006fe` | Fix '?' for unnamed relations as relation endpoints |
| `79464d2` | Fix Svelte 5 state_referenced_locally warnings |

---

## Session 04 — 2026-03-08

**Focus**: Canvas visualization with ELK.js layout engine

- Canvas as derivative projection — list view remains privileged
- ELK.js for hierarchical/stress/force layout algorithms
- Custom Svelte rendering (not off-the-shelf graph lib)
- Relations as first-class visual nodes on edges
- Phase highlight with pulse animation
- List/Canvas view toggle with shared prompts
- Topology snapshots: auto-buffer + named save/restore
- UX: renamed "co-actors" to "namings I have in mind"

| Commit | Description |
|--------|-------------|
| `4ca2025` | Canvas-based map visualization with ELK.js auto-layout |
| `ebdf2c3` | Phase highlight + expand on label click, canvas phase visualization |
| `d8efcdc` | Stronger phase pulse and subtle dimming (85%) for non-members |
| `ace8893` | Add List/Canvas view toggle for situational map |
| `94ef15e` | Restore list view as primary: fix 5 missing functions, shared prompts |
| `773e721` | Add naming-act memo prompt for relations |
| `d335e53` | Show linked memos in stack panel and act-prompt |
| `41eb4e9` | Single-click inscription toggles stack panel |
| `69ea8bf` | Fix canvas node positioning: center-based instead of top-left |
| `2d2f0f0` | Increase ELK layout spacing and fix center-based coordinates |
| `fccdce0` | Add topology snapshots: auto-buffer + named save/restore |
| `638350b` | Rename 'co-actors' to 'namings I have in mind' in act prompt |

---

## Session 05 — 2026-03-08

**Focus**: AI dialogue and discussion infrastructure

- Cue discussion: researchers discuss AI-generated Cues inline with multi-turn conversation
- Unified withdraw: both researcher and AI can withdraw contributions
- Discussion-aware map context passed to AI for reasoning
- Deployed via Cloudflare for external access

| Commit | Description |
|--------|-------------|
| `7df3f53` | Allow transact.ucdcae.org as Vite dev server host |
| `7dd5449` | Add cue discussion: researchers can discuss AI-generated cues inline |
| `2a3cde0` | Fix discussCue SQL error and improve discussion error handling |
| `3191132` | Unified withdraw for researcher and AI, discussion-aware map context |

---

## Session 06 — 2026-03-09

**Focus**: Team collaboration and member management

- Project member management API (GET/POST/PATCH/DELETE)
- Role hierarchy: owner > admin > member > viewer
- Members page with role badges, add/remove UI, sidebar integration
- Fix topology snapshots to use actual browser positions
- Declined filter: dim connection lines, virtual phase hides non-members

| Commit | Description |
|--------|-------------|
| `5cfdd6f` | Add team collaboration: project member management |
| `0c67de4` | Fix topology snapshots: save/restore use actual browser positions |
| `d6e09f0` | Add declined filter: dim connection lines, virtual phase hides members |

---

## Session 07 — 2026-03-10

**Focus**: Canvas fixes, document annotation, infrastructure

- Fix canvas click-to-relate: left-click now completes relation as status bar promises
- Floating stack panel for canvas view (top-right overlay)
- Memo hover tooltips on canvas nodes (non-AI memos, pure CSS)
- Interactive document text annotation with CSS Custom Highlight API
- Nightly database backup via pg_dump + systemd timer (03:00, 30-day retention)

| Commit | Description |
|--------|-------------|
| `3298cfd` | Fix canvas: click-to-relate and floating stack panel |
| `c699799` | Add memo hover tooltips on canvas nodes |
| `2c19e50` | Add nightly database backup via pg_dump + systemd timer |
| `d2c7774` | Add interactive document text annotation with CSS Custom Highlight API |

---

## Session 08 — 2026-03-11

**Focus**: Image annotation, in-vivo coding, provenance design

- Image region annotation: rectangle selection with SVG overlay on normalized coordinates
- Image serving endpoint, ImageAnnotationViewer component with zoom/pan (reuses `createViewport()`)
- Unified sidebar: text selections and image regions share the same code picker panel
- In-vivo coding: create codes inline during annotation (type name → create + annotate in one step)
- Color picker for in-vivo codes, code uniqueness enforcement
- Zoom fixes: configurable min/max zoom in viewport, large image support, viewport constraint after zoom
- Text annotation rendering: segment-based inline color coding with hover tooltips (no layout shift)
- Monospace font for document text (Courier New/Consolas) — stable character positions for Gruppendiskussionen
- Fixed code panel: no longer scrolls away, stays in view while text scrolls independently
- **Design decision: provenance and codes** — documented in `docs/design-provenance-and-codes.md`
  - Codes should be a derived view from maps, not a separate ontological domain
  - Two orthogonal dimensions: CCS gradient (cue → characterization → specification) vs. grounding (📄 document anchor)
  - "There is no such thing as context" → all material (including discourse/theory texts) belongs in the corpus
  - Memos (📝) are reflexive process, not grounding. 📄 is the only grounding indicator.
  - AI visual analysis deferred — requires multimodal client, positioned as grounding assistant (not map-level co-analyst)

| Commit | Description |
|--------|-------------|
| `45b6f29` | Add image region annotation with rectangle selection and SVG overlay |
| `287d4c5` | Add in-vivo coding: create codes inline during annotation |
| `de0c481` | Add color picker for in-vivo codes, enforce code uniqueness |
| `ac39f27` | Fix image viewer zoom, cancel button, and large image support |
| `a550c06` | Segment-based text annotation rendering, monospace font, fixed code panel |

---

## Session 09 — 2026-03-11

**Focus**: Code system refactor — codes as derived view from maps

- **Retired `code-system` perspective** (ATLAS.ti model: codes as pre-existing categories)
- Renamed to `grounding-workspace`: infrastructure holding pen for orphan in-vivo codes, not a separate analytical domain
- **`getAnnotationCandidates()`** replaces `getCodeTree()`: pulls entities from ALL map perspectives + grounding workspace, `DISTINCT ON` preferring map appearances
- Annotation sidebar now groups candidates by source map (section headers)
- Color resolution perspective-agnostic (subquery across all entity appearances)
- Layout nav: "Codes" → "Grounding", badge shows grounded naming count
- **Grounding dashboard**: filter by grounded (📄) / ungrounded, grouped by source map
- Memo indicator (📝) shown as orthogonal marker — reflexive process, not a grounding category
- **Correction**: removed "reflected" as a grounding filter status — having a memo is CCS-gradient movement (cue→characterization), not grounding

| Commit | Description |
|--------|-------------|
| `71de965` | Refactor code system: codes as derived view from maps |

---

## Session 10 — 2026-03-12

**Focus**: Namings workspace and naming_acts unification

- Renamed Codes/Grounding sidebar to **Namings** — direct map links, standalone workspace
- Namings workspace: filter, create unplaced cues, relation proposition format
- **Unified `naming_acts`**: merged `naming_inscriptions` + `naming_designations` into single append-only stack
- Relation valence editing, mode switching, AI filter covers endpoints
- Canvas zoom fix: non-passive wheel listener, +/- zoom buttons

| Commit | Description |
|--------|-------------|
| `ff059a6` | Fix grounding dashboard: remove reflected as grounding category |
| `e6aada0` | Rename Codes/Grounding to Namings, restructure sidebar |
| `542d1be` | Add Namings workspace as standalone working space |
| `2c78753` | Improve namings: relation proposition format, AI filter |
| `036ac94` | Relation proposition format, mode switching, valence editing |
| `06bfcfa` | Unify naming_inscriptions + naming_designations into naming_acts |
| `b31e635` | Fix canvas zoom: non-passive wheel listener, +/- buttons |

---

## Session 11 — 2026-03-12

**Focus**: Clarke's relational interrogation and epistemological foundations

- Epistemological foundations reference doc
- Clarke's Situational Matrix integrated into AI agent prompt
- Enhanced Sit Map: connection toggle, scatter placement, flexible list grouping
- **"Center on" radial layout**: pure-geometry radial layout for Clarke's relational interrogation
- Extended Clarke critique: the unmarked, deconstructive AI questioning

| Commit | Description |
|--------|-------------|
| `8fa878d` | Add epistemological foundations, improve relate confirmation UX |
| `4dda55a` | Add Clarke's Situational Matrix, restructure AI agent prompt |
| `c8b0a4f` | Enhance Sit Map: connection toggle, scatter placement, list grouping |
| `dc3c295` | Add "Center on" radial layout for relational interrogation |
| `46fdcf5` | Extended Clarke critique: the unmarked, deconstructive AI questioning |

---

## Session 12 — 2026-03-14

**Focus**: Manual, CCS terminology, participations as autonomous layer

- transact-qda manual documenting all features
- Corrected CCS terminology throughout codebase
- Clarified participations as relating-cues and autonomous structural layer

| Commit | Description |
|--------|-------------|
| `122d424` | Add transact-qda manual and correct CCS terminology |
| `5784884` | Clarify participations as relating-cues and autonomous structural layer |

---

## Session 13 — 2026-03-14

**Focus**: Multi-map architecture and structural integrity

- **Multi-map support**: place existing namings on multiple maps, cross-boundary signaling
- ELK layout resilience: skip orphaned edges, try/catch in initPositions
- Naming merge with confirmation step and auto-memo documenting absorbed naming
- Sidebar multi-map navigation
- **"Import from document"**: batch placement of document-grounded namings onto maps
- **Structural integrity enforcement**: auto-add missing endpoints when relating on a map

| Commit | Description |
|--------|-------------|
| `9cd7a63` | Add multi-map support: place existing namings, cross-boundary signaling, ELK resilience |
| `f3f93f9` | Add naming merge and sidebar multi-map navigation |
| `8d14821` | Add "Import from document" batch placement on maps |
| `51ed80c` | Add merge confirmation step and auto-memo |
| `1957623` | Enforce structural integrity: auto-add missing endpoints when relating |

---

## Session 14 — 2026-03-15

**Focus**: Social Worlds/Arenas Maps — epistemological foundations and initial rendering

- Epistemological deep dive into Clarke's SW/A maps (Session 14 transcript):
  - Social Worlds as universes of discourse (Strauss/Shibutani), not institutional containers
  - Arenas as dispositif configurations (Foucault), not neutral interaction zones
  - Resolved dual discourse question (Gasterstädt): Straussian and Foucauldian discourse must be held in productive tension
  - SW/A maps make stabilizations, conflict structures, and dispositival configurations visible
  - Discourses are constitutive forces, not mere elements
- **Formation classification via memo**: machine-readable `Formation: <role>` in first memo inscription — the analytical judgment "this IS a social world" is itself a naming act, not a structural type
- **Four formation roles** with distinct visual signatures per Clarke:
  - Social World: dotted ellipse
  - Arena: dashed ellipse (gestrichelt)
  - Organization: dashed rectangle
  - Discourse: solid ellipse, semi-transparent fill
- `addFormation` API action: creates element + classification memo with default size per role
- `getMapAppearances` extracts `sw_role` from first linked "Formation:" memo
- `FormationNode.svelte`: SVG component rendering inside existing `CanvasElement` (reuses drag/click logic)
- SW/A-specific add-form with role selector dropdown

| Commit | Description |
|--------|-------------|
| `f0fa562` | Add Social Worlds/Arenas map rendering with formation types |

---

## Session 14b — 2026-03-15

**Focus**: Interactive resize and rotation for SWA formation elements

- **Resize handles**: 4 cardinal handles (N/S/E/W) appear when a formation is selected; drag to change rx/ry
- **Rotation handle**: stem + circle above north edge; custom rotation cursor icon on hover/drag
- **Shift modifiers**: Shift+resize locks aspect ratio (proportional scaling); Shift+rotate snaps to 15° increments
- Rotation applied via SVG `<g transform="rotate(...)">` — no CSS transform conflicts
- Resize/rotate deltas corrected for viewport zoom and current rotation angle (2D rotation matrix)
- Generic `updateProperties` API action: merges arbitrary props into `appearances.properties` JSONB — reusable beyond formations
- **Svelte 5 event delegation workaround**: SVG handle events use native `addEventListener` via Svelte actions (`use:resizeHandle`, `use:rotateHandle`) + `stopImmediatePropagation` to prevent CanvasElement drag from intercepting handle interactions

| Commit | Description |
|--------|-------------|
| `e8fd4d9` | Add resize and rotation handles for SWA formation elements |
| `e38783c` | Fix handles: window-level listeners instead of SVG pointer capture |
| `ad8aa77` | Fix handles: Svelte actions with native listeners to bypass delegation |
| `c67e853` | Improve rotation handle: larger hit area and rotation cursor icon |
| `68a2390` | Add Shift+drag for proportional resize |

---

## Session 15 — 2026-03-16

**Focus**: SW/A map interaction polish, spatial relations, map duplication

- **Automatic spatial relation derivation** for SW/A maps: detects containment and overlap between formations based on position/size, syncs relations on drag/resize/rotate via `syncSpatialRelations`
- **Map duplication**: right-click context menu on maps listing page → "Duplicate". Creates new map with shared elements (same namings, new appearances with copied positions), cloned phases with memberships. Aligns with multi-map architecture — same naming, independent perspectival collapse
- **Withdraw/Restore in context menu**: all map types now offer withdraw/restore via right-click; FormationNode shows withdrawn state at 30% opacity
- Spatial/AI relations skip designation advance (`skipDesignationAdvance`) — provisional relations are not positive analytical acts
- Re-queue mechanism for spatial sync during concurrent drags
- Read-only map support and Clarke demo project restore
- **Bugfix**: relation node min-width increased (36px → 80px) to prevent single-character wrapping
- **Bugfix**: declined filter hint shows "hidden" instead of "showing"

| Commit | Description |
|--------|-------------|
| `5ad10c6` | Add automatic spatial relation derivation for SW/A maps |
| `be07a58` | Fix spatial sync: re-queue mechanism for concurrent drags |
| `e06448c` | Add withdraw/restore to context menu and withdrawn state on formations |
| `08f8301` | Add map duplication via context menu on maps listing page |
| `2165427` | Fix: spatial/AI relations must not advance endpoint designations |
| `9239229` | Fix declined filter hint: show 'hidden' instead of 'showing' |
| `98b01c8` | Fix relation node width: prevent single-char wrapping |
| `bfc055f` | Add read-only map support and restore Clarke demo project |

---

## Session 17 — 2026-03-16

**Focus**: Map page decomposition, type error fixes, displayMode restoration

- **Map page decomposition**: monolith `+page.svelte` (2881 lines) decomposed into 11 components + shared state factory (805 lines remaining)
  - `mapState.svelte.ts`: factory function with reactive getters/setters, distributed via `setContext`/`getContext`
  - Extracted: MapToolbar, StackPanel (unified floating+inline), ListItemCard, PhasesSidebar, NamingActPrompt, RelationForm, MemoPanel, ContextMenu, TopoPanel, OutsidePanel
  - StackPanel eliminates duplication between canvas floating panel and list inline panel
- **Type error fixes** (24 → 0): installed `@types/node` + `@types/pg`, typed query generics in codes/memos/namings queries, fixed role cast, pdf-parse import, layout param types
- **Dead CSS removal**: 20 unused selectors across 4 files
- **displayMode restoration**: discovered that the 3-way canvas display filter (Entities/Relations/Full) was silently dropped in commit `3deb477` (Session 15 WIP) — the feature had been implemented in `a5e9c66` but was replaced with a simpler `showConnections` toggle during a large rewrite. Restored from git history.

**Regression root cause**: Session 15 Claude rewrote the map page to add spatial containment + diamond shapes and silently replaced `displayMode` (3 modes: entities-only, relations-only, full+lines) with `showConnections` (binary toggle). No mention in session docs, no user confirmation. Prevention: pre-rewrite feature inventory rule added to memory.

| Commit | Description |
|--------|-------------|
| `afe270b` | Decompose map page monolith (2881→805 lines) + fix all type errors |
| `pending` | Restore displayMode 3-way canvas filter (Entities/Relations/Full) |

---

## Bugfixes — 2026-03-15

| Commit | Description |
|--------|-------------|
| `4c33c74` | Fix phase assignment in canvas mode: clicking nodes now assigns to active phase |
