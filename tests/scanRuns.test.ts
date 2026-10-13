import { describe, expect, it } from "vitest";
import { canRunManual, formatIstClock, nextRunAt, shouldCharge } from "../shared/engine/scanRules";

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
});
