import { describe, expect, it } from "vitest";
import { releaseMoment } from "../shared/releaseWindow";
import { sha256 } from "../worker/crypto";

describe("overnight release window", () => {
  it("waits until 00:03 UTC when started the evening before", () => {
    const decision = releaseMoment(new Date("2026-10-14T19:30:00.000Z"));
    expect(decision.action).toBe("wait");
    expect(decision.at.toISOString()).toBe("2026-10-15T00:03:00.000Z");
  });

  it("starts immediately if the process is restarted after the reset but still in the morning window", () => {
    const atOpen = releaseMoment(new Date("2026-10-15T00:03:00.000Z"));
    const restarted = releaseMoment(new Date("2026-10-15T02:15:00.000Z"));
    expect(atOpen.action).toBe("run");
    expect(restarted.action).toBe("run");
  });

  it("does not run again later the same afternoon", () => {
    const decision = releaseMoment(new Date("2026-10-15T07:00:00.000Z"));
    expect(decision.action).toBe("wait");
    expect(decision.at.toISOString()).toBe("2026-10-16T00:03:00.000Z");
  });
});

describe("release smoke session hash", () => {
  it("stores the same base64 hash the Worker looks up", async () => {
    expect(await sha256("abc")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });
});
