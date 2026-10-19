-- Read employer career sites and public Breezy boards. Incomplete HTML is not treated as a closed board.

UPDATE source_adapters SET
  enabled = 1,
  compliance = 'public_site',
  notes = 'The employer''s public career page. JSON-LD, embedded ATS boards, and same-site job links are read.',
  capabilities = '["detect","list_openings","fetch_posting"]',
  countries = '[]',
  freshness_hours = 6,
  listing = 'live'
WHERE ats = 'website';

INSERT INTO source_adapters (ats, enabled, compliance, notes, capabilities, countries, freshness_hours, listing)
VALUES (
  'breezy',
  1,
  'public_api',
  'Public Breezy board JSON at /json. No login.',
  '["detect","list_openings","fetch_posting"]',
  '[]',
  6,
  'live'
);
