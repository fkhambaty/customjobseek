import { describe, expect, it } from "vitest";
import { laneFor, roleFamily, routeFromUrl } from "../shared/engine/classify";
import { computeAnalytics, todayQueues } from "../shared/engine/insights";
import { buildMessages } from "../shared/engine/outreach";
import { emptyProfile, type FitResult, type JobRecord } from "../shared/types";

const fit: FitResult = {
  score: 70,
  decision: "apply",
  matchedRequired: ["SQL", "dbt"],
  matchedOther: ["Airflow"],
  missingRequired: ["Databricks"],
  missingOther: [],
  blockers: [],
  notes: [],
  jdYearsRequired: null,
  parsedSalary: null,
};

function job(over: Partial<JobRecord>): JobRecord {
  return {
    id: crypto.randomUUID(),
    title: "Data Engineer",
    company: "Acme",
    location: "Pune",
    url: "",
    salaryText: "",
    description: "",
    status: "applied",
    fit,
    notes: "",
    nextActionAt: null,
    appliedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    hasResume: true,
    lane: "Pune · above floor",
    searchPathId: null,
    archivedAt: null,
    route: "Greenhouse",
    family: "Data engineering",
    requisition: "",
    payLow: null,
    payHigh: null,
    payEstimated: false,
    postedAt: null,
    rejectedAt: null,
    closedAt: null,
    contactCount: 0,
    messagesSent: 0,
    replies: 0,
    lastTouchAt: null,
    ...over,
  };
}

describe("classify", () => {
  it("puts seniority ahead of function", () => {
    expect(roleFamily("Analytics and Insights Lead - Vice President")).toBe("Leadership");
    expect(roleFamily("Senior Data Engineer")).toBe("Data engineering");
    expect(roleFamily("Business Analytics Manager")).toBe("Analytics & BI");
    expect(roleFamily("Snowflake Solution Architect")).toBe("Solutions & pre-sales");
  });

  it("names the route from the link", () => {
    expect(routeFromUrl("https://job-boards.greenhouse.io/acme/jobs/1")).toBe("Greenhouse");
    expect(routeFromUrl("https://www.phdata.io/jobs?gh_jid=8124479")).toBe("Greenhouse");
    expect(routeFromUrl("https://citi.wd5.myworkdayjobs.com/x/job/1")).toBe("Workday");
    expect(routeFromUrl("https://www.linkedin.com/jobs/view/1")).toBe("LinkedIn");
    expect(routeFromUrl("")).toBe("No link");
  });

  it("builds a lane from place and floor", () => {
    const prefs = { ...emptyProfile().preferences, cities: ["Pune"], currency: "INR", minSalary: 30, salaryPeriod: "lpa" as const };
    expect(laneFor("Pune, India", 3_500_000, 4_500_000, prefs)).toBe("Pune · above floor");
    expect(laneFor("Remote (India)", 2_000_000, 2_400_000, prefs)).toBe("Remote · below floor");
    expect(laneFor("Hyderabad", null, null, prefs)).toBe("Other places");
  });
});

describe("outreach", () => {
  it("keeps the connection note within LinkedIn's limit and quotes a real profile line", () => {
    const profile = {
      ...emptyProfile(),
      fullName: "Asha Rao",
      totalYears: 9,
      experience: [{ id: "e", company: "X", title: "Lead", location: "", start: "", end: "", bullets: [{ id: "b", text: "Moved 40 dbt models onto Airflow with tests on every run." }] }],
    };
    const m = buildMessages(profile, fit, { title: "Senior Analytics Engineer with a very long title for testing", company: "Some Company Private Limited", requisition: "R-1" }, { id: "c", name: "Dave Link", role: "", url: "", email: "" });
    expect(m.connectionNote.length).toBeLessThanOrEqual(200);
    expect(m.connectionNote.startsWith("Hi Dave,")).toBe(true);
    expect(m.firstMessage).toContain("Moved 40 dbt models onto Airflow with tests on every run");
    expect(m.quotedLine).toBe(profile.experience[0]!.bullets[0]!.text);
  });
});

describe("queues and analytics", () => {
  const today = "2026-10-13";
  const jobs = [
    job({ status: "resume_ready", fit: { ...fit, score: 80 } }),
    job({ status: "evaluated", fit: { ...fit, score: 40, decision: "skip" } }),
    job({ status: "applied", appliedAt: "2026-10-05", contactCount: 2, company: "Beta" }),
    job({ status: "applied", appliedAt: "2026-10-06", contactCount: 1, company: "Beta" }),
    job({ status: "applied", appliedAt: "2026-09-25", contactCount: 1, messagesSent: 1, lastTouchAt: "2026-10-01T00:00:00Z", company: "Gamma" }),
    job({ status: "rejected", appliedAt: "2026-09-12", rejectedAt: "2026-09-23", route: "Lever" }),
    job({ status: "interview", appliedAt: "2026-09-12", route: "Lever" }),
    job({ status: "closed", appliedAt: "2026-09-12", closedAt: "2026-10-06" }),
  ];

  it("queues what to do today", () => {
    const q = todayQueues(jobs, today);
    expect(q.applyNext).toHaveLength(1);
    expect(q.messageNow.map((j) => j.company)).toEqual(["Beta"]);
    expect(q.nudge).toHaveLength(1);
    expect(q.live).toHaveLength(1);
  });

  it("keeps an open posting ahead of a closed one and still shows the closed conversation", () => {
    const q = todayQueues([
      job({ id: "closed-interview", status: "interview", liveStatus: "closed", fit: { ...fit, score: 90 } }),
      job({ id: "open-interview", status: "interview", liveStatus: "live", fit: { ...fit, score: 10 } }),
      job({ id: "open-apply", status: "resume_ready", liveStatus: "live", fit: { ...fit, score: 20 } }),
      job({ id: "closed-apply", status: "resume_ready", liveStatus: "closed", fit: { ...fit, score: 99 } }),
    ], today);
    expect(q.live.map((item) => item.id)).toEqual(["open-interview", "closed-interview"]);
    expect(q.applyNext.map((item) => item.id)).toEqual(["open-apply", "closed-apply"]);
  });

  it("measures answers, interviews and time to a no", () => {
    const a = computeAnalytics(jobs, today);
    expect(a.submitted).toBe(6);
    expect(a.answered).toBe(2);
    expect(a.interviews).toBe(1);
    expect(a.medianDaysToRejection).toBe(11);
    expect(a.byRoute.find((r) => r.key === "Lever")?.answered).toBe(2);
    expect(a.skillGaps[0]).toEqual({ label: "databricks", count: 8 });
    expect(a.weeks.reduce((n, w) => n + w.interview + w.rejected + w.closed + w.silent, 0)).toBe(6);
  });

  it("leaves archived jobs in submitted history and out of the open queue and skill gaps", () => {
    const live = job({ id: "live", status: "evaluated", appliedAt: null, fit: { ...fit, missingRequired: ["SQL"] } });
    const archived = job({
      id: "old",
      status: "evaluated",
      archivedAt: "2026-10-01",
      appliedAt: "2026-09-01",
      lane: "Pune · Above ₹30 LPA",
      fit: { ...fit, missingRequired: ["Snowflake"] },
    });
    const a = computeAnalytics([live, archived], today);
    expect(a.openTotal).toBe(1);
    expect(a.submitted).toBe(1);
    expect(a.byLane.map((row) => row.key)).toEqual(["Pune · Above ₹30 LPA"]);
    expect(a.skillGaps.map((gap) => gap.label)).toEqual(["sql"]);
    expect(a.targeting.find((row) => row.key === "Data engineering")?.queued).toBe(1);
  });
});
