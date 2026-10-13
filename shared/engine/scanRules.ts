/** IST has no daylight saving. Every whole hour in IST is a half hour in UTC. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const MANUAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SCAN_LOCK_MS = 2 * 60 * 1000;
export const SCHEDULES_PER_TICK = 10;

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
