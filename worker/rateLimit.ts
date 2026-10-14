import { RETENTION_DAYS, sqliteCutoff, utcCutoffIso } from "../shared/capacity";
import {
  ruleFor,
  windowStartIso,
  type RateLimitAction,
} from "../shared/commercial";
import { sha256 } from "./crypto";
import { HttpError } from "./env";

const RATE_KEEP_MS = 48 * 60 * 60_000;
const EVENT_KEEP_DAYS = 180;
const ALERT_KEEP_MS = 90 * 24 * 60 * 60_000;

export function requestIp(header: (name: string) => string | undefined): string {
  const raw = header("cf-connecting-ip") || header("x-forwarded-for")?.split(",")[0] || "local";
  const ip = raw.trim().slice(0, 80);
  return ip || "local";
}

/**
 * One atomic upsert per hit. The bucket is action plus a hash of the person or
 * network address, so the table does not keep plain emails or IP addresses.
 */
export async function enforceRateLimit(db: D1Database, action: RateLimitAction, subject: string, nowMs = Date.now()): Promise<void> {
  const rule = ruleFor(action);
  const bucket = `${action}:${await sha256(subject)}`;
  const windowStart = windowStartIso(nowMs, rule.windowMs);
  const listed = await db.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(bucket, windowStart).all<{ count: number }>();
  const count = listed.results[0]?.count;
  if (count === undefined) throw new HttpError(500, "Something went wrong on our side. Please try again.");
  if (count > rule.limit) throw new HttpError(429, "Too many attempts. Please wait a little while and try again.");
}

export async function rateLimitDeletes(db: D1Database, subjects: string[]): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const subject of subjects) {
    const hash = await sha256(subject);
    if (/[%_]/.test(hash)) throw new Error("Rate limit hash changed alphabet; escape LIKE wildcards.");
    statements.push(db.prepare("DELETE FROM rate_limits WHERE bucket LIKE ?").bind(`%:${hash}`));
  }
  return statements;
}

/** Drop expired sign-in rows, old scan candidates, stale job events, used email codes, old counters, and stale owner notes. */
export async function purgeExpired(db: D1Database, now = new Date()): Promise<void> {
  const iso = now.toISOString();
  const rateCutoff = new Date(now.getTime() - RATE_KEEP_MS).toISOString();
  const alertCutoff = new Date(now.getTime() - ALERT_KEEP_MS).toISOString();
  const eventCutoff = utcCutoffDay(now, EVENT_KEEP_DAYS);
  const sessionBackstop = sqliteCutoff(now, RETENTION_DAYS.sessionBackstop);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR created_at <= ?").bind(iso, sessionBackstop),
    db.prepare(
      "DELETE FROM mobile_refresh_tokens WHERE expires_at <= ? OR session_id IN (SELECT id FROM mobile_sessions WHERE revoked_at IS NOT NULL)",
    ).bind(iso),
    db.prepare(
      "DELETE FROM mobile_sessions WHERE access_expires_at <= ? AND NOT EXISTS (SELECT 1 FROM mobile_refresh_tokens r WHERE r.session_id = mobile_sessions.id AND r.expires_at > ? AND r.used_at IS NULL)",
    ).bind(iso, iso),
    db.prepare("DELETE FROM email_codes WHERE expires_at <= ?").bind(iso),
    db.prepare("DELETE FROM rate_limits WHERE window_start <= ?").bind(rateCutoff),
    db.prepare("DELETE FROM product_events WHERE day < ?").bind(eventCutoff),
    db.prepare("DELETE FROM owner_alerts WHERE last_at <= ?").bind(alertCutoff),
  ]);
  const candidateCutoff = utcCutoffIso(now, RETENTION_DAYS.scanCandidates);
  const jobEventCutoff = utcCutoffIso(now, RETENTION_DAYS.jobEvents);
  const sampleCutoff = utcCutoffIso(now, RETENTION_DAYS.quotaSamples).slice(0, 10);
  await db.batch([
    db.prepare(
      `DELETE FROM market_scan_candidates
       WHERE scan_id IN (
         SELECT id FROM market_scans
         WHERE (status IN ('complete', 'failed') AND COALESCE(completed_at, updated_at, queued_at) <= ?)
            OR (status = 'queued' AND queued_at <= ?)
       )`,
    ).bind(candidateCutoff, sqliteCutoff(now, RETENTION_DAYS.scanCandidates)),
    db.prepare("DELETE FROM job_events WHERE at <= ?").bind(jobEventCutoff),
    db.prepare("DELETE FROM quota_samples WHERE day < ?").bind(sampleCutoff),
  ]).catch((err: unknown) => {
    console.error("capacity cleanup skipped", err instanceof Error ? err.name : "error");
  });
}

function utcCutoffDay(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString().slice(0, 10);
}
