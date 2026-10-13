-- One wallet of scan runs, shared by the button and a daily schedule.
-- A run is spent only when at least one application pack is prepared.

ALTER TABLE users ADD COLUMN scan_runs INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_manual_scan_at TEXT;
ALTER TABLE users ADD COLUMN scan_lock_until TEXT;

CREATE TABLE scan_schedules (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hour_ist INTEGER NOT NULL DEFAULT 13,
  enabled INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  paused_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE scan_runs_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  prepared_count INTEGER NOT NULL DEFAULT 0,
  charged INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_scan_runs_user ON scan_runs_log(user_id, started_at DESC);

ALTER TABLE credit_ledger ADD COLUMN runs_delta INTEGER NOT NULL DEFAULT 0;

UPDATE users SET scan_runs = CASE plan
  WHEN 'starter' THEN 4
  WHEN 'growth' THEN 10
  WHEN 'pro' THEN 25
  ELSE 1
END;
