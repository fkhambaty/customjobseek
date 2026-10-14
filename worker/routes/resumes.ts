import { Hono, type Context } from "hono";
import { parseLiveStatus } from "../../shared/agency";
import { tailorResume } from "../../shared/engine/tailor";
import { renderPlainTextHtml } from "../../shared/resumeHtml";
import { parseResumeFileRoute, resumeFileHeaders, toPublicResumeUpload } from "../../shared/resumeFile";
import type { FitResult, TailoredResume } from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { decryptJson } from "../crypto";
import { HttpError, type AppEnv } from "../env";
import { ensureJobResumeFile, ensureMasterResumeFile, ensureUploadResumeFile, type StoredResumeFile } from "../resumeArtifacts";
import { requireUser } from "../session";
import { loadProfile } from "./profile";

const NO_JOB: FitResult = {
  score: 0,
  decision: "apply",
  matchedRequired: [],
  matchedOther: [],
  missingRequired: [],
  missingOther: [],
  blockers: [],
  notes: [],
  jdYearsRequired: null,
  parsedSalary: null,
};

async function prepareMaster(c: Context<AppEnv>): Promise<{ resume: TailoredResume; file: StoredResumeFile }> {
  const user = c.get("user");
  const profile = await loadProfile(c.env, user.id, user.email);
  const missing = profileReadiness(profile);
  if (missing.length) throw new HttpError(400, `Finish your profile first: add ${missing.join(", ")}.`);
  const resume = tailorResume(profile, NO_JOB, { id: "master", title: "", company: "" });
  const stamp = await c.env.DB.prepare("SELECT updated_at FROM profiles WHERE user_id = ?")
    .bind(user.id)
    .first<{ updated_at: string }>();
  const file = await ensureMasterResumeFile(c.env, user.id, resume, stamp?.updated_at ?? "");
  return { resume, file };
}

async function openResumeFile(c: Context<AppEnv>, kind: "master" | "job" | "upload", id: string): Promise<StoredResumeFile> {
  const user = c.get("user");
  switch (kind) {
    case "master":
      return (await prepareMaster(c)).file;
    case "job":
      return ensureJobResumeFile(c.env, user.id, id);
    case "upload":
      return ensureUploadResumeFile(c.env, user.id, id);
    default: {
      const unexpected: never = kind;
      throw new HttpError(404, unexpected);
    }
  }
}

export const resumes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const [tailored, base] = await Promise.all([
      c.env.DB.prepare(
        `SELECT j.id, j.title, j.company, j.status, j.live_status,
           COALESCE(MAX(r.created_at), MAX(p.created_at)) AS made_at,
           CASE
             WHEN MAX(r.job_id) IS NOT NULL OR SUM(CASE WHEN p.kind = 'resume' AND p.ciphertext != '' THEN 1 ELSE 0 END) > 0 THEN 1
             ELSE 0
           END AS built,
           MAX(CASE WHEN p.kind = 'resume_html' THEN 1 ELSE 0 END) AS saved
         FROM jobs j
         LEFT JOIN resumes r ON r.job_id = j.id AND r.user_id = j.user_id
         LEFT JOIN packs p ON p.job_id = j.id AND p.user_id = j.user_id AND p.kind IN ('resume', 'resume_html')
         WHERE j.user_id = ? AND (r.job_id IS NOT NULL OR p.job_id IS NOT NULL)
         GROUP BY j.id
         ORDER BY made_at DESC`,
      )
        .bind(user.id)
        .all<{ id: string; title: string; company: string; status: string; live_status: string; made_at: string; built: number; saved: number }>(),
      c.env.DB.prepare("SELECT id, label, filename, format, created_at FROM resume_uploads WHERE user_id = ? ORDER BY created_at DESC")
        .bind(user.id)
        .all<{ id: string; label: string; filename: string; format: string; created_at: string }>(),
    ]);
    return c.json({
      tailored: tailored.results.map((r) => ({
        jobId: r.id,
        title: r.title,
        company: r.company,
        status: r.status,
        liveStatus: parseLiveStatus(r.live_status),
        madeAt: r.made_at,
        built: Boolean(r.built),
        saved: Boolean(r.saved),
      })),
      base: base.results.map((r) => toPublicResumeUpload(r)),
    });
  })
  .get("/master", async (c) => {
    const { resume } = await prepareMaster(c);
    return c.json(resume);
  })
  .get("/files/:kind/:id/:format", async (c) => {
    const route = parseResumeFileRoute(c.req.param("kind"), c.req.param("id"), c.req.param("format"), c.req.query("download") ?? null);
    if (!route) throw new HttpError(404, "Resume not found.");
    const file = await openResumeFile(c, route.kind, route.id);
    const headers = resumeFileHeaders(route, file.filename);
    if (route.format === "pdf") {
      if (file.pdfRefusal) throw new HttpError(422, file.pdfRefusal);
      const body = new Uint8Array(file.pdf.byteLength);
      body.set(file.pdf);
      return c.body(body, 200, headers);
    }
    return c.body(file.html, 200, headers);
  })
  .get("/base/:id", async (c) => {
    const user = c.get("user");
    const row = await c.env.DB.prepare("SELECT label, format, text_ciphertext FROM resume_uploads WHERE id = ? AND user_id = ?")
      .bind(c.req.param("id"), user.id)
      .first<{ label: string; format: string; text_ciphertext: string }>();
    if (!row) throw new HttpError(404, "Resume not found.");
    const body = await decryptJson<{ text: string }>(c.env.DATA_KEY, row.text_ciphertext);
    const html = row.format === "html" ? body.text : renderPlainTextHtml(row.label, body.text);
    return c.body(html, 200, resumeFileHeaders({ format: "html", disposition: "inline" }, row.label || "Resume"));
  })
  .delete("/base/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM resume_artifacts WHERE user_id = ? AND upload_id = ?").bind(user.id, id),
      c.env.DB.prepare("DELETE FROM resume_uploads WHERE id = ? AND user_id = ?").bind(id, user.id),
    ]);
    return c.json({ ok: true });
  });
