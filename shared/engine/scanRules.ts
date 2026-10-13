import { DEFAULT_TIME_ZONE, isScheduleTimeZone, timeZoneLabel } from "../geo";

/** IST has no daylight saving. Kept so older clock math stays easy to compare. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const MANUAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SCAN_LOCK_MS = 2 * 60 * 1000;
export const SCHEDULES_PER_TICK = 10;
export const SCANS_PER_TICK = 2;

export type ScanStage =
  | "queued"
  | "searching"
  | "reading"
  | "checking_fit"
  | "building_resumes"
  | "building_packs"
  | "complete"
  | "failed";

export const SCAN_STAGE_LABELS: Record<ScanStage, string> = {
  queued: "Waiting for a scan slot",
  searching: "Searching openings for your titles",
  reading: "Reading the strongest openings",
  checking_fit: "Checking fit and deal-breakers",
  building_resumes: "Building truthful resumes",
  building_packs: "Finishing application packs",
  complete: "Your handpicked jobs are ready",
  failed: "The scan stopped",
};

export function estimatedScanSeconds(completedDurations: number[], queueAhead: number): number {
  const usable = completedDurations.filter((seconds) => Number.isFinite(seconds) && seconds >= 10 && seconds <= 900);
  const own = usable.length ? Math.round(usable.reduce((sum, seconds) => sum + seconds, 0) / usable.length) : 120;
  return Math.max(45, Math.min(900, own * (queueAhead + 1)));
}

export function scanProgress(stage: ScanStage, checked: number, candidates: number): number | null {
  switch (stage) {
    case "queued":
      return 0;
    case "searching":
      return null;
    case "reading":
      return candidates > 0 ? Math.min(62, 12 + Math.round((checked / candidates) * 50)) : null;
    case "checking_fit":
      return 68;
    case "building_resumes":
      return 78;
    case "building_packs":
      return 90;
    case "complete":
    case "failed":
      return 100;
    default: {
      const unexpected: never = stage;
      return unexpected;
    }
  }
}

export function scanStageLabel(stage: ScanStage, countryName = ""): string {
  switch (stage) {
    case "queued":
      return SCAN_STAGE_LABELS.queued;
    case "searching":
      return countryName ? `Searching openings for ${countryName}` : SCAN_STAGE_LABELS.searching;
    case "reading":
      return SCAN_STAGE_LABELS.reading;
    case "checking_fit":
      return SCAN_STAGE_LABELS.checking_fit;
    case "building_resumes":
      return SCAN_STAGE_LABELS.building_resumes;
    case "building_packs":
      return SCAN_STAGE_LABELS.building_packs;
    case "complete":
      return SCAN_STAGE_LABELS.complete;
    case "failed":
      return SCAN_STAGE_LABELS.failed;
    default: {
      const unexpected: never = stage;
      return unexpected;
    }
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = zonedParts(new Date(utcMs), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcMs;
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const adjusted = guess - offsetMs(guess - offsetMs(guess, timeZone), timeZone);
  return new Date(adjusted);
}

/** Rows saved before this version keep the hour in India time. */
export const SCHEDULE_VERSION_LOCAL = 1;

export function scheduleTimeZone(version: number, storedZone: string | null | undefined): string {
  if (version >= SCHEDULE_VERSION_LOCAL && storedZone && isScheduleTimeZone(storedZone)) return storedZone;
  return DEFAULT_TIME_ZONE;
}

export function nextRunAt(hourLocal: number, now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) throw new Error("Pick an hour from 0 to 23.");
  const zone = isScheduleTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const local = zonedParts(now, zone);
  const dayOffset = local.hour >= hourLocal ? 1 : 0;
  for (let shift = 0; shift < 4; shift += 1) {
    const instant = zonedTimeToUtc(local.year, local.month, local.day + dayOffset, hourLocal + shift, zone);
    const back = zonedParts(instant, zone);
    if (back.hour === (hourLocal + shift) % 24) return instant.toISOString();
  }
  throw new Error("Could not place that hour in the time zone.");
}

export function canRunManual(lastAt: string | null, now: Date): { ok: true } | { ok: false; nextAt: string } {
  if (!lastAt) return { ok: true };
  const next = new Date(new Date(lastAt).getTime() + MANUAL_COOLDOWN_MS);
  if (Number.isNaN(next.getTime()) || now >= next) return { ok: true };
  return { ok: false, nextAt: next.toISOString() };
}

/** A scan that prepares nothing is not charged. The deep read still counts toward the manual cooldown. */
export function shouldCharge(prepared: number): boolean {
  return prepared > 0;
}

export function formatZonedClock(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const zone = isScheduleTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = zonedParts(new Date(iso), zone);
  const hour = parts.hour;
  const minute = parts.minute;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatZonedHour(hourLocal: number, timeZone = DEFAULT_TIME_ZONE): string {
  const zone = isScheduleTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return `${hourLocal % 12 || 12}:00 ${hourLocal < 12 ? "AM" : "PM"} ${timeZoneLabel(zone)}`;
}

export function formatIstClock(iso: string): string {
  return formatZonedClock(iso, DEFAULT_TIME_ZONE);
}

export function formatIstHour(hourIst: number): string {
  return formatZonedHour(hourIst, DEFAULT_TIME_ZONE);
}
