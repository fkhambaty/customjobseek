import { describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { freshPlatformProxy } from "./localDb";
import { PIPELINE_CHECKS_PER_SCAN, PIPELINE_RECHECK_MS } from "../shared/engine/liveness";
import type { Env } from "../worker/env";
import { processScan } from "../worker/autoScan";
import { applyPipelineOutcome, checkDuePipeline } from "../worker/pipelineLiveness";

async function withUser(run: (userId: string, db: D1Database, env: Env) => Promise<void>): Promise<void> {
  const proxy = await freshPlatformProxy();
  const db = proxy.env.DB as D1Database;
  const env = proxy.env as unknown as Env;
  const userId = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO users (id, email, password_hash, eval_credits, resume_credits, scan_runs) VALUES (?, ?, 'x', 3, 3, 2)")
      .bind(userId, `${userId}@example.com`)
      .run();
    await run(userId, db, env);
  } finally {
    vi.unstubAllGlobals();
    await db.prepare("DELETE FROM job_events WHERE user_id = ?").bind(userId).run();
    await db.prepare("DELETE FROM scan_runs_log WHERE user_id = ?").bind(userId).run();
    await db.prepare("DELETE FROM market_scans WHERE user_id = ?").bind(userId).run();
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    await proxy.dispose();
  }
}

async function insertJob(db: D1Database, userId: string, id: string, url: string, status: string): Promise<void> {
  await db.prepare(
    "INSERT INTO jobs (id, user_id, title, company, url, description, status, fit_json) VALUES (?, ?, 'Role', 'Acme', ?, 'A role worth reading.', ?, '{}')",
  ).bind(id, userId, url, status).run();
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    return Promise.resolve(handler(url));
  });
  return seen;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

describe("pipeline liveness service", () => {
  it("closes an unevaluated job, keeps an interview, and ignores transient responses", async () => {
    await withUser(async (userId, db, env) => {
      const evaluated = `${userId}-evaluated`;
      const ready = `${userId}-ready`;
      const interview = `${userId}-interview`;
      const limited = `${userId}-limited`;
      const down = `${userId}-down`;
      const slow = `${userId}-slow`;
      const shell = `${userId}-shell`;
      await insertJob(db, userId, evaluated, "https://boards.greenhouse.io/acme/jobs/404111", "evaluated");
      await insertJob(db, userId, ready, "https://boards.greenhouse.io/acme/jobs/410222", "resume_ready");
      await insertJob(db, userId, interview, "https://jobs.lever.co/acme/interview-role", "interview");
      await insertJob(db, userId, limited, "https://boards.greenhouse.io/acme/jobs/429333", "evaluated");
      await insertJob(db, userId, down, "https://boards.greenhouse.io/acme/jobs/503444", "resume_ready");
      await insertJob(db, userId, slow, "https://careers.example.com/jobs/slow", "evaluated");
      await insertJob(db, userId, shell, "https://careers.example.com/jobs/shell", "evaluated");

      stubFetch((url) => {
        if (url.includes("/jobs/404111")) return html("missing", 404);
        if (url.includes("/jobs/410222")) return html("gone", 410);
        if (url.includes("/postings/acme/interview-role")) {
          return new Response(JSON.stringify({ id: "interview-role", text: "Role", state: "closed" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/jobs/429333")) return html("This position is no longer available.", 429);
        if (url.includes("/jobs/503444")) return html("down", 503);
        if (url.includes("/jobs/slow")) {
          const error = new Error("The operation was aborted due to timeout");
          error.name = "TimeoutError";
          throw error;
        }
        if (url.includes("/jobs/shell")) {
          return html(`<html><body><div id="root"></div><script>this job is no longer available</script></body></html>`);
        }
        return html(JSON.stringify({ id: 1, title: "Open role" }), 200);
      });

      const counts = await checkDuePipeline(env, userId);
      expect(counts.checked).toBe(PIPELINE_CHECKS_PER_SCAN);
      expect(counts.closed).toBe(2);

      const evaluatedRow = await db.prepare("SELECT status, live_status, closed_at, source_checked_at FROM jobs WHERE id = ?")
        .bind(evaluated).first<{ status: string; live_status: string; closed_at: string | null; source_checked_at: string | null }>();
      expect(evaluatedRow).toMatchObject({ status: "closed", live_status: "closed" });
      expect(evaluatedRow?.closed_at).toBeTruthy();
      expect(evaluatedRow?.source_checked_at).toBeTruthy();
      const events = await db.prepare("SELECT status FROM job_events WHERE job_id = ? AND kind = 'status'").bind(evaluated).all<{ status: string }>();
      expect(events.results.map((row) => row.status)).toEqual(["closed"]);

      const readyRow = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(ready).first<{ status: string; live_status: string }>();
      expect(readyRow).toEqual({ status: "closed", live_status: "closed" });

      const interviewRow = await db.prepare("SELECT status, live_status, closed_at FROM jobs WHERE id = ?")
        .bind(interview).first<{ status: string; live_status: string; closed_at: string | null }>();
      expect(interviewRow).toEqual({ status: "interview", live_status: "closed", closed_at: null });
      const interviewEvents = await db.prepare("SELECT id FROM job_events WHERE job_id = ?").bind(interview).all();
      expect(interviewEvents.results).toHaveLength(0);

      const limitedRow = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(limited).first<{ status: string; live_status: string }>();
      expect(limitedRow).toEqual({ status: "evaluated", live_status: "unknown" });
      const downRow = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(down).first<{ status: string; live_status: string }>();
      expect(downRow).toEqual({ status: "resume_ready", live_status: "unknown" });
      const slowRow = await db.prepare("SELECT status, live_status, source_checked_at FROM jobs WHERE id = ?")
        .bind(slow).first<{ status: string; live_status: string; source_checked_at: string | null }>();
      expect(slowRow).toEqual({ status: "evaluated", live_status: "unknown", source_checked_at: null });
      const shellRow = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(shell).first<{ status: string; live_status: string }>();
      expect(shellRow).toEqual({ status: "evaluated", live_status: "stale" });

      await applyPipelineOutcome(
        db,
        userId,
        { id: evaluated, status: "evaluated", closureStreak: 1, autoClosedFrom: null },
        { status: "closed", strength: "exact" },
        "2026-10-14T12:00:00.000Z",
      );
      const again = await db.prepare("SELECT COUNT(*) AS n FROM job_events WHERE job_id = ? AND kind = 'status'").bind(evaluated).first<{ n: number }>();
      expect(again?.n).toBe(1);
      const stillClosed = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(evaluated).first<{ status: string }>();
      expect(stillClosed?.status).toBe("closed");
    });
  });

  it("checks a bounded rotating slice and never requests a protected board", async () => {
    await withUser(async (userId, db, env) => {
      await insertJob(db, userId, `${userId}-board`, "https://www.linkedin.com/jobs/view/99", "evaluated");
      await insertJob(db, userId, `${userId}-final`, "https://boards.greenhouse.io/acme/jobs/999001", "rejected");
      const ids = Array.from({ length: 10 }, (_, index) => `${userId}-job-${index}`);
      for (let index = 0; index < ids.length; index += 1) {
        await insertJob(db, userId, ids[index]!, `https://boards.greenhouse.io/acme/jobs/${3000 + index}`, "evaluated");
      }
      const seen = stubFetch(() => new Response(JSON.stringify({ id: 1, title: "Open role" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      const first = await checkDuePipeline(env, userId);
      expect(first).toEqual({ checked: PIPELINE_CHECKS_PER_SCAN, closed: 0 });
      expect(seen.some((url) => url.includes("linkedin.com"))).toBe(false);
      expect(seen.some((url) => url.includes("999001"))).toBe(false);
      expect(seen).toHaveLength(PIPELINE_CHECKS_PER_SCAN);
      const board = await db.prepare("SELECT live_status, source_checked_at FROM jobs WHERE id = ?")
        .bind(`${userId}-board`).first<{ live_status: string; source_checked_at: string | null }>();
      expect(board?.live_status).toBe("unknown");
      expect(board?.source_checked_at).toBeTruthy();

      const checked = await db.prepare("SELECT id FROM jobs WHERE user_id = ? AND live_status = 'live' ORDER BY id")
        .bind(userId).all<{ id: string }>();
      expect(checked.results.map((row) => row.id)).toEqual(ids.slice(0, PIPELINE_CHECKS_PER_SCAN));

      const firstSeen = [...seen];
      seen.length = 0;
      const second = await checkDuePipeline(env, userId);
      expect(second.checked).toBe(10 - PIPELINE_CHECKS_PER_SCAN);
      expect(seen).toHaveLength(10 - PIPELINE_CHECKS_PER_SCAN);
      expect(seen.every((url) => !firstSeen.includes(url))).toBe(true);
      expect(seen.every((url) => /\/jobs\/300[6-9]$/.test(url))).toBe(true);
      const allChecked = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND live_status = 'live'")
        .bind(userId).first<{ n: number }>();
      expect(allChecked?.n).toBe(10);
    });
  });

  it("records pipeline counts when a market scan prepares nothing", async () => {
    await withUser(async (userId, db, env) => {
      const scanId = crypto.randomUUID();
      const jobId = `${userId}-empty`;
      await insertJob(db, userId, jobId, "https://boards.greenhouse.io/acme/jobs/404900", "resume_ready");
      await db.prepare(
        "INSERT INTO market_scans (id, user_id, trigger, status, stage, estimated_seconds) VALUES (?, ?, 'scheduled', 'processing', 'searching', 120)",
      ).bind(scanId, userId).run();
      stubFetch((url) => (url.includes("404900") ? html("missing", 404) : html("ok", 200)));
      const now = new Date().toISOString();
      await processScan(env, {
        id: scanId,
        user_id: userId,
        trigger: "scheduled",
        status: "processing",
        stage: "searching",
        queued_at: now,
        started_at: now,
        updated_at: now,
        completed_at: null,
        estimated_seconds: 120,
        candidate_count: 0,
        checked_count: 0,
        handpicked_count: 0,
        charged: 0,
        result_job_ids: "[]",
        error: "",
        pipeline_checked: 0,
        pipeline_closed: 0,
      });
      const scan = await db.prepare("SELECT status, charged, pipeline_checked, pipeline_closed, note FROM market_scans WHERE id = ?")
        .bind(scanId).first<{ status: string; charged: number; pipeline_checked: number; pipeline_closed: number; note: string }>();
      expect(scan).toMatchObject({ status: "complete", charged: 0, pipeline_checked: 1, pipeline_closed: 1 });
      expect(scan?.note).toContain("Nothing was charged");
      const log = await db.prepare("SELECT prepared_count, charged, pipeline_checked, pipeline_closed FROM scan_runs_log WHERE market_scan_id = ?")
        .bind(scanId).first<{ prepared_count: number; charged: number; pipeline_checked: number; pipeline_closed: number }>();
      expect(log).toEqual({ prepared_count: 0, charged: 0, pipeline_checked: 1, pipeline_closed: 1 });
      const job = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(jobId).first<{ status: string; live_status: string }>();
      expect(job).toEqual({ status: "closed", live_status: "closed" });

      await db.prepare("UPDATE market_scans SET status = 'processing', stage = 'searching', completed_at = NULL WHERE id = ?").bind(scanId).run();
      await processScan(env, {
        id: scanId,
        user_id: userId,
        trigger: "scheduled",
        status: "processing",
        stage: "searching",
        queued_at: now,
        started_at: now,
        updated_at: now,
        completed_at: null,
        estimated_seconds: 120,
        candidate_count: 0,
        checked_count: 0,
        handpicked_count: 0,
        charged: 0,
        result_job_ids: "[]",
        error: "",
        pipeline_checked: 1,
        pipeline_closed: 1,
      });
      const events = await db.prepare("SELECT COUNT(*) AS n FROM job_events WHERE job_id = ?").bind(jobId).first<{ n: number }>();
      expect(events?.n).toBe(1);
      const totals = await db.prepare("SELECT pipeline_checked, pipeline_closed FROM market_scans WHERE id = ?")
        .bind(scanId).first<{ pipeline_checked: number; pipeline_closed: number }>();
      expect(totals).toEqual({ pipeline_checked: 1, pipeline_closed: 1 });
    });
  });

  it("needs two generic misses, ignores a transient 404, and restores an auto-closed job", async () => {
    await withUser(async (userId, db, env) => {
      const strike = `${userId}-strike`;
      const transient = `${userId}-transient`;
      const restored = `${userId}-restored`;
      const offer = `${userId}-offer`;
      await insertJob(db, userId, strike, "https://careers.example.com/jobs/strike", "evaluated");
      await insertJob(db, userId, transient, "https://jobs.ashbyhq.com/acme/transient", "resume_ready");
      await insertJob(db, userId, restored, "https://boards.greenhouse.io/acme/jobs/505", "closed");
      await insertJob(db, userId, offer, "https://boards.greenhouse.io/acme/jobs/606", "offer");
      await db.prepare(
        "UPDATE jobs SET closed_at = '2026-10-01', auto_closed_from = 'evaluated', live_status = 'closed', streak = 2 WHERE id = ?",
      ).bind(restored).run();

      let transientHits = 0;
      stubFetch((url) => {
        if (url.includes("/jobs/strike")) return html("missing", 404);
        if (url.includes("transient")) {
          transientHits += 1;
          if (transientHits === 1) return html("missing", 404);
          return html(`<html><body><p>${"Open role with a full description of the work. ".repeat(12)}</p></body></html>`);
        }
        if (url.includes("/jobs/505")) {
          return new Response(JSON.stringify({ id: 505, title: "Open role" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/jobs/606")) return html("missing", 404);
        return html("ok", 200);
      });

      const start = new Date("2026-10-14T12:00:00.000Z");
      const first = await checkDuePipeline(env, userId, start);
      expect(first).toEqual({ checked: 4, closed: 0 });
      const struck = await db.prepare("SELECT status, streak, auto_closed_from FROM jobs WHERE id = ?")
        .bind(strike).first<{ status: string; streak: number; auto_closed_from: string | null }>();
      expect(struck).toEqual({ status: "evaluated", streak: 1, auto_closed_from: null });
      const flickered = await db.prepare("SELECT status, streak FROM jobs WHERE id = ?")
        .bind(transient).first<{ status: string; streak: number }>();
      expect(flickered).toEqual({ status: "resume_ready", streak: 1 });
      const back = await db.prepare("SELECT status, live_status, closed_at, auto_closed_from, streak FROM jobs WHERE id = ?")
        .bind(restored).first<{ status: string; live_status: string; closed_at: string | null; auto_closed_from: string | null; streak: number }>();
      expect(back).toEqual({ status: "evaluated", live_status: "live", closed_at: null, auto_closed_from: null, streak: 0 });
      const restoredEvents = await db.prepare("SELECT status FROM job_events WHERE job_id = ? AND kind = 'status'").bind(restored).all<{ status: string }>();
      expect(restoredEvents.results.map((row) => row.status)).toEqual(["evaluated"]);
      const offered = await db.prepare("SELECT status, live_status, closed_at FROM jobs WHERE id = ?")
        .bind(offer).first<{ status: string; live_status: string; closed_at: string | null }>();
      expect(offered).toEqual({ status: "offer", live_status: "closed", closed_at: null });

      const soon = await checkDuePipeline(env, userId, new Date(start.getTime() + 60_000));
      expect(soon).toEqual({ checked: 0, closed: 0 });
      const stillOpen = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(strike).first<{ status: string }>();
      expect(stillOpen?.status).toBe("evaluated");

      const later = await checkDuePipeline(env, userId, new Date(start.getTime() + PIPELINE_RECHECK_MS));
      expect(later).toEqual({ checked: 4, closed: 1 });
      const closed = await db.prepare("SELECT status, auto_closed_from, live_status FROM jobs WHERE id = ?")
        .bind(strike).first<{ status: string; auto_closed_from: string | null; live_status: string }>();
      expect(closed).toEqual({ status: "closed", auto_closed_from: "evaluated", live_status: "closed" });
      const recovered = await db.prepare("SELECT status, streak FROM jobs WHERE id = ?")
        .bind(transient).first<{ status: string; streak: number }>();
      expect(recovered).toEqual({ status: "resume_ready", streak: 0 });
      const offerStill = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(offer).first<{ status: string }>();
      expect(offerStill?.status).toBe("offer");
      const events = await db.prepare("SELECT status FROM job_events WHERE job_id = ? AND kind = 'status' ORDER BY at")
        .bind(strike).all<{ status: string }>();
      expect(events.results.map((row) => row.status)).toEqual(["closed"]);
    });
  });

  it("does not count a posting again when a later scan confirms it is still closed", async () => {
    await withUser(async (userId, db, env) => {
      const jobId = `${userId}-again`;
      await insertJob(db, userId, jobId, "https://boards.greenhouse.io/acme/jobs/404777", "resume_ready");
      stubFetch(() => html("missing", 404));
      const start = new Date("2026-10-14T12:00:00.000Z");
      const first = await checkDuePipeline(env, userId, start);
      expect(first).toEqual({ checked: 1, closed: 1 });
      const later = await checkDuePipeline(env, userId, new Date(start.getTime() + PIPELINE_RECHECK_MS + 1000));
      expect(later).toEqual({ checked: 1, closed: 0 });
      const row = await db.prepare("SELECT status, live_status FROM jobs WHERE id = ?").bind(jobId).first<{ status: string; live_status: string }>();
      expect(row).toEqual({ status: "closed", live_status: "closed" });
      const events = await db.prepare("SELECT COUNT(*) AS n FROM job_events WHERE job_id = ?").bind(jobId).first<{ n: number }>();
      expect(events?.n).toBe(1);
    });
  });
});
