-- AI ticket system: bots report bugs, improvements, and suggestions.
-- Gitignored data (not in the project data space — purely operational).

CREATE TABLE ai_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona TEXT NOT NULL CHECK (persona IN ('aidele', 'cairrie', 'raichel')),
  type TEXT NOT NULL CHECK (type IN ('bug', 'improvement', 'suggestion')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_tickets_status ON ai_tickets (status);
CREATE INDEX idx_ai_tickets_persona ON ai_tickets (persona);
