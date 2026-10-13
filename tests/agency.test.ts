import { describe, expect, it } from "vitest";
import {
  agencyOutcomes,
  appOrigin,
  badMatchSupportMessage,
  companyKey,
  decideLifecycle,
  lifecycleClass,
  isoWeekKey,
  lifecycleCopy,
  packageAudit,
  referralIntentAction,
  payProvenanceFor,
  rowEvidence,
  shouldRewardReferral,
  silenceDays,
  sourceFreshness,
} from "../shared/agency";
import type { FitResult, JobRecord } from "../shared/types";

const fit: FitResult = {
  score: 80,
  decision: "apply",
  matchedRequired: ["SQL"],
  matchedOther: [],
  missingRequired: ["dbt"],
  missingOther: [],
  blockers: [],
  notes: [],
  jdYearsRequired: null,
  parsedSalary: null,
};

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    title: "Data Engineer",
    company: "Acme",
    location: "Pune",
    url: "",
    salaryText: "",
    description: "",
    status: "resume_ready",
    fit,
    notes: "",
    nextActionAt: null,
    appliedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    hasResume: true,
    lane: "Pune",
    route: "Greenhouse",
    family: "Data engineering",
    requisition: "",
    payLow: null,
    payHigh: null,
    payEstimated: false,
    postedAt: "2026-10-10",
    rejectedAt: null,
    closedAt: null,
    contactCount: 0,
    messagesSent: 0,
    replies: 0,
    lastTouchAt: null,
    ...over,
  };
}

const now = Date.parse("2026-10-14T12:00:00Z");

describe("row evidence", () => {
  it("shows source freshness, pay provenance, coverage, the pack gate, and outreach readiness", () => {
    expect(payProvenanceFor({ salaryText: "", payEstimated: false, parsed: true })).toBe("posting");
    expect(payProvenanceFor({ salaryText: "30 LPA", payEstimated: false, parsed: false })).toBe("stated");
    expect(payProvenanceFor({ salaryText: "", payEstimated: true, parsed: true })).toBe("estimated");
    expect(companyKey("  Acme   Labs ")).toBe("acme labs");

    const ready = rowEvidence(job({ hasPack: true, salaryText: "30 LPA", payProvenance: "stated" }), "2026-10-14");
    expect(ready.freshness.status).toBe("live");
    expect(ready.freshness.label).toContain("Greenhouse");
    expect(ready.payLabel).toBe("Entered by you");
    expect(ready.coverage).toBe(50);
    expect(ready.packageReady).toBe(true);
    expect(ready.stage).toBe("Ready to send");

    const blocked = rowEvidence(job({
      hasPack: false,
      fit: { ...fit, blockers: [{ kind: "salary", message: "Below your floor" }] },
      status: "applied",
      appliedAt: "2026-10-01",
      contactCount: 1,
      postedAt: "2026-08-01",
      liveStatus: "closed",
    }), "2026-10-14");
    expect(blocked.packageReady).toBe(false);
    expect(blocked.packageGaps).toContain("Application pack missing");
    expect(blocked.blocker).toBe("Below your floor");
    expect(blocked.freshness.status).toBe("closed");
    expect(blocked.outreach).toEqual({ ready: true, note: "Ready to write" });
    expect(blocked.stage).toBe("Applied");

    const round = rowEvidence(job({ status: "interview", interviewStage: "panel", hasPack: true }), "2026-10-14");
    expect(round.stage).toBe("Interviewing · Panel");
    expect(rowEvidence(job({ status: "interview", hasPack: true }), "2026-10-14").stage).toBe("Interviewing");
    expect(sourceFreshness({ liveStatus: "unknown", postedAt: "2026-08-01", sourceCheckedAt: null, route: "Lever", today: "2026-10-14" }).status).toBe("stale");
  });

  it("audits only open roles whose pack is incomplete", () => {
    const gaps = packageAudit([
      job({ id: "ready", hasPack: true }),
      job({ id: "thin", hasResume: false, hasPack: false, title: "Analyst" }),
      job({ id: "done", status: "rejected", hasResume: false, hasPack: false, appliedAt: "2026-09-01" }),
    ], "2026-10-14");
    expect(gaps.map((gap) => gap.id)).toEqual(["thin"]);
    expect(gaps[0]?.gaps).toContain("Resume not built");
  });
});

describe("outcomes", () => {
  const jobs = [
    job({ id: "a", status: "applied", appliedAt: "2026-10-01", route: "Greenhouse", messagesSent: 1, replies: 1, company: "Acme" }),
    job({ id: "b", status: "applied", appliedAt: "2026-10-04", route: "Greenhouse", messagesSent: 1, replies: 0, company: "Beta" }),
    job({ id: "c", status: "interview", appliedAt: "2026-09-01", route: "Lever", messagesSent: 0, replies: 0, company: "Gamma" }),
    job({ id: "d", status: "rejected", appliedAt: "2026-09-01", rejectedAt: "2026-09-12", route: "Lever", company: "Delta" }),
  ];

  it("measures silence age, reply rate, interview rate, rejection latency, and source effectiveness", () => {
    const outcomes = agencyOutcomes(jobs, "2026-10-14");
    expect(outcomes.submitted).toBe(4);
    expect(outcomes.silent).toBe(1);
    expect(outcomes.medianSilenceDays).toBe(10);
    expect(outcomes.replyRate).toBe(0.5);
    expect(outcomes.interviewRate).toBe(0.25);
    expect(outcomes.medianRejectionDays).toBe(11);
    expect(outcomes.sources.map((row) => row.source)).toEqual(["Greenhouse", "Lever"]);
    expect(outcomes.sources[0]).toMatchObject({ sent: 2, replied: 1, interviews: 0 });
    expect(outcomes.sources[1]).toMatchObject({ sent: 2, replied: 0, interviews: 1 });
    expect(silenceDays("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "2026-10-14")).toBeNull();
    expect(silenceDays("2026-10-01T00:00:00Z", null, "2026-10-14")).toBe(13);
  });
});

describe("lifecycle mail", () => {
  const base = {
    transactional: true,
    marketing: true,
    lastSentAt: null,
    lastMarketingAt: null,
    nowMs: now,
    dailyUsed: 0,
    monthlyUsed: 0,
    lifecycleSentToday: 0,
  };

  it("separates transactional and marketing, and stops before the Resend cap", () => {
    expect(decideLifecycle({ ...base, kind: "weekly_priorities", marketing: false })).toEqual({ send: false, reason: "preference" });
    expect(decideLifecycle({ ...base, kind: "scan_complete", transactional: false })).toEqual({ send: false, reason: "preference" });
    expect(decideLifecycle({ ...base, kind: "low_credits", lastSentAt: new Date(now - 2 * 86_400_000).toISOString() })).toEqual({ send: false, reason: "quiet" });
    expect(decideLifecycle({ ...base, kind: "weekly_priorities", lastMarketingAt: new Date(now - 2 * 86_400_000).toISOString() })).toEqual({ send: false, reason: "quiet" });
    expect(decideLifecycle({ ...base, kind: "scan_complete", dailyUsed: 80 })).toEqual({ send: false, reason: "quota" });
    expect(decideLifecycle({ ...base, kind: "scan_complete", monthlyUsed: 2800 })).toEqual({ send: false, reason: "quota" });
    expect(decideLifecycle({ ...base, kind: "scan_complete", dailyUsed: null, monthlyUsed: null, lifecycleSentToday: 15 })).toEqual({ send: false, reason: "quota" });
    expect(decideLifecycle({ ...base, kind: "expiring_entitlement", dailyUsed: 79 }).send).toBe(true);

    const scan = lifecycleCopy("scan_complete", { packs: 3 }, "https://customjobseek.com", "https://customjobseek.com/api/mail/unsubscribe?token=abc");
    expect(scan.subject).toBe("Your scan is ready");
    expect(scan.text).toContain("3 application packs");
    expect(scan.text).not.toContain("unsubscribe");
    expect(scan.text).not.toMatch(/@/);

    const low = lifecycleCopy("low_credits", { evalCredits: 1, resumeCredits: 0 }, "https://customjobseek.com", null);
    expect(low.text).toContain("1 fit checks");
    expect(low.text).toContain("/account");
    expect(low.text).not.toContain("/pricing");
    expect(lifecycleClass("low_credits")).toBe("transactional");

    const weekly = lifecycleCopy("weekly_priorities", { todo: 2, due: 1 }, "https://customjobseek.com", "https://customjobseek.com/api/mail/unsubscribe?token=abc");
    expect(weekly.text).toContain("unsubscribe?token=abc");
    expect(weekly.text).not.toContain("Acme");
    expect(appOrigin("http://evil.example")).toBe("https://customjobseek.com");
    expect(isoWeekKey(Date.parse("2026-10-12T00:00:00Z"))).toBe(isoWeekKey(Date.parse("2026-10-14T00:00:00Z")));
    expect(isoWeekKey(Date.parse("2026-10-12T00:00:00Z"))).not.toBe(isoWeekKey(Date.parse("2026-10-19T00:00:00Z")));
  });
});

describe("referrals and bad matches", () => {
  it("attaches a referral only when the proof covers the saved intent", () => {
    const intent = { code: "a".repeat(16), emailCodeId: 4, createdAt: "2026-10-14T00:00:00.000Z" };
    expect(referralIntentAction(null, { purpose: "signup", codeId: 4 })).toBe("ignore");
    expect(referralIntentAction(intent, { purpose: "signup", codeId: 4 })).toBe("attach");
    expect(referralIntentAction(intent, { purpose: "signup", codeId: 9 })).toBe("clear");
    expect(referralIntentAction({ ...intent, emailCodeId: null }, { purpose: "signup", codeId: 9 })).toBe("attach");
    expect(referralIntentAction({ ...intent, code: "" }, { purpose: "signup", codeId: 4 })).toBe("clear");
    expect(referralIntentAction(intent, { purpose: "reset", issuedAt: "2026-10-14T01:00:00.000Z" })).toBe("attach");
    expect(referralIntentAction(intent, { purpose: "reset", issuedAt: "2026-10-13T01:00:00.000Z" })).toBe("clear");
  });

  it("grants referral credits only after the first verified payment, once", () => {
    const first = { hasReferral: true, alreadyRewarded: false, otherAppliedPayments: 0, paymentApplied: true };
    expect(shouldRewardReferral(first)).toBe(true);
    expect(shouldRewardReferral({ ...first, alreadyRewarded: true })).toBe(false);
    expect(shouldRewardReferral({ ...first, otherAppliedPayments: 1 })).toBe(false);
    expect(shouldRewardReferral({ ...first, paymentApplied: false })).toBe(false);
    expect(shouldRewardReferral({ ...first, hasReferral: false })).toBe(false);
  });

  it("files a bad match as a short support note without a resume", () => {
    const message = badMatchSupportMessage("stale", "1234567890abcdef", "The link 404s.");
    expect(message.length).toBeGreaterThanOrEqual(20);
    expect(message).toContain("Job reference 12345678");
    expect(message).toContain("The link 404s.");
    expect(message.toLowerCase()).not.toContain("resume");
    expect(message).not.toMatch(/@/);
  });
});
