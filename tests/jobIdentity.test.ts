import { describe, expect, it } from "vitest";
import { collapseDuplicateJobs, dedupeJobOpenings, jobIdentityKey, sameJobOpening } from "../shared/engine/jobIdentity";

describe("job identity", () => {
  it("treats the same employer and title as one job even when the ATS id changes", () => {
    const a = "https://www.phdata.io/jobs?gh_jid=7907104";
    const b = "https://www.phdata.io/jobs?gh_jid=8083778";
    expect(jobIdentityKey({ title: "AI & Data Strategy Architect", company: "phData", url: a }))
      .toBe(jobIdentityKey({ title: "AI & Data Strategy Architect", company: "phData", url: b }));
    expect(sameJobOpening(
      { title: "AI & Data Strategy Architect", company: "phData", url: a },
      { title: "AI & Data Strategy Architect", company: "phData", url: b },
    )).toBe(true);
  });

  it("collapses duplicate pipeline rows keeping the further-along status", () => {
    const jobs = [
      { id: "a", title: "AI & Data Strategy Architect", company: "phData", url: "https://www.phdata.io/jobs?gh_jid=7907104", status: "resume_ready", createdAt: "2026-10-01" },
      { id: "b", title: "AI & Data Strategy Architect", company: "phData", url: "https://www.phdata.io/jobs?gh_jid=8083778", status: "applied", createdAt: "2026-10-02" },
      { id: "c", title: "Principal Data Engineer", company: "Precision AQ", url: "https://boards.greenhouse.io/x/jobs/2", status: "resume_ready", createdAt: "2026-10-03" },
    ];
    expect(collapseDuplicateJobs(jobs).map((job) => job.id)).toEqual(["b", "c"]);
  });

  it("dedupes openings before packing", () => {
    const rows = dedupeJobOpenings([
      { title: "Dietitian", company: "Noom", url: "https://boards.greenhouse.io/noom/jobs/1" },
      { title: "Dietitian", company: "Noom", url: "https://boards.greenhouse.io/noom/jobs/2" },
    ]);
    expect(rows).toHaveLength(1);
  });
});
