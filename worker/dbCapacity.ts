import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { cloudflareMeters } from "../shared/capacity";
import { utcDay } from "../shared/commercial";
import { capacityPause, shouldPauseBackground, shouldPauseFreeAccounts, type CapacityPause, type DbUsage } from "../shared/dbCapacity";
import { sha256 } from "./crypto";
import type { AppEnv, Env } from "./env";
import { D1_ROWS_QUERY, postGraphql } from "./quota";
import { SESSION_COOKIE } from "./session";

const USAGE_TTL_MS = 60_000;
const ALWAYS_OPEN = new Set(["/api/billing/razorpay/webhook", "/api/mail/unsubscribe", "/api/plans", "/api/auth/logout"]);

export class CapacityPausedError extends Error {
  constructor(public pause: CapacityPause) {
    super(pause.error);
  }
}

let cached: { at: number; day: string; account: string; usage: DbUsage | null } | null = null;

/** Today's D1 rows, read from Cloudflare analytics at most once a minute per isolate. Null when unknown. */
export async function todaysDbUsage(env: Env, now = new Date()): Promise<DbUsage | null> {
  const day = utcDay(now.getTime());
  const account = env.CF_ACCOUNT_ID?.trim() ?? "";
  const token = env.CF_ANALYTICS_API_TOKEN?.trim() ?? "";
  if (cached && cached.day === day && cached.account === account && now.getTime() - cached.at < USAGE_TTL_MS) return cached.usage;
  let usage: DbUsage | null = null;
  if (account && token) {
    const meters = cloudflareMeters(await postGraphql(token, D1_ROWS_QUERY, { accountTag: account, since: day }));
    if (meters.d1_rows_read !== undefined || meters.d1_rows_written !== undefined) {
      usage = { rowsRead: meters.d1_rows_read ?? 0, rowsWritten: meters.d1_rows_written ?? 0 };
    }
  }
  cached = { at: now.getTime(), day, account, usage };
  return usage;
}

const PAID_SQL = "(u.plan <> 'free' OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'))";

async function sessionIsPaid(db: D1Database, token: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT ${PAID_SQL} AS paid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), new Date().toISOString()).first<{ paid: number }>();
  return Boolean(row?.paid);
}

async function loginIsPaid(db: D1Database, request: Request): Promise<boolean> {
  const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return false;
  const row = await db.prepare(`SELECT ${PAID_SQL} AS paid FROM users u WHERE u.email = ?`).bind(email).first<{ paid: number }>();
  return Boolean(row?.paid);
}

/** Near the daily database limit, free accounts wait so paying customers keep working until midnight UTC. */
export const capacityGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (ALWAYS_OPEN.has(c.req.path)) return next();
  const usage = await todaysDbUsage(c.env).catch(() => null);
  if (!shouldPauseFreeAccounts(usage)) return next();
  const token = getCookie(c, SESSION_COOKIE);
  if (!token && c.req.path === "/api/auth/me") return next();
  const paid = token
    ? await sessionIsPaid(c.env.DB, token)
    : c.req.path === "/api/auth/login" && (await loginIsPaid(c.env.DB, c.req.raw));
  if (paid) return next();
  throw new CapacityPausedError(capacityPause("saving_for_paid"));
});

/** Background work stops at half of the daily allowance. */
export async function backgroundWorkAllowed(env: Env): Promise<boolean> {
  const usage = await todaysDbUsage(env).catch(() => null);
  return !shouldPauseBackground(usage);
}
