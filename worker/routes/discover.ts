import { Hono } from "hono";
import { canRunManual, formatIstClock, nextRunAt } from "../../shared/engine/scanRules";
import { runScan } from "../autoScan";
import { matchingRows } from "../discoverMatch";
import { HttpError, type AppEnv } from "../env";
import { requireUser } from "../session";
import { loadProfile } from "./profile";

export { contactsFrom, meaningfulTitleMatch } from "../discoverMatch";
export type { DiscoverRow } from "../discoverMatch";

interface ScheduleRow {
  hour_ist: number;
  enabled: number;
  next_run_at: string | null;
  paused_reason: string;
}

interface RunRow {
  id: string;
  trigger: string;
  started_at: string;
  prepared_count: number;
  charged: number;
  note: string;
}

async function scheduleView(env: AppEnv["Bindings"], userId: string, scanRuns: number, lastManual: string | null) {
  const schedule = await env.DB.prepare("SELECT hour_ist, enabled, next_run_at, paused_reason FROM scan_schedules WHERE user_id = ?")
    .bind(userId)
    .first<ScheduleRow>();
  const { results } = await env.DB.prepare(
    "SELECT id, trigger, started_at, prepared_count, charged, note FROM scan_runs_log WHERE user_id = ? ORDER BY started_at DESC LIMIT 10",
  ).bind(userId).all<RunRow>();
  const wait = canRunManual(lastManual, new Date());
  return {
    schedule: schedule
      ? { hourIst: schedule.hour_ist, enabled: Boolean(schedule.enabled), nextRunAt: schedule.next_run_at, pausedReason: schedule.paused_reason }
      : null,
    scanRuns,
    manualAllowedAt: wait.ok ? null : wait.nextAt,
    manualNote: wait.ok ? "" : `Next manual scan at ${formatIstClock(wait.nextAt)}.`,
    runs: results.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      startedAt: row.started_at,
      preparedCount: row.prepared_count,
      charged: Boolean(row.charged),
      note: row.note,
    })),
  };
}

/** Openings whose title and place match, before any credit is spent. */
export const discover = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const needsTargets = profile.preferences.targetRoles.length === 0;
    return c.json({ needsTargets, rows: needsTargets ? [] : await matchingRows(c.env, user.id, profile) });
  })
  .get("/schedule", async (c) => {
    const user = c.get("user");
    return c.json(await scheduleView(c.env, user.id, user.scan_runs ?? 0, user.last_manual_scan_at ?? null));
  })
  .put("/schedule", async (c) => {
    const user = c.get("user");
    if (user.plan === "free") throw new HttpError(403, "Daily scans come with any paid plan.");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const hourIst = body.hourIst;
    if (typeof hourIst !== "number" || !Number.isInteger(hourIst) || hourIst < 0 || hourIst > 23) {
      throw new HttpError(400, "Pick an hour from midnight to 11 PM.");
    }
    const enabled = body.enabled === true;
    if (enabled && (user.scan_runs ?? 0) < 1) throw new HttpError(402, "You have used your scans. Add a run pack to turn the daily scan on.");
    if (enabled && Math.min(user.eval_credits, user.resume_credits) < 1) {
      throw new HttpError(402, "A daily scan needs an application pack left.");
    }
    const next = nextRunAt(hourIst, new Date());
    await c.env.DB.prepare(
      `INSERT INTO scan_schedules (user_id, hour_ist, enabled, next_run_at, paused_reason) VALUES (?, ?, ?, ?, '')
       ON CONFLICT(user_id) DO UPDATE SET hour_ist = excluded.hour_ist, enabled = excluded.enabled, next_run_at = excluded.next_run_at, paused_reason = ''`,
    ).bind(user.id, hourIst, enabled ? 1 : 0, enabled ? next : null).run();
    return c.json(await scheduleView(c.env, user.id, user.scan_runs ?? 0, user.last_manual_scan_at ?? null));
  })
  .post("/scan", async (c) => {
    const result = await runScan(c.env, c.get("user"), "manual");
    return c.json({ prepared: result.prepared, locked: result.locked, checked: result.checked });
  });
