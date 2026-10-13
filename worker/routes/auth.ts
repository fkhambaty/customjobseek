import { Hono } from "hono";
import { isEmail, utcDay } from "../../shared/commercial";
import { hashPassword, verifyPassword } from "../crypto";
import { HttpError, type AppContext, type AppEnv, type UserRow } from "../env";
import { issueCode, takeCode } from "../mail";
import { readOnboarding, seedNewAccount } from "../onboarding";
import { enforceRateLimit, purgeExpired, rateLimitDeletes, requestIp } from "../rateLimit";
import { commitReferralIntent, ensureReferralCode, saveReferralIntent } from "../referrals";
import { endSession, requireUser, revokeUserSessions, startSession } from "../session";
import { notifyOwner } from "../notify";
import { noteProductEvent } from "../usage";
import { toAccount } from "./serialise";

function credentialsFrom(body: Record<string, unknown>): { email: string; password: string } {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!isEmail(email)) throw new HttpError(400, "Enter a valid email address.");
  if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
  return { email, password };
}

async function readCredentials(req: Request): Promise<{ email: string; password: string }> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return credentialsFrom(body);
}

function ipOf(c: AppContext): string {
  return requestIp((name) => c.req.header(name));
}

async function limitIp(c: AppContext): Promise<void> {
  c.executionCtx?.waitUntil(purgeExpired(c.env.DB).catch((err: unknown) => console.error("cleanup failed", err)));
  await enforceRateLimit(c.env.DB, "auth_ip", ipOf(c));
}

export const auth = new Hono<AppEnv>()
  .post("/signup", async (c) => {
    await limitIp(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { email, password } = credentialsFrom(body);
    await enforceRateLimit(c.env.DB, "auth_email", email);
    const referral = typeof body.referralCode === "string" ? body.referralCode : "";
    const existing = await c.env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?").bind(email).first<{ id: string; email_verified: number }>();
    if (existing?.email_verified) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    const id = existing?.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    if (!existing) {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO users (id, email, password_hash, email_verified, eval_credits, resume_credits) VALUES (?, ?, ?, 0, 3, 3)")
          .bind(id, email, await hashPassword(password)),
        c.env.DB.prepare("INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, runs_delta, note) VALUES (?, 'grant', 3, 3, 1, 'free plan')").bind(id),
      ]);
    } else {
      await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), id).run();
    }
    await seedNewAccount(c.env.DB, id, now);
    await ensureReferralCode(c.env.DB, id);
    const issued = await issueCode(c.env, email, "signup");
    if (issued) {
      await saveReferralIntent(c.env.DB, id, referral, issued.id, issued.createdAt).catch((err: unknown) => {
        console.error("referral intent failed", err);
      });
    }
    return c.json({ ok: true, needsVerification: true });
  })
  .post("/verify", async (c) => {
    await limitIp(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!isEmail(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the email and the 6-digit code.");
    await enforceRateLimit(c.env.DB, "auth_email", email);
    const proof = await takeCode(c.env, email, "signup", code);
    if (!proof) throw new HttpError(400, "That code is wrong or expired. Request a new one.");
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (!user) throw new HttpError(404, "No account for that email.");
    await c.env.DB.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(user.id).run();
    if (typeof body.referralCode === "string") {
      await saveReferralIntent(c.env.DB, user.id, body.referralCode, proof.id, proof.createdAt).catch((err: unknown) => {
        console.error("referral intent failed", err);
      });
    }
    await commitReferralIntent(c.env.DB, user.id, { purpose: "signup", codeId: proof.id }).catch((err: unknown) => {
      console.error("referral attach failed", err);
    });
    await startSession(c, user.id);
    await noteProductEvent(c.env.DB, user.id, "signup");
    c.executionCtx?.waitUntil(notifyOwner(c.env, {
      kind: "verified_signup",
      dedupeKey: `verified-signup:${utcDay()}`,
      summary: "A person confirmed a new account.",
    }).catch((err: unknown) => console.error("signup alert failed", err)));
    return c.json({ ok: true });
  })
  .post("/resend-code", async (c) => {
    await limitIp(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const purpose = body.purpose === "reset" ? "reset" : "signup";
    if (!isEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    await enforceRateLimit(c.env.DB, "auth_email", email);
    const user = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (user) await issueCode(c.env, email, purpose);
    return c.json({ ok: true });
  })
  .post("/forgot", async (c) => {
    await limitIp(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    await enforceRateLimit(c.env.DB, "auth_email", email);
    const user = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (user) await issueCode(c.env, email, "reset");
    return c.json({ ok: true });
  })
  .post("/reset", async (c) => {
    await limitIp(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isEmail(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the email and the 6-digit code.");
    await enforceRateLimit(c.env.DB, "auth_email", email);
    if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
    const proof = await takeCode(c.env, email, "reset", code);
    if (!proof) throw new HttpError(400, "That code is wrong or expired. Request a new one.");
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (!user) throw new HttpError(404, "No account for that email.");
    const passwordHash = await hashPassword(password);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?").bind(passwordHash, user.id),
    ]);
    await revokeUserSessions(c.env.DB, user.id);
    await commitReferralIntent(c.env.DB, user.id, { purpose: "reset", issuedAt: proof.createdAt }).catch((err: unknown) => {
      console.error("referral attach failed", err);
    });
    await startSession(c, user.id);
    return c.json({ ok: true });
  })
  .post("/login", async (c) => {
    await limitIp(c);
    const { email, password } = await readCredentials(c.req.raw);
    await enforceRateLimit(c.env.DB, "auth_email", email);
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, "That email and password do not match.");
    }
    if (!user.email_verified) throw new HttpError(403, "Confirm your email first. We can send a new code from the sign-up page.");
    await startSession(c, user.id);
    await noteProductEvent(c.env.DB, user.id, "login");
    return c.json({ ok: true });
  })
  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })
  .get("/me", requireUser, async (c) => {
    const user = c.get("user");
    const onboarding = await readOnboarding(c.env.DB, user.id);
    return c.json({ ...toAccount(user), onboardingStep: onboarding.step });
  })
  .delete("/me", requireUser, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const user = c.get("user");
    if (typeof body.password !== "string" || !(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(403, "Enter your password to delete the account.");
    }
    // Foreign keys cascade, but D1 enforcement depends on the connection, so every table is cleared explicitly.
    const rateDeletes = await rateLimitDeletes(c.env.DB, [user.id, user.email, `email:${user.email}`]);
    const owned = [
      "entitlements",
      "orders",
      "onboarding_progress",
      "consent_preferences",
      "usage_snapshots",
      "product_events",
      "referral_codes",
      "support_requests",
      "job_events",
      "packs",
      "resume_uploads",
      "missed_reports",
      "resumes",
      "jobs",
      "profiles",
      "credit_ledger",
      "scan_runs_log",
      "market_scans",
      "scan_schedules",
      "sessions",
    ];
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM bad_match_reports WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM thread_messages WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM company_threads WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM lifecycle_sends WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM market_scan_candidates WHERE scan_id IN (SELECT id FROM market_scans WHERE user_id = ?)").bind(user.id),
      c.env.DB.prepare("DELETE FROM payment_events WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)").bind(user.id),
      c.env.DB.prepare("DELETE FROM referral_uses WHERE referred_user_id = ? OR referrer_user_id = ?").bind(user.id, user.id),
      c.env.DB.prepare("DELETE FROM referral_intents WHERE user_id = ?").bind(user.id),
      ...owned.map((table) => c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id)),
      c.env.DB.prepare("DELETE FROM support_requests WHERE email = ?").bind(user.email),
      ...rateDeletes,
      c.env.DB.prepare("UPDATE companies SET added_by = NULL WHERE added_by = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(user.email),
      c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ]);
    await endSession(c);
    return c.json({ ok: true });
  });
