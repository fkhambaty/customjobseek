import { describe, expect, it } from "vitest";
import { collapseDuplicateJobs, dedupeJobOpenings, jobIdentityKey, sameJobOpening } from "../shared/engine/jobIdentity";

describe("job identity", () => {
  it("treats tracking params as the same URL", () => {
    const a = "https://boards.greenhouse.io/phdata/jobs/123?gh_src=xyz";
    const b = "https://boards.greenhouse.io/phdata/jobs/123";
    expect(jobIdentityKey({ title: "AI Architect", company: "phData", url: a }))
      .toBe(jobIdentityKey({ title: "AI Architect", company: "phData", url: b }));
    expect(sameJobOpening(
      { title: "AI & Data Strategy Architect", company: "phData", url: a },
      { title: "AI & Data Strategy Architect", company: "phData", url: b },
    )).toBe(true);
  });

  it("collapses duplicate pipeline rows keeping the further-along status", () => {
    const jobs = [
      { id: "a", title: "AI & Data Strategy Architect", company: "phData", url: "https://boards.greenhouse.io/phdata/jobs/1", status: "resume_ready", createdAt: "2026-10-01" },
      { id: "b", title: "AI & Data Strategy Architect", company: "phData", url: "https://boards.greenhouse.io/phdata/jobs/1?utm_source=x", status: "applied", createdAt: "2026-10-02" },
      { id: "c", title: "Principal Data Engineer", company: "Precision AQ", url: "https://boards.greenhouse.io/x/jobs/2", status: "resume_ready", createdAt: "2026-10-03" },
    ];
    expect(collapseDuplicateJobs(jobs).map((job) => job.id)).toEqual(["b", "c"]);
  });

  it("dedupes openings before packing", () => {
    const rows = dedupeJobOpenings([
      { title: "Dietitian", company: "Noom", url: "https://boards.greenhouse.io/noom/jobs/1" },
      { title: "Dietitian", company: "Noom", url: "https://boards.greenhouse.io/noom/jobs/1?ref=1" },
    ]);
    expect(rows).toHaveLength(1);
  });
});
