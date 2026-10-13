-- The free trial prepares the best three matches, so evaluation and resume
-- allowances must move together as three complete application packs.
UPDATE credit_ledger
SET resume_delta = 3
WHERE kind = 'grant'
  AND note = 'free plan'
  AND resume_delta = 1
  AND user_id IN (
    SELECT id FROM users
    WHERE plan = 'free'
      AND resume_credits = 1
      AND NOT EXISTS (
        SELECT 1 FROM credit_ledger spent
        WHERE spent.user_id = users.id AND spent.resume_delta < 0
      )
  );

UPDATE users
SET resume_credits = 3
WHERE plan = 'free'
  AND resume_credits = 1
  AND NOT EXISTS (
    SELECT 1 FROM credit_ledger spent
    WHERE spent.user_id = users.id AND spent.resume_delta < 0
  );
