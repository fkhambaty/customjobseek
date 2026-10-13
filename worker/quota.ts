import {
  QUOTA_LIMITS,
  cloudflareMeters,
  cloudflarePayloadFailed,
  forecastUsed,
  limitFor,
  missingQuotaMeters,
  parseResendUsage,
  quotaSeverity,
  quotaSummary,
  type QuotaMeter,
  type QuotaSample,
} from "../shared/capacity";
import { utcDay } from "../shared/commercial";
import type { Env } from "./env";
import { notifyOwner } from "./notify";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

const WORKERS_QUERY = `query ($accountTag: String!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since }) {
        sum { requests errors subrequests cpuTimeUs }
      }
    }
  }
}`;

const WORKERS_REQUESTS_QUERY = `query ($accountTag: String!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since }) {
        sum { requests }
      }
    }
  }
}`;

const WORKERS_CPU_QUERY = `query ($accountTag: String!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since }) {
        sum { cpuTime }
      }
    }
  }
}`;

const D1_QUERY = `query ($accountTag: String!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since }) {
        sum { rowsRead rowsWritten readQueries writeQueries }
      }
    }
  }
}`;

const D1_ROWS_QUERY = `query ($accountTag: String!, $since: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $since }) {
        sum { rowsRead rowsWritten }
      }
    }
  }
}`;

const STORAGE_QUERY = `query ($accountTag: String!, $since: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1StorageAdaptiveGroups(limit: 100, filter: { date_geq: $since }) {
        max { databaseSizeBytes }
      }
    }
  }
}`;

async function postGraphql(token: string, query: string, variables: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Cloudflare analytics request failed", err instanceof Error ? err.name : "error");
    return null;
  }
}

async function readResend(apiKey: string): Promise<unknown | null> {
  try {
    const res = await fetch("https://api.resend.com/usage", {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Resend usage request failed", err instanceof Error ? err.name : "error");
    return null;
  }
}

async function remember(db: D1Database, meter: QuotaMeter, day: string, used: number, limit: number): Promise<void> {
  await db.prepare(
    `INSERT INTO quota_samples (meter, day, used, limit_value) VALUES (?, ?, ?, ?)
     ON CONFLICT(meter, day) DO UPDATE SET used = excluded.used, limit_value = excluded.limit_value`,
  ).bind(meter, day, used, limit).run();
}

async function history(db: D1Database, meter: QuotaMeter): Promise<QuotaSample[]> {
  const { results } = await db.prepare(
    "SELECT day, used, limit_value FROM quota_samples WHERE meter = ? ORDER BY day DESC LIMIT 14",
  ).bind(meter).all<{ day: string; used: number; limit_value: number }>();
  return results.map((row) => ({ day: row.day, used: row.used, limit: row.limit_value }));
}

async function alertMeter(env: Env, meter: QuotaMeter, day: string, used: number, limit: number): Promise<void> {
  const samples = await history(env.DB, meter);
  const forecast = forecastUsed(samples, day);
  const severity = quotaSeverity(used, limit, forecast);
  if (severity === "ok") return;
  await notifyOwner(env, {
    kind: severity === "critical" ? "quota_critical" : "quota_watch",
    dedupeKey: `quota:${meter}:${severity}:${day}`,
    summary: quotaSummary(meter, severity, used, limit, forecast),
  });
}

async function telemetryGap(env: Env, source: "cloudflare" | "resend", day: string): Promise<void> {
  const name = source === "cloudflare" ? "Cloudflare" : "Resend";
  await notifyOwner(env, {
    kind: "telemetry_unavailable",
    dedupeKey: `telemetry:${source}:${day}`,
    summary: `${name} usage could not be read today. No quota number was stored for it.`,
  });
}

function usable(payload: unknown): boolean {
  return payload !== null && !cloudflarePayloadFailed(payload) && Object.keys(cloudflareMeters(payload)).length > 0;
}

async function collectCloudflare(env: Env, day: string, sinceIso: string, sinceDay: string): Promise<boolean> {
  const account = env.CF_ACCOUNT_ID?.trim() ?? "";
  const token = env.CF_ANALYTICS_API_TOKEN?.trim() ?? "";
  if (!account || !token) return false;
  const variables = { accountTag: account, since: sinceIso };
  let workers = await postGraphql(token, WORKERS_QUERY, variables);
  if (!usable(workers)) workers = await postGraphql(token, WORKERS_REQUESTS_QUERY, variables);
  let database = await postGraphql(token, D1_QUERY, variables);
  if (!usable(database)) database = await postGraphql(token, D1_ROWS_QUERY, { accountTag: account, since: sinceDay });
  const storage = await postGraphql(token, STORAGE_QUERY, { accountTag: account, since: sinceDay });
  const meters: Partial<Record<QuotaMeter, number>> = {
    ...cloudflareMeters(workers),
    ...cloudflareMeters(database),
    ...cloudflareMeters(storage),
  };
  if (meters.workers_cpu_ms === undefined) {
    const cpu = await postGraphql(token, WORKERS_CPU_QUERY, variables);
    const parsed = cloudflareMeters(cpu);
    if (parsed.workers_cpu_ms !== undefined) meters.workers_cpu_ms = parsed.workers_cpu_ms;
  }
  if (Object.keys(meters).length === 0) return false;
  for (const meter of Object.keys(QUOTA_LIMITS) as QuotaMeter[]) {
    const used = meters[meter];
    if (used === undefined || meter === "resend_daily" || meter === "resend_monthly") continue;
    const limit = limitFor(meter, null);
    await remember(env.DB, meter, day, used, limit);
    await alertMeter(env, meter, day, used, limit);
  }
  const missing = missingQuotaMeters(meters);
  if (missing.length > 0) {
    await notifyOwner(env, {
      kind: "telemetry_unavailable",
      dedupeKey: `telemetry:cloudflare:${day}`,
      summary: `Some Cloudflare usage numbers were missing (${missing.join(", ")}). Database requests are required. Stored only the meters that parsed.`,
    });
  }
  return true;
}

async function collectResend(env: Env, day: string): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  if (!apiKey) return false;
  const payload = await readResend(apiKey);
  if (!payload) return false;
  const reading = parseResendUsage(payload, day);
  if (reading.daily === null && reading.monthly === null) return false;
  if (reading.daily !== null) {
    const limit = limitFor("resend_daily", reading.dailyLimit);
    await remember(env.DB, "resend_daily", day, reading.daily, limit);
    await alertMeter(env, "resend_daily", day, reading.daily, limit);
  }
  if (reading.monthly !== null) {
    const limit = limitFor("resend_monthly", reading.monthlyLimit);
    await remember(env.DB, "resend_monthly", day, reading.monthly, limit);
    await alertMeter(env, "resend_monthly", day, reading.monthly, limit);
  }
  return true;
}

async function reportSourceHealth(env: Env, day: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT ats FROM source_adapters WHERE consecutive_failures >= 5 ORDER BY ats",
  ).all<{ ats: string }>();
  if (!results.length) return;
  const names = results.slice(0, 8).map((row) => row.ats).join(", ");
  await notifyOwner(env, {
    kind: "source_unhealthy",
    dedupeKey: `source-health:${day}`,
    summary: `Job-board readers still failing: ${names}.`,
  });
}

export async function collectDailyQuotas(env: Env, now = new Date()): Promise<void> {
  const day = utcDay(now.getTime());
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const cloudflareOk = await collectCloudflare(env, day, since, day).catch((err: unknown) => {
    console.error("Cloudflare quota collect failed", err instanceof Error ? err.name : "error");
    return false;
  });
  if (!cloudflareOk) await telemetryGap(env, "cloudflare", day);
  const resendOk = await collectResend(env, day).catch((err: unknown) => {
    console.error("Resend quota collect failed", err instanceof Error ? err.name : "error");
    return false;
  });
  if (!resendOk) await telemetryGap(env, "resend", day);
  await reportSourceHealth(env, day).catch((err: unknown) => {
    console.error("source health note failed", err instanceof Error ? err.name : "error");
  });
}

