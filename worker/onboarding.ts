import { onboardingColumn, type OnboardingStep } from "../shared/commercial";
import { parseStoredWizardStep, type OnboardingProgress, type WizardStep } from "../shared/onboardingWizard";

export type OnboardingView = OnboardingProgress;

export async function seedNewAccount(db: D1Database, userId: string, acceptedAt: string): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO consent_preferences (user_id, terms_accepted_at, privacy_accepted_at, cookies, product_email, updated_at)
       VALUES (?, ?, ?, 'essential', 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         terms_accepted_at = excluded.terms_accepted_at,
         privacy_accepted_at = excluded.privacy_accepted_at,
         updated_at = excluded.updated_at`,
    ).bind(userId, acceptedAt, acceptedAt, acceptedAt),
    db.prepare(
      `INSERT INTO onboarding_progress (user_id, wizard_step, updated_at) VALUES (?, 'welcome', ?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(userId, acceptedAt),
  ]);
}

export async function readOnboarding(db: D1Database, userId: string): Promise<OnboardingView> {
  const row = await db.prepare(
    "SELECT profile_done, resume_done, preferences_done, first_check_done, wizard_step FROM onboarding_progress WHERE user_id = ?",
  ).bind(userId).first<{
    profile_done: number;
    resume_done: number;
    preferences_done: number;
    first_check_done: number;
    wizard_step: string | null;
  }>();
  return {
    profile: Boolean(row?.profile_done),
    resume: Boolean(row?.resume_done),
    preferences: Boolean(row?.preferences_done),
    firstCheck: Boolean(row?.first_check_done),
    step: parseStoredWizardStep(row?.wizard_step ?? ""),
  };
}

export async function saveWizardStep(db: D1Database, userId: string, step: WizardStep | "done"): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO onboarding_progress (user_id, wizard_step, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET wizard_step = excluded.wizard_step, updated_at = excluded.updated_at`,
  ).bind(userId, step, now).run();
}

export async function noteOnboarding(db: D1Database, userId: string, step: OnboardingStep): Promise<void> {
  const column = onboardingColumn(step);
  try {
    await db.prepare(
      `INSERT INTO onboarding_progress (user_id, ${column}, updated_at) VALUES (?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET ${column} = 1, updated_at = excluded.updated_at`,
    ).bind(userId, new Date().toISOString()).run();
  } catch (err) {
    console.error("onboarding update failed", err);
  }
}
