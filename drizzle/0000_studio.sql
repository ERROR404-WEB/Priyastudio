-- Additive initial schema. Re-running is safe; no drops or financial-data rewrites.
CREATE TABLE IF NOT EXISTS auth_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  username text UNIQUE, display_username text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_session (
  id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text, user_agent text, user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_account_user_idx ON auth_account(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS studio (
  id text PRIMARY KEY CONSTRAINT studio_singleton CHECK (id = 'studio'),
  revision integer NOT NULL,
  state jsonb NOT NULL,
  CONSTRAINT studio_revision_matches CHECK (revision >= 0 AND (state->>'revision')::integer = revision)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS studio_rate_bucket (
  key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS studio_bootstrap (
  id text PRIMARY KEY CONSTRAINT bootstrap_singleton CHECK (id = 'admin'), user_id text NOT NULL
);