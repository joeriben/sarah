-- Force password change for users whose password is a well-known default
-- (seeded 'admin' account, etc.). A banner in the header prompts the user
-- to set a new password on next login; the flag is cleared when they do.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Any existing user named 'admin' is assumed to still be on the seeded
-- default password. If they've already changed it, they can just dismiss
-- the banner by setting a new password (idempotent).
UPDATE users SET must_change_password = TRUE WHERE username = 'admin';
