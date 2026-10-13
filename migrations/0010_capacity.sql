-- Capacity: fingerprints and a token index for openings, plus quota history.
-- Existing opening rows stay. A missing role is expired later, not deleted here.
-- Duplicate resume ciphertext is cleared only when the resumes table already holds the same bytes.

ALTER TABLE openings ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN unchanged_scans INTEGER NOT NULL DEFAULT 0;

CREATE TABLE opening_search (
  token TEXT NOT NULL,
  company_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  PRIMARY KEY (token, company_id, external_id)
);
CREATE INDEX idx_opening_search_opening ON opening_search(company_id, external_id);
CREATE INDEX idx_openings_company_hash ON openings(company_id, content_hash);

CREATE TABLE quota_samples (
  meter TEXT NOT NULL,
  day TEXT NOT NULL,
  used REAL NOT NULL,
  limit_value REAL NOT NULL,
  PRIMARY KEY (meter, day)
);

CREATE INDEX idx_jobs_user_created_id ON jobs(user_id, created_at DESC, id DESC);

UPDATE packs SET ciphertext = ''
WHERE kind = 'resume'
  AND ciphertext != ''
  AND EXISTS (
    SELECT 1 FROM resumes r
    WHERE r.job_id = packs.job_id
      AND r.user_id = packs.user_id
      AND r.ciphertext = packs.ciphertext
  );
