import { describe, expect, it } from "vitest";
import {
  contactOutreachState,
  outreachProspect,
  sortByOutreachProspect,
  templateLabel,
} from "../shared/engine/outreachIntel";
import type { FitResult, JobEvent, JobRecord } from "../shared/types";

const fit: FitResult = {
  score: 72,
  decision: "apply",
  matchedRequired: ["SQL"],
  matchedOther: [],
  missingRequired: [],
  missingOther: [],
  blockers: [],
  notes: [],
  jdYearsRequired: null,
  parsedSalary: null,
};

function event(partial: Partial<JobEvent> & Pick<JobEvent, "kind" | "person">): JobEvent {
  return {
    id: partial.id ?? crypto.randomUUID(),
    jobId: "job",
    kind: partial.kind,
    status: "",
    channel: partial.channel ?? "linkedin",
    at: partial.at ?? "2026-10-16T10:00:00.000Z",
    person: partial.person,
    note: partial.note ?? "",
    template: partial.template ?? "",
  };
}

function job(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: crypto.randomUUID(),
    title: "Data Engineer",
    company: "Acme",
    location: "Remote",
    url: "",
    salaryText: "",
    description: "",
    status: "applied",
    fit,
    notes: "",
    nextActionAt: null,
    appliedAt: "2026-10-15",
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    hasResume: true,
    lane: "Remote",
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
    contactCount: 1,
    messagesSent: 0,
    replies: 0,
    lastTouchAt: null,
    liveStatus: "unknown",
    sourceCheckedAt: null,
    payProvenance: "",
    interviewStage: "",
    hasPack: true,
    ...partial,
  };
}

describe("outreach intelligence", () => {
  it("tracks which draft was sent and what to do next", () => {
    const state = contactOutreachState(
      [event({ kind: "message", person: "Tejaswi Bidkar", template: "connection", at: "2026-10-16T08:00:00.000Z" })],
      "Tejaswi Bidkar",
      "2026-10-16",
    );
    expect(state.status).toBe("in_flight");
    expect(state.sent.connection?.template).toBe("connection");
    expect(state.nextTemplate).toBe("first");
    expect(state.statusNote.toLowerCase()).toContain("connection");
  });

  it("marks a reply against the draft they answered", () => {
    const state = contactOutreachState(
      [
        event({ kind: "message", person: "Tejaswi", template: "first", at: "2026-10-14T08:00:00.000Z" }),
        event({ kind: "reply", person: "Tejaswi", template: "first", at: "2026-10-16T09:00:00.000Z" }),
      ],
      "Tejaswi",
      "2026-10-16",
    );
    expect(state.status).toBe("replied");
    expect(state.statusNote.toLowerCase()).toContain("first message");
  });

  it("waits before offering a nudge", () => {
    const state = contactOutreachState(
      [
        event({ kind: "message", person: "A", template: "connection", at: "2026-10-14T08:00:00.000Z" }),
        event({ kind: "message", person: "A", template: "first", at: "2026-10-14T08:05:00.000Z" }),
        event({ kind: "message", person: "A", template: "email", at: "2026-10-14T08:10:00.000Z" }),
      ],
      "A",
      "2026-10-16",
    );
    expect(state.status).toBe("waiting");
    expect(state.nextTemplate).toBeNull();
  });

  it("ranks fresher high-fit applications ahead of cold ones", () => {
    const hot = job({
      id: "hot",
      company: "A",
      appliedAt: "2026-10-16",
      fit: { ...fit, score: 80 },
      payLow: 4_000_000,
      payHigh: 5_000_000,
      liveStatus: "live",
    });
    const cold = job({
      id: "cold",
      company: "B",
      appliedAt: "2026-09-20",
      fit: { ...fit, score: 55, decision: "stretch" },
    });
    const waiting = job({
      id: "wait",
      company: "C",
      appliedAt: "2026-10-01",
      messagesSent: 1,
      lastTouchAt: "2026-10-15T00:00:00Z",
    });
    expect(outreachProspect(hot, "2026-10-16").score).toBeGreaterThan(outreachProspect(cold, "2026-10-16").score);
    expect(sortByOutreachProspect([cold, waiting, hot], "2026-10-16").map((row) => row.id)).toEqual(["hot", "cold", "wait"]);
  });

  it("labels templates for the UI", () => {
    expect(templateLabel("nudge")).toBe("Nudge");
  });
});
