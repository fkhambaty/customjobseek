-- Counts from the pipeline liveness pass that runs with every market scan.
-- A scan that prepares nothing still records how many saved links it checked.

ALTER TABLE market_scans ADD COLUMN pipeline_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE market_scans ADD COLUMN pipeline_closed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scan_runs_log ADD COLUMN pipeline_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scan_runs_log ADD COLUMN pipeline_closed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_jobs_pipeline_due ON jobs(user_id, status, source_checked_at);
