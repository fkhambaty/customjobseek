/** When the unattended release should wait, and when a restart should go straight to work. */

const RELEASE_MINUTE_UTC = 3;
const WINDOW_MS = 6 * 60 * 60 * 1000;

export function releaseMoment(now: Date): { action: "wait" | "run"; at: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, RELEASE_MINUTE_UTC));
  if (now.getTime() < start.getTime()) return { action: "wait", at: start };
  if (now.getTime() <= start.getTime() + WINDOW_MS) return { action: "run", at: now };
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  return { action: "wait", at: next };
}
