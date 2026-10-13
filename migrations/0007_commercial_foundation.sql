-- Commercial foundation: consent, payments ledger, support, and abuse limits.
-- Profile text stays in the encrypted tables from earlier migrations.
-- Rate-limit buckets store a hash, not an email address or an IP address.
-- D1 is a fit for these counters: one atomic upsert per hit, human-sized traffic,
-- and a daily delete of old windows. It is not an edge firewall for a huge flood.

CREATE TABLE onboarding_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_done INTEGER NOT NULL DEFAULT 0,
  resume_done INTEGER NOT NULL DEFAULT 0,
  preferences_done INTEGER NOT NULL DEFAULT 0,
  first_check_done INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE consent_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  terms_accepted_at TEXT,
  privacy_accepted_at TEXT,
  cookies TEXT NOT NULL DEFAULT 'essential' CHECK (cookies IN ('essential', 'analytics')),
  product_email INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per checkout attempt. idempotency_key stops a double-submitted purchase
-- from becoming two orders. provider_order_id stays NULL until a provider exists,
-- and SQLite allows many NULLs under the unique pair.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT,
  kind TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount_inr INTEGER NOT NULL CHECK (amount_inr >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (provider, provider_order_id)
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);

-- Provider events are stored once. There is no raw webhook body: that body can
-- contain an email, a phone number, or a card hint.
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_payment_events_order ON payment_events(order_id, created_at DESC);

-- The grant of credits. applied flips once, in the same transaction as the wallet
-- update, so a repeated call cannot add the same purchase twice.
CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  eval_credits INTEGER NOT NULL DEFAULT 0,
  resume_credits INTEGER NOT NULL DEFAULT 0,
  scan_runs INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entitlements_user ON entitlements(user_id, created_at DESC);

-- One row per reader we know about. compliance is the rule for that reader,
-- kept in step with complianceFor() in shared/commercial.ts.
CREATE TABLE source_adapters (
  ats TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  compliance TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  last_ok_at TEXT,
  last_error_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO source_adapters (ats, enabled, compliance, notes) VALUES
  ('greenhouse', 1, 'public_api', 'Public Greenhouse job board. No login.'),
  ('lever', 1, 'public_api', 'Public Lever job board. No login.'),
  ('ashby', 1, 'public_api', 'Public Ashby job board. No login.'),
  ('workable', 1, 'public_api', 'Public Workable job board. No login.'),
  ('smartrecruiters', 1, 'public_api', 'Public SmartRecruiters job board. No login.'),
  ('workday', 1, 'public_site', 'The company''s public Workday career site. No login.'),
  ('website', 0, 'not_crawled', 'Ordinary company websites are not crawled.');

-- Compact on purpose: a name and a day, no free-text properties.
CREATE TABLE product_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_product_events_name_day ON product_events(name, day);
CREATE INDEX idx_product_events_user ON product_events(user_id, created_at DESC);

CREATE TABLE referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE referral_uses (
  referred_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_referral_uses_referrer ON referral_uses(referrer_user_id, created_at DESC);

CREATE TABLE usage_snapshots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  resumes INTEGER NOT NULL DEFAULT 0,
  scans INTEGER NOT NULL DEFAULT 0,
  fetches INTEGER NOT NULL DEFAULT 0,
  imports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE owner_alerts (
  dedupe_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  emailed_at TEXT
);

CREATE TABLE support_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_support_user ON support_requests(user_id, created_at DESC);
CREATE INDEX idx_support_email ON support_requests(email, created_at DESC);

CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_codes_expires ON email_codes(expires_at);

INSERT INTO onboarding_progress (user_id)
SELECT id FROM users;

INSERT INTO consent_preferences (user_id, cookies, product_email)
SELECT id, 'essential', 0 FROM users;

INSERT INTO referral_codes (user_id, code)
SELECT id, lower(hex(randomblob(8))) FROM users;
