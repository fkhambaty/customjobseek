import { Hono } from "hono";
import { agencyOutcomes, companyKey, packageAudit } from "../../shared/agency";
import { CHANNELS, type Channel } from "../../shared/types";
import { encryptJson } from "../crypto";
import { HttpError, type AppEnv } from "../env";
import { requireUser } from "../session";
import { listThreads, logCompanyMessage, threadMessages } from "../threads";
import { JOB_LIST_SELECT, toJob, type JobRow } from "./serialise";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export const workspace = new Hono<AppEnv>()
  .use(requireUser)
  .get("/threads", async (c) => {
    return c.json({ threads: await listThreads(c.env.DB, c.get("user").id, today()) });
  })
  .get("/threads/:id", async (c) => {
    const messages = await threadMessages(c.env, c.get("user").id, c.req.param("id"));
    if (!messages) throw new HttpError(404, "That company thread was not found.");
    return c.json({ messages });
  })
  .patch("/threads/:id", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const followUpOn = body.followUpOn === null ? null : text(body.followUpOn, 10);
    if (followUpOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) throw new HttpError(400, "Choose a follow-up date.");
    const updated = await c.env.DB.prepare(
      "UPDATE company_threads SET follow_up_on = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    ).bind(followUpOn, c.req.param("id"), user.id).run();
    if (!updated.meta.changes) throw new HttpError(404, "That company thread was not found.");
    return c.json({ threads: await listThreads(c.env.DB, user.id, today()) });
  })
  .post("/threads/:id/messages", async (c) => {
    const user = c.get("user");
    const thread = await c.env.DB.prepare("SELECT id, company_name, company_key FROM company_threads WHERE id = ? AND user_id = ?")
      .bind(c.req.param("id"), user.id)
      .first<{ id: string; company_name: string; company_key: string }>();
    if (!thread) throw new HttpError(404, "That company thread was not found.");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const direction = body.direction === "in" ? "in" : body.direction === "out" ? "out" : null;
    if (!direction) throw new HttpError(400, "Say whether you sent this or they replied.");
    const channel = typeof body.channel === "string" && CHANNELS.includes(body.channel as Channel) ? body.channel as Channel : "";
    const person = text(body.person, 120);
    const note = text(body.note, 2000);
    if (!person && !note) throw new HttpError(400, "Add who it was, or what was said.");
    const on = text(body.on, 10);
    const at = /^\d{4}-\d{2}-\d{2}$/.test(on) && on !== today() ? `${on}T12:00:00.000Z` : new Date().toISOString();
    let jobId: string | null = null;
    let eventId: string | null = null;
    const requestedJob = text(body.jobId, 80);
    if (requestedJob) {
      const job = await c.env.DB.prepare("SELECT id, company FROM jobs WHERE id = ? AND user_id = ?")
        .bind(requestedJob, user.id)
        .first<{ id: string; company: string }>();
      if (!job || companyKey(job.company) !== thread.company_key) throw new HttpError(400, "That role is not on this company thread.");
      jobId = job.id;
      eventId = crypto.randomUUID();
      const kind = direction === "in" ? "reply" : "message";
      await c.env.DB.prepare(
        "INSERT INTO job_events (id, job_id, user_id, kind, channel, at, ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(eventId, jobId, user.id, kind, channel, at, await encryptJson(c.env.DATA_KEY, { person, note })).run();
    }
    await logCompanyMessage(c.env, {
      userId: user.id,
      company: thread.company_name,
      jobId,
      eventId,
      direction,
      channel,
      at,
      person,
      note,
    });
    const messages = await threadMessages(c.env, user.id, thread.id);
    return c.json({ messages: messages ?? [] }, 201);
  })
  .get("/audit", async (c) => {
    const jobs = await loadJobs(c.env.DB, c.get("user").id);
    return c.json({ gaps: packageAudit(jobs, today()) });
  })
  .get("/outcomes", async (c) => {
    const jobs = await loadJobs(c.env.DB, c.get("user").id);
    return c.json(agencyOutcomes(jobs, today()));
  });

async function loadJobs(db: D1Database, userId: string) {
  const { results } = await db.prepare(`${JOB_LIST_SELECT} WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 500`)
    .bind(userId)
    .all<JobRow>();
  return results.map(toJob);
}
