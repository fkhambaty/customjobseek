-- Ordered search paths replace the older place-and-floor lane once a person saves one.
-- Jobs keep lane text for analytics. search_path_id is cleared in the same transaction
-- that deletes a path, so the historical label can stay on an archived row.

CREATE TABLE search_paths (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_mode TEXT NOT NULL CHECK (location_mode IN ('city', 'remote')),
  city TEXT NOT NULL DEFAULT '',
  pay_direction TEXT NOT NULL CHECK (pay_direction IN ('above', 'below', 'any')),
  pay_amount REAL,
  currency TEXT NOT NULL,
  salary_period TEXT NOT NULL CHECK (salary_period IN ('year', 'month', 'hour', 'lpa')),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (location_mode = 'city' AND length(trim(city)) > 0)
    OR (location_mode = 'remote' AND city = '')
  ),
  CHECK (
    (pay_direction = 'any' AND pay_amount IS NULL)
    OR (pay_direction IN ('above', 'below') AND pay_amount > 0)
  )
);

CREATE INDEX idx_search_paths_user ON search_paths(user_id, sort_order);
CREATE UNIQUE INDEX idx_search_paths_user_order ON search_paths(user_id, sort_order);

CREATE TRIGGER search_paths_limit
BEFORE INSERT ON search_paths
WHEN (SELECT COUNT(*) FROM search_paths WHERE user_id = NEW.user_id) >= 6
BEGIN
  SELECT RAISE(ABORT, 'search path limit');
END;

ALTER TABLE jobs ADD COLUMN search_path_id TEXT;
ALTER TABLE jobs ADD COLUMN archived_at TEXT;

CREATE INDEX idx_jobs_search_path ON jobs(user_id, search_path_id);
CREATE INDEX idx_jobs_archived ON jobs(user_id, archived_at);
