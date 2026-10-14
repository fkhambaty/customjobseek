import type { D1Database } from "@cloudflare/workers-types";
import { abortBatchWhen } from "./batchGuard";

export type JobStoreResult = "stored" | "replay" | "unpaid";

export interface EvaluatedJobRow {
  id: string;
  userId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  salaryText: string;
  description: string;
  fitJson: string;
  lane: string;
  route: string;
  payLow: number | null;
  payHigh: number | null;
  provenance: string;
  searchPathId?: string | null;
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
 * Inserts the job, spends one fit credit, and writes the ledger in one batch.
 * The credit moves only after the job row is inserted. A failed insert rolls back.
 * Repeating the same job id does not spend a second credit.
 */
export async function storeEvaluatedJob(db: D1Database, row: EvaluatedJobRow): Promise<JobStoreResult> {
  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO jobs (id, user_id, title, company, location, url, salary_text, description, fit_json, lane, route, pay_low, pay_high, pay_provenance, search_path_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        row.id,
        row.userId,
        row.title,
        row.company,
        row.location,
        row.url,
        row.salaryText,
        row.description,
        row.fitJson,
        row.lane,
        row.route,
        row.payLow,
        row.payHigh,
        row.provenance,
        row.searchPathId ?? null,
      ),
      db.prepare(
        `UPDATE users SET eval_credits = eval_credits - 1
         WHERE id = ? AND eval_credits > 0 AND changes() = 1`,
      ).bind(row.userId),
      db.prepare(
        `INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id)
         SELECT ?, 'spend_eval', -1, 0, ?
         WHERE changes() = 1
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_eval')`,
      ).bind(row.userId, row.id, row.id),
      db.prepare(
        abortBatchWhen(
          "changes() = 0 AND EXISTS (SELECT 1 FROM jobs WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_eval')",
        ),
      ).bind(row.id, row.id),
    ]);
    return (results[0]?.meta.changes ?? 0) > 0 ? "stored" : "replay";
  } catch (err) {
    if (isUnpaidGuard(err)) return "unpaid";
    throw err;
  }
}
