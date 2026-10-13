ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_codes_email ON email_codes(email, purpose, created_at DESC);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  career_url TEXT NOT NULL UNIQUE,
  ats TEXT NOT NULL,
  board_token TEXT NOT NULL DEFAULT '',
  scan_status TEXT NOT NULL DEFAULT 'pending',
  last_scan_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  opening_count INTEGER NOT NULL DEFAULT 0,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE missed_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  company_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_missed_user ON missed_reports(user_id, created_at DESC);

CREATE TABLE openings (
  company_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, external_id)
);

CREATE TABLE packs (
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, kind)
);
CREATE INDEX idx_packs_user ON packs(user_id);

CREATE TABLE resume_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  text_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_uploads_user ON resume_uploads(user_id);
