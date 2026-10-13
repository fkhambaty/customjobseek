import { Hono } from "hono";
import { parseCookieChoice } from "../../shared/commercial";
import { HttpError, type AppEnv } from "../env";
import { buildAccountExport, readConsent } from "../exportAccount";
import { readOnboarding } from "../onboarding";
import { enforceRateLimit } from "../rateLimit";
import { referralSummary } from "../referrals";
import { requireUser } from "../session";
import { noteProductEvent } from "../usage";

export const account = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const [preferences, onboarding, referral] = await Promise.all([
      readConsent(c.env.DB, user.id),
      readOnboarding(c.env.DB, user.id),
      referralSummary(c.env.DB, user.id),
    ]);
    return c.json({ preferences, onboarding, referral });
  })
  .put("/preferences", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cookies = parseCookieChoice(body.cookies);
    if (!cookies) throw new HttpError(400, "Choose the sign-in cookie only, or allow anonymous counts.");
    const marketing = typeof body.marketingEmail === "boolean"
      ? body.marketingEmail
      : typeof body.productEmail === "boolean"
        ? body.productEmail
        : null;
    if (marketing === null) throw new HttpError(400, "Choose whether weekly notes are welcome.");
    const transactional = typeof body.transactionalEmail === "boolean" ? body.transactionalEmail : null;
    const now = new Date().toISOString();
    const token = crypto.randomUUID().replace(/-/g, "");
    await c.env.DB.prepare(
      `INSERT INTO consent_preferences (user_id, cookies, product_email, transactional_email, marketing_email, marketing_opt_out_at, unsubscribe_token, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         cookies = excluded.cookies,
         product_email = excluded.product_email,
         transactional_email = COALESCE(?, consent_preferences.transactional_email),
         marketing_email = excluded.marketing_email,
         marketing_opt_out_at = CASE WHEN excluded.marketing_email = 0 THEN COALESCE(consent_preferences.marketing_opt_out_at, excluded.updated_at) ELSE NULL END,
         unsubscribe_token = COALESCE(consent_preferences.unsubscribe_token, excluded.unsubscribe_token),
         updated_at = excluded.updated_at`,
    ).bind(
      user.id,
      cookies,
      marketing ? 1 : 0,
      transactional === null ? 1 : transactional ? 1 : 0,
      marketing ? 1 : 0,
      marketing ? null : now,
      token,
      now,
      transactional === null ? null : transactional ? 1 : 0,
    ).run();
    return c.json(await readConsent(c.env.DB, user.id));
  })
  .get("/export", async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "export", user.id);
    const body = await buildAccountExport(c.env, user);
    await noteProductEvent(c.env.DB, user.id, "data_export");
    return c.json(body);
  });
