# Memo Ontology

Foundation: Dewey/Bentley, "Knowing and the Known" (Ch. VI, Specification).

> "A name is in effect a truncated description. A description is an expanding naming."

This applies to ONE naming. Inquiry itself is not a naming — it is the medium in which namings are produced.

## Memo Types

| Type | Mode | Where | Purpose | Implementation |
|------|------|-------|---------|----------------|
| **Description-Memo** | Stack-integral | `naming_acts.memo_text` | Expanding form of a single naming. Captures passage-specific nuance. | Created during annotation (Code-Memo field) or retroactively (+ Memo on passage card). Linked to annotation via `linked_naming_ids`. Part of the code's designation stack. |
| **Analytical Memo** | Inquiry-medium | `memo_content` table | Reflexive inquiry spanning constellations or the research process. Incl. organizational memos (sampling strategy, data collection). | Created in `/memos` or inline (document memo). Technically a naming in the DB but does not appear on map perspectives. Can be **promoted** to map-visible naming. |

## Key Principles

### No AI/Human binary
Analytical memos are the shared medium of the **Interpretations-Kollektiv** (researcher + AI as co-inquirers). The distinction is **provenance** (who authored, when, with what epistemic authority) — not type. One memo system, one discussion mechanism, one visibility pattern. Provenance markers signal epistemic status without creating separate UI flows.

### Description-Memo lifecycle
1. During annotation: optional Code-Memo captures why this passage is coded this way
2. Retroactively: `+ Memo` on any expanded passage card in the Passages panel
3. Storage: `naming_acts` row on the **code** (not the annotation), with `linked_naming_ids: [annotationId]`
4. Visibility: appears in the code's designation stack (Namings panel, expanded), and on the passage card

### Analytical Memo lifecycle
1. Created: in `/memos` page, or via document memo input (Namings panel footer)
2. Can link to documents, codes, or other namings
3. Can be **promoted** to a map-visible naming (explicit transition from inquiry-medium to data-structure)
4. Both AI and researcher produce these

### Stack relationship
A code's stack = its `naming_acts` entries ordered by `seq`. This includes:
- Designation changes (CCS: cue → characterization → specification)
- Inscription changes (renames)
- Description-Memos (passage-specific observations)

A naming **IS** its stack — it does not *have* a history the way a file has metadata.

## References
- Session 16: ontological foundation
- Session 28: Code-Memo field added to annotation workflow
- Session 29: retroactive passage memo, Namings panel shows stack + memos
- D/B: Dewey & Bentley (1949), Knowing and the Known, Chapter VI
