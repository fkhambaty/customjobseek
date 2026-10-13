-- Where someone is in guided setup. Empty means the account predates the wizard.
-- done means they finished, or chose to leave, the free-scan step.
-- The career profile itself stays in the encrypted profiles table.

ALTER TABLE onboarding_progress ADD COLUMN wizard_step TEXT NOT NULL DEFAULT '';
