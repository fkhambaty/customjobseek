-- Canonical opening identity, and the capability record for each source.
-- Readers that are not live stay disabled. Nothing here calls a partner feed.

ALTER TABLE openings ADD COLUMN dedup_key TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN title_key TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN location_key TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN employer_key TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN provenance TEXT NOT NULL DEFAULT '';
ALTER TABLE openings ADD COLUMN expires_at TEXT;
ALTER TABLE openings ADD COLUMN first_seen_at TEXT;

CREATE INDEX idx_openings_dedup ON openings(dedup_key);
CREATE INDEX idx_openings_canonical ON openings(canonical_url);

ALTER TABLE source_adapters ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
ALTER TABLE source_adapters ADD COLUMN countries TEXT NOT NULL DEFAULT '[]';
ALTER TABLE source_adapters ADD COLUMN freshness_hours INTEGER;
ALTER TABLE source_adapters ADD COLUMN listing TEXT NOT NULL DEFAULT 'none';

UPDATE source_adapters SET
  capabilities = '["detect","list_openings","fetch_posting"]',
  countries = '[]',
  freshness_hours = 6,
  listing = 'live'
WHERE ats IN ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters');

UPDATE source_adapters SET
  capabilities = '["detect","list_openings"]',
  countries = '[]',
  freshness_hours = 6,
  listing = 'live',
  notes = 'The company''s public Workday career site. No login. The list endpoint does not include the full description.'
WHERE ats = 'workday';

UPDATE source_adapters SET
  capabilities = '["paste_link"]',
  countries = '[]',
  freshness_hours = NULL,
  listing = 'none',
  enabled = 0
WHERE ats = 'website';

INSERT INTO source_adapters (ats, enabled, compliance, notes, capabilities, countries, freshness_hours, listing) VALUES
  ('teamtailor', 1, 'public_feed', 'Documented public RSS at /jobs.rss. No API key. Pages of 100, up to 500 openings.', '["detect","list_openings","fetch_posting"]', '[]', 6, 'live'),
  ('recruitee', 1, 'public_api', 'Documented careers-site API at /api/offers/. Unauthenticated calls are scheduled to stop on 10 February 2027.', '["detect","list_openings","fetch_posting"]', '[]', 6, 'live'),
  ('icims', 0, 'paste_only', 'iCIMS job API needs the employer''s own credentials. The portal is not scraped.', '["detect","paste_link","manual_review"]', '[]', NULL, 'none'),
  ('oracle_recruiting', 0, 'paste_only', 'Oracle marks recruitingCEJobRequisitions as internal-only. It is not called.', '["detect","paste_link","manual_review"]', '[]', NULL, 'none'),
  ('successfactors', 0, 'paste_only', 'SuccessFactors OData needs tenant credentials. Search pages are not scraped.', '["detect","paste_link","manual_review"]', '[]', NULL, 'none'),
  ('public_feed', 0, 'credential_required', 'Official feeds are registered individually. None is called without a live feed address.', '["detect","manual_review"]', '["IN","US","GB","CA","AU","SG","NZ","IE","ZA"]', NULL, 'none'),
  ('licensed', 0, 'partnership_required', 'Reserved for a future licensed provider. No provider is connected.', '["partnership"]', '["IN","US","GB","CA","AU","SG","NZ","IE","ZA"]', NULL, 'none'),
  ('aggregator', 0, 'partnership_required', 'Protected job boards are not scraped.', '["detect","paste_link","partnership"]', '["IN","US","GB","CA","AU","SG","NZ","IE","ZA"]', NULL, 'none');
