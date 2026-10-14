import { QUOTA_LIMITS } from "./capacity";

/** Free accounts pause at this share of either daily database meter, so paying customers keep the rest. */
export const FREE_PAUSE_AT = 0.85;

export const CAPACITY_PAUSED = "capacity_paused";

export type CapacityPauseReason = "quota_reached" | "saving_for_paid";

export interface CapacityPause {
  code: typeof CAPACITY_PAUSED;
  reason: CapacityPauseReason;
  /** The moment the daily database allowance refills, as an ISO timestamp. */
  resetAt: string;
  error: string;
}

export interface DbUsage {
  rowsRead: number;
  rowsWritten: number;
}

/** True when D1 refused a query because the account used up today's free rows. */
export function isDailyQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /exceeded D1'?s? .*daily .*limit/i.test(message) || /D1.*daily row (read|write) limit/i.test(message);
}

/** D1 free-tier allowances refill at midnight UTC. */
export function nextQuotaReset(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export function dbUsageShare(usage: DbUsage): number {
  return Math.max(usage.rowsRead / QUOTA_LIMITS.d1_rows_read, usage.rowsWritten / QUOTA_LIMITS.d1_rows_written);
}

export function shouldPauseFreeAccounts(usage: DbUsage | null): boolean {
  return usage !== null && dbUsageShare(usage) >= FREE_PAUSE_AT;
}

function untilText(resetAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`;
}

/** The reset time in the reader's own time zone, e.g. "5:30 am IST tomorrow". */
export function localResetTime(resetAt: string, now: Date = new Date(), locale?: string, timeZone?: string): string {
  const reset = new Date(resetAt);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(reset);
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
  const today = dayOf(now);
  const tomorrow = dayOf(new Date(now.getTime() + 86_400_000));
  const resetDay = dayOf(reset);
  const when = resetDay === today ? "today" : resetDay === tomorrow ? "tomorrow" : "";
  return `${time}${when ? ` ${when}` : ""} (${untilText(reset, now)} from now)`;
}

export function capacityHeadline(reason: CapacityPauseReason): string {
  switch (reason) {
    case "quota_reached":
      return "We're taking a quick breather";
    case "saving_for_paid":
      return "Busy day. Free accounts are on a short break";
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

export function capacityMessage(reason: CapacityPauseReason, resetAt: string, now: Date = new Date(), locale?: string, timeZone?: string): string {
  const back = localResetTime(resetAt, now, locale, timeZone);
  switch (reason) {
    case "quota_reached":
      return `CustomJobSeek runs on its founder's pocket money, with no investors yet. So many people hunted for jobs today that we used up our free daily database allowance. Annoying, but it means things are going well. We're adding more room soon. Everything works again at ${back}. Your data is safe and nothing was charged.`;
    case "saving_for_paid":
      return `CustomJobSeek runs on its founder's pocket money, with no investors yet, and today's database allowance is nearly used up. That's a good problem to have. We're saving the last bit for people who bought a plan, and adding more room soon. Free accounts work again at ${back}. Your data is safe and nothing was charged.`;
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

export function capacityPause(reason: CapacityPauseReason, now: Date = new Date()): CapacityPause {
  const resetAt = nextQuotaReset(now);
  return { code: CAPACITY_PAUSED, reason, resetAt, error: capacityMessage(reason, resetAt, now, "en-GB", "UTC") };
}

export function parseCapacityPause(body: unknown): CapacityPause | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (row.code !== CAPACITY_PAUSED || typeof row.resetAt !== "string" || Number.isNaN(Date.parse(row.resetAt))) return null;
  const reason: CapacityPauseReason = row.reason === "saving_for_paid" ? "saving_for_paid" : "quota_reached";
  return { code: CAPACITY_PAUSED, reason, resetAt: row.resetAt, error: typeof row.error === "string" ? row.error : "" };
}
