import { Hono } from "hono";
import { parseWizardProgress } from "../../shared/onboardingWizard";
import { profileReadiness } from "../../shared/validate";
import { HttpError, type AppEnv } from "../env";
import { readOnboarding, saveWizardStep } from "../onboarding";
import { requireUser } from "../session";
import { loadProfile } from "./profile";

export const onboardingRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const [profile, onboarding] = await Promise.all([
      loadProfile(c.env, user.id, user.email),
      readOnboarding(c.env.DB, user.id),
    ]);
    return c.json({ profile, missing: profileReadiness(profile), onboarding });
  })
  .put("/", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const step = parseWizardProgress(body.step);
    if (!step) throw new HttpError(400, "Choose a setup step.");
    await saveWizardStep(c.env.DB, user.id, step);
    return c.json({ onboarding: await readOnboarding(c.env.DB, user.id) });
  });
