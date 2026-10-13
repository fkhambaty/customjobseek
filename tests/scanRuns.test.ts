import { describe, expect, it } from "vitest";
import { chargeGatedInsert } from "../worker/discoverMatch";
import { dedupeEmployers, employerKey } from "../shared/engine/catalog";
import { canRunManual, estimatedScanSeconds, formatIstClock, formatZonedClock, formatZonedHour, nextRunAt, scanProgress, scanStageLabel, SCHEDULE_VERSION_LOCAL, scheduleTimeZone, shouldCharge } from "../shared/engine/scanRules";

describe("scan run rules", () => {
  it("gates scan pack inserts on the charge token", () => {
    const sql = chargeGatedInsert("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'application', ?)");
    expect(sql).toContain("SELECT ?, ?, 'application', ?");
    expect(sql).not.toContain("VALUES");
  });

  it("keeps old schedule rows on India time and new rows on the saved zone", () => {
    expect(scheduleTimeZone(0, "America/New_York")).toBe("Asia/Kolkata");
    expect(scheduleTimeZone(0, "")).toBe("Asia/Kolkata");
    expect(scheduleTimeZone(SCHEDULE_VERSION_LOCAL, "America/New_York")).toBe("America/New_York");
    expect(scheduleTimeZone(SCHEDULE_VERSION_LOCAL, "Not/AZone")).toBe("Asia/Kolkata");
    const morning = new Date("2026-10-13T04:00:00.000Z");
    expect(nextRunAt(9, morning, scheduleTimeZone(0, "America/Los_Angeles"))).toBe(nextRunAt(9, morning, "Asia/Kolkata"));
    expect(nextRunAt(9, morning, scheduleTimeZone(SCHEDULE_VERSION_LOCAL, "America/New_York"))).not.toBe(nextRunAt(9, morning, "Asia/Kolkata"));
  });

  it("schedules the next whole hour in India time", () => {
    const morning = new Date("2026-10-13T04:00:00.000Z");
    expect(nextRunAt(13, morning)).toBe("2026-10-13T07:30:00.000Z");
    const after = new Date("2026-10-13T07:30:00.000Z");
    expect(nextRunAt(13, after)).toBe("2026-10-14T07:30:00.000Z");
    const late = new Date("2026-10-13T17:30:00.000Z");
    expect(nextRunAt(0, late)).toBe("2026-10-13T18:30:00.000Z");
  });

  it("allows a manual scan again six hours later", () => {
    const now = new Date("2026-10-13T12:00:00.000Z");
    expect(canRunManual(null, now)).toEqual({ ok: true });
    expect(canRunManual("2026-10-13T07:00:00.000Z", now)).toEqual({ ok: false, nextAt: "2026-10-13T13:00:00.000Z" });
    expect(canRunManual("2026-10-13T06:00:00.000Z", now)).toEqual({ ok: true });
  });

  it("charges a run only when a job was prepared", () => {
    expect(shouldCharge(0)).toBe(false);
    expect(shouldCharge(3)).toBe(true);
  });

  it("prints an India-time clock", () => {
    expect(formatIstClock("2026-10-13T11:00:00.000Z")).toBe("4:30 PM");
  });

  it("schedules the same local hour in other English-language markets", () => {
    expect(nextRunAt(9, new Date("2026-01-15T13:00:00.000Z"), "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-07-15T12:00:00.000Z"), "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-01-15T08:00:00.000Z"), "Europe/London")).toBe("2026-01-15T09:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-07-15T07:00:00.000Z"), "Europe/London")).toBe("2026-07-15T08:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-10-13T00:00:00.000Z"), "Asia/Singapore")).toBe("2026-10-13T01:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-10-13T06:00:00.000Z"), "Africa/Johannesburg")).toBe("2026-10-13T07:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-01-15T21:00:00.000Z"), "Australia/Sydney")).toBe("2026-01-15T22:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-07-15T20:00:00.000Z"), "Pacific/Auckland")).toBe("2026-07-15T21:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-06-15T07:00:00.000Z"), "Europe/Dublin")).toBe("2026-06-15T08:00:00.000Z");
    expect(nextRunAt(9, new Date("2026-01-15T13:00:00.000Z"), "America/Toronto")).toBe("2026-01-15T14:00:00.000Z");
    expect(formatZonedHour(13, "Asia/Kolkata")).toBe("1:00 PM IST");
    expect(formatZonedHour(9, "America/Los_Angeles")).toBe("9:00 AM PT");
    expect(formatZonedClock("2026-07-15T12:00:00.000Z", "America/New_York")).toBe("8 AM");
    expect(scanStageLabel("searching", "South Africa")).toBe("Searching openings for South Africa");
    expect(scanStageLabel("searching")).toBe("Searching openings for your titles");
  });

  it("estimates from observed runs and queue position without an unbounded promise", () => {
    expect(estimatedScanSeconds([], 0)).toBe(120);
    expect(estimatedScanSeconds([60, 120], 1)).toBe(180);
    expect(estimatedScanSeconds([2000], 20)).toBe(900);
  });

  it("uses real counts where progress is measurable", () => {
    expect(scanProgress("searching", 0, 0)).toBeNull();
    expect(scanProgress("reading", 6, 24)).toBe(25);
    expect(scanProgress("building_packs", 24, 24)).toBe(90);
    expect(scanProgress("complete", 24, 24)).toBe(100);
  });
});

describe("India employer catalog", () => {
  it("deduplicates ATS boards by board identity and websites by domain", () => {
    expect(employerKey("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse:acme");
    expect(dedupeEmployers([
      { name: "Acme", careerUrl: "https://boards.greenhouse.io/acme", sectors: [] },
      { name: "Acme duplicate", careerUrl: "https://boards.greenhouse.io/acme/jobs/123", sectors: [] },
      { name: "Example", careerUrl: "https://www.example.com/careers", sectors: [] },
    ])).toHaveLength(2);
  });
});
