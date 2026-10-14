import { describe, expect, it } from "vitest";
import {
  FREE_PAUSE_AT,
  capacityMessage,
  capacityPause,
  isDailyQuotaError,
  localResetTime,
  nextQuotaReset,
  parseCapacityPause,
  shouldPauseFreeAccounts,
} from "../shared/dbCapacity";

const PRODUCTION_ERROR =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

describe("database capacity", () => {
  it("recognises the D1 daily-limit errors and nothing else", () => {
    expect(isDailyQuotaError(new Error(PRODUCTION_ERROR))).toBe(true);
    expect(isDailyQuotaError(new Error(PRODUCTION_ERROR.replace("write", "read")))).toBe(true);
    expect(isDailyQuotaError(new Error("D1_ERROR: no such table: jobs"))).toBe(false);
    expect(isDailyQuotaError(null)).toBe(false);
  });

  it("resets at the next midnight UTC", () => {
    expect(nextQuotaReset(new Date("2026-10-14T10:29:00Z"))).toBe("2026-10-15T00:00:00.000Z");
    expect(nextQuotaReset(new Date("2026-10-14T23:59:59Z"))).toBe("2026-10-15T00:00:00.000Z");
  });

  it("pauses free accounts only once either meter reaches the reserve line", () => {
    expect(shouldPauseFreeAccounts(null)).toBe(false);
    expect(shouldPauseFreeAccounts({ rowsRead: 0, rowsWritten: 84_000 })).toBe(false);
    expect(shouldPauseFreeAccounts({ rowsRead: 0, rowsWritten: FREE_PAUSE_AT * 100_000 })).toBe(true);
    expect(shouldPauseFreeAccounts({ rowsRead: 4_300_000, rowsWritten: 10 })).toBe(true);
  });

  it("shows the reset in the reader's own time zone", () => {
    const now = new Date("2026-10-14T10:29:00Z");
    const india = localResetTime("2026-10-15T00:00:00.000Z", now, "en-IN", "Asia/Kolkata");
    expect(india).toContain("5:30");
    expect(india).toContain("tomorrow");
    expect(india).toContain("13 h 31 min");
    const newYork = localResetTime("2026-10-15T00:00:00.000Z", now, "en-US", "America/New_York");
    expect(newYork).toContain("8:00");
    expect(newYork).toContain("today");
  });

  it("explains the pause plainly for both reasons", () => {
    const now = new Date("2026-10-14T10:29:00Z");
    expect(capacityMessage("quota_reached", nextQuotaReset(now), now, "en-IN", "Asia/Kolkata")).toMatch(/means things are going well/);
    expect(capacityMessage("saving_for_paid", nextQuotaReset(now), now, "en-IN", "Asia/Kolkata")).toMatch(/Free accounts work again/);
  });

  it("round-trips the response body", () => {
    const body = capacityPause("saving_for_paid", new Date("2026-10-14T10:29:00Z"));
    expect(parseCapacityPause(JSON.parse(JSON.stringify(body)))).toEqual(body);
    expect(parseCapacityPause({ error: "Something went wrong" })).toBeNull();
  });
});
