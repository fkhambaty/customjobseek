import { Hono } from "hono";
import { tailorResume } from "../../shared/engine/tailor";
import type { FitResult } from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { decryptJson } from "../crypto";
import { HttpError, type AppEnv } from "../env";
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

export const SAVED_FILE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
  "x-content-type-options": "nosniff",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export const resumes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const [tailored, base] = await Promise.all([
      c.env.DB.prepare(
        `SELECT j.id, j.title, j.company, j.status, MAX(p.created_at) AS made_at,
           MAX(CASE WHEN p.kind = 'resume' THEN 1 ELSE 0 END) AS built,
           MAX(CASE WHEN p.kind = 'resume_html' THEN 1 ELSE 0 END) AS saved
         FROM packs p JOIN jobs j ON j.id = p.job_id
         WHERE p.user_id = ? AND p.kind IN ('resume', 'resume_html')
         GROUP BY j.id ORDER BY made_at DESC`,
      )
        .bind(user.id)
        .all<{ id: string; title: string; company: string; status: string; made_at: string; built: number; saved: number }>(),
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
        madeAt: r.made_at,
        built: Boolean(r.built),
        saved: Boolean(r.saved),
      })),
      base: base.results.map((r) => ({ id: r.id, label: r.label || r.filename, format: r.format, createdAt: r.created_at })),
    });
  })
  .get("/master", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const missing = profileReadiness(profile);
    if (missing.length) throw new HttpError(400, `Finish your profile first: add ${missing.join(", ")}.`);
    return c.json(tailorResume(profile, NO_JOB, { id: "master", title: "", company: "" }));
  })
  .get("/base/:id", async (c) => {
    const user = c.get("user");
    const row = await c.env.DB.prepare("SELECT label, format, text_ciphertext FROM resume_uploads WHERE id = ? AND user_id = ?")
      .bind(c.req.param("id"), user.id)
      .first<{ label: string; format: string; text_ciphertext: string }>();
    if (!row) throw new HttpError(404, "Resume not found.");
    const body = await decryptJson<{ text: string }>(c.env.DATA_KEY, row.text_ciphertext);
    const html =
      row.format === "html"
        ? body.text
        : `<!doctype html><meta charset="utf-8"><title>${escapeHtml(row.label)}</title>
           <pre style="font:14px/1.55 Georgia,serif;white-space:pre-wrap;max-width:780px;margin:32px auto">${escapeHtml(body.text)}</pre>`;
    return c.body(html, 200, SAVED_FILE_HEADERS);
  })
  .delete("/base/:id", async (c) => {
    await c.env.DB.prepare("DELETE FROM resume_uploads WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("user").id).run();
    return c.json({ ok: true });
  });
