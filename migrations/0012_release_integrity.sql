-- Release integrity: anonymous analytics, referral intent before verify,
-- partial refunds, atomic scan charges, and profile-local schedules.
-- Existing scan rows stay on version 0, which means the stored hour is India time.

UPDATE product_events SET user_id = NULL;

CREATE TABLE referral_intents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  email_code_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO referral_intents (user_id, code, email_code_id, created_at)
SELECT ru.referred_user_id, ru.code, NULL, ru.created_at
FROM referral_uses ru
JOIN users u ON u.id = ru.referred_user_id
WHERE u.email_verified = 0
  AND ru.rewarded_at IS NULL;

DELETE FROM referral_uses
WHERE rewarded_at IS NULL
  AND referred_user_id IN (SELECT id FROM users WHERE email_verified = 0);

CREATE INDEX idx_referral_unrewarded ON referral_uses(referred_user_id) WHERE rewarded_at IS NULL;

ALTER TABLE entitlements ADD COLUMN refunded_eval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN refunded_resume INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN refunded_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entitlements ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE entitlements ADD COLUMN refunded_at TEXT;

ALTER TABLE market_scans ADD COLUMN charge_token TEXT NOT NULL DEFAULT '';

ALTER TABLE scan_schedules ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
ALTER TABLE scan_schedules ADD COLUMN schedule_version INTEGER NOT NULL DEFAULT 0;
