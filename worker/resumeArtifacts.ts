import { htmlToVisibleText, renderPlainTextHtml, renderResumeHtml } from "../shared/resumeHtml";
import { PdfGlyphError, pdfRefusalBytes, pdfRefusalMessage, renderResumePdf, renderTextPdf } from "../shared/resumePdf";
import {
  artifactIdentity,
  isPdf,
  safeResumeFilename,
  visibleToOwner,
  type ResumeArtifactKind,
} from "../shared/resumeFile";
import type { TailoredResume } from "../shared/types";
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from "./crypto";
import { HttpError, type Env } from "./env";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const INSERT_RESUME_ARTIFACT =
  "INSERT INTO resume_artifacts (user_id, artifact_key, kind, job_id, upload_id, filename, html_ciphertext, pdf_ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

export const UPSERT_RESUME_ARTIFACT = `INSERT INTO resume_artifacts
  (user_id, artifact_key, kind, job_id, upload_id, filename, html_ciphertext, pdf_ciphertext, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(user_id, artifact_key) DO UPDATE SET
    kind = excluded.kind,
    job_id = excluded.job_id,
    upload_id = excluded.upload_id,
    filename = excluded.filename,
    html_ciphertext = excluded.html_ciphertext,
    pdf_ciphertext = excluded.pdf_ciphertext,
    updated_at = datetime('now')`;

export interface StoredResumeFile {
  filename: string;
  html: string;
  pdf: Uint8Array;
  pdfRefusal: string | null;
  updatedAt: string;
}

export interface TailoredArtifactPayload {
  filename: string;
  html: string;
  pdf: Uint8Array;
  htmlCipher: string;
  pdfCipher: string;
  /** Set when the PDF was refused. The HTML is the exact resume text. */
  refusal: string;
}

async function pdfOrRefusal(render: () => Promise<Uint8Array>): Promise<{ pdf: Uint8Array; refusal: string }> {
  try {
    const pdf = await render();
    if (!isPdf(pdf)) throw new HttpError(500, "The resume PDF could not be prepared.");
    return { pdf, refusal: "" };
  } catch (err) {
    if (!(err instanceof PdfGlyphError)) throw err;
    return { pdf: pdfRefusalBytes(err.message), refusal: err.message };
  }
}

export async function tailoredArtifactValues(secret: string, resume: TailoredResume): Promise<TailoredArtifactPayload> {
  const html = renderResumeHtml(resume);
  const filename = safeResumeFilename(resume.fullName || "Resume", "pdf");
  const { pdf, refusal } = await pdfOrRefusal(() => renderResumePdf(resume));
  const [htmlCipher, pdfCipher] = await Promise.all([
    encryptBytes(secret, encoder.encode(html)),
    encryptBytes(secret, pdf),
  ]);
  return { filename, html, pdf, htmlCipher, pdfCipher, refusal };
}

export async function readResumeFile(env: Env, userId: string, kind: ResumeArtifactKind, id: string): Promise<StoredResumeFile | null> {
  const identity = artifactIdentity(kind, id);
  const row = await env.DB.prepare(
    `SELECT user_id, filename, html_ciphertext, pdf_ciphertext, updated_at
     FROM resume_artifacts WHERE user_id = ? AND artifact_key = ?`,
  )
    .bind(userId, identity.artifactKey)
    .first<{ user_id: string; filename: string; html_ciphertext: string; pdf_ciphertext: string; updated_at: string }>();
  const visible = visibleToOwner(row, userId);
  if (!visible) return null;
  const [htmlBytes, pdf] = await Promise.all([
    decryptBytes(env.DATA_KEY, visible.html_ciphertext),
    decryptBytes(env.DATA_KEY, visible.pdf_ciphertext),
  ]);
  return { filename: visible.filename, html: decoder.decode(htmlBytes), pdf, pdfRefusal: pdfRefusalMessage(pdf), updatedAt: visible.updated_at };
}

async function upsertResumeFile(
  env: Env,
  userId: string,
  kind: ResumeArtifactKind,
  id: string,
  filename: string,
  htmlCipher: string,
  pdfCipher: string,
): Promise<void> {
  const identity = artifactIdentity(kind, id);
  await env.DB.prepare(UPSERT_RESUME_ARTIFACT)
    .bind(userId, identity.artifactKey, identity.kind, identity.jobId, identity.uploadId, filename, htmlCipher, pdfCipher)
    .run();
}

export async function writeResumeBytes(
  env: Env,
  userId: string,
  kind: ResumeArtifactKind,
  id: string,
  filename: string,
  html: string,
  pdf: Uint8Array,
): Promise<StoredResumeFile> {
  if (!isPdf(pdf) && !pdfRefusalMessage(pdf)) throw new HttpError(500, "The resume PDF could not be prepared.");
  const safeName = safeResumeFilename(filename, "pdf");
  const [htmlCipher, pdfCipher] = await Promise.all([
    encryptBytes(env.DATA_KEY, encoder.encode(html)),
    encryptBytes(env.DATA_KEY, pdf),
  ]);
  await upsertResumeFile(env, userId, kind, id, safeName, htmlCipher, pdfCipher);
  return { filename: safeName, html, pdf, pdfRefusal: pdfRefusalMessage(pdf), updatedAt: "" };
}

export async function writeTailoredResumeFile(
  env: Env,
  userId: string,
  kind: "master" | "job",
  id: string,
  resume: TailoredResume,
): Promise<StoredResumeFile> {
  const file = await tailoredArtifactValues(env.DATA_KEY, resume);
  await upsertResumeFile(env, userId, kind, id, file.filename, file.htmlCipher, file.pdfCipher);
  return { filename: file.filename, html: file.html, pdf: file.pdf, pdfRefusal: file.refusal || null, updatedAt: "" };
}

/** Stores the exact HTML when a PDF cannot be drawn. Does not spend a resume credit. */
export async function keepExactHtml(env: Env, userId: string, jobId: string, file: TailoredArtifactPayload): Promise<void> {
  await upsertResumeFile(env, userId, "job", jobId, file.filename, file.htmlCipher, file.pdfCipher);
  await env.DB.prepare(
    `INSERT INTO packs (job_id, user_id, kind, ciphertext, created_at) VALUES (?, ?, 'resume_html', ?, datetime('now'))
     ON CONFLICT(job_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
  ).bind(jobId, userId, await encryptJson(env.DATA_KEY, file.html)).run();
}

export async function ensureMasterResumeFile(
  env: Env,
  userId: string,
  resume: TailoredResume,
  profileUpdatedAt: string,
): Promise<StoredResumeFile> {
  const existing = await readResumeFile(env, userId, "master", "master");
  if (existing && profileUpdatedAt && existing.updatedAt >= profileUpdatedAt) return existing;
  return writeTailoredResumeFile(env, userId, "master", "master", resume);
}

async function structuredResume(env: Env, userId: string, jobId: string): Promise<TailoredResume | null> {
  const row = await env.DB.prepare("SELECT ciphertext FROM resumes WHERE job_id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<{ ciphertext: string }>();
  if (row?.ciphertext) return decryptJson<TailoredResume>(env.DATA_KEY, row.ciphertext);
  const pack = await env.DB.prepare(
    "SELECT ciphertext FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume' AND ciphertext != ''",
  )
    .bind(jobId, userId)
    .first<{ ciphertext: string }>();
  if (!pack?.ciphertext) return null;
  return decryptJson<TailoredResume>(env.DATA_KEY, pack.ciphertext);
}

export async function ensureJobResumeFile(env: Env, userId: string, jobId: string): Promise<StoredResumeFile> {
  const existing = await readResumeFile(env, userId, "job", jobId);
  if (existing) return existing;
  const job = await env.DB.prepare("SELECT user_id, title FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<{ user_id: string; title: string }>();
  if (!visibleToOwner(job, userId)) throw new HttpError(404, "Resume not found.");
  const resume = await structuredResume(env, userId, jobId);
  if (resume) return writeTailoredResumeFile(env, userId, "job", jobId, resume);
  const saved = await env.DB.prepare("SELECT ciphertext FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume_html'")
    .bind(jobId, userId)
    .first<{ ciphertext: string }>();
  if (saved?.ciphertext) {
    const html = await decryptJson<string>(env.DATA_KEY, saved.ciphertext);
    const page = typeof html === "string" ? html : "";
    const { pdf } = await pdfOrRefusal(() => renderTextPdf("Resume", htmlToVisibleText(page)));
    return writeResumeBytes(env, userId, "job", jobId, "Resume.pdf", page, pdf);
  }
  throw new HttpError(404, "No resume has been made for this job yet.");
}

export async function ensureUploadResumeFile(env: Env, userId: string, uploadId: string): Promise<StoredResumeFile> {
  const existing = await readResumeFile(env, userId, "upload", uploadId);
  if (existing) return existing;
  const row = await env.DB.prepare(
    "SELECT user_id, label, filename, format, text_ciphertext FROM resume_uploads WHERE id = ? AND user_id = ?",
  )
    .bind(uploadId, userId)
    .first<{ user_id: string; label: string; filename: string; format: string; text_ciphertext: string }>();
  const visible = visibleToOwner(row, userId);
  if (!visible) throw new HttpError(404, "Resume not found.");
  const body = await decryptJson<{ text?: string }>(env.DATA_KEY, visible.text_ciphertext);
  const text = body.text ?? "";
  const label = visible.label || visible.filename || "Resume";
  const filename = safeResumeFilename(visible.filename || label, "pdf");
  const html = visible.format === "html" ? text : renderPlainTextHtml(label, text);
  const { pdf } = await pdfOrRefusal(() => renderTextPdf(label, visible.format === "html" ? htmlToVisibleText(text) : text));
  return writeResumeBytes(env, userId, "upload", uploadId, filename, html, pdf);
}
