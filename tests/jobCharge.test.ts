import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { storeEvaluatedJob, type EvaluatedJobRow } from "../worker/jobCharge";

function row(userId: string, id: string): EvaluatedJobRow {
  return {
    id,
    userId,
    title: "Lead Data Solutions Architect",
    company: "Syngenta Group",
    location: "Pune, Maharashtra, in",
    url: "https://jobs.smartrecruiters.com/SyngentaGroup/744000145796757",
    salaryText: "",
    description: "A".repeat(180),
    fitJson: "{}",
    lane: "in",
    route: "smartrecruiters",
    payLow: null,
    payHigh: null,
    provenance: "unknown",
  };
}

describe("fit check charge", () => {
  it("keeps the credit when the job insert fails, and does not charge twice", async () => {
    const proxy = await getPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const userId = crypto.randomUUID();
    const failId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO users (id, email, password_hash, eval_credits) VALUES (?, ?, 'x', 1)")
        .bind(userId, `${userId}@example.com`)
        .run();

      const jobId = crypto.randomUUID();
      const stored = await storeEvaluatedJob(db, row(userId, jobId));
      expect(stored).toBe("stored");
      const spent = await db.prepare("SELECT eval_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(spent?.n).toBe(0);

      await db.prepare("UPDATE users SET eval_credits = 2 WHERE id = ?").bind(userId).run();
      const again = await storeEvaluatedJob(db, row(userId, jobId));
      expect(again).toBe("replay");
      const replayed = await db.prepare("SELECT eval_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(replayed?.n).toBe(2);
      const ledger = await db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ? AND kind = 'spend_eval'").bind(userId).first<{ n: number }>();
      expect(ledger?.n).toBe(1);

      await db.prepare("UPDATE users SET eval_credits = 0 WHERE id = ?").bind(userId).run();
      const unpaid = await storeEvaluatedJob(db, row(userId, crypto.randomUUID()));
      expect(unpaid).toBe("unpaid");
      const still = await db.prepare("SELECT eval_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(still?.n).toBe(0);
      const jobs = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?").bind(userId).first<{ n: number }>();
      expect(jobs?.n).toBe(1);

      await db.prepare("UPDATE users SET eval_credits = 1 WHERE id = ?").bind(userId).run();
      await db.prepare(
        `CREATE TRIGGER _fit_job_fail BEFORE INSERT ON jobs WHEN NEW.id = '${failId}' BEGIN SELECT RAISE(ROLLBACK, 'forced job insert failure'); END`,
      ).run();
      await expect(storeEvaluatedJob(db, row(userId, failId))).rejects.toThrow();
      const kept = await db.prepare("SELECT eval_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(kept?.n).toBe(1);
      const failed = await db.prepare("SELECT id FROM jobs WHERE id = ?").bind(failId).first();
      expect(failed).toBeNull();
      const extraLedger = await db.prepare("SELECT id FROM credit_ledger WHERE job_id = ?").bind(failId).first();
      expect(extraLedger).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER IF EXISTS _fit_job_fail").run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  });
});
