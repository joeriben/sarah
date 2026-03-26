-- Migration 020: Fix persona check constraint (was still aidele/cairrie/raichel)
ALTER TABLE ai_tickets DROP CONSTRAINT IF EXISTS ai_tickets_persona_check;
ALTER TABLE ai_tickets ADD CONSTRAINT ai_tickets_persona_check
  CHECK (persona = ANY (ARRAY['coach', 'cowork', 'autonomous']));
