-- Migration 046: case_review_drafts — Liste der Begutachtungs-Entwürfe pro Case
--
-- Konzeptioneller Hintergrund: docs/h3_implementation_plan.md +
-- Memory project_critical_friend_identity.md (gated-c-Mechanismus) +
-- project_three_heuristics_architecture.md ("review_draft als Liste mit
-- Owner-/Quelle-Marker — UI heute single-Slot, Datenmodell kompatibel").
--
-- Begutachtungs-Entwürfe sind heute als FK cases.review_draft_document_id
-- abgebildet (Migration 029) — das erlaubt genau einen Entwurf pro Case.
-- Für die spätere Phase-6-Erweiterung (zweites Gutachten in MA/Diss/Peer-
-- Review als Vergleichs-Position) brauchen wir ein Listen-Datenmodell mit
-- Owner-Marker. Diese Migration legt die Liste an, lässt den FK aus
-- Migration 029 unverändert (Single-Slot-UI bleibt) und backfillt
-- existierende Entwürfe als 'SELF'.
--
-- owner_kind:
--   * 'SELF'             — eigenes Urteil des Users; ist das Material,
--                          gegen das WERK_GUTACHT-c und der dialogische
--                          Block d/e/f gegated werden (siehe
--                          project_critical_friend_identity.md).
--   * 'SECOND_REVIEWER'  — Zweitgutachten (MA/Diss); Vergleichs-Position
--                          für e (Differenz) und f (reflexive Position).
--   * 'EXTERNAL'         — externes Gutachten (Peer-Review-Decision-Letter,
--                          Editor-Brief). Kontext-Material, kein Konkurrenz-
--                          Urteil.
--
-- seq:
--   Reihenfolge innerhalb eines Cases (UI-Sortierung). Ist Application-
--   verwaltet, kein DB-Auto-Increment (damit Re-Order ohne Renumber-
--   Storm möglich ist).
--
-- Backward-Compat:
--   * Bestehender FK cases.review_draft_document_id bleibt unverändert.
--   * Backfill: für jeden Case mit non-NULL review_draft_document_id
--     wird ein 'SELF'-Eintrag erzeugt.
--   * Schreibwege (UI/API) werden in einem Folge-Schritt parallel
--     gepflegt: jede Änderung an cases.review_draft_document_id
--     wird auch in case_review_drafts reflektiert (siehe
--     docs/h3_implementation_status.md, Phase-1-Spec). Das ist
--     Application-Code, nicht Migration.
--   * Lange Sicht (Phase 6): View über case_review_drafts zur
--     Backward-Compat des FK, dann FK-Drop.
--
-- TO REVERT:
--   DROP TABLE case_review_drafts;

CREATE TABLE case_review_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  owner_kind TEXT NOT NULL CHECK (owner_kind IN (
    'SELF',
    'SECOND_REVIEWER',
    'EXTERNAL'
  )),

  -- Optionales Label für UI-Anzeige bei multiplen Entwürfen
  -- (z.B. "Erstgutachten Müller", "Editor-Decision JfE 2024").
  label TEXT,

  seq INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Genau ein 'SELF'-Eintrag pro Case (das eigene Urteil ist singulär).
  -- 'SECOND_REVIEWER' und 'EXTERNAL' können mehrfach pro Case vorkommen.
  -- Partial-Unique-Index erzwingt das DB-seitig.
  UNIQUE (case_id, document_id)
);

CREATE UNIQUE INDEX uniq_case_review_drafts_self
  ON case_review_drafts(case_id)
  WHERE owner_kind = 'SELF';

CREATE INDEX idx_case_review_drafts_case_seq
  ON case_review_drafts(case_id, seq);

-- Backfill: alle existierenden cases.review_draft_document_id als
-- 'SELF'-Einträge übernehmen. Idempotent via ON CONFLICT.
INSERT INTO case_review_drafts (case_id, document_id, owner_kind, seq)
SELECT id, review_draft_document_id, 'SELF', 0
FROM cases
WHERE review_draft_document_id IS NOT NULL
ON CONFLICT (case_id, document_id) DO NOTHING;
