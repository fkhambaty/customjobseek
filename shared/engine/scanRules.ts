/** IST has no daylight saving. Every whole hour in IST is a half hour in UTC. */
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
  searching: "Searching the India market",
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

export function nextRunAt(hourIst: number, now: Date): string {
  if (!Number.isInteger(hourIst) || hourIst < 0 || hourIst > 23) throw new Error("Pick an hour from 0 to 23.");
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCHours() < hourIst ? ist.getUTCDate() : ist.getUTCDate() + 1;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), day, hourIst) - IST_OFFSET_MS).toISOString();
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

export function formatIstClock(iso: string): string {
  const ist = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const label = `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
  return label;
}

export function formatIstHour(hourIst: number): string {
  return `${hourIst % 12 || 12}:00 ${hourIst < 12 ? "AM" : "PM"} IST`;
}
