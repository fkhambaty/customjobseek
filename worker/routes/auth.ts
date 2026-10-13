import { Hono } from "hono";
import { hashPassword, verifyPassword } from "../crypto";
import { HttpError, type AppEnv, type UserRow } from "../env";
import { issueCode, takeCode } from "../mail";
import { endSession, requireUser, startSession } from "../session";
import { toAccount } from "./serialise";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readCredentials(req: Request): Promise<{ email: string; password: string }> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
  return { email, password };
}

export const auth = new Hono<AppEnv>()
  .post("/signup", async (c) => {
    const { email, password } = await readCredentials(c.req.raw);
    const existing = await c.env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?").bind(email).first<{ id: string; email_verified: number }>();
    if (existing?.email_verified) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    if (!existing) {
      const id = crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 0)").bind(id, email, await hashPassword(password)),
        c.env.DB.prepare("INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, note) VALUES (?, 'grant', 3, 1, 'free plan')").bind(id),
      ]);
    } else {
      await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), existing.id).run();
    }
    await issueCode(c.env, email, "signup");
    return c.json({ ok: true, needsVerification: true });
  })
  .post("/verify", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the email and the 6-digit code.");
    if (!(await takeCode(c.env, email, "signup", code))) throw new HttpError(400, "That code is wrong or expired. Request a new one.");
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (!user) throw new HttpError(404, "No account for that email.");
    await c.env.DB.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(user.id).run();
    await startSession(c, user.id);
    return c.json({ ok: true });
  })
  .post("/resend-code", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const purpose = body.purpose === "reset" ? "reset" : "signup";
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const user = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (user) await issueCode(c.env, email, purpose);
    return c.json({ ok: true });
  })
  .post("/forgot", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const user = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (user) await issueCode(c.env, email, "reset");
    return c.json({ ok: true });
  })
  .post("/reset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the email and the 6-digit code.");
    if (password.length < 10) throw new HttpError(400, "Use a password of at least 10 characters.");
    if (!(await takeCode(c.env, email, "reset", code))) throw new HttpError(400, "That code is wrong or expired. Request a new one.");
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (!user) throw new HttpError(404, "No account for that email.");
    await c.env.DB.prepare("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?").bind(await hashPassword(password), user.id).run();
    await startSession(c, user.id);
    return c.json({ ok: true });
  })
  .post("/login", async (c) => {
    const { email, password } = await readCredentials(c.req.raw);
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, "That email and password do not match.");
    }
    if (!user.email_verified) throw new HttpError(403, "Confirm your email first. We can send a new code from the sign-up page.");
    await startSession(c, user.id);
    return c.json({ ok: true });
  })
  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })
  .get("/me", requireUser, (c) => c.json(toAccount(c.get("user"))))
  .delete("/me", requireUser, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const user = c.get("user");
    if (typeof body.password !== "string" || !(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(403, "Enter your password to delete the account.");
    }
    // Foreign keys cascade, but D1 enforcement depends on the connection, so every table is cleared explicitly.
    await c.env.DB.batch(
      ["resumes", "jobs", "profiles", "credit_ledger", "sessions"].map((t) =>
        c.env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id),
      ).concat(c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)),
    );
    await endSession(c);
    return c.json({ ok: true });
  });
