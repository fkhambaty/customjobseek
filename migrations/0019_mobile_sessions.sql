CREATE TABLE mobile_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX idx_mobile_sessions_user ON mobile_sessions(user_id, revoked_at);
CREATE INDEX idx_mobile_sessions_access ON mobile_sessions(access_token_hash, access_expires_at);

CREATE TABLE mobile_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mobile_sessions(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  replaced_by_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_mobile_refresh_session ON mobile_refresh_tokens(session_id, expires_at);
