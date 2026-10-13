import { Hono } from "hono";
import { buildApplication, buildJobFile } from "../../shared/engine/documents";
import { evaluateFit, type JobInput } from "../../shared/engine/fit";
import { tailorResume } from "../../shared/engine/tailor";
import { JOB_STATUSES, type JobStatus, type TailoredResume } from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { decryptJson, encryptJson } from "../crypto";
import { HttpError, type AppEnv, type Env } from "../env";
import { fetchJob, isFetchableUrl } from "../jobFetch";
import { requireUser } from "../session";
import { loadProfile } from "./profile";
import { toJob, type JobRow } from "./serialise";

const JOB_SELECT = `SELECT j.*, EXISTS(SELECT 1 FROM resumes r WHERE r.job_id = j.id) AS has_resume FROM jobs j`;

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

async function spendCredit(env: Env, userId: string, kind: "eval" | "resume", jobId: string): Promise<boolean> {
  const column = kind === "eval" ? "eval_credits" : "resume_credits";
  const res = await env.DB.prepare(`UPDATE users SET ${column} = ${column} - 1 WHERE id = ? AND ${column} > 0`).bind(userId).run();
  if (!res.meta.changes) return false;
  await env.DB.prepare(
    "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(userId, `spend_${kind}`, kind === "eval" ? -1 : 0, kind === "resume" ? -1 : 0, jobId)
    .run();
  return true;
}

export const jobs = new Hono<AppEnv>()
  .use(requireUser)
  .post("/fetch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = isFetchableUrl(typeof body.url === "string" ? body.url.trim() : "");
    if (!url) throw new HttpError(400, "Enter a full job link starting with https://");
    const job = await fetchJob(url).catch(() => null);
    if (!job) {
      throw new HttpError(422, "That page could not be read (some career sites load jobs with scripts). Paste the description instead.");
    }
    return c.json({ ...job, url: url.toString() });
  })
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.user_id = ? ORDER BY j.created_at DESC`)
      .bind(c.get("user").id)
      .all<JobRow>();
    return c.json(results.map(toJob));
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
    await c.env.DB.prepare(
      `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, fit_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, user.id, input.title, input.company, input.location, input.url, input.salaryText, input.description, JSON.stringify(fit))
      .run();
    return c.json(toJob(await getJob(c.env, user.id, id)), 201);
  })
  .get("/:id", async (c) => c.json(toJob(await getJob(c.env, c.get("user").id, c.req.param("id")))))
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const status = typeof body.status === "string" ? body.status : job.status;
    if (!JOB_STATUSES.includes(status as JobStatus)) throw new HttpError(400, "Unknown status.");
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 5000) : job.notes;
    const nextActionAt =
      body.nextActionAt === null ? null : typeof body.nextActionAt === "string" && body.nextActionAt ? body.nextActionAt.slice(0, 10) : job.next_action_at;
    const appliedAt = status === "applied" && !job.applied_at ? new Date().toISOString() : job.applied_at;

    await c.env.DB.prepare(
      `UPDATE jobs SET status = ?, notes = ?, next_action_at = ?, applied_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    )
      .bind(status, notes, nextActionAt, appliedAt, job.id, user.id)
      .run();
    return c.json(toJob(await getJob(c.env, user.id, job.id)));
  })
  .post("/:id/rescore", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    const profile = await loadProfile(c.env, user.id, user.email);
    const fit = evaluateFit(
      { title: job.title, company: job.company, location: job.location, salaryText: job.salary_text, description: job.description },
      profile,
    );
    await c.env.DB.prepare("UPDATE jobs SET fit_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(fit), job.id).run();
    return c.json(toJob(await getJob(c.env, user.id, job.id)));
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const job = await getJob(c.env, user.id, c.req.param("id"));
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM resumes WHERE job_id = ? AND user_id = ?").bind(job.id, user.id),
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
    const packed = [
      ["resume", resume],
      ["application", application],
      ["jd", jobFile],
    ] as const;
    const stored = await Promise.all(packed.map(async ([kind, body]) => [kind, await encryptJson(c.env.DATA_KEY, body)] as const));
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = datetime('now')`,
      ).bind(job.id, user.id, stored[0]![1]),
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
    const { results } = await c.env.DB.prepare("SELECT kind, ciphertext FROM packs WHERE job_id = ? AND user_id = ?")
      .bind(job.id, user.id)
      .all<{ kind: string; ciphertext: string }>();
    if (!results.length) throw new HttpError(404, "No application pack has been made for this job yet.");
    const out: Record<string, unknown> = {};
    for (const row of results) out[row.kind] = await decryptJson(c.env.DATA_KEY, row.ciphertext);
    return c.json({ resume: out.resume ?? null, application: out.application ?? null, jobFile: out.jd ?? null });
  });
