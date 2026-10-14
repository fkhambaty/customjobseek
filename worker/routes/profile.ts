import { Hono } from "hono";
import { extractText, getDocumentProxy } from "unpdf";
import { onboardingMarks } from "../../shared/commercial";
import { profileFromResumeText } from "../../shared/engine/importResume";
import { nextRunAt } from "../../shared/engine/scanRules";
import { resumeTextInReadingOrder, type ResumeTextPage } from "../../shared/engine/resumeLayout";
import { emptyProfile, type Profile } from "../../shared/types";
import { profileReadiness, sanitiseProfile } from "../../shared/validate";
import { artifactIdentity, isPdf, safeResumeFilename } from "../../shared/resumeFile";
import { ciphertextRowFits, D1_MAX_VALUE_BYTES, MAX_ORIGINAL_PDF_BYTES, originalPdfLimitMessage, UPLOAD_TEXT_CAP } from "../../shared/resumeStorage";
import { renderPlainTextHtml } from "../../shared/resumeHtml";
import { decryptJson, encryptBytes, encryptJson } from "../crypto";
import { UPSERT_RESUME_ARTIFACT } from "../resumeArtifacts";
import { HttpError, type AppEnv, type Env } from "../env";
import { noteOnboarding } from "../onboarding";
import { enforceRateLimit } from "../rateLimit";
import { requireUser } from "../session";
import { noteProductEvent, noteUsage } from "../usage";

const encoder = new TextEncoder();

export async function loadProfile(env: Env, userId: string, email: string): Promise<Profile> {
  const row = await env.DB.prepare("SELECT ciphertext FROM profiles WHERE user_id = ?").bind(userId).first<{ ciphertext: string }>();
  return row ? sanitiseProfile(await decryptJson(env.DATA_KEY, row.ciphertext)) : emptyProfile(email);
}

export const profile = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const p = await loadProfile(c.env, user.id, user.email);
    return c.json({ profile: p, missing: profileReadiness(p) });
  })
  .put("/", async (c) => {
    const user = c.get("user");
    const p = sanitiseProfile(await c.req.json().catch(() => ({})));
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, ciphertext, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    )
      .bind(user.id, await encryptJson(c.env.DATA_KEY, p))
      .run();
    for (const step of onboardingMarks(p)) await noteOnboarding(c.env.DB, user.id, step);
    const schedule = await c.env.DB.prepare("SELECT hour_ist, enabled FROM scan_schedules WHERE user_id = ?")
      .bind(user.id)
      .first<{ hour_ist: number; enabled: number }>();
    if (schedule?.enabled) {
      await c.env.DB.prepare("UPDATE scan_schedules SET next_run_at = ? WHERE user_id = ?")
        .bind(nextRunAt(schedule.hour_ist, new Date(), p.preferences.timezone), user.id)
        .run();
    }
    return c.json({ profile: p, missing: profileReadiness(p) });
  })
  .post("/resume-file", async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "resume_import", user.id);
    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ORIGINAL_PDF_BYTES) throw new HttpError(400, originalPdfLimitMessage());
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength < 100) throw new HttpError(400, "That PDF is too small to read.");
    if (bytes.byteLength > MAX_ORIGINAL_PDF_BYTES) throw new HttpError(400, originalPdfLimitMessage());
    if (!isPdf(bytes)) throw new HttpError(422, "That file could not be read. Use a text-based PDF, not a scanned image.");
    // pdf.js transfers the buffer it is given; the original bytes are encrypted and stored below.
    const doc = await getDocumentProxy(bytes.slice()).catch(() => null);
    if (!doc) throw new HttpError(422, "That file could not be read. Use a text-based PDF, not a scanned image.");
    const pages: ResumeTextPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        width: page.getViewport({ scale: 1 }).width,
        items: content.items.flatMap((item) =>
          "str" in item && item.str.trim()
            ? [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }]
            : [],
        ),
      });
    }
    let text = resumeTextInReadingOrder(pages);
    if (!text.trim()) {
      const fallback = await extractText(doc, { mergePages: true });
      text = Array.isArray(fallback.text) ? fallback.text.join("\n") : fallback.text;
    }
    if (!text || text.trim().length < 80) throw new HttpError(422, "Almost no text came out of that PDF. It may be a scan.");
    const draft = sanitiseProfile(profileFromResumeText(text, user.email));
    const rawName = (c.req.header("x-file-name") ?? "").replace(/[^\w .()-]/g, "").slice(0, 120);
    const filename = safeResumeFilename(rawName || "Uploaded resume", "pdf");
    const label = (rawName || "Uploaded resume").replace(/\.pdf$/i, "").slice(0, 120);
    const plain = text.slice(0, UPLOAD_TEXT_CAP);
    const html = renderPlainTextHtml(label, plain);
    const uploadId = crypto.randomUUID();
    const artifact = artifactIdentity("upload", uploadId);
    const [textCipher, htmlCipher, pdfCipher] = await Promise.all([
      encryptJson(c.env.DATA_KEY, { text: plain }),
      encryptBytes(c.env.DATA_KEY, encoder.encode(html)),
      encryptBytes(c.env.DATA_KEY, bytes),
    ]);
    if (textCipher.length > D1_MAX_VALUE_BYTES || !ciphertextRowFits(htmlCipher.length, pdfCipher.length)) {
      throw new HttpError(400, originalPdfLimitMessage());
    }
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO resume_uploads (id, user_id, filename, label, format, text_ciphertext) VALUES (?, ?, ?, ?, 'pdf', ?)")
        .bind(uploadId, user.id, filename, label, textCipher),
      c.env.DB.prepare(UPSERT_RESUME_ARTIFACT).bind(
        user.id,
        artifact.artifactKey,
        artifact.kind,
        artifact.jobId,
        artifact.uploadId,
        filename,
        htmlCipher,
        pdfCipher,
      ),
    ]);
    await noteUsage(c.env.DB, user.id, "imports");
    await noteOnboarding(c.env.DB, user.id, "resume");
    await noteProductEvent(c.env.DB, user.id, "resume_import");
    return c.json({ profile: draft, missing: profileReadiness(draft) });
  });
