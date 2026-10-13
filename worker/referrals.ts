import {
  REFERRAL_EVAL_CREDITS,
  REFERRAL_RESUME_CREDITS,
  referralIntentAction,
  shouldRewardReferral,
  type ReferralProof,
} from "../shared/agency";
import { newReferralCode } from "../shared/commercial";
import type { Env } from "./env";

export async function ensureReferralCode(db: D1Database, userId: string): Promise<string> {
  const existing = await db.prepare("SELECT code FROM referral_codes WHERE user_id = ?").bind(userId).first<{ code: string }>();
  if (existing?.code) return existing.code;
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newReferralCode();
    try {
      await db.prepare("INSERT INTO referral_codes (user_id, code) VALUES (?, ?)").bind(userId, code).run();
      return code;
    } catch (err) {
      const winner = await db.prepare("SELECT code FROM referral_codes WHERE user_id = ?").bind(userId).first<{ code: string }>();
      if (winner?.code) return winner.code;
      if (attempt === 1) throw err;
    }
  }
  throw new Error("Could not create a referral code.");
}

export async function referralSummary(db: D1Database, userId: string): Promise<{ code: string; uses: number; rewarded: number }> {
  const code = await ensureReferralCode(db, userId);
  const row = await db.prepare(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN rewarded_at IS NOT NULL THEN 1 ELSE 0 END) AS rewarded
     FROM referral_uses WHERE referrer_user_id = ?`,
  ).bind(userId).first<{ n: number; rewarded: number | null }>();
  return { code, uses: row?.n ?? 0, rewarded: row?.rewarded ?? 0 };
}

/** Keeps a referral code beside the account until the inbox is proven. It does not grant anything. */
export async function saveReferralIntent(db: D1Database, userId: string, rawCode: string, emailCodeId: number, createdAt: string): Promise<void> {
  const code = rawCode.trim().toLowerCase();
  const stored = /^[a-f0-9]{16}$/.test(code) ? code : "";
  await db.prepare(
    `INSERT INTO referral_intents (user_id, code, email_code_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, email_code_id = excluded.email_code_id, created_at = excluded.created_at`,
  ).bind(userId, stored, emailCodeId, createdAt).run();
}

/** Attaches a saved code only when this proof covers it. A later code is discarded. */
export async function commitReferralIntent(db: D1Database, referredUserId: string, proof: ReferralProof): Promise<void> {
  const row = await db.prepare("SELECT code, email_code_id, created_at FROM referral_intents WHERE user_id = ?")
    .bind(referredUserId)
    .first<{ code: string; email_code_id: number | null; created_at: string }>();
  const action = referralIntentAction(
    row ? { code: row.code, emailCodeId: row.email_code_id, createdAt: row.created_at } : null,
    proof,
  );
  switch (action) {
    case "ignore":
      return;
    case "clear":
      await db.prepare("DELETE FROM referral_intents WHERE user_id = ?").bind(referredUserId).run();
      return;
    case "attach":
      if (row) await attachReferral(db, referredUserId, row.code);
      await db.prepare("DELETE FROM referral_intents WHERE user_id = ?").bind(referredUserId).run();
      return;
    default: {
      const unexpected: never = action;
      throw new Error(String(unexpected));
    }
  }
}

/** Records a signup against someone else's code. Unknown codes are ignored. No credits are granted. */
export async function attachReferral(db: D1Database, referredUserId: string, rawCode: string): Promise<void> {
  const code = rawCode.trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(code)) return;
  const referrer = await db.prepare("SELECT user_id FROM referral_codes WHERE code = ?").bind(code).first<{ user_id: string }>();
  if (!referrer || referrer.user_id === referredUserId) return;
  await db.prepare(
    "INSERT INTO referral_uses (referred_user_id, referrer_user_id, code) VALUES (?, ?, ?) ON CONFLICT(referred_user_id) DO NOTHING",
  ).bind(referredUserId, referrer.user_id, code).run();
}

/**
 * Grants the referrer credits once, only after this referred user's first verified payment.
 * The note stored in the ledger does not name the referred person.
 */
export async function grantReferralReward(env: Env, referredUserId: string, orderId: string, nowMs = Date.now()): Promise<boolean> {
  const use = await env.DB.prepare(
    "SELECT referrer_user_id, rewarded_at FROM referral_uses WHERE referred_user_id = ?",
  ).bind(referredUserId).first<{ referrer_user_id: string; rewarded_at: string | null }>();
  const prior = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND applied = 1 AND order_id != ?",
  ).bind(referredUserId, orderId).first<{ n: number }>();
  if (!shouldRewardReferral({
    hasReferral: Boolean(use),
    alreadyRewarded: Boolean(use?.rewarded_at),
    otherAppliedPayments: prior?.n ?? 0,
    paymentApplied: true,
  })) return false;

  const nowIso = new Date(nowMs).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE referral_uses
       SET rewarded_at = ?, reward_order_id = ?, reward_eval = ?, reward_resume = ?
       WHERE referred_user_id = ?
         AND rewarded_at IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = referral_uses.referrer_user_id)
         AND NOT EXISTS (
           SELECT 1 FROM entitlements e
           WHERE e.user_id = referral_uses.referred_user_id AND e.applied = 1 AND e.order_id != ?
         )`,
    ).bind(nowIso, orderId, REFERRAL_EVAL_CREDITS, REFERRAL_RESUME_CREDITS, referredUserId, orderId),
    env.DB.prepare(
      `UPDATE users
       SET eval_credits = eval_credits + ?, resume_credits = resume_credits + ?
       WHERE id = (SELECT referrer_user_id FROM referral_uses WHERE referred_user_id = ? AND reward_order_id = ? AND rewarded_at = ?)`,
    ).bind(REFERRAL_EVAL_CREDITS, REFERRAL_RESUME_CREDITS, referredUserId, orderId, nowIso),
    env.DB.prepare(
      `INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, runs_delta, note)
       SELECT referrer_user_id, 'referral_reward', ?, ?, 0, 'referral'
       FROM referral_uses
       WHERE referred_user_id = ? AND reward_order_id = ? AND rewarded_at = ?`,
    ).bind(REFERRAL_EVAL_CREDITS, REFERRAL_RESUME_CREDITS, referredUserId, orderId, nowIso),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

/** Retries referral grants that a transient error skipped. Safe to run more than once. */
export async function reconcileReferralRewards(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT ru.referred_user_id AS user_id,
        (
          SELECT e.order_id FROM entitlements e
          JOIN orders o ON o.id = e.order_id
          WHERE e.user_id = ru.referred_user_id AND e.applied = 1 AND o.status = 'paid'
          ORDER BY e.applied_at ASC
          LIMIT 1
        ) AS order_id
     FROM referral_uses ru
     WHERE ru.rewarded_at IS NULL
     LIMIT 25`,
  ).all<{ user_id: string; order_id: string | null }>();
  let granted = 0;
  for (const row of results) {
    if (!row.order_id) continue;
    const ok = await grantReferralReward(env, row.user_id, row.order_id, nowMs).catch((err: unknown) => {
      console.error("referral reconcile failed", err);
      return false;
    });
    if (ok) granted += 1;
  }
  return granted;
}
