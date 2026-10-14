-- A generic closed page is remembered here until a second check, after the due interval, agrees.
-- auto_closed_from is the pre-application status to restore when that posting is open again.
-- Applied, interview, and offer rows are never given this value.

ALTER TABLE jobs ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN auto_closed_from TEXT;
