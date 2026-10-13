import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { randomToken, sha256 } from "./crypto";
import { HttpError, type AppContext, type AppEnv, type UserRow } from "./env";

const COOKIE = "cjs_session";
const SESSION_DAYS = 30;

export async function startSession(c: AppContext, userId: string): Promise<void> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires.toISOString())
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export async function endSession(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

// Paid credits lapse after their validity window; the account drops back to the free plan with nothing left.
async function expireCredits(db: D1Database, user: UserRow): Promise<UserRow> {
  if (!user.credits_expire_at || new Date(user.credits_expire_at) > new Date()) return user;
  await db.batch([
    db.prepare("UPDATE users SET plan = 'free', eval_credits = 0, resume_credits = 0, credits_expire_at = NULL WHERE id = ?").bind(user.id),
    db.prepare("INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, note) VALUES (?, 'expiry', ?, ?, 'credits expired')")
      .bind(user.id, -user.eval_credits, -user.resume_credits),
  ]);
  return { ...user, plan: "free", eval_credits: 0, resume_credits: 0, credits_expire_at: null };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, "Please sign in.");
  const row = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<UserRow>();
  if (!row) throw new HttpError(401, "Your session has ended. Please sign in again.");
  c.set("user", await expireCredits(c.env.DB, row));
  await next();
});
