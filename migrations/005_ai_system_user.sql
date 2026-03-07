-- System user for AI-created namings.
-- The AI is not a human user, but namings.created_by is NOT NULL REFERENCES users(id).
-- A sentinel system user with a fixed UUID satisfies the FK without making the column nullable.
-- This user never logs in; it exists only as a DB anchor for AI acts.

INSERT INTO users (id, username, email, password_hash, display_name, role)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'ai-system',
  'ai-system@internal',
  '',
  'AI System',
  'user'
) ON CONFLICT (id) DO NOTHING;
