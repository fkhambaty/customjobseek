import { timeZoneLabel } from "../shared/geo";
import {
  canRunManual,
  estimatedScanSeconds,
  formatZonedClock,
  nextRunAt,
  scheduleTimeZone,
  SCAN_LOCK_MS,
  SCANS_PER_TICK,
  SCHEDULES_PER_TICK,
  scanProgress,
  type ScanStage,
} from "../shared/engine/scanRules";
import { collapseDuplicateJobs, jobIdentityKey } from "../shared/engine/jobIdentity";
import { jobPayPlace, scanCandidateDecision, scanOpeningAcceptance, withoutPlaceAndPayBlockers } from "../shared/engine/searchPaths";
import type { JobRecord } from "../shared/types";
import { profileReadiness } from "../shared/validate";
import { abortBatchWhen } from "./batchGuard";
import { MAX_DEEP_CHECKS, PACKS_PER_SCAN, checkOpening, matchingRows, packStatements, type CheckedOpening } from "./discoverMatch";
import { listSearchPaths } from "./searchPathStore";
import { HttpError, type Env, type UserRow } from "./env";
import { loadProfile } from "./routes/profile";
import { JOB_SELECT, toJob, type JobRow } from "./routes/serialise";
import { notifyScanComplete } from "./lifecycle";
import { checkDuePipeline, type PipelineLivenessCounts } from "./pipelineLiveness";
import { scanFailureRecord } from "./publicError";
import { noteProductEvent, noteUsage } from "./usage";

type ScanTrigger = "manual" | "scheduled";
type ScanStatus = "queued" | "processing" | "complete" | "failed";

interface MarketScanRow {
  id: string;
  user_id: string;
  trigger: ScanTrigger;
  status: ScanStatus;
  stage: ScanStage;
  queued_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  estimated_seconds: number;
  candidate_count: number;
  checked_count: number;
  handpicked_count: number;
  charged: number;
  result_job_ids: string;
  error: string;
  pipeline_checked: number;
  pipeline_closed: number;
}

export interface MarketScanView {
  id: string;
  trigger: ScanTrigger;
  status: ScanStatus;
  stage: ScanStage;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estimatedSeconds: number;
  elapsedSeconds: number;
  queueAhead: number;
  candidateCount: number;
  checkedCount: number;
  handpickedCount: number;
  charged: boolean;
  progress: number | null;
  error: string;
  pipelineChecked: number;
  pipelineClosed: number;
  prepared: JobRecord[];
}

async function logRun(
  env: Env,
  scanId: string,
  userId: string,
  trigger: ScanTrigger,
  prepared: number,
  charged: boolean,
  pipelineChecked: number,
  pipelineClosed: number,
  note: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scan_runs_log (id, user_id, trigger, prepared_count, charged, note, market_scan_id, pipeline_checked, pipeline_closed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), userId, trigger, prepared, charged ? 1 : 0, note.slice(0, 300), scanId, pipelineChecked, pipelineClosed).run();
}

async function pipelineTotals(env: Env, scanId: string): Promise<PipelineLivenessCounts> {
  const row = await env.DB.prepare("SELECT pipeline_checked, pipeline_closed FROM market_scans WHERE id = ?")
    .bind(scanId)
    .first<{ pipeline_checked: number; pipeline_closed: number }>();
  return { checked: row?.pipeline_checked ?? 0, closed: row?.pipeline_closed ?? 0 };
}

async function rememberPipeline(env: Env, scanId: string, counts: PipelineLivenessCounts): Promise<void> {
  await env.DB.prepare(
    `UPDATE market_scans
     SET pipeline_checked = pipeline_checked + ?, pipeline_closed = pipeline_closed + ?, updated_at = ?
     WHERE id = ?`,
  ).bind(counts.checked, counts.closed, new Date().toISOString(), scanId).run();
}

async function pauseSchedule(env: Env, userId: string, reason: string): Promise<void> {
  await env.DB.prepare("UPDATE scan_schedules SET paused_reason = ? WHERE user_id = ?").bind(reason, userId).run();
}

async function advanceSchedule(env: Env, userId: string, now: Date): Promise<void> {
  const row = await env.DB.prepare("SELECT hour_ist, timezone, schedule_version FROM scan_schedules WHERE user_id = ?")
    .bind(userId)
    .first<{ hour_ist: number; timezone: string; schedule_version: number }>();
  if (!row) return;
  await env.DB.prepare("UPDATE scan_schedules SET next_run_at = ?, paused_reason = '' WHERE user_id = ?")
    .bind(nextRunAt(row.hour_ist, now, scheduleTimeZone(row.schedule_version, row.timezone)), userId)
    .run();
}

async function updateStage(env: Env, scanId: string, stage: ScanStage, values: { candidates?: number; checked?: number } = {}): Promise<void> {
  await env.DB.prepare(
    `UPDATE market_scans SET stage = ?, candidate_count = COALESCE(?, candidate_count),
     checked_count = COALESCE(?, checked_count), heartbeat_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(stage, values.candidates ?? null, values.checked ?? null, new Date().toISOString(), new Date().toISOString(), scanId).run();
}

async function averageDurations(env: Env): Promise<number[]> {
  const { results } = await env.DB.prepare(
    `SELECT CAST((julianday(completed_at) - julianday(started_at)) * 86400 AS INTEGER) AS seconds
     FROM market_scans WHERE status = 'complete' AND started_at IS NOT NULL AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 20`,
  ).all<{ seconds: number }>();
  return results.map((row) => row.seconds);
}

export async function enqueueScan(env: Env, user: UserRow, trigger: ScanTrigger): Promise<MarketScanView | null> {
  const now = new Date();
  const profile = await loadProfile(env, user.id, user.email);
  const missing = profileReadiness(profile);
  if (missing.length) {
    const message = `Finish your profile first: add ${missing.join(", ")}.`;
    if (trigger === "scheduled") {
      await pauseSchedule(env, user.id, message);
      return null;
    }
    throw new HttpError(400, message);
  }

  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<UserRow>();
  if (!fresh) throw new HttpError(404, "Account not found.");
  const runs = fresh.scan_runs ?? 0;
  const packs = Math.min(PACKS_PER_SCAN, fresh.eval_credits, fresh.resume_credits);

  if (trigger === "manual") {
    const wait = canRunManual(fresh.last_manual_scan_at ?? null, now);
    if (!wait.ok) throw new HttpError(429, `Next manual scan at ${formatZonedClock(wait.nextAt, profile.preferences.timezone)} ${timeZoneLabel(profile.preferences.timezone)}.`);
  }
  if (runs < 1 || packs < 1) {
    const reason = runs < 1 ? "No scan runs left." : "No application packs left.";
    if (trigger === "scheduled") {
      await pauseSchedule(env, user.id, reason);
      return null;
    }
    throw new HttpError(402, runs < 1 ? "You have used your scans. A paid plan or a run pack adds more." : "You have used all your application packs. Pick a plan to scan again.");
  }

  const active = await env.DB.prepare(
    "SELECT id FROM market_scans WHERE user_id = ? AND status IN ('queued', 'processing') ORDER BY queued_at DESC LIMIT 1",
  ).bind(user.id).first<{ id: string }>();
  if (active) return marketScanView(env, user.id, active.id);

  const lockUntil = new Date(now.getTime() + SCAN_LOCK_MS).toISOString();
  const locked = await env.DB.prepare(
    "UPDATE users SET scan_lock_until = ? WHERE id = ? AND (scan_lock_until IS NULL OR scan_lock_until < ?)",
  ).bind(lockUntil, user.id, now.toISOString()).run();
  if (!locked.meta.changes) throw new HttpError(409, "A scan is already running. Give it a minute.");

  try {
    const queued = await env.DB.prepare("SELECT COUNT(*) AS n FROM market_scans WHERE status IN ('queued', 'processing')")
      .first<{ n: number }>();
    const estimate = estimatedScanSeconds(await averageDurations(env), queued?.n ?? 0);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO market_scans (id, user_id, trigger, estimated_seconds)
       VALUES (?, ?, ?, ?)`,
    ).bind(id, user.id, trigger, estimate).run();
    await noteUsage(env.DB, user.id, "scans");
    await noteProductEvent(env.DB, user.id, "scan_queued");
    if (trigger === "manual") {
      await env.DB.prepare("UPDATE users SET last_manual_scan_at = ? WHERE id = ?").bind(now.toISOString(), user.id).run();
    } else {
      await advanceSchedule(env, user.id, now);
    }
    return marketScanView(env, user.id, id);
  } finally {
    await env.DB.prepare("UPDATE users SET scan_lock_until = NULL WHERE id = ?").bind(user.id).run();
  }
}

async function completeWithNothing(env: Env, scan: MarketScanRow, message: string): Promise<void> {
  const now = new Date().toISOString();
  const pipeline = await pipelineTotals(env, scan.id);
  await env.DB.prepare(
    `UPDATE market_scans SET status = 'complete', stage = 'complete', completed_at = ?, updated_at = ?,
     handpicked_count = 0, charged = 0, note = ? WHERE id = ?`,
  ).bind(now, now, message, scan.id).run();
  await env.DB.prepare("DELETE FROM market_scan_candidates WHERE scan_id = ?").bind(scan.id).run();
  await logRun(env, scan.id, scan.user_id, scan.trigger, 0, false, pipeline.checked, pipeline.closed, message);
}

export async function processScan(env: Env, scan: MarketScanRow): Promise<void> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(scan.user_id).first<UserRow>();
  if (!user) throw new Error("Account not found");
  await rememberPipeline(env, scan.id, await checkDuePipeline(env, user.id));
  const profile = await loadProfile(env, user.id, user.email);
  const packs = Math.min(PACKS_PER_SCAN, user.eval_credits, user.resume_credits);
  if ((user.scan_runs ?? 0) < 1 || packs < 1) {
    await completeWithNothing(env, scan, (user.scan_runs ?? 0) < 1 ? "No scan runs left." : "No application packs left.");
    return;
  }

  await updateStage(env, scan.id, "searching");
  const paths = await listSearchPaths(env.DB, user.id);
  const rows = await matchingRows(env, user.id, profile);
  const candidates = rows.slice(0, MAX_DEEP_CHECKS);
  if (!candidates.length) {
    await completeWithNothing(env, scan, "No new title and location matches were found. Nothing was charged.");
    return;
  }
  await env.DB.batch(candidates.map((row, position) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO market_scan_candidates (scan_id, position, url) VALUES (?, ?, ?)",
    ).bind(scan.id, position, row.url),
  ));
  await updateStage(env, scan.id, "reading", { candidates: candidates.length, checked: 0 });
  const readable: CheckedOpening[] = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = await Promise.all(candidates.slice(i, i + 4).map((row) => checkOpening(row, profile, paths)));
    for (const checked of batch) {
      if (!checked) continue;
      const acceptance = scanOpeningAcceptance(
        paths,
        jobPayPlace(checked.input.location, checked.fit.parsedSalary),
        checked.fit.blockers.map((blocker) => blocker.kind),
        profile.preferences.country,
      );
      switch (acceptance) {
        case "pack":
          readable.push(paths.length ? { ...checked, fit: withoutPlaceAndPayBlockers(checked.fit) } : checked);
          break;
        case "skip":
          break;
        default: {
          const never: never = acceptance;
          throw new Error(String(never));
        }
      }
    }
    const done = Math.min(i + 4, candidates.length);
    await updateStage(env, scan.id, "reading", { checked: done });
    await env.DB.batch(candidates.slice(i, i + 4).map((row) =>
      env.DB.prepare("UPDATE market_scan_candidates SET status = 'checked' WHERE scan_id = ? AND url = ?").bind(scan.id, row.url),
    ));
  }
  await updateStage(env, scan.id, "checking_fit", { checked: candidates.length });
  const ranked = readable.sort((a, b) => {
    const rank = (item: CheckedOpening) => {
      return scanCandidateDecision(paths, jobPayPlace(item.input.location, item.fit.parsedSalary), profile.preferences.country) === "review" ? 1 : 0;
    };
    return rank(a) - rank(b) || b.row.match - a.row.match || b.fit.score - a.fit.score;
  });
  const chosen: typeof ranked = [];
  const packedKeys = new Set<string>();
  for (const item of ranked) {
    if (chosen.length >= packs) break;
    const key = jobIdentityKey(item.input) || `${item.input.company}::${item.input.title}::${item.input.url}`.toLowerCase();
    if (packedKeys.has(key)) continue;
    packedKeys.add(key);
    chosen.push(item);
  }
  if (!chosen.length) {
    await completeWithNothing(env, scan, "The strongest openings had a deal-breaker or could not be read. Nothing was charged.");
    return;
  }

  await updateStage(env, scan.id, "building_resumes");
  const chargeToken = crypto.randomUUID();
  const packsSaved: { id: string; statements: D1PreparedStatement[] }[] = [];
  for (let index = 0; index < chosen.length; index += 1) {
    const item = chosen[index];
    if (!item) continue;
    packsSaved.push(await packStatements(env, user.id, profile, item, paths, {
      scanId: scan.id,
      chargeToken,
      jobId: `scan-${scan.id}-${index}`,
    }));
  }
  await updateStage(env, scan.id, "building_packs");
  const now = new Date().toISOString();
  const ids = packsSaved.map((pack) => pack.id);
  const note = `market scan ${scan.id}`;
  let claimed = 0;
  try {
    const outcome = await env.DB.batch([
      env.DB.prepare(
        `UPDATE market_scans
         SET charged = 1, status = 'complete', stage = 'complete', completed_at = ?, updated_at = ?,
             handpicked_count = ?, result_job_ids = ?, charge_token = ?, error = ''
         WHERE id = ? AND user_id = ? AND charged = 0`,
      ).bind(now, now, ids.length, JSON.stringify(ids), chargeToken, scan.id, user.id),
      env.DB.prepare(
        `UPDATE users
         SET eval_credits = eval_credits - ?, resume_credits = resume_credits - ?, scan_runs = COALESCE(scan_runs, 0) - 1
         WHERE id = ?
           AND eval_credits >= ?
           AND resume_credits >= ?
           AND COALESCE(scan_runs, 0) >= 1
           AND changes() = 1
           AND EXISTS (SELECT 1 FROM market_scans WHERE id = ? AND charge_token = ?)`,
      ).bind(ids.length, ids.length, user.id, ids.length, ids.length, scan.id, chargeToken),
      env.DB.prepare(abortBatchWhen(
        "EXISTS (SELECT 1 FROM market_scans WHERE id = ? AND charge_token = ?) AND changes() = 0",
      )).bind(scan.id, chargeToken),
      ...packsSaved.flatMap((pack) => pack.statements),
      env.DB.prepare(
        `INSERT INTO credit_ledger (user_id, kind, runs_delta, note)
         SELECT ?, 'spend_scan_run', -1, ?
         WHERE EXISTS (SELECT 1 FROM market_scans WHERE id = ? AND charge_token = ?)
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ? AND kind = 'spend_scan_run' AND note = ?)`,
      ).bind(user.id, note, scan.id, chargeToken, user.id, note),
      env.DB.prepare(
        `DELETE FROM market_scan_candidates
         WHERE scan_id = ? AND EXISTS (SELECT 1 FROM market_scans WHERE id = ? AND charge_token = ?)`,
      ).bind(scan.id, scan.id, chargeToken),
      env.DB.prepare(
        `INSERT INTO scan_runs_log (id, user_id, trigger, prepared_count, charged, note, market_scan_id, pipeline_checked, pipeline_closed)
         SELECT ?, ?, ?, ?, 1, '', ?, pipeline_checked, pipeline_closed
         FROM market_scans
         WHERE id = ? AND charge_token = ?
           AND NOT EXISTS (SELECT 1 FROM scan_runs_log WHERE market_scan_id = ? AND charged = 1)`,
      ).bind(crypto.randomUUID(), user.id, scan.trigger, ids.length, scan.id, scan.id, chargeToken, scan.id),
    ]);
    claimed = Number(outcome[1]?.meta.changes ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/CHECK constraint failed: ok = 1/i.test(message)) {
      throw new Error("Credits changed while this scan was running.");
    }
    throw error;
  }
  if (claimed > 0) await notifyScanComplete(env, user.id, scan.id, ids.length);
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
      await enqueueScan(env, user, "scheduled");
    } catch (error) {
      console.error(scanFailureRecord(error, "/internal/scheduled-scan").log);
    }
  }
}

export async function processQueuedScans(env: Env): Promise<void> {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE market_scans SET status = 'queued', stage = 'queued', error = ''
     WHERE status = 'processing' AND (heartbeat_at IS NULL OR heartbeat_at < ?) AND charged = 0`,
  ).bind(stale).run();
  const { results } = await env.DB.prepare(
    "SELECT * FROM market_scans WHERE status = 'queued' ORDER BY queued_at LIMIT ?",
  ).bind(SCANS_PER_TICK).all<MarketScanRow>();
  for (const scan of results) {
    const now = new Date().toISOString();
    const claimed = await env.DB.prepare(
      `UPDATE market_scans SET status = 'processing', stage = 'searching', started_at = COALESCE(started_at, ?),
       heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
    ).bind(now, now, now, scan.id).run();
    if (!claimed.meta.changes) continue;
    try {
      await processScan(env, { ...scan, status: "processing", stage: "searching", started_at: scan.started_at ?? now });
    } catch (error) {
      const failure = scanFailureRecord(error, `/internal/market-scan/${scan.id}`);
      if (scan.trigger === "manual") {
        await env.DB.prepare("UPDATE users SET last_manual_scan_at = NULL WHERE id = ?").bind(scan.user_id).run();
      }
      await env.DB.prepare(
        `UPDATE market_scans SET status = 'failed', stage = 'failed', error = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND charged = 0`,
      ).bind(failure.message.slice(0, 300), new Date().toISOString(), new Date().toISOString(), scan.id).run();
      await env.DB.prepare("DELETE FROM market_scan_candidates WHERE scan_id = ?").bind(scan.id).run();
      const pipeline = await pipelineTotals(env, scan.id);
      await logRun(env, scan.id, scan.user_id, scan.trigger, 0, false, pipeline.checked, pipeline.closed, failure.message);
      console.error(failure.log);
    }
  }
}

export async function marketScanView(env: Env, userId: string, scanId?: string): Promise<MarketScanView | null> {
  const row = scanId
    ? await env.DB.prepare("SELECT * FROM market_scans WHERE id = ? AND user_id = ?").bind(scanId, userId).first<MarketScanRow>()
    : await env.DB.prepare(
      "SELECT * FROM market_scans WHERE user_id = ? ORDER BY queued_at DESC LIMIT 1",
    ).bind(userId).first<MarketScanRow>();
  if (!row) return null;
  const { results: ahead } = await env.DB.prepare(
    "SELECT id FROM market_scans WHERE status IN ('queued','processing') AND queued_at < ?",
  ).bind(row.queued_at).all<{ id: string }>();
  const ids = JSON.parse(row.result_job_ids || "[]") as string[];
  const preparedRaw: JobRecord[] = [];
  for (const id of ids) {
    const job = await env.DB.prepare(`${JOB_SELECT} WHERE j.id = ? AND j.user_id = ?`).bind(id, userId).first<JobRow>();
    if (job) preparedRaw.push(toJob(job));
  }
  const prepared = collapseDuplicateJobs(preparedRaw);
  const rawStarted = row.started_at ?? row.queued_at;
  const started = new Date(rawStarted.includes("T") ? rawStarted : `${rawStarted.replace(" ", "T")}Z`).getTime();
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    stage: row.stage,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    estimatedSeconds: row.estimated_seconds,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - started) / 1000)),
    queueAhead: ahead.length,
    candidateCount: row.candidate_count,
    checkedCount: row.checked_count,
    handpickedCount: row.status === "complete" ? prepared.length : row.handpicked_count,
    charged: Boolean(row.charged),
    progress: scanProgress(row.stage, row.checked_count, row.candidate_count),
    error: row.error,
    pipelineChecked: row.pipeline_checked ?? 0,
    pipelineClosed: row.pipeline_closed ?? 0,
    prepared,
  };
}
