import { describe, expect, it } from "vitest";
import { emptyProfile } from "../shared/types";
import { PLANS } from "../shared/plans";
import {
  ATS_READY,
  OWNER_ALERT_SUBJECTS,
  OWNER_ALERT_WINDOW_MS,
  adapterEnabled,
  complianceFor,
  ANALYTICS_COUNT_COPY,
  entitlementExpiry,
  grantForPaidSku,
  grantForSku,
  isEmail,
  mergePaidPlan,
  newReferralCode,
  shouldRecordAnalytics,
  onboardingMarks,
  ownerAlertSubject,
  parseCookieChoice,
  parseOrderStatus,
  parseSupportTopic,
  ruleFor,
  safeOwnerSummary,
  shouldSendOwnerEmail,
  supportTopicLabel,
  usageColumn,
  utcDay,
  windowStartIso,
  type OwnerAlertKind,
  type RateLimitAction,
} from "../shared/commercial";
import type { Ats } from "../shared/engine/boards";

const ACTIONS: Record<RateLimitAction, true> = {
  auth_ip: true,
  auth_email: true,
  resume_import: true,
  job_fetch: true,
  scan: true,
  checkout: true,
  checkout_recover: true,
  support: true,
  export: true,
  companies_read: true,
};

describe("commercial foundation", () => {
  it("starts a rate window on the boundary", () => {
    const windowMs = 15 * 60_000;
    expect(windowStartIso(Date.parse("2026-10-14T00:14:59.000Z"), windowMs)).toBe("2026-10-14T00:00:00.000Z");
    expect(windowStartIso(Date.parse("2026-10-14T00:15:00.000Z"), windowMs)).toBe("2026-10-14T00:15:00.000Z");
  });

  it("keeps abuse limits small and finite", () => {
    for (const action of Object.keys(ACTIONS) as RateLimitAction[]) {
      const rule = ruleFor(action);
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.limit).toBeLessThanOrEqual(30);
      expect(rule.windowMs).toBeGreaterThan(0);
    }
    expect(ruleFor("auth_ip").windowMs).toBeLessThan(ruleFor("job_fetch").windowMs);
    expect(ruleFor("resume_import")).toEqual({ limit: 8, windowMs: 3_600_000 });
  });

  it("grants paid plans and run packs from the price list", () => {
    expect(grantForPaidSku("growth")).toMatchObject({
      kind: "plan",
      plan: "growth",
      evalCredits: PLANS.growth.evalCredits,
      resumeCredits: PLANS.growth.resumeCredits,
      scanRuns: PLANS.growth.scanRuns,
      validityDays: 180,
      amountInr: 999,
    });
    expect(grantForPaidSku("runs15")).toMatchObject({ kind: "run_pack", evalCredits: 0, resumeCredits: 0, scanRuns: 15, amountInr: 399 });
    expect(grantForSku("free")).toBeNull();
    expect(entitlementExpiry(180, Date.parse("2026-10-14T00:00:00.000Z"))).toBe("2027-04-12T00:00:00.000Z");
    expect(entitlementExpiry(0, Date.now())).toBeNull();
  });

  it("records anonymous counts only when analytics cookies are allowed", () => {
    expect(shouldRecordAnalytics("analytics")).toBe(true);
    expect(shouldRecordAnalytics("essential")).toBe(false);
    expect(shouldRecordAnalytics(null)).toBe(false);
    expect(ANALYTICS_COUNT_COPY).not.toMatch(/user id|until a later release|not sent to Cloudflare yet/i);
    expect(ANALYTICS_COUNT_COPY).toMatch(/not tied to an account/);
  });

  it("keeps a higher plan and a later expiry when a cheaper plan is bought", () => {
    expect(mergePaidPlan({
      currentPlan: "pro",
      currentExpiry: "2027-08-01T00:00:00.000Z",
      kind: "plan",
      nextPlan: "starter",
      nextExpiry: "2027-04-12T00:00:00.000Z",
    })).toEqual({ plan: "pro", creditsExpireAt: "2027-08-01T00:00:00.000Z" });
    expect(mergePaidPlan({
      currentPlan: "starter",
      currentExpiry: "2026-11-01T00:00:00.000Z",
      kind: "plan",
      nextPlan: "growth",
      nextExpiry: "2027-04-12T00:00:00.000Z",
    })).toEqual({ plan: "growth", creditsExpireAt: "2027-04-12T00:00:00.000Z" });
    expect(mergePaidPlan({
      currentPlan: "pro",
      currentExpiry: "2027-08-01T00:00:00.000Z",
      kind: "run_pack",
      nextPlan: null,
      nextExpiry: null,
    })).toEqual({ plan: "pro", creditsExpireAt: "2027-08-01T00:00:00.000Z" });
    expect(ruleFor("companies_read")).toEqual({ limit: 30, windowMs: 60_000 });
  });

  it("scrubs owner notes without eating a reference id", () => {
    expect(safeOwnerSummary("User ada@example.com used code 123456")).toBe("User [email] used code [code]");
    expect(safeOwnerSummary("bearer rzp_live_abcdefghijklmnop")).toContain("[secret]");
    expect(safeOwnerSummary("Reference 7c9e6679-7425-40de-944b-e07fc1f90ae7")).toContain("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(safeOwnerSummary("   ")).toBe("Notice");
    for (const kind of Object.keys(OWNER_ALERT_SUBJECTS) as OwnerAlertKind[]) {
      const subject = ownerAlertSubject(kind);
      expect(subject).not.toMatch(/@/);
      expect(subject.toLowerCase()).not.toContain("password");
    }
  });

  it("emails the owner again only after the quiet period", () => {
    const now = Date.parse("2026-10-14T12:00:00.000Z");
    expect(shouldSendOwnerEmail(null, now, OWNER_ALERT_WINDOW_MS)).toBe(true);
    expect(shouldSendOwnerEmail("2026-10-14T11:00:00.000Z", now, OWNER_ALERT_WINDOW_MS)).toBe(false);
    expect(shouldSendOwnerEmail("2026-10-14T05:59:59.000Z", now, OWNER_ALERT_WINDOW_MS)).toBe(true);
    expect(shouldSendOwnerEmail("not-a-date", now, OWNER_ALERT_WINDOW_MS)).toBe(true);
  });

  it("accepts only known support topics, cookies, and order states", () => {
    expect(parseSupportTopic("billing")).toBe("billing");
    expect(supportTopicLabel("billing")).toBe("Plans and payments");
    expect(parseSupportTopic("password")).toBeNull();
    expect(parseCookieChoice("essential")).toBe("essential");
    expect(parseCookieChoice("advertising")).toBeNull();
    expect(parseOrderStatus("paid")).toBe("paid");
    expect(parseOrderStatus("stolen")).toBeNull();
    expect(isEmail("ada@example.com")).toBe(true);
    expect(isEmail("not an email")).toBe(false);
  });

  it("makes a 16 character referral code and marks onboarding from the profile", () => {
    expect(newReferralCode()).toMatch(/^[a-f0-9]{16}$/);
    expect(onboardingMarks(emptyProfile("a@b.co"))).toEqual([]);
    const profile = emptyProfile("a@b.co");
    profile.fullName = "Ada Lovelace";
    profile.experience = [{ id: "1", company: "Analytical", title: "Engineer", location: "", start: "1842", end: "", bullets: [] }];
    profile.preferences.targetRoles = ["Engineer"];
    expect(onboardingMarks(profile)).toEqual(["profile", "preferences"]);
    expect(usageColumn("imports")).toBe("imports");
    expect(utcDay(Date.parse("2026-10-14T23:30:00.000Z"))).toBe("2026-10-14");
  });

  it("describes every job-board reader without crawling ordinary websites", () => {
    const names = Object.keys(ATS_READY) as Ats[];
    expect(names).toContain("greenhouse");
    expect(complianceFor("greenhouse")).toBe("public_api");
    expect(complianceFor("workday")).toBe("public_site");
    expect(complianceFor("website")).toBe("not_crawled");
    expect(adapterEnabled("website")).toBe(false);
    expect(adapterEnabled("lever")).toBe(true);
  });
});
