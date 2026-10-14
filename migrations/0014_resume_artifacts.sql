-- File copies of resumes. Structured tailored resumes stay in `resumes`.
-- html_ciphertext and pdf_ciphertext are AES-GCM payloads, never returned as JSON.

CREATE TABLE resume_artifacts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  upload_id TEXT REFERENCES resume_uploads(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  html_ciphertext TEXT NOT NULL,
  pdf_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artifact_key),
  CHECK (
    (kind = 'master' AND artifact_key = 'master' AND job_id IS NULL AND upload_id IS NULL)
    OR (kind = 'job' AND job_id IS NOT NULL AND upload_id IS NULL AND artifact_key = 'job:' || job_id)
    OR (kind = 'upload' AND upload_id IS NOT NULL AND job_id IS NULL AND artifact_key = 'upload:' || upload_id)
  )
);

CREATE INDEX idx_resume_artifacts_job ON resume_artifacts(job_id);
CREATE INDEX idx_resume_artifacts_upload ON resume_artifacts(upload_id);
CREATE INDEX idx_resume_artifacts_user_updated ON resume_artifacts(user_id, updated_at DESC);
