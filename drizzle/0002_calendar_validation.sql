-- Repair the original CHECK's SQL-NULL loophole on existing installations, without rewriting data.
-- One ALTER statement is atomic, including when rerun. Invalid old rows abort the migration:
-- the owner must inspect/repair them explicitly, never reset/delete saved data automatically.
ALTER TABLE calendar_shoot
	DROP CONSTRAINT IF EXISTS calendar_shoot_valid,
	ADD CONSTRAINT calendar_shoot_valid CHECK (coalesce(
		revision > 0 AND event_generation >= 0 AND (synced_epoch IS NULL OR synced_epoch >= 0)
		AND jsonb_typeof(body) = 'object'
		AND body ?& ARRAY['id', 'collaborationId', 'title', 'startsAt', 'endsAt', 'timeZone', 'location', 'reminderMinutes', 'revision', 'cancelled', 'status', 'error']
		AND body - ARRAY['id', 'collaborationId', 'title', 'startsAt', 'endsAt', 'timeZone', 'location', 'reminderMinutes', 'revision', 'cancelled', 'status', 'error'] = '{}'::jsonb
		AND jsonb_typeof(body->'id') = 'string' AND body->>'id' = id AND id ~ '^[A-Za-z0-9_-]{1,100}$'
		AND jsonb_typeof(body->'collaborationId') = 'string' AND body->>'collaborationId' ~ '^[A-Za-z0-9_-]{1,100}$'
		AND jsonb_typeof(body->'revision') = 'number' AND (body->>'revision')::numeric = revision
		AND jsonb_typeof(body->'title') = 'string' AND length(body->>'title') <= 200
		AND jsonb_typeof(body->'location') = 'string' AND length(body->>'location') <= 500
		AND body->>'timeZone' = 'Asia/Kolkata'
		AND jsonb_typeof(body->'startsAt') = 'string' AND body->>'startsAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
		AND jsonb_typeof(body->'endsAt') = 'string' AND body->>'endsAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
		AND (body->>'startsAt')::timestamptz < (body->>'endsAt')::timestamptz
		AND jsonb_typeof(body->'cancelled') = 'boolean'
		AND body->>'status' IN ('pending', 'synced', 'error', 'cancelled')
		AND (body->>'status' <> 'cancelled' OR body->'cancelled' = 'true'::jsonb)
		AND (body->>'status' <> 'synced' OR body->'cancelled' = 'false'::jsonb)
		AND jsonb_typeof(body->'error') IN ('null', 'string')
		AND jsonb_typeof(body->'reminderMinutes') = 'array' AND jsonb_array_length(body->'reminderMinutes') <= 5
		AND NOT jsonb_path_exists(body, '$.reminderMinutes[*] ? (@.type() != "number" || @ < 0 || @ > 40320 || @ % 1 != 0)')
	, false));