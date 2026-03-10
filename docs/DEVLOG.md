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
