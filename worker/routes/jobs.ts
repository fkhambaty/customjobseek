import { Hono } from "hono";
import { badMatchSupportMessage, parseBadMatchReason, parseInterviewStage, payProvenanceFor } from "../../shared/agency";
import { laneFor, routeFromUrl } from "../../shared/engine/classify";
import { buildApplication, buildJobFile } from "../../shared/engine/documents";
import { evaluateFit, type JobInput } from "../../shared/engine/fit";
import { buildMessages } from "../../shared/engine/outreach";
import { tailorResume } from "../../shared/engine/tailor";
import {
  CHANNELS,
  emptyDetails,
  JOB_STATUSES,
  type Channel,
  type Contact,
  type FitResult,
  type JobDetails,
  type JobEvent,
  type JobFull,
  type JobStatus,
  type Profile,
  type TailoredResume,
} from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { decryptJson, encryptJson } from "../crypto";
import { HttpError, type AppEnv, type Env } from "../env";
import { notifyOwner } from "../notify";
import { logCompanyMessage } from "../threads";
import { aggregatorBlock, fetchJob, isFetchableUrl } from "../jobFetch";
import { noteOnboarding } from "../onboarding";
import { enforceRateLimit } from "../rateLimit";
import { requireUser } from "../session";
import { noteProductEvent, noteUsage } from "../usage";
import { loadProfile } from "./profile";
import { SAVED_FILE_HEADERS } from "./resumes";
import { nextJobCursor, parseJobListQuery } from "../../shared/capacity";
import { JOB_LIST_SELECT, JOB_SELECT, toJob, type JobRow } from "./serialise";

function readJobInput(body: Record<string, unknown>): JobInput & { url: string } {
  const s = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
  const job = {
    title: s("title", 200),
    company: s("company", 200),
    location: s("location", 200),
    salaryText: s("salaryText", 200),
    description: s("description", 30000),
    url: s("url", 1000),
  };
  if (!job.title) throw new HttpError(400, "Add the job title.");
  if (job.description.length < 150) throw new HttpError(400, "Paste the full job description (at least a few paragraphs).");
  if (job.url && !isFetchableUrl(job.url)) throw new HttpError(400, "The job link must be a normal https:// web address.");
  return job;
}

async function getJob(env: Env, userId: string, id: string): Promise<JobRow> {
  const row = await env.DB.prepare(`${JOB_SELECT} WHERE j.id = ? AND j.user_id = ?`).bind(id, userId).first<JobRow>();
  if (!row) throw new HttpError(404, "Job not found.");
  return row;
}

async function loadDetails(env: Env, row: JobRow): Promise<JobDetails> {
  if (!row.details_ciphertext) return emptyDetails();
  return { ...emptyDetails(), ...(await decryptJson<JobDetails>(env.DATA_KEY, row.details_ciphertext)) };
}

interface EventRow {
  id: string;
  job_id: string;
  kind: string;
  status: string;
  channel: string;
  at: string;
  ciphertext: string;
}

async function loadEvents(env: Env, userId: string, jobId: string): Promise<JobEvent[]> {
  const { results } = await env.DB.prepare("SELECT * FROM job_events WHERE job_id = ? AND user_id = ? ORDER BY at DESC")
    .bind(jobId, userId)
    .all<EventRow>();
  return Promise.all(
    results.map(async (e) => {
      const body = e.ciphertext ? await decryptJson<{ person: string; note: string }>(env.DATA_KEY, e.ciphertext) : { person: "", note: "" };
      return {
        id: e.id,
        jobId: e.job_id,
        kind: e.kind as JobEvent["kind"],
        status: e.status as JobEvent["status"],
        channel: e.channel as JobEvent["channel"],
        at: e.at,
        person: body.person,
        note: body.note,
      };
    }),
  );
}

async function full(env: Env, userId: string, id: string): Promise<JobFull> {
  const row = await getJob(env, userId, id);
  return { ...toJob(row), details: await loadDetails(env, row), events: await loadEvents(env, userId, id) };
}

async function spendCredit(env: Env, userId: string, kind: "eval" | "resume", jobId: string): Promise<boolean> {
  const column = kind === "eval" ? "eval_credits" : "resume_credits";
  const res = await env.DB.prepare(`UPDATE users SET ${column} = ${column} - 1 WHERE id = ? AND ${column} > 0`).bind(userId).run();
  if (!res.meta.changes) return false;
  await env.DB.prepare(
    "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(userId, `spend_${kind}`, kind === "eval" ? -1 : 0, kind === "resume" ? -1 : 0, jobId)
    .run();
  switch (kind) {
    case "eval":
      await noteUsage(env.DB, userId, "checks");
      await noteOnboarding(env.DB, userId, "first_check");
      break;
    case "resume":
      await noteUsage(env.DB, userId, "resumes");
      break;
    default: {
      const unexpected: never = kind;
      throw new Error(String(unexpected));
    }
  }
  return true;
}

/** Stored pay is only ever the person's own currency, so lists and lanes never compare across currencies. */
function payFor(fit: FitResult, profile: Profile): { low: number | null; high: number | null } {
  const s = fit.parsedSalary;
  if (!s || s.currency !== profile.preferences.currency) return { low: null, high: null };
  return { low: s.annualMin, high: s.annualMax };
}

function laneOf(location: string, fit: FitResult, profile: Profile): string {
  const s = fit.parsedSalary;
  const same = s && s.currency === profile.preferences.currency;
  return laneFor(location, same ? s.annualMin : null, same ? s.annualMax : null, profile.preferences);
}

function isoDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function readContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Send a list of contacts.");
  return raw.slice(0, 20).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const url = s(o.url, 500);
    if (url && !isFetchableUrl(url)) throw new HttpError(400, "Contact links must start with https://");
    const contact = { id: s(o.id, 40) || crypto.randomUUID(), name: s(o.name, 120), role: s(o.role, 160), url, email: s(o.email, 200) };
    if (!contact.name && !contact.email) throw new HttpError(400, "Each contact needs a name or an email.");
    return contact;
  });
}

export const jobs = new Hono<AppEnv>()
  .use(requireUser)
  .post("/fetch", async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "job_fetch", user.id);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = isFetchableUrl(typeof body.url === "string" ? body.url.trim() : "");
    if (!url) throw new HttpError(400, "Enter a full job link starting with https://");
    const blocked = aggregatorBlock(url);
    if (blocked) throw new HttpError(422, blocked);
    const job = await fetchJob(url).catch(() => null);
    if (!job) {
      throw new HttpError(422, "That page could not be read (some career sites load jobs with scripts). Paste the description instead.");
    }
    await noteUsage(c.env.DB, user.id, "fetches");
    await noteProductEvent(c.env.DB, user.id, "job_fetch");
    return c.json({ ...job, url: url.toString() });
  })
  .get("/", async (c) => {
    const page = parseJobListQuery(c.req.query("limit"), c.req.query("cursor"));
    const cursor = page.cursor;
    const { results } = await c.env.DB.prepare(
      `${JOB_LIST_SELECT}
       WHERE j.user_id = ?
         AND (? = '' OR j.created_at < ? OR (j.created_at = ? AND j.id < ?))
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ?`,
    )
      .bind(
        c.get("user").id,
        cursor?.createdAt ?? "",
        cursor?.createdAt ?? "",
        cursor?.createdAt ?? "",
        cursor?.id ?? "",
        page.limit,
      )
      .all<JobRow>();
    const jobs = results.map(toJob);
    return c.json({ jobs, nextCursor: nextJobCursor(jobs, page.limit) });
  })
  .get("/activity", async (c) => {
    const user = c.get("user");
    const { results } = await c.env.DB.prepare(
      `SELECT e.*, j.title, j.company FROM job_events e JOIN jobs j ON j.id = e.job_id
       WHERE e.user_id = ? AND e.kind IN ('message', 'reply', 'note') ORDER BY e.at DESC LIMIT 500`,
    )
      .bind(user.id)
      .all<EventRow & { title: string; company: string }>();
    return c.json(
      await Promise.all(
        results.map(async (e) => {
          const body = e.ciphertext ? await decryptJson<{ person: string; note: string }>(c.env.DATA_KEY, e.ciphertext) : { person: "", note: "" };
          return { id: e.id, jobId: e.job_id, kind: e.kind, status: e.status, channel: e.channel, at: e.at, ...body, title: e.title, company: e.company };
        }),
      ),
    );
  })
  .get("/people", async (c) => {
    const user = c.get("user");
    const { results } = await c.env.DB.prepare(
      "SELECT id, title, company, status, details_ciphertext FROM jobs WHERE user_id = ? AND contact_count > 0 ORDER BY updated_at DESC",
    )
      .bind(user.id)
      .all<{ id: string; title: string; company: string; status: string; details_ciphertext: string }>();
    const out = [];
    for (const r of results) {
      const d = await decryptJson<JobDetails>(c.env.DATA_KEY, r.details_ciphertext);
      for (const contact of d.contacts ?? []) out.push({ jobId: r.id, title: r.title, company: r.company, status: r.status, contact });
    }
    return c.json(out);
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const input = readJobInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    const profile = await loadProfile(c.env, user.id, user.email);
    const missing = profileReadiness(profile);
    if (missing.length) throw new HttpError(400, `Finish your profile first: add ${missing.join(", ")}.`);

    const fit = evaluateFit(input, profile);
    const id = crypto.randomUUID();
    if (!(await spendCredit(c.env, user.id, "eval", id))) {
      throw new HttpError(402, "You have used all your fit checks. Pick a plan to continue.");
    }
    const pay = payFor(fit, profile);
    const provenance = payProvenanceFor({ salaryText: input.salaryText, payEstimated: false, parsed: fit.parsedSalary !== null });
    await c.env.DB.prepare(
      `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, fit_json, lane, route, pay_low, pay_high, pay_provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        input.title,
        input.company,
        input.location,
        input.url,
        input.salaryText,
        input.description,
        JSON.stringify(fit),
        laneOf(input.location, fit, profile),
        routeFromUrl(input.url),
        pay.low,
        pay.high,
        provenance,
      )
      .run();
    return c.json(toJob(await getJob(c.env, user.id, id)), 201);
  })
  .get("/:id", async (c) => c.json(await full(c.env, c.get("user").id, c.req.param("id"))))
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const status = typeof body.status === "string" ? body.status : job.status;
    if (!JOB_STATUSES.includes(status as JobStatus)) throw new HttpError(400, "Unknown status.");
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 5000) : job.notes;
    const nextActionAt =
      body.nextActionAt === null ? null : typeof body.nextActionAt === "string" && body.nextActionAt ? body.nextActionAt.slice(0, 10) : job.next_action_at;
    const today = new Date().toISOString().slice(0, 10);
    const on = isoDate(body.on) ?? today;
    const changed = status !== job.status;
    const appliedAt = isoDate(body.appliedAt) ?? (status === "applied" && !job.applied_at ? on : job.applied_at);
    const rejectedAt = changed && status === "rejected" ? on : job.rejected_at;
    const closedAt = changed && (status === "closed" || status === "withdrawn") ? on : job.closed_at;
    if (typeof body.interviewStage === "string" && body.interviewStage && !parseInterviewStage(body.interviewStage)) {
      throw new HttpError(400, "Choose a recruiter screen, hiring manager, panel, or final round.");
    }
    const interviewStage = status === "interview" || status === "offer"
      ? parseInterviewStage(typeof body.interviewStage === "string" ? body.interviewStage : job.interview_stage)
      : "";

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE jobs SET status = ?, notes = ?, next_action_at = ?, applied_at = ?, rejected_at = ?, closed_at = ?,
         interview_stage = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      ).bind(status, notes, nextActionAt, appliedAt, rejectedAt, closedAt, interviewStage, job.id, user.id),
      ...(changed
        ? [
            c.env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, status, at) VALUES (?, ?, ?, 'status', ?, ?)").bind(
              crypto.randomUUID(),
              job.id,
              user.id,
              status,
              on === today ? new Date().toISOString() : `${on}T12:00:00.000Z`,
            ),
          ]
        : []),
    ]);
    return c.json(await full(c.env, user.id, job.id));
  })
  .put("/:id/contacts", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const contacts = readContacts(body.contacts);
    const details = { ...(await loadDetails(c.env, job)), contacts };
    await c.env.DB.prepare("UPDATE jobs SET details_ciphertext = ?, contact_count = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(await encryptJson(c.env.DATA_KEY, details), contacts.length, job.id)
      .run();
    return c.json(await full(c.env, user.id, job.id));
  })
  .post("/:id/events", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = body.kind;
    if (kind !== "message" && kind !== "reply" && kind !== "note") throw new HttpError(400, "Log a message, a reply or a note.");
    const channel: Channel | "" = typeof body.channel === "string" && CHANNELS.includes(body.channel as Channel) ? body.channel as Channel : "";
    const on = isoDate(body.on);
    const at = on && on !== new Date().toISOString().slice(0, 10) ? `${on}T12:00:00.000Z` : new Date().toISOString();
    const person = s(body.person, 120);
    const note = s(body.note, 2000);
    const payload = await encryptJson(c.env.DATA_KEY, { person, note });
    const eventId = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO job_events (id, job_id, user_id, kind, channel, at, ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, job.id, user.id, kind, channel, at, payload)
      .run();
    if (kind === "message" || kind === "reply") {
      await logCompanyMessage(c.env, {
        userId: user.id,
        company: job.company,
        jobId: job.id,
        eventId,
        direction: kind === "reply" ? "in" : "out",
        channel,
        at,
        person,
        note,
      }).catch((err: unknown) => console.error("company thread log failed", err));
    }
    return c.json(await full(c.env, user.id, job.id), 201);
  })
  .delete("/:id/events/:eventId", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const eventId = c.req.param("eventId");
    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM thread_messages
         WHERE event_id = ? AND user_id = ?
           AND EXISTS (
             SELECT 1 FROM job_events
             WHERE id = ? AND job_id = ? AND user_id = ? AND kind != 'status'
           )`,
      ).bind(eventId, user.id, eventId, job.id, user.id),
      c.env.DB.prepare("DELETE FROM job_events WHERE id = ? AND job_id = ? AND user_id = ? AND kind != 'status'")
        .bind(eventId, job.id, user.id),
    ]);
    return c.json(await full(c.env, user.id, job.id));
  })
  .get("/:id/messages", async (c) => {
    const user = c.get("user");
    const row = await getJob(c.env, user.id, c.req.param("id"));
    const [profile, details] = await Promise.all([loadProfile(c.env, user.id, user.email), loadDetails(c.env, row)]);
    const fit = JSON.parse(row.fit_json) as FitResult;
    const people: Contact[] = details.contacts.length ? details.contacts : [{ id: "team", name: "", role: "Hiring team", url: "", email: "" }];
    const job = { title: row.title, company: row.company, requisition: row.requisition };
    return c.json(people.map((p) => buildMessages(profile, fit, job, p)));
  })
  .post("/:id/rescore", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const profile = await loadProfile(c.env, user.id, user.email);
    const fit = evaluateFit(
      { title: job.title, company: job.company, location: job.location, salaryText: job.salary_text, description: job.description },
      profile,
    );
    const imported = job.id.startsWith("cc:");
    await c.env.DB.prepare("UPDATE jobs SET fit_json = ?, lane = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(JSON.stringify(fit), imported ? job.lane : laneOf(job.location, fit, profile), job.id)
      .run();
    return c.json(await full(c.env, user.id, job.id));
  })
  .post("/:id/report-match", async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "support", user.id);
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = parseBadMatchReason(body.reason);
    if (!reason) throw new HttpError(400, "Choose why this match looks wrong.");
    const note = s(body.note, 500);
    const existing = await c.env.DB.prepare("SELECT support_id FROM bad_match_reports WHERE user_id = ? AND job_id = ?")
      .bind(user.id, job.id)
      .first<{ support_id: string }>();
    if (existing) return c.json({ id: existing.support_id });
    const supportId = crypto.randomUUID();
    const message = badMatchSupportMessage(reason, job.id, note);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO support_requests (id, user_id, email, topic, message) VALUES (?, ?, ?, 'match', ?)")
        .bind(supportId, user.id, user.email, message),
      c.env.DB.prepare("INSERT INTO bad_match_reports (id, user_id, job_id, support_id, reason) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), user.id, job.id, supportId, reason),
    ]);
    await noteProductEvent(c.env.DB, user.id, "support_request");
    await notifyOwner(c.env, {
      kind: "support_request",
      dedupeKey: `support:${supportId}`,
      summary: `Bad-match report filed. Reference ${supportId}.`,
    }).catch((err: unknown) => console.error("bad match alert failed", err));
    return c.json({ id: supportId }, 201);
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    await c.env.DB.batch([
      ...["resumes", "packs", "job_events", "thread_messages", "bad_match_reports"]
        .map((t) => c.env.DB.prepare(`DELETE FROM ${t} WHERE job_id = ? AND user_id = ?`).bind(job.id, user.id)),
      c.env.DB.prepare("DELETE FROM jobs WHERE id = ? AND user_id = ?").bind(job.id, user.id),
    ]);
    return c.json({ ok: true });
  })
  .get("/:id/resume", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT ciphertext FROM resumes WHERE job_id = ? AND user_id = ?")
      .bind(job.id, user.id)
      .first<{ ciphertext: string }>();
    if (!row) throw new HttpError(404, "No resume has been made for this job yet.");
    return c.json(await decryptJson<TailoredResume>(c.env.DATA_KEY, row.ciphertext));
  })
  .get("/:id/resume.html", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT ciphertext FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume_html'")
      .bind(job.id, user.id)
      .first<{ ciphertext: string }>();
    if (!row) throw new HttpError(404, "No saved resume file for this job.");
    const html = await decryptJson<string>(c.env.DATA_KEY, row.ciphertext);
    return c.body(html, 200, SAVED_FILE_HEADERS);
  })
  .post("/:id/resume", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const profile = await loadProfile(c.env, user.id, user.email);
    const missing = profileReadiness(profile);
    if (missing.length) throw new HttpError(400, `Finish your profile first: add ${missing.join(", ")}.`);

    // Rebuilding a resume for the same job is free, so profile edits never cost a second credit.
    if (!job.has_resume && !(await spendCredit(c.env, user.id, "resume", job.id))) {
      throw new HttpError(402, "You have used all your tailored resumes. Pick a plan to continue.");
    }
    const fit = evaluateFit(
      { title: job.title, company: job.company, location: job.location, salaryText: job.salary_text, description: job.description },
      profile,
    );
    const resume = tailorResume(profile, fit, { id: job.id, title: job.title, company: job.company });
    const application = buildApplication(profile, fit, resume);
    const jobFile = buildJobFile(
      { title: job.title, company: job.company, location: job.location, url: job.url, salaryText: job.salary_text, description: job.description },
      fit,
    );
    const resumeCipher = await encryptJson(c.env.DATA_KEY, resume);
    const packed = [
      ["application", application],
      ["jd", jobFile],
    ] as const;
    const stored = await Promise.all(packed.map(async ([kind, body]) => [kind, await encryptJson(c.env.DATA_KEY, body)] as const));
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = datetime('now')`,
      ).bind(job.id, user.id, resumeCipher),
      c.env.DB.prepare("DELETE FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume'").bind(job.id, user.id),
      ...stored.map(([kind, ciphertext]) =>
        c.env.DB.prepare(
          `INSERT INTO packs (job_id, user_id, kind, ciphertext, created_at) VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(job_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
        ).bind(job.id, user.id, kind, ciphertext),
      ),
      c.env.DB.prepare(
        `UPDATE jobs SET fit_json = ?, status = CASE WHEN status = 'evaluated' THEN 'resume_ready' ELSE status END,
         updated_at = datetime('now') WHERE id = ?`,
      ).bind(JSON.stringify(fit), job.id),
    ]);
    return c.json({ resume, application, jobFile });
  })
  .get("/:id/pack", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const { results } = await c.env.DB.prepare("SELECT kind, ciphertext FROM packs WHERE job_id = ? AND user_id = ? AND kind != 'resume_html'")
      .bind(job.id, user.id)
      .all<{ kind: string; ciphertext: string }>();
    const [hasHtml, resumeRow] = await Promise.all([
      c.env.DB.prepare("SELECT 1 AS ok FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume_html'")
        .bind(job.id, user.id)
        .first<{ ok: number }>(),
      c.env.DB.prepare("SELECT ciphertext FROM resumes WHERE job_id = ? AND user_id = ?")
        .bind(job.id, user.id)
        .first<{ ciphertext: string }>(),
    ]);
    const out: Record<string, unknown> = {};
    for (const row of results) {
      if (!row.ciphertext) continue;
      out[row.kind] = await decryptJson(c.env.DATA_KEY, row.ciphertext);
    }
    if (!out.resume && resumeRow?.ciphertext) out.resume = await decryptJson(c.env.DATA_KEY, resumeRow.ciphertext);
    return c.json({
      resume: out.resume ?? null,
      application: out.application ?? null,
      jobFile: out.jd ?? null,
      savedResume: Boolean(hasHtml),
      applicationNotes: (out.application_md as string | undefined) ?? null,
      jobNotes: (out.jd_md as string | undefined) ?? null,
      statusNotes: (out.status_md as string | undefined) ?? null,
    });
  });
