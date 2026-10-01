-- Additive and rerunnable. Deliberately separate from the studio aggregate and auth accounts.
CREATE TABLE IF NOT EXISTS calendar_connection (
	owner_id text PRIMARY KEY,
	namespace text NOT NULL UNIQUE,
	epoch integer NOT NULL DEFAULT 0 CONSTRAINT calendar_epoch_valid CHECK (epoch >= 0),
	credentials text,
	reconnect_required boolean NOT NULL DEFAULT false,
	lease_token text,
	lease_until timestamptz NOT NULL DEFAULT now(),
	blocked_until timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS calendar_shoot (
	owner_id text NOT NULL REFERENCES calendar_connection(owner_id),
	id text NOT NULL,
	revision integer NOT NULL,
	body jsonb NOT NULL,
	event_generation integer NOT NULL DEFAULT 0,
	synced_epoch integer,
	PRIMARY KEY (owner_id, id),
	CONSTRAINT calendar_shoot_valid CHECK (
		revision > 0 AND event_generation >= 0
		AND (body->>'revision')::integer = revision AND body->>'id' = id
		AND body->>'timeZone' = 'Asia/Kolkata'
		AND (body->>'startsAt')::timestamptz < (body->>'endsAt')::timestamptz
	)
);
--> statement-breakpoint
-- At most one outstanding consent per owner. Raw browser/state values are never stored.
CREATE TABLE IF NOT EXISTS calendar_oauth_state (
	owner_id text PRIMARY KEY REFERENCES calendar_connection(owner_id),
	state_hash text NOT NULL UNIQUE,
	browser_hash text NOT NULL,
	epoch integer NOT NULL,
	verifier text NOT NULL,
	expires_at timestamptz NOT NULL
);