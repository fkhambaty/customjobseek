import { canRunManual, formatIstClock, nextRunAt, SCAN_LOCK_MS, SCHEDULES_PER_TICK, shouldCharge } from "../shared/engine/scanRules";
import type { JobRecord } from "../shared/types";
import { profileReadiness } from "../shared/validate";
import { MAX_DEEP_CHECKS, PACKS_PER_SCAN, checkOpening, matchingRows, packStatements, type CheckedOpening, type DiscoverRow } from "./discoverMatch";
import { HttpError, type Env, type UserRow } from "./env";
import { loadProfile } from "./routes/profile";
import { JOB_SELECT, toJob, type JobRow } from "./routes/serialise";

export interface ScanResult {
  prepared: JobRecord[];
  locked: DiscoverRow[];
  checked: number;
  charged: boolean;
}

async function logRun(env: Env, userId: string, trigger: "manual" | "scheduled", prepared: number, charged: boolean, note: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO scan_runs_log (id, user_id, trigger, prepared_count, charged, note) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), userId, trigger, prepared, charged ? 1 : 0, note.slice(0, 300)).run();
}

async function pauseSchedule(env: Env, userId: string, reason: string): Promise<void> {
  await env.DB.prepare("UPDATE scan_schedules SET paused_reason = ? WHERE user_id = ?").bind(reason, userId).run();
}

async function advanceSchedule(env: Env, userId: string, now: Date): Promise<void> {
  const row = await env.DB.prepare("SELECT hour_ist FROM scan_schedules WHERE user_id = ?").bind(userId).first<{ hour_ist: number }>();
  if (!row) return;
  await env.DB.prepare("UPDATE scan_schedules SET next_run_at = ?, paused_reason = '' WHERE user_id = ?")
    .bind(nextRunAt(row.hour_ist, now), userId)
    .run();
}

async function choose(env: Env, userId: string, profile: Awaited<ReturnType<typeof loadProfile>>, limit: number): Promise<{ chosen: CheckedOpening[]; rows: DiscoverRow[]; checked: number }> {
  const rows = await matchingRows(env, userId, profile);
  const readable = (await Promise.all(rows.slice(0, MAX_DEEP_CHECKS).map((row) => checkOpening(row, profile))))
    .filter((item): item is CheckedOpening => item !== null && item.fit.blockers.length === 0);
  const chosen = readable.sort((a, b) => b.row.match - a.row.match || b.fit.score - a.fit.score).slice(0, limit);
  return { chosen, rows, checked: Math.min(rows.length, MAX_DEEP_CHECKS) };
}

export async function runScan(env: Env, user: UserRow, trigger: "manual" | "scheduled"): Promise<ScanResult> {
  const now = new Date();
  const profile = await loadProfile(env, user.id, user.email);
  const missing = profileReadiness(profile);
  if (missing.length || !profile.preferences.targetRoles.length) {
    const message = missing.length
      ? `Finish your profile first: add ${missing.join(", ")}.`
      : "Add the job titles you want to your profile first.";
    if (trigger === "scheduled") {
      await pauseSchedule(env, user.id, message);
      await logRun(env, user.id, trigger, 0, false, message);
      return { prepared: [], locked: [], checked: 0, charged: false };
    }
    throw new HttpError(400, message);
  }

  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<UserRow>();
  if (!fresh) throw new HttpError(404, "Account not found.");
  const runs = fresh.scan_runs ?? 0;
  const packs = Math.min(PACKS_PER_SCAN, fresh.eval_credits, fresh.resume_credits);

  if (trigger === "manual") {
    const wait = canRunManual(fresh.last_manual_scan_at ?? null, now);
    if (!wait.ok) throw new HttpError(429, `Next manual scan at ${formatIstClock(wait.nextAt)}.`);
  }
  if (runs < 1 || packs < 1) {
    const reason = runs < 1 ? "No scan runs left." : "No application packs left.";
    if (trigger === "scheduled") {
      await pauseSchedule(env, user.id, reason);
      await logRun(env, user.id, trigger, 0, false, reason);
      return { prepared: [], locked: [], checked: 0, charged: false };
    }
    throw new HttpError(402, runs < 1 ? "You have used your scans. A paid plan or a run pack adds more." : "You have used all your application packs. Pick a plan to scan again.");
  }

  const lockUntil = new Date(now.getTime() + SCAN_LOCK_MS).toISOString();
  const locked = await env.DB.prepare(
    "UPDATE users SET scan_lock_until = ? WHERE id = ? AND (scan_lock_until IS NULL OR scan_lock_until < ?)",
  ).bind(lockUntil, user.id, now.toISOString()).run();
  if (!locked.meta.changes) throw new HttpError(409, "A scan is already running. Give it a minute.");

  try {
    const { chosen, rows, checked } = await choose(env, user.id, profile, packs);
    if (!chosen.length) {
      if (trigger === "manual") {
        await env.DB.prepare("UPDATE users SET last_manual_scan_at = ? WHERE id = ?").bind(now.toISOString(), user.id).run();
      } else {
        await advanceSchedule(env, user.id, now);
      }
      await logRun(env, user.id, trigger, 0, false, "Nothing new was ready to prepare.");
      throw new HttpError(422, "The strongest title matches could not be read or had a deal-breaker. Nothing was charged.");
    }

    const reserved = await env.DB.prepare(
      `UPDATE users SET eval_credits = eval_credits - ?, resume_credits = resume_credits - ?, scan_runs = scan_runs - 1,
         last_manual_scan_at = CASE WHEN ? = 'manual' THEN ? ELSE last_manual_scan_at END
       WHERE id = ? AND eval_credits >= ? AND resume_credits >= ? AND scan_runs >= 1`,
    ).bind(chosen.length, chosen.length, trigger, now.toISOString(), user.id, chosen.length, chosen.length).run();
    if (!reserved.meta.changes) throw new HttpError(409, "Your credits changed while this scan was running. Refresh and try again.");

    let packsSaved: { id: string; statements: D1PreparedStatement[] }[];
    try {
      packsSaved = [];
      for (const item of chosen) packsSaved.push(await packStatements(env, user.id, profile, item));
      await env.DB.batch([
        ...packsSaved.flatMap((pack) => pack.statements),
        env.DB.prepare(
          "INSERT INTO credit_ledger (user_id, kind, runs_delta, note) VALUES (?, 'spend_scan_run', -1, ?)",
        ).bind(user.id, trigger === "manual" ? "manual scan" : "daily scan"),
      ]);
    } catch (error) {
      await env.DB.prepare(
        "UPDATE users SET eval_credits = eval_credits + ?, resume_credits = resume_credits + ?, scan_runs = scan_runs + 1 WHERE id = ?",
      ).bind(chosen.length, chosen.length, user.id).run();
      throw error;
    }

    const prepared = await Promise.all(packsSaved.map(async (pack) => {
      const row = await env.DB.prepare(`${JOB_SELECT} WHERE j.id = ? AND j.user_id = ?`).bind(pack.id, user.id).first<JobRow>();
      if (!row) throw new Error("Prepared job was not saved");
      return toJob(row);
    }));
    if (trigger === "scheduled") await advanceSchedule(env, user.id, now);
    await logRun(env, user.id, trigger, prepared.length, shouldCharge(prepared.length), "");
    const preparedUrls = new Set(prepared.map((job) => job.url));
    return { prepared, locked: rows.filter((row) => !preparedUrls.has(row.url)), checked, charged: true };
  } finally {
    await env.DB.prepare("UPDATE users SET scan_lock_until = NULL WHERE id = ?").bind(user.id).run();
  }
}

export async function runDueSchedules(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT u.* FROM scan_schedules s JOIN users u ON u.id = s.user_id
     WHERE s.enabled = 1 AND s.paused_reason = '' AND s.next_run_at IS NOT NULL AND s.next_run_at <= ? AND u.plan != 'free'
     ORDER BY s.next_run_at LIMIT ?`,
  ).bind(now, SCHEDULES_PER_TICK).all<UserRow>();
  for (const user of results) {
    try {
      await runScan(env, user, "scheduled");
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) continue;
      console.error("scheduled scan failed", user.id, error);
    }
  }
}
