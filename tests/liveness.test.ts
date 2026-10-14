import { describe, expect, it } from "vitest";
import {
  classifyHttpStatus,
  closureConfirmed,
  closureEffect,
  explicitClosedText,
  interpretProbe,
  judgeProbe,
  livenessProbe,
  PIPELINE_CHECKS_PER_SCAN,
  pipelineCheckDue,
  pipelineCountLabel,
  postingClosedCopy,
  readBoundedText,
  scriptUnreadable,
  selectDuePipelineJobs,
  type PipelineCandidate,
} from "../shared/engine/liveness";
import type { JobStatus } from "../shared/types";

const now = Date.parse("2026-10-14T12:00:00.000Z");

function candidate(over: Partial<PipelineCandidate> & Pick<PipelineCandidate, "id" | "url" | "status">): PipelineCandidate {
  return { sourceCheckedAt: null, ...over };
}

describe("liveness signals", () => {
  it("closes only on 404, 410, or an explicit phrase from a successful read", () => {
    expect(classifyHttpStatus(404)).toBe("closed");
    expect(classifyHttpStatus(410)).toBe("closed");
    expect(interpretProbe({ httpStatus: 404, body: "", contentType: "text/html", failure: null })).toBe("closed");
    expect(interpretProbe({ httpStatus: 410, body: "gone", contentType: "text/html", failure: null })).toBe("closed");
    expect(explicitClosedText("This position is no longer available.")).toBe(true);
    expect(explicitClosedText("This job has been filled.")).toBe(true);
    expect(explicitClosedText("We closed the quarter strongly.")).toBe(false);
    expect(interpretProbe({
      httpStatus: 200,
      body: "<html><body><p>This position is no longer available.</p></body></html>",
      contentType: "text/html",
      failure: null,
    })).toBe("closed");
    expect(interpretProbe({
      httpStatus: 200,
      body: JSON.stringify({ offer: { title: "Engineer", closed_at: "2026-10-01" } }),
      contentType: "application/json",
      failure: null,
      nowMs: now,
    })).toBe("closed");
    expect(interpretProbe({
      httpStatus: 200,
      body: JSON.stringify({ id: "1", name: "Engineer", active: false }),
      contentType: "application/json",
      failure: null,
    })).toBe("closed");
    expect(interpretProbe({
      httpStatus: 200,
      body: JSON.stringify({ id: 9, title: "Engineer" }),
      contentType: "application/json",
      failure: null,
    })).toBe("live");
  });

  it("keeps 403, 429, 5xx, timeouts, and script shells from auto-closing", () => {
    for (const status of [403, 429, 500, 503]) {
      expect(interpretProbe({
        httpStatus: status,
        body: "This position is no longer available.",
        contentType: "text/html",
        failure: null,
      })).toBe("unknown");
    }
    expect(interpretProbe({ httpStatus: null, body: "", contentType: "", failure: "timeout" })).toBe("unknown");
    expect(interpretProbe({ httpStatus: null, body: "", contentType: "", failure: "network" })).toBe("unknown");
    const shell = `<html><body><div id="root"></div><script>this job is no longer available</script></body></html>`;
    expect(scriptUnreadable(shell)).toBe(true);
    expect(interpretProbe({ httpStatus: 200, body: shell, contentType: "text/html", failure: null })).toBe("stale");
    const readable = `<html><body><p>${"Build data models for the finance team. ".repeat(12)}</p></body></html>`;
    expect(interpretProbe({ httpStatus: 200, body: readable, contentType: "text/html", failure: null })).toBe("live");
  });

  it("uses the stable per-job API and skips protected boards", () => {
    expect(livenessProbe("https://boards.greenhouse.io/acme/jobs/123")).toEqual({
      url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
      accept: "application/json",
      source: "greenhouse",
    });
    expect(livenessProbe("https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555")?.source).toBe("lever");
    expect(livenessProbe("https://jobs.smartrecruiters.com/Acme/744000145796757-title")?.url).toBe(
      "https://api.smartrecruiters.com/v1/companies/Acme/postings/744000145796757",
    );
    expect(livenessProbe("https://acme.recruitee.com/o/senior-engineer")?.source).toBe("recruitee");
    expect(livenessProbe("https://www.linkedin.com/jobs/view/1")).toBeNull();
    expect(livenessProbe("https://in.indeed.com/viewjob?jk=1")).toBeNull();
    expect(livenessProbe("https://www.naukri.com/job-listings-1")).toBeNull();
    expect(livenessProbe("http://127.0.0.1/jobs/1")).toBeNull();
    expect(livenessProbe("https://jobs.ashbyhq.com/acme/abc")?.source).toBe("page");
  });

  it("closes an unevaluated application and only flags a live interview", () => {
    expect(closureEffect("evaluated", "closed")).toBe("close_workflow");
    expect(closureEffect("resume_ready", "closed")).toBe("close_workflow");
    expect(closureEffect("interview", "closed")).toBe("flag_posting");
    expect(closureEffect("applied", "closed")).toBe("flag_posting");
    expect(closureEffect("offer", "closed")).toBe("flag_posting");
    expect(closureEffect("interview", "unknown")).toBe("none");
    expect(closureEffect("rejected", "closed")).toBe("none");
    expect(postingClosedCopy("interview")).toContain("stays active");
    expect(postingClosedCopy("closed")).toContain("marked closed");
    expect(pipelineCountLabel(1, 1)).toBe("1 pipeline link checked · 1 posting closed");
    expect(pipelineCountLabel(0, 2)).toBe("0 pipeline links checked · 2 postings closed");
  });

  it("rotates the oldest due links and stops at the scan bound", () => {
    const jobs: PipelineCandidate[] = [
      candidate({ id: "fresh", url: "https://boards.greenhouse.io/acme/jobs/1", status: "evaluated", sourceCheckedAt: "2026-10-14T10:00:00.000Z" }),
      candidate({ id: "old", url: "https://jobs.lever.co/acme/abc", status: "resume_ready", sourceCheckedAt: "2026-10-01T00:00:00.000Z" }),
      candidate({ id: "never", url: "https://careers.example.com/jobs/2", status: "applied" }),
      candidate({ id: "board", url: "https://www.linkedin.com/jobs/view/9", status: "interview" }),
      candidate({ id: "done", url: "https://boards.greenhouse.io/acme/jobs/3", status: "rejected" as JobStatus }),
      candidate({ id: "blank", url: "  ", status: "offer" }),
    ];
    for (let n = 0; n < 3; n += 1) {
      jobs.push(candidate({ id: `extra-${n}`, url: `https://boards.greenhouse.io/acme/jobs/${200 + n}`, status: "evaluated" }));
    }
    const selected = selectDuePipelineJobs(jobs, now);
    expect(selected.map((job) => job.id)).toEqual(["extra-0", "extra-1", "extra-2", "never", "old"]);
    expect(selected).toHaveLength(5);
    expect(selected.length).toBeLessThanOrEqual(PIPELINE_CHECKS_PER_SCAN);
    const crowded = selectDuePipelineJobs(
      Array.from({ length: PIPELINE_CHECKS_PER_SCAN + 4 }, (_, index) => candidate({
        id: `crowd-${index}`,
        url: `https://boards.greenhouse.io/acme/jobs/${400 + index}`,
        status: "evaluated",
      })),
      now,
    );
    expect(crowded).toHaveLength(PIPELINE_CHECKS_PER_SCAN);
    expect(pipelineCheckDue("2026-10-14T10:00:00.000Z", now)).toBe(false);
    expect(pipelineCheckDue(null, now)).toBe(true);
  });

  it("leaves sponsorship, remote wording, and a future close date open", () => {
    expect(explicitClosedText("This position is no longer available.")).toBe(true);
    expect(explicitClosedText("Visa sponsorship is no longer available for this role.")).toBe(false);
    expect(explicitClosedText("This role does not offer visa sponsorship.")).toBe(false);
    expect(explicitClosedText("This job is no longer remote.")).toBe(false);
    expect(explicitClosedText("This position is no longer a remote role.")).toBe(false);
    const buried = `${"We are hiring a nurse for a hospital ward. ".repeat(8)} This position is no longer available.`;
    expect(explicitClosedText(buried)).toBe(false);
    expect(interpretProbe({
      httpStatus: 200,
      body: `<html><body><h1>This job is no longer remote.</h1><p>${"Build data models for the finance team. ".repeat(12)}</p></body></html>`,
      contentType: "text/html",
      failure: null,
    })).toBe("live");
    expect(interpretProbe({
      httpStatus: 200,
      body: JSON.stringify({ offer: { title: "Engineer", close_at: "2026-12-01" } }),
      contentType: "application/json",
      failure: null,
      nowMs: now,
    })).toBe("live");
    expect(interpretProbe({
      httpStatus: 200,
      body: JSON.stringify({ offer: { closed_at: "2026-12-01" } }),
      contentType: "application/json",
      failure: null,
      nowMs: now,
    })).toBe("live");
  });

  it("treats a generic 404 as one page signal and an ATS API 404 as exact", () => {
    const missing = { httpStatus: 404, body: "missing", contentType: "text/html", failure: null };
    expect(judgeProbe(missing, "page")).toEqual({ status: "closed", strength: "page" });
    expect(judgeProbe(missing, "greenhouse")).toEqual({ status: "closed", strength: "exact" });
    expect(closureConfirmed(0, "page")).toBe(false);
    expect(closureConfirmed(1, "page")).toBe(true);
    expect(closureConfirmed(0, "exact")).toBe(true);
    expect(closureConfirmed(0, "none")).toBe(false);
    const jobs: PipelineCandidate[] = [
      candidate({ id: "auto", url: "https://boards.greenhouse.io/acme/jobs/1", status: "closed", autoClosedFrom: "evaluated" }),
      candidate({ id: "manual", url: "https://boards.greenhouse.io/acme/jobs/2", status: "closed" }),
    ];
    expect(selectDuePipelineJobs(jobs, now).map((job) => job.id)).toEqual(["auto"]);
  });

  it("reads only the capped prefix of a liveness body and cancels the rest", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(80_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const text = await readBoundedText(stream, 100);
    expect(text).toHaveLength(100);
    expect(cancelled).toBe(true);
    await expect(readBoundedText(null, 100)).resolves.toBe("");
  });
});
