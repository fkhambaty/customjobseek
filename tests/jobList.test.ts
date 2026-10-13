import { describe, expect, it } from "vitest";
import { JOB_LIST_CAP, jobListCapNotice, parseJobListResponse } from "../src/jobList";
import type { JobRecord } from "../shared/types";

function row(id: string): JobRecord {
  return { id } as JobRecord;
}

describe("job list pages", () => {
  it("rejects an old array and an unreadable page", () => {
    expect(() => parseJobListResponse([{ id: "job-1" }])).toThrow(/old format/);
    expect(() => parseJobListResponse(null)).toThrow(/could not be read/);
    expect(() => parseJobListResponse({ jobs: "nope" })).toThrow(/could not be read/);
    expect(() => parseJobListResponse({ jobs: [{ title: "Analyst" }], nextCursor: null })).toThrow(/could not be read/);
    expect(() => parseJobListResponse({ jobs: [], nextCursor: 12 })).toThrow(/could not be read/);
  });

  it("reads the current page and warns at the 4000 cap only when more remain", () => {
    expect(parseJobListResponse({ jobs: [row("job-1")], nextCursor: "2026-10-14|job-1" })).toEqual({
      jobs: [row("job-1")],
      nextCursor: "2026-10-14|job-1",
    });
    expect(parseJobListResponse({ jobs: [] })).toEqual({ jobs: [], nextCursor: null });
    expect(jobListCapNotice(JOB_LIST_CAP, true)).toContain("4,000");
    expect(jobListCapNotice(JOB_LIST_CAP, false)).toBe("");
    expect(jobListCapNotice(40, true)).toBe("");
  });
});
