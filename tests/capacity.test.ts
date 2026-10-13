import { describe, expect, it } from "vitest";
import {
  cloudflareMeters,
  cloudflarePayloadFailed,
  companyListCursor,
  companyNameLike,
  describeOpeningRead,
  discoveryTokens,
  forecastUsed,
  jobListCursor,
  limitFor,
  missingQuotaMeters,
  nextJobCursor,
  nextRefreshDelayMs,
  openingContentHash,
  pageSlice,
  parseCompanyCursor,
  parseCompanyPageLimit,
  parseJobListQuery,
  parseResendUsage,
  planOpeningDelta,
  shouldExpireOmittedOpenings,
  quotaSeverity,
  quotaSummary,
  refreshBand,
  scanFailureSpike,
  searchTokens,
  shouldCollectQuotas,
  type IncomingOpening,
  type StoredOpening,
} from "../shared/capacity";

const HOUR = 3_600_000;
const NOW = "2026-10-14T06:17:00.000Z";

function stored(partial: Partial<StoredOpening> & Pick<StoredOpening, "externalId">): StoredOpening {
  return {
    dedupKey: `req:acme:${partial.externalId}`,
    canonicalUrl: `https://jobs.example/${partial.externalId}`,
    contentHash: "same",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    provenance: "greenhouse:public_api",
    expiresAt: null,
    ...partial,
  };
}

function incoming(partial: Partial<IncomingOpening> & Pick<IncomingOpening, "externalId">): IncomingOpening {
  const externalId = partial.externalId;
  return {
    title: "Engineer",
    location: "Bengaluru",
    url: `https://jobs.example/${externalId}`,
    dedupKey: `req:acme:${externalId}`,
    canonicalUrl: `https://jobs.example/${externalId}`,
    titleKey: "engineer",
    locationKey: "bengaluru",
    employerKey: "greenhouse:acme",
    provenance: "greenhouse:public_api",
    contentHash: "same",
    expiresAt: null,
    tokens: ["engineer"],
    ...partial,
  };
}

describe("opening delta", () => {
  it("writes only the rows that were added, changed, expired, or reactivated", () => {
    const delta = planOpeningDelta(
      [
        stored({ externalId: "keep" }),
        stored({ externalId: "edit", contentHash: "old" }),
        stored({ externalId: "gone" }),
        stored({ externalId: "back", expiresAt: "2026-01-02T00:00:00.000Z" }),
        stored({ externalId: "already-gone", expiresAt: "2026-01-02T00:00:00.000Z" }),
      ],
      [
        incoming({ externalId: "keep" }),
        incoming({ externalId: "edit", contentHash: "new" }),
        incoming({ externalId: "back" }),
        incoming({ externalId: "fresh" }),
      ],
      NOW,
    );
    expect(delta.unchanged).toBe(1);
    expect(delta.liveCount).toBe(4);
    expect(delta.ops.map((op) => op.kind).sort()).toEqual(["add", "change", "expire", "reactivate"]);
    const expired = delta.ops.find((op) => op.kind === "expire");
    expect(expired && expired.kind === "expire" ? expired.externalId : "").toBe("gone");
    const added = delta.ops.find((op) => op.kind === "add");
    expect(added && added.kind === "add" ? added.row.externalId : "").toBe("fresh");
  });

  it("keeps the first-seen time, provenance, and an existing canonical link", () => {
    const delta = planOpeningDelta(
      [stored({ externalId: "1", canonicalUrl: "https://jobs.example/original", provenance: "greenhouse:public_api" })],
      [incoming({ externalId: "1", contentHash: "new", canonicalUrl: "", provenance: "other" })],
      NOW,
    );
    const op = delta.ops[0];
    expect(op?.kind).toBe("change");
    if (op?.kind !== "change") return;
    expect(op.row.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(op.row.provenance).toBe("greenhouse:public_api");
    expect(op.row.canonicalUrl).toBe("https://jobs.example/original");
  });

  it("does not delete a board when every role is unchanged", () => {
    const delta = planOpeningDelta([stored({ externalId: "1" }), stored({ externalId: "2" })], [incoming({ externalId: "1" }), incoming({ externalId: "2" })], NOW);
    expect(delta.ops).toEqual([]);
    expect(delta.liveCount).toBe(2);
  });

  it("does not expire omitted roles on a truncated or unreadable empty read", () => {
    const storedRows = [stored({ externalId: "kept" }), stored({ externalId: "omitted" })];
    const partial = describeOpeningRead([incoming({ externalId: "kept" })], { truncated: true, recognized: true });
    expect(shouldExpireOmittedOpenings(partial)).toBe(false);
    expect(partial).toMatchObject({ complete: false, truncated: true, suspiciousEmpty: false });
    const truncated = planOpeningDelta(storedRows, partial.openings, NOW, shouldExpireOmittedOpenings(partial));
    expect(truncated.ops.some((op) => op.kind === "expire")).toBe(false);

    const blank = describeOpeningRead([], { truncated: false, recognized: false });
    expect(blank.suspiciousEmpty).toBe(true);
    expect(shouldExpireOmittedOpenings(blank)).toBe(false);
    const suspicious = planOpeningDelta(storedRows, [], NOW, shouldExpireOmittedOpenings(blank));
    expect(suspicious.ops).toEqual([]);

    const cleared = describeOpeningRead([], { truncated: false, recognized: true });
    expect(cleared.complete).toBe(true);
    const gone = planOpeningDelta(storedRows, [], NOW, shouldExpireOmittedOpenings(cleared));
    expect(gone.ops.map((op) => op.kind)).toEqual(["expire", "expire"]);
  });
});

describe("refresh bands", () => {
  it("names the band from priority", () => {
    expect(refreshBand(80)).toBe("hot");
    expect(refreshBand(40)).toBe("warm");
    expect(refreshBand(10)).toBe("cool");
    expect(refreshBand(0)).toBe("cold");
  });

  it("waits longer after a quiet scan and after failures, and never waits more than a week", () => {
    expect(nextRefreshDelayMs({ priority: 90, consecutiveFailures: 0, unchangedScans: 0, freshnessHours: 6 })).toBe(2 * HOUR);
    expect(nextRefreshDelayMs({ priority: 50, consecutiveFailures: 0, unchangedScans: 0, freshnessHours: 6 })).toBe(6 * HOUR);
    expect(nextRefreshDelayMs({ priority: 0, consecutiveFailures: 0, unchangedScans: 0, freshnessHours: 6 })).toBe(24 * HOUR);
    expect(nextRefreshDelayMs({ priority: 90, consecutiveFailures: 0, unchangedScans: 2, freshnessHours: 6 })).toBe(4 * HOUR);
    expect(nextRefreshDelayMs({ priority: 90, consecutiveFailures: 2, unchangedScans: 0, freshnessHours: 6 })).toBe(8 * HOUR);
    expect(nextRefreshDelayMs({ priority: 0, consecutiveFailures: 8, unchangedScans: 0, freshnessHours: 6 })).toBe(7 * 24 * HOUR);
  });
});

describe("search tokens and job pages", () => {
  it("indexes whole title words and ignores a leading-wildcard style fragment", () => {
    expect(searchTokens("Senior Communications Lead")).toEqual(["senior", "communications", "lead"]);
    expect(discoveryTokens(["communications", "a", "lead%", "communications"])).toEqual(["communications"]);
  });

  it("pages the job list without reading past a bad cursor", () => {
    expect(parseJobListQuery("1000", undefined).limit).toBe(80);
    expect(parseJobListQuery(undefined, "nope").cursor).toBeNull();
    const cursor = jobListCursor("2026-10-14 00:00:00", "job-1");
    expect(parseJobListQuery("40", cursor).cursor).toEqual({ createdAt: "2026-10-14 00:00:00", id: "job-1" });
    expect(nextJobCursor([{ createdAt: "a", id: "1" }], 2)).toBeNull();
    expect(nextJobCursor([{ createdAt: "a", id: "1" }, { createdAt: "b", id: "2" }], 2)).toBe("b|2");
  });
});

describe("quotas", () => {
  it("collects once a day on the existing hourly trigger", () => {
    expect(shouldCollectQuotas("17 * * * *", new Date("2026-10-14T06:17:00.000Z"))).toBe(true);
    expect(shouldCollectQuotas("17 * * * *", new Date("2026-10-14T07:17:00.000Z"))).toBe(false);
    expect(shouldCollectQuotas("* * * * *", new Date("2026-10-14T06:17:00.000Z"))).toBe(false);
  });

  it("flags a scan pass that is mostly failures", () => {
    expect(scanFailureSpike(20, 5)).toBe(true);
    expect(scanFailureSpike(4, 2)).toBe(true);
    expect(scanFailureSpike(10, 4)).toBe(false);
    expect(scanFailureSpike(0, 0)).toBe(false);
  });

  it("forecasts seven days from the recent slope and alerts at 80 percent or a 90 percent forecast", () => {
    const samples = [
      { day: "2026-10-13", used: 10, limit: 100 },
      { day: "2026-10-14", used: 20, limit: 100 },
    ];
    expect(forecastUsed(samples, "2026-10-14")).toBe(90);
    expect(quotaSeverity(20, 100, 90)).toBe("watch");
    expect(quotaSeverity(80, 100, 80)).toBe("watch");
    expect(quotaSeverity(90, 100, 90)).toBe("critical");
    expect(quotaSeverity(10, 100, 20)).toBe("ok");
    expect(quotaSummary("workers_requests", "watch", 80, 100, 95)).not.toMatch(/@|bearer|token/i);
  });

  it("reads Cloudflare and Resend payloads defensively", () => {
    const cloudflare = {
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [{ sum: { requests: 1000, cpuTimeUs: 2_500_000 } }],
              d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 10, rowsWritten: 2, readQueries: 4, writeQueries: 1 } }],
              d1StorageAdaptiveGroups: [{ max: { databaseSizeBytes: 4096 } }],
            },
          ],
        },
      },
    };
    expect(cloudflareMeters(cloudflare)).toMatchObject({
      workers_requests: 1000,
      workers_cpu_ms: 2500,
      d1_rows_read: 10,
      d1_rows_written: 2,
      d1_requests: 5,
      d1_storage_bytes: 4096,
    });
    expect(cloudflarePayloadFailed({ errors: [{ message: "unknown field" }] })).toBe(true);
    expect(cloudflareMeters({ errors: [{ message: "unknown field" }] })).toEqual({});
    expect(missingQuotaMeters(cloudflareMeters(cloudflare))).toEqual([]);
    const rowsOnly = cloudflareMeters({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 3, rowsWritten: 1 } }] }] } } });
    expect(rowsOnly.d1_requests).toBeUndefined();
    expect(missingQuotaMeters(rowsOnly)).toContain("d1_requests");
    expect(parseResendUsage({ sent_today: 90, sent_this_month: 400, daily_quota: 100, monthly_quota: 3000 }, "2026-10-14")).toEqual({
      daily: 90,
      monthly: 400,
      dailyLimit: 100,
      monthlyLimit: 3000,
    });
    expect(parseResendUsage({ data: [{ date: "2026-10-14", sent: 3 }, { date: "2026-10-02", sent: 4 }] }, "2026-10-14")).toMatchObject({
      daily: 3,
      monthly: 7,
    });
    expect(parseResendUsage({ unexpected: true }, "2026-10-14")).toEqual({
      daily: null,
      monthly: null,
      dailyLimit: null,
      monthlyLimit: null,
    });
    expect(limitFor("resend_daily", 250)).toBe(250);
    expect(limitFor("resend_daily", null)).toBe(100);
  });

  it("hashes the same opening the same way", () => {
    const input = { externalId: "42", canonicalUrl: "https://jobs.example/42", title: "engineer", location: "bengaluru" };
    expect(openingContentHash(input)).toBe(openingContentHash(input));
    expect(openingContentHash(input)).not.toBe(openingContentHash({ ...input, title: "designer" }));
  });
});

describe("public company pages", () => {
  it("pages a stable cursor and escapes a search", () => {
    expect(parseCompanyPageLimit(undefined)).toBe(40);
    expect(parseCompanyPageLimit("500")).toBe(80);
    const cursor = {
      active: 1,
      priority: 2,
      openings: 9,
      name: "Acme & Co",
      id: "company-1",
    };
    expect(parseCompanyCursor(companyListCursor(cursor))).toEqual(cursor);
    expect(parseCompanyCursor("not-a-cursor")).toBeNull();
    expect(companyNameLike("100%_")).toBe("%100\\%\\_%");
    expect(companyNameLike("  ")).toBeNull();
    expect(pageSlice([1, 2, 3], 2)).toEqual({ rows: [1, 2], hasMore: true });
    expect(pageSlice([1], 2)).toEqual({ rows: [1], hasMore: false });
  });
});
