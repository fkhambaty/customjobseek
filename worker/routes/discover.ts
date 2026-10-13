import { Hono } from "hono";
import { countryByCode, timeZoneLabel } from "../../shared/geo";
import { canRunManual, formatZonedClock, nextRunAt, SCHEDULE_VERSION_LOCAL, scheduleTimeZone } from "../../shared/engine/scanRules";
import { DEFAULT_TIME_ZONE, isScheduleTimeZone } from "../../shared/geo";
import { enqueueScan, marketScanView } from "../autoScan";
import { matchingRows } from "../discoverMatch";
import { HttpError, type AppEnv } from "../env";
import { enforceRateLimit } from "../rateLimit";
import { requireUser } from "../session";
import { loadProfile } from "./profile";

export { contactsFrom, indiaMarketLocation, meaningfulTitleMatch } from "../discoverMatch";
export type { DiscoverRow } from "../discoverMatch";

interface ScheduleRow {
  hour_ist: number;
  enabled: number;
  next_run_at: string | null;
  paused_reason: string;
  timezone: string;
  schedule_version: number;
}

interface RunRow {
  id: string;
  trigger: string;
  started_at: string;
  prepared_count: number;
  charged: number;
  note: string;
}

async function scheduleView(env: AppEnv["Bindings"], userId: string, email: string, scanRuns: number, lastManual: string | null) {
  const profile = await loadProfile(env, userId, email);
  const timeZone = profile.preferences.timezone;
  const schedule = await env.DB.prepare(
    "SELECT hour_ist, enabled, next_run_at, paused_reason, timezone, schedule_version FROM scan_schedules WHERE user_id = ?",
  )
    .bind(userId)
    .first<ScheduleRow>();
  const scheduleZone = schedule ? scheduleTimeZone(schedule.schedule_version, schedule.timezone) : timeZone;
  const { results } = await env.DB.prepare(
    "SELECT id, trigger, started_at, prepared_count, charged, note FROM scan_runs_log WHERE user_id = ? ORDER BY started_at DESC LIMIT 10",
  ).bind(userId).all<RunRow>();
  const wait = canRunManual(lastManual, new Date());
  return {
    schedule: schedule
      ? {
          hourIst: schedule.hour_ist,
          hourLocal: schedule.hour_ist,
          timeZone: scheduleZone,
          scheduleVersion: schedule.schedule_version,
          enabled: Boolean(schedule.enabled),
          nextRunAt: schedule.next_run_at,
          pausedReason: schedule.paused_reason,
        }
      : null,
    timeZone,
    timeZoneLabel: timeZoneLabel(timeZone),
    country: profile.preferences.country,
    countryName: countryByCode(profile.preferences.country)?.name ?? "",
    scanRuns,
    manualAllowedAt: wait.ok ? null : wait.nextAt,
    manualNote: wait.ok ? "" : `Next manual scan at ${formatZonedClock(wait.nextAt, timeZone)} ${timeZoneLabel(timeZone)}.`,
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
    return c.json(await scheduleView(c.env, user.id, user.email, user.scan_runs ?? 0, user.last_manual_scan_at ?? null));
  })
  .put("/schedule", async (c) => {
    const user = c.get("user");
    if (user.plan === "free") throw new HttpError(403, "Daily scans come with any paid plan.");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const hourLocal = typeof body.hourLocal === "number" ? body.hourLocal : body.hourIst;
    if (typeof hourLocal !== "number" || !Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) {
      throw new HttpError(400, "Pick an hour from midnight to 11 PM.");
    }
    const enabled = body.enabled === true;
    if (enabled && (user.scan_runs ?? 0) < 1) throw new HttpError(402, "You have used your scans. Add a run pack to turn the daily scan on.");
    if (enabled && Math.min(user.eval_credits, user.resume_credits) < 1) {
      throw new HttpError(402, "A daily scan needs an application pack left.");
    }
    const profile = await loadProfile(c.env, user.id, user.email);
    const zone = isScheduleTimeZone(profile.preferences.timezone) ? profile.preferences.timezone : DEFAULT_TIME_ZONE;
    const next = nextRunAt(hourLocal, new Date(), zone);
    await c.env.DB.prepare(
      `INSERT INTO scan_schedules (user_id, hour_ist, enabled, next_run_at, paused_reason, timezone, schedule_version)
       VALUES (?, ?, ?, ?, '', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         hour_ist = excluded.hour_ist,
         enabled = excluded.enabled,
         next_run_at = excluded.next_run_at,
         paused_reason = '',
         timezone = excluded.timezone,
         schedule_version = excluded.schedule_version`,
    ).bind(user.id, hourLocal, enabled ? 1 : 0, enabled ? next : null, zone, SCHEDULE_VERSION_LOCAL).run();
    return c.json(await scheduleView(c.env, user.id, user.email, user.scan_runs ?? 0, user.last_manual_scan_at ?? null));
  })
  .get("/scan/current", async (c) => {
    const user = c.get("user");
    return c.json({ scan: await marketScanView(c.env, user.id) });
  })
  .get("/scan/:id", async (c) => {
    const user = c.get("user");
    const scan = await marketScanView(c.env, user.id, c.req.param("id"));
    if (!scan) throw new HttpError(404, "Scan not found.");
    return c.json({ scan });
  })
  .post("/scan", async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "scan", user.id);
    const scan = await enqueueScan(c.env, user, "manual");
    if (!scan) throw new HttpError(500, "The scan could not be queued.");
    return c.json({ scan }, 202);
  });
