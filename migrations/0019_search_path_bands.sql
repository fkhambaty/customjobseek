-- Rebuild search_paths around pay bands and multi-city / country location modes.
-- Pay matching is inclusive on both ends (pay_min ≤ midpoint ≤ pay_max).
-- Legacy rows:
--   city → cities with cities_json = [old city]
--   remote → remote
--   above X → pay_min = X, pay_max = min(X * 10, 1e9)
--   below X → pay_min = 1, pay_max = X
--   any → pay_min = 1, pay_max = 1e9

CREATE TABLE search_paths_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_mode TEXT NOT NULL CHECK (location_mode IN ('cities', 'remote', 'country')),
  cities_json TEXT NOT NULL DEFAULT '[]',
  excluded_cities_json TEXT NOT NULL DEFAULT '[]',
  pay_min REAL NOT NULL,
  pay_max REAL NOT NULL,
  currency TEXT NOT NULL,
  salary_period TEXT NOT NULL CHECK (salary_period IN ('year', 'month', 'hour', 'lpa')),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (pay_min > 0 AND pay_max > pay_min),
  CHECK (
    (location_mode = 'cities' AND cities_json != '[]' AND excluded_cities_json = '[]')
    OR (location_mode = 'remote' AND cities_json = '[]' AND excluded_cities_json = '[]')
    OR (location_mode = 'country' AND cities_json = '[]')
  )
);

INSERT INTO search_paths_new (
  id, user_id, name, location_mode, cities_json, excluded_cities_json,
  pay_min, pay_max, currency, salary_period, sort_order, revision, created_at, updated_at
)
SELECT
  id,
  user_id,
  name,
  CASE location_mode WHEN 'city' THEN 'cities' ELSE location_mode END,
  CASE
    WHEN location_mode = 'city' AND length(trim(city)) > 0 THEN json_array(trim(city))
    ELSE '[]'
  END,
  '[]',
  CASE pay_direction
    WHEN 'above' THEN COALESCE(pay_amount, 1)
    WHEN 'below' THEN 1
    ELSE 1
  END,
  CASE pay_direction
    WHEN 'above' THEN CASE
      WHEN COALESCE(pay_amount, 1) * 10 > 1000000000 THEN 1000000000
      ELSE COALESCE(pay_amount, 1) * 10
    END
    WHEN 'below' THEN COALESCE(pay_amount, 2)
    ELSE 1000000000
  END,
  currency,
  salary_period,
  sort_order,
  revision,
  created_at,
  updated_at
FROM search_paths;

-- Guard against below-threshold rows where pay_amount was 1 (pay_max must exceed pay_min).
UPDATE search_paths_new
SET pay_max = pay_min + 1
WHERE pay_max <= pay_min;

DROP TABLE search_paths;
ALTER TABLE search_paths_new RENAME TO search_paths;

CREATE INDEX idx_search_paths_user ON search_paths(user_id, sort_order);
CREATE UNIQUE INDEX idx_search_paths_user_order ON search_paths(user_id, sort_order);

CREATE TRIGGER search_paths_limit
BEFORE INSERT ON search_paths
WHEN (SELECT COUNT(*) FROM search_paths WHERE user_id = NEW.user_id) >= 6
BEGIN
  SELECT RAISE(ABORT, 'search path limit');
END;
