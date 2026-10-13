-- Pipeline, outreach and analytics. Plain columns hold only what lists and
-- charts sort by; anything about people (contacts, message notes) is encrypted.

ALTER TABLE jobs ADD COLUMN lane TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN route TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN requisition TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN pay_low REAL;
ALTER TABLE jobs ADD COLUMN pay_high REAL;
ALTER TABLE jobs ADD COLUMN pay_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN posted_at TEXT;
ALTER TABLE jobs ADD COLUMN rejected_at TEXT;
ALTER TABLE jobs ADD COLUMN closed_at TEXT;
ALTER TABLE jobs ADD COLUMN contact_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN details_ciphertext TEXT NOT NULL DEFAULT '';

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now')),
  ciphertext TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_events_user ON job_events(user_id, at DESC);
CREATE INDEX idx_events_job ON job_events(job_id, at DESC);

ALTER TABLE resume_uploads ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE resume_uploads ADD COLUMN format TEXT NOT NULL DEFAULT 'text';
