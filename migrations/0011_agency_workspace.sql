-- Agency workspace. These columns and tables are list-safe.
-- Message text stays encrypted. Nothing here is a feed of candidate data.

ALTER TABLE jobs ADD COLUMN live_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE jobs ADD COLUMN source_checked_at TEXT;
ALTER TABLE jobs ADD COLUMN pay_provenance TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN interview_stage TEXT NOT NULL DEFAULT '';

CREATE TABLE company_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_key TEXT NOT NULL,
  company_name TEXT NOT NULL,
  follow_up_on TEXT,
  last_out_at TEXT,
  last_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, company_key)
);
CREATE INDEX idx_threads_user ON company_threads(user_id, updated_at DESC);
CREATE INDEX idx_threads_follow ON company_threads(user_id, follow_up_on);

CREATE TABLE thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES company_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT,
  event_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  channel TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  ciphertext TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_thread_messages_thread ON thread_messages(thread_id, at DESC);
CREATE UNIQUE INDEX idx_thread_messages_event ON thread_messages(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE lifecycle_sends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_lifecycle_sent ON lifecycle_sends(sent_at DESC);
CREATE INDEX idx_lifecycle_user ON lifecycle_sends(user_id, sent_at DESC);

ALTER TABLE consent_preferences ADD COLUMN transactional_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE consent_preferences ADD COLUMN marketing_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE consent_preferences ADD COLUMN marketing_opt_out_at TEXT;
ALTER TABLE consent_preferences ADD COLUMN unsubscribe_token TEXT;

UPDATE consent_preferences SET marketing_email = product_email;
UPDATE consent_preferences SET unsubscribe_token = lower(hex(randomblob(16))) WHERE unsubscribe_token IS NULL;
CREATE UNIQUE INDEX idx_consent_unsubscribe ON consent_preferences(unsubscribe_token);

ALTER TABLE referral_uses ADD COLUMN rewarded_at TEXT;
ALTER TABLE referral_uses ADD COLUMN reward_order_id TEXT;
ALTER TABLE referral_uses ADD COLUMN reward_eval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE referral_uses ADD COLUMN reward_resume INTEGER NOT NULL DEFAULT 0;

CREATE TABLE bad_match_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  support_id TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, job_id)
);
CREATE INDEX idx_bad_match_user ON bad_match_reports(user_id, created_at DESC);
