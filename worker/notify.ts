import {
  OWNER_ALERT_WINDOW_MS,
  isEmail,
  ownerAlertSubject,
  safeOwnerSummary,
  shouldSendOwnerEmail,
  type OwnerAlertKind,
} from "../shared/commercial";
import type { Env } from "./env";
import { sendMail } from "./mail";

export interface OwnerNotice {
  kind: OwnerAlertKind;
  dedupeKey: string;
  summary: string;
}

export function ownerInbox(env: Env): string | null {
  const email = env.OWNER_EMAIL?.trim().toLowerCase() ?? "";
  return isEmail(email) ? email : null;
}

/**
 * Records a short operational note and emails the owner at most once per key
 * inside the quiet period. The summary is scrubbed first. Callers must not put
 * a resume, a password, a sign-in code, or a support message in it.
 */
export async function notifyOwner(env: Env, notice: OwnerNotice): Promise<void> {
  const summary = safeOwnerSummary(notice.summary);
  const key = notice.dedupeKey.trim().slice(0, 200);
  if (!key) return;
  const now = new Date();
  const nowIso = now.toISOString();
  const existing = await env.DB.prepare("SELECT emailed_at, count FROM owner_alerts WHERE dedupe_key = ?")
    .bind(key)
    .first<{ emailed_at: string | null; count: number }>();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO owner_alerts (dedupe_key, kind, summary, count, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(key, notice.kind, summary, nowIso, nowIso).run();
  } else {
    await env.DB.prepare(
      "UPDATE owner_alerts SET count = count + 1, last_at = ?, summary = ?, kind = ? WHERE dedupe_key = ?",
    ).bind(nowIso, summary, notice.kind, key).run();
  }

  const inbox = ownerInbox(env);
  const previousEmailAt = existing?.emailed_at ?? null;
  if (!inbox || !shouldSendOwnerEmail(previousEmailAt, now.getTime(), OWNER_ALERT_WINDOW_MS)) return;

  const claim = await env.DB.prepare(
    `UPDATE owner_alerts SET emailed_at = ?
     WHERE dedupe_key = ? AND ((? IS NULL AND emailed_at IS NULL) OR emailed_at = ?)`,
  ).bind(nowIso, key, previousEmailAt, previousEmailAt).run();
  if (!claim.meta.changes) return;

  try {
    const seen = (existing?.count ?? 0) + 1;
    await sendMail(
      env,
      inbox,
      ownerAlertSubject(notice.kind),
      `${summary}\n\nSeen ${seen} time${seen === 1 ? "" : "s"}.\nThis note does not include a resume, a password, a sign-in code, or the text of a support message.`,
    );
  } catch (err) {
    console.error("Owner alert email failed", err);
    await env.DB.prepare("UPDATE owner_alerts SET emailed_at = ? WHERE dedupe_key = ?").bind(previousEmailAt, key).run();
  }
}
