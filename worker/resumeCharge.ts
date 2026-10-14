import type { D1Database } from "@cloudflare/workers-types";
import { artifactIdentity } from "../shared/resumeFile";
import { abortBatchWhen } from "./batchGuard";
import { UPSERT_RESUME_ARTIFACT } from "./resumeArtifacts";

export type ResumeStoreResult = "charged" | "rebuilt" | "unpaid";

export interface TailoredResumeStore {
  userId: string;
  jobId: string;
  /** False when this job already has a resume. A rebuild does not debit. */
  charge: boolean;
  fitJson: string;
  resumeCipher: string;
  applicationCipher: string;
  jobFileCipher: string;
  filename: string;
  htmlCipher: string;
  pdfCipher: string;
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err ?? "");
  const cause = "cause" in err ? err.cause : undefined;
  return `${err.message} ${cause instanceof Error ? cause.message : ""}`;
}

function isUnpaidGuard(err: unknown): boolean {
  const text = errorText(err);
  return text.includes("ok = 1") || text.includes("batch_guards");
}

/**
 * Writes the resume, the PDF file, the application, the job file, the status,
 * and any credit debit in one batch. Generating the PDF happens before this
 * runs, so a failed file never spends a credit. A second save of the same job
 * does not debit again.
 */
export async function commitTailoredResume(db: D1Database, row: TailoredResumeStore): Promise<ResumeStoreResult> {
  const artifact = artifactIdentity("job", row.jobId);
  const charge = row.charge ? 1 : 0;
  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = datetime('now')`,
      ).bind(row.jobId, row.userId, row.resumeCipher),
      db.prepare("DELETE FROM packs WHERE job_id = ? AND user_id = ? AND kind = 'resume'").bind(row.jobId, row.userId),
      db.prepare(UPSERT_RESUME_ARTIFACT).bind(
        row.userId,
        artifact.artifactKey,
        artifact.kind,
        artifact.jobId,
        artifact.uploadId,
        row.filename,
        row.htmlCipher,
        row.pdfCipher,
      ),
      db.prepare(
        `INSERT INTO packs (job_id, user_id, kind, ciphertext, created_at) VALUES (?, ?, 'application', ?, datetime('now'))
         ON CONFLICT(job_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
      ).bind(row.jobId, row.userId, row.applicationCipher),
      db.prepare(
        `INSERT INTO packs (job_id, user_id, kind, ciphertext, created_at) VALUES (?, ?, 'jd', ?, datetime('now'))
         ON CONFLICT(job_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
      ).bind(row.jobId, row.userId, row.jobFileCipher),
      db.prepare(
        `UPDATE jobs SET fit_json = ?, status = CASE WHEN status = 'evaluated' THEN 'resume_ready' ELSE status END,
         updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).bind(row.fitJson, row.jobId, row.userId),
      db.prepare(
        `UPDATE users SET resume_credits = resume_credits - 1
         WHERE id = ?
           AND ? = 1
           AND resume_credits > 0
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_resume')`,
      ).bind(row.userId, charge, row.jobId),
      db.prepare(
        `INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id)
         SELECT ?, 'spend_resume', 0, -1, ?
         WHERE changes() = 1
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_resume')`,
      ).bind(row.userId, row.jobId, row.jobId),
      db.prepare(abortBatchWhen(
        "? = 1 AND changes() = 0 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_resume')",
      )).bind(charge, row.jobId),
    ]);
    return (results[6]?.meta.changes ?? 0) > 0 ? "charged" : "rebuilt";
  } catch (err) {
    if (isUnpaidGuard(err)) return "unpaid";
    throw err;
  }
}
