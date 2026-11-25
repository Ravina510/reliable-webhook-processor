DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attempt_result AS ENUM ('SUCCESS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id         TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           event_status NOT NULL DEFAULT 'PENDING',
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  next_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by        TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_claimable
  ON webhook_events (next_run_at, lease_expires_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE IF NOT EXISTS processed_orders (
  id           BIGSERIAL PRIMARY KEY,
  order_id     TEXT NOT NULL,
  event_id     TEXT NOT NULL UNIQUE REFERENCES webhook_events(event_id),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_attempts (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES webhook_events(event_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  worker_id      TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  result         attempt_result,
  error          TEXT,
  UNIQUE (event_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_webhook_attempts_event_id
  ON webhook_attempts (event_id, attempt_number DESC);
