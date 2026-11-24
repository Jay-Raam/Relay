-- Relay — 003 authentication
-- Accounts that may sign in to the dashboard, and who sent each device command.
-- No account is created here and none is seeded: create the first one with
--   pnpm --filter @relay/api create-user <email> <viewer|operator>

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,         -- scrypt$N$r$p$salt$hash, never the password
  role          TEXT NOT NULL,         -- viewer | operator
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_role_check CHECK (role IN ('viewer', 'operator')),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- Audit: who sent the command. Nullable so commands logged before auth existed stay valid,
-- and SET NULL so removing an account never deletes the command history.
ALTER TABLE device_commands
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users (id) ON DELETE SET NULL;
