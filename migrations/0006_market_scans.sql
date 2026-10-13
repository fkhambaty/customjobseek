-- A source-qualified India employer catalog and durable, resumable user scans.

ALTER TABLE companies ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN sectors TEXT NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN normalized_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN verified_at TEXT;
ALTER TABLE companies ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN scan_priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN next_scan_at TEXT;

CREATE INDEX idx_companies_country_active ON companies(country, active, scan_priority DESC);
CREATE INDEX idx_companies_scan_due ON companies(active, next_scan_at, last_scan_at);
CREATE INDEX idx_companies_domain ON companies(normalized_domain);
CREATE INDEX idx_openings_title_updated ON openings(title, updated_at DESC);

CREATE TABLE market_scans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  heartbeat_at TEXT,
  estimated_seconds INTEGER NOT NULL DEFAULT 120,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  handpicked_count INTEGER NOT NULL DEFAULT 0,
  charged INTEGER NOT NULL DEFAULT 0,
  result_job_ids TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_market_scans_queue ON market_scans(status, queued_at);
CREATE INDEX idx_market_scans_user ON market_scans(user_id, queued_at DESC);

CREATE TABLE market_scan_candidates (
  scan_id TEXT NOT NULL REFERENCES market_scans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  checked_ciphertext TEXT,
  PRIMARY KEY (scan_id, url)
);
CREATE INDEX idx_market_scan_candidates_status ON market_scan_candidates(scan_id, status, position);

ALTER TABLE scan_runs_log ADD COLUMN market_scan_id TEXT;
CREATE INDEX idx_scan_runs_market_scan ON scan_runs_log(market_scan_id);
