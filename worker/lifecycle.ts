import {
  appOrigin,
  decideLifecycle,
  isoWeekKey,
  lifecycleClass,
  lifecycleCopy,
  type LifecycleFacts,
  type LifecycleKind,
} from "../shared/agency";
import { utcDay } from "../shared/commercial";
import type { Env } from "./env";
import { sendMail } from "./mail";

interface ConsentMail {
  transactional_email: number;
  marketing_email: number;
  unsubscribe_token: string | null;
}

async function mailConsent(env: Env, userId: string): Promise<(ConsentMail & { email: string }) | null> {
  return env.DB.prepare(
    `SELECT u.email, c.transactional_email, c.marketing_email, c.unsubscribe_token
     FROM users u
     LEFT JOIN consent_preferences c ON c.user_id = u.id
     WHERE u.id = ?`,
  ).bind(userId).first<ConsentMail & { email: string }>();
}

async function ensureUnsubscribeToken(env: Env, userId: string, current: string | null): Promise<string> {
  if (current) return current;
  const token = crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    `INSERT INTO consent_preferences (user_id, transactional_email, marketing_email, unsubscribe_token)
     VALUES (?, 1, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET unsubscribe_token = CASE
       WHEN consent_preferences.unsubscribe_token IS NULL OR consent_preferences.unsubscribe_token = '' THEN excluded.unsubscribe_token
       ELSE consent_preferences.unsubscribe_token
     END`,
  ).bind(userId, token).run();
  const row = await env.DB.prepare("SELECT unsubscribe_token FROM consent_preferences WHERE user_id = ?")
    .bind(userId)
    .first<{ unsubscribe_token: string | null }>();
  return row?.unsubscribe_token || token;
}

async function quotaReading(env: Env, nowMs: number): Promise<{ dailyUsed: number | null; monthlyUsed: number | null; lifecycleSentToday: number }> {
  const day = utcDay(nowMs);
  const [daily, monthly, sent] = await Promise.all([
    env.DB.prepare("SELECT used, limit_value FROM quota_samples WHERE meter = 'resend_daily' AND day = ?").bind(day).first<{ used: number; limit_value: number }>(),
    env.DB.prepare("SELECT used, limit_value FROM quota_samples WHERE meter = 'resend_monthly' AND day = ?").bind(day).first<{ used: number; limit_value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM lifecycle_sends WHERE sent_at >= ?").bind(`${day}T00:00:00.000Z`).first<{ n: number }>(),
  ]);
  return {
    dailyUsed: daily ? daily.used : null,
    monthlyUsed: monthly ? monthly.used : null,
    lifecycleSentToday: sent?.n ?? 0,
  };
}

async function lastSend(env: Env, userId: string, kind: LifecycleKind): Promise<string | null> {
  const row = await env.DB.prepare("SELECT MAX(sent_at) AS at FROM lifecycle_sends WHERE user_id = ? AND kind = ?")
    .bind(userId, kind)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}

async function lastMarketing(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT MAX(sent_at) AS at FROM lifecycle_sends WHERE user_id = ? AND kind IN ('onboarding_recovery', 'weekly_priorities')",
  ).bind(userId).first<{ at: string | null }>();
  return row?.at ?? null;
}

export async function sendLifecycle(env: Env, userId: string, kind: LifecycleKind, dedupeKey: string, facts: LifecycleFacts, nowMs = Date.now()): Promise<boolean> {
  const consent = await mailConsent(env, userId);
  if (!consent?.email) return false;
  const quota = await quotaReading(env, nowMs);
  const decision = decideLifecycle({
    kind,
    transactional: consent.transactional_email !== 0,
    marketing: consent.marketing_email === 1,
    lastSentAt: await lastSend(env, userId, kind),
    lastMarketingAt: await lastMarketing(env, userId),
    nowMs,
    dailyUsed: quota.dailyUsed,
    monthlyUsed: quota.monthlyUsed,
    lifecycleSentToday: quota.lifecycleSentToday,
  });
  if (!decision.send) return false;

  const origin = appOrigin(env.PUBLIC_ORIGIN);
  const token = lifecycleClass(kind) === "marketing" ? await ensureUnsubscribeToken(env, userId, consent.unsubscribe_token) : null;
  const unsubscribeUrl = token ? `${origin}/api/mail/unsubscribe?token=${token}` : null;
  const copy = lifecycleCopy(kind, facts, origin, unsubscribeUrl);
  const headers = unsubscribeUrl
    ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : undefined;

  const claimId = crypto.randomUUID();
  const sentAt = new Date(nowMs).toISOString();
  const claim = await env.DB.prepare(
    "INSERT INTO lifecycle_sends (id, user_id, kind, dedupe_key, sent_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, dedupe_key) DO NOTHING",
  ).bind(claimId, userId, kind, dedupeKey.slice(0, 200), sentAt).run();
  if (!claim.meta.changes) return false;
  try {
    await sendMail(env, consent.email, copy.subject, copy.text, headers);
    return true;
  } catch (err) {
    console.error("Lifecycle email failed", kind);
    await env.DB.prepare("DELETE FROM lifecycle_sends WHERE id = ?").bind(claimId).run();
    throw err;
  }
}

export async function notifyScanComplete(env: Env, userId: string, scanId: string, packs: number): Promise<void> {
  if (packs < 1) return;
  await sendLifecycle(env, userId, "scan_complete", `scan:${scanId}`, { packs }).catch((err: unknown) => {
    console.error("scan complete email failed", err);
  });
}

async function sweepKind(env: Env, kind: LifecycleKind, nowMs: number, rows: { id: string; dedupe: string; facts: LifecycleFacts }[]): Promise<void> {
  for (const row of rows) {
    const quota = await quotaReading(env, nowMs);
    const room = decideLifecycle({
      kind,
      transactional: true,
      marketing: true,
      lastSentAt: null,
      lastMarketingAt: null,
      nowMs,
      dailyUsed: quota.dailyUsed,
      monthlyUsed: quota.monthlyUsed,
      lifecycleSentToday: quota.lifecycleSentToday,
    });
    if (!room.send && room.reason === "quota") return;
    await sendLifecycle(env, row.id, kind, row.dedupe, row.facts, nowMs).catch((err: unknown) => {
      console.error("lifecycle sweep failed", kind, err);
    });
  }
}

export async function runLifecycleSweep(env: Env, nowMs = Date.now()): Promise<void> {
  const day = utcDay(nowMs);
  const week = isoWeekKey(nowMs);
  const expiring = await env.DB.prepare(
    `SELECT u.id, u.credits_expire_at AS expires_on
     FROM users u
     JOIN consent_preferences c ON c.user_id = u.id
     WHERE c.transactional_email = 1
       AND u.credits_expire_at IS NOT NULL
       AND u.credits_expire_at > ?
       AND u.credits_expire_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM lifecycle_sends s WHERE s.user_id = u.id AND s.dedupe_key = 'expire:' || substr(u.credits_expire_at, 1, 10)
       )
     LIMIT 8`,
  ).bind(new Date(nowMs).toISOString(), new Date(nowMs + 7 * 86_400_000).toISOString()).all<{ id: string; expires_on: string }>();

  const low = await env.DB.prepare(
    `SELECT u.id, u.eval_credits, u.resume_credits
     FROM users u
     JOIN consent_preferences c ON c.user_id = u.id
     WHERE c.transactional_email = 1
       AND u.eval_credits <= 1
       AND u.resume_credits <= 1
       AND EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM lifecycle_sends s
         WHERE s.user_id = u.id AND s.dedupe_key = 'low:' || u.eval_credits || ':' || u.resume_credits
       )
     LIMIT 8`,
  ).all<{ id: string; eval_credits: number; resume_credits: number }>();

  const recovery = await env.DB.prepare(
    `SELECT u.id
     FROM users u
     JOIN consent_preferences c ON c.user_id = u.id
     LEFT JOIN onboarding_progress o ON o.user_id = u.id
     WHERE c.marketing_email = 1
       AND u.created_at <= datetime('now', '-2 days')
       AND COALESCE(o.wizard_step, 'welcome') != 'done'
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM lifecycle_sends s
         WHERE s.user_id = u.id AND s.kind = 'onboarding_recovery' AND s.sent_at >= datetime('now', '-14 days')
       )
     LIMIT 8`,
  ).all<{ id: string }>();

  const weekly = await env.DB.prepare(
    `SELECT u.id,
        (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status IN ('evaluated', 'resume_ready')) AS todo,
        (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status NOT IN ('rejected', 'withdrawn', 'closed')
           AND j.next_action_at IS NOT NULL AND j.next_action_at <= ?) AS due
     FROM users u
     JOIN consent_preferences c ON c.user_id = u.id
     WHERE c.marketing_email = 1
       AND EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM lifecycle_sends s WHERE s.user_id = u.id AND s.dedupe_key = ?
       )
     LIMIT 8`,
  ).bind(day, `week:${week}`).all<{ id: string; todo: number; due: number }>();

  await sweepKind(env, "expiring_entitlement", nowMs, expiring.results.map((row) => ({
    id: row.id,
    dedupe: `expire:${row.expires_on.slice(0, 10)}`,
    facts: { expiresOn: row.expires_on.slice(0, 10) },
  })));
  await sweepKind(env, "low_credits", nowMs, low.results.map((row) => ({
    id: row.id,
    dedupe: `low:${row.eval_credits}:${row.resume_credits}`,
    facts: { evalCredits: row.eval_credits, resumeCredits: row.resume_credits },
  })));
  await sweepKind(env, "onboarding_recovery", nowMs, recovery.results.map((row) => ({
    id: row.id,
    dedupe: "onboarding",
    facts: {},
  })));
  await sweepKind(env, "weekly_priorities", nowMs, weekly.results.map((row) => ({
    id: row.id,
    dedupe: `week:${week}`,
    facts: { todo: row.todo, due: row.due },
  })));
}
