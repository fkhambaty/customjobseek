import type { D1Database } from "@cloudflare/workers-types";
import {
  closureConfirmed,
  closureEffect,
  jobStatusFromDb,
  judgeProbe,
  livenessProbe,
  PIPELINE_CHECKS_PER_SCAN,
  PIPELINE_DUE_READ_CAP,
  PIPELINE_FETCH_CONCURRENCY,
  PIPELINE_RECHECK_MS,
  readBoundedText,
  selectDuePipelineJobs,
  type PipelineCandidate,
  type ProbeFailure,
  type ProbeSource,
  type ProbeVerdict,
} from "../shared/engine/liveness";
import type { Env } from "./env";

export interface PipelineLivenessCounts {
  checked: number;
  closed: number;
}

interface DueRow {
  id: string;
  url: string;
  status: string;
  source_checked_at: string | null;
  streak: number;
  auto_closed_from: string | null;
}

const OPEN_PIPELINE_SQL = "('evaluated', 'resume_ready', 'applied', 'interview', 'offer')";
const DUE_STATUS_SQL = `(
  status IN ${OPEN_PIPELINE_SQL}
  OR (status = 'closed' AND auto_closed_from IN ('evaluated', 'resume_ready'))
)`;

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_BODY_CAP = 100_000;

export async function checkDuePipeline(env: Env, userId: string, now = new Date()): Promise<PipelineLivenessCounts> {
  const dueBefore = new Date(now.getTime() - PIPELINE_RECHECK_MS).toISOString();
  const nowIso = now.toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, url, status, source_checked_at, streak, auto_closed_from
     FROM jobs
     WHERE user_id = ?
       AND ${DUE_STATUS_SQL}
       AND trim(url) != ''
       AND (source_checked_at IS NULL OR source_checked_at <= ?)
     ORDER BY CASE WHEN source_checked_at IS NULL OR source_checked_at = '' THEN 0 ELSE 1 END,
              source_checked_at ASC,
              id ASC
     LIMIT ?`,
  ).bind(userId, dueBefore, PIPELINE_DUE_READ_CAP).all<DueRow>();

  const candidates: PipelineCandidate[] = [];
  const skipped: string[] = [];
  for (const row of results) {
    const status = jobStatusFromDb(row.status);
    if (!status) continue;
    const job = {
      id: row.id,
      url: row.url,
      status,
      sourceCheckedAt: row.source_checked_at,
      closureStreak: row.streak ?? 0,
      autoClosedFrom: priorWorkflowStatus(row.auto_closed_from),
    };
    if (livenessProbe(job.url)) candidates.push(job);
    else skipped.push(job.id);
  }
  if (skipped.length) await markUncheckable(env.DB, userId, skipped, nowIso);
  const due = selectDuePipelineJobs(candidates, now.getTime(), PIPELINE_CHECKS_PER_SCAN);
  const outcomes = await mapLimited(due, PIPELINE_FETCH_CONCURRENCY, async (job) => {
    const probe = livenessProbe(job.url);
    if (!probe) return { job, verdict: { status: "unknown" as const, strength: "none" as const }, fetched: false };
    const verdict = await readProbe(probe.url, probe.accept, probe.source);
    return { job, verdict, fetched: true };
  });

  let checked = 0;
  let closed = 0;
  for (const item of outcomes) {
    if (!item.fetched) continue;
    try {
      const transitioned = await applyPipelineOutcome(env.DB, userId, item.job, item.verdict, nowIso);
      checked += 1;
      if (transitioned) closed += 1;
    } catch (error) {
      console.error("pipeline liveness failed", item.job.id, error instanceof Error ? error.name : "Error");
    }
  }
  return { checked, closed };
}

export async function applyPipelineOutcome(
  db: D1Database,
  userId: string,
  job: Pick<PipelineCandidate, "id" | "status" | "closureStreak" | "autoClosedFrom">,
  verdict: ProbeVerdict,
  nowIso: string,
): Promise<boolean> {
  const prior = job.autoClosedFrom === "evaluated" || job.autoClosedFrom === "resume_ready" ? job.autoClosedFrom : null;
  const recovering = job.status === "closed" && prior !== null;
  const streak = job.closureStreak ?? 0;
  if (verdict.status === "live") {
    if (recovering && prior) await restoreWorkflow(db, userId, job.id, prior, nowIso);
    else await noteLive(db, userId, job.id, nowIso);
    return false;
  }
  if (verdict.status !== "closed") {
    if (recovering) await noteRecheck(db, userId, job.id, nowIso);
    else await noteReading(db, userId, job.id, verdict.status, nowIso);
    return false;
  }
  const nextStreak = streak + 1;
  if (!closureConfirmed(streak, verdict.strength)) {
    await noteStrike(db, userId, job.id, nextStreak, nowIso);
    return false;
  }
  if (recovering) {
    await noteStillClosed(db, userId, job.id, nextStreak, nowIso);
    return false;
  }
  const effect = closureEffect(job.status, "closed");
  switch (effect) {
    case "close_workflow":
      return closeWorkflow(db, userId, job.id, job.status, nextStreak, nowIso);
    case "flag_posting":
      await flagPosting(db, userId, job.id, nextStreak, nowIso);
      return false;
    case "none":
      await noteReading(db, userId, job.id, "closed", nowIso);
      return false;
    default: {
      const unexpected: never = effect;
      return unexpected;
    }
  }
}

function priorWorkflowStatus(value: string | null): "evaluated" | "resume_ready" | null {
  if (value === "evaluated" || value === "resume_ready") return value;
  return null;
}

async function markUncheckable(db: D1Database, userId: string, ids: readonly string[], nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET source_checked_at = ?
     WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})
       AND ${DUE_STATUS_SQL}`,
  ).bind(nowIso, userId, ...ids).run();
}

async function noteLive(db: D1Database, userId: string, jobId: string, nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET live_status = 'live', streak = 0, source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ${OPEN_PIPELINE_SQL}`,
  ).bind(nowIso, nowIso, jobId, userId).run();
}

async function noteReading(db: D1Database, userId: string, jobId: string, status: ProbeVerdict["status"], nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET live_status = ?, source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ${OPEN_PIPELINE_SQL}`,
  ).bind(status, nowIso, nowIso, jobId, userId).run();
}

async function noteRecheck(db: D1Database, userId: string, jobId: string, nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'closed' AND auto_closed_from IN ('evaluated', 'resume_ready')`,
  ).bind(nowIso, nowIso, jobId, userId).run();
}

async function noteStrike(db: D1Database, userId: string, jobId: string, streak: number, nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET streak = ?, source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND ${DUE_STATUS_SQL}`,
  ).bind(streak, nowIso, nowIso, jobId, userId).run();
}

async function noteStillClosed(db: D1Database, userId: string, jobId: string, streak: number, nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET live_status = 'closed', streak = ?, source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'closed' AND auto_closed_from IN ('evaluated', 'resume_ready')`,
  ).bind(streak, nowIso, nowIso, jobId, userId).run();
}

async function closeWorkflow(
  db: D1Database,
  userId: string,
  jobId: string,
  prior: PipelineCandidate["status"],
  streak: number,
  nowIso: string,
): Promise<boolean> {
  const closedOn = nowIso.slice(0, 10);
  const batch = await db.batch([
    db.prepare(
      `UPDATE jobs
       SET status = 'closed', closed_at = ?, live_status = 'closed', source_checked_at = ?, updated_at = ?,
           streak = ?, auto_closed_from = ?
       WHERE id = ? AND user_id = ? AND status IN ('evaluated', 'resume_ready')`,
    ).bind(closedOn, nowIso, nowIso, streak, prior, jobId, userId),
    db.prepare(
      `INSERT INTO job_events (id, job_id, user_id, kind, status, at)
       SELECT ?, ?, ?, 'status', 'closed', ?
       WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), jobId, userId, nowIso),
  ]);
  return Number(batch[0]?.meta.changes ?? 0) > 0;
}

async function flagPosting(db: D1Database, userId: string, jobId: string, streak: number, nowIso: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET live_status = 'closed', streak = ?, source_checked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ('applied', 'interview', 'offer')`,
  ).bind(streak, nowIso, nowIso, jobId, userId).run();
}

async function restoreWorkflow(
  db: D1Database,
  userId: string,
  jobId: string,
  prior: "evaluated" | "resume_ready",
  nowIso: string,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE jobs
       SET status = ?, closed_at = NULL, live_status = 'live', source_checked_at = ?, updated_at = ?,
           streak = 0, auto_closed_from = NULL
       WHERE id = ? AND user_id = ? AND status = 'closed' AND auto_closed_from = ?`,
    ).bind(prior, nowIso, nowIso, jobId, userId, prior),
    db.prepare(
      `INSERT INTO job_events (id, job_id, user_id, kind, status, at)
       SELECT ?, ?, ?, 'status', ?, ?
       WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), jobId, userId, prior, nowIso),
  ]);
}

async function readProbe(url: string, accept: "application/json" | "text/html", source: ProbeSource): Promise<ProbeVerdict> {
  try {
    const res = await fetch(url, {
      headers: {
        accept,
        "user-agent": "Mozilla/5.0 (compatible; CustomJobSeek/0.1; +https://customjobseek.com)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await readBoundedText(res.body, PROBE_BODY_CAP);
    return judgeProbe({
      httpStatus: res.status,
      body,
      contentType: res.headers.get("content-type") ?? "",
      failure: null,
      nowMs: Date.now(),
    }, source);
  } catch (error) {
    const failure: ProbeFailure = isTimeout(error) ? "timeout" : "network";
    return judgeProbe({ httpStatus: null, body: "", contentType: "", failure }, source);
  }
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timeout/i.test(error.message);
}

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 0), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}
