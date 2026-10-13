import { describe, expect, it } from "vitest";
import { dedupeEmployers, employerKey } from "../shared/engine/catalog";
import { canRunManual, estimatedScanSeconds, formatIstClock, nextRunAt, scanProgress, shouldCharge } from "../shared/engine/scanRules";

describe("scan run rules", () => {
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
