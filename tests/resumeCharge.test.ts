import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { freshPlatformProxy } from "./localDb";
import { commitTailoredResume, type TailoredResumeStore } from "../worker/resumeCharge";

function store(userId: string, jobId: string, charge: boolean, marker: string): TailoredResumeStore {
  return {
    userId,
    jobId,
    charge,
    fitJson: "{}",
    resumeCipher: `resume-${marker}`,
    applicationCipher: `application-${marker}`,
    jobFileCipher: `job-${marker}`,
    filename: "Asha Rao.pdf",
    htmlCipher: `html-${marker}`,
    pdfCipher: `pdf-${marker}`,
  };
}

describe("tailored resume charge", () => {
  it("spends once inside the batch, rebuilds for free, and rolls back when the file cannot be stored", async () => {
    const proxy = await freshPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const userId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const failId = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO users (id, email, password_hash, resume_credits) VALUES (?, ?, 'x', 1)")
        .bind(userId, `${userId}@example.com`)
        .run();
      await db.prepare("INSERT INTO jobs (id, user_id, title, description, fit_json, status) VALUES (?, ?, 'Role', 'A long enough description for the row.', '{}', 'evaluated')")
        .bind(jobId, userId)
        .run();
      await db.prepare("INSERT INTO jobs (id, user_id, title, description, fit_json, status) VALUES (?, ?, 'Role', 'A long enough description for the row.', '{}', 'interview')")
        .bind(failId, userId)
        .run();

      const charged = await commitTailoredResume(db, store(userId, jobId, true, "one"));
      expect(charged).toBe("charged");
      const spent = await db.prepare("SELECT resume_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(spent?.n).toBe(0);
      const ledger = await db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE job_id = ? AND kind = 'spend_resume'").bind(jobId).first<{ n: number }>();
      expect(ledger?.n).toBe(1);
      const file = await db.prepare("SELECT filename FROM resume_artifacts WHERE user_id = ? AND job_id = ?").bind(userId, jobId).first<{ filename: string }>();
      expect(file?.filename).toBe("Asha Rao.pdf");
      const status = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first<{ status: string }>();
      expect(status?.status).toBe("resume_ready");
      const packs = await db.prepare("SELECT kind FROM packs WHERE job_id = ? ORDER BY kind").bind(jobId).all<{ kind: string }>();
      expect(packs.results.map((row) => row.kind)).toEqual(["application", "jd"]);

      await db.prepare("UPDATE users SET resume_credits = 1 WHERE id = ?").bind(userId).run();
      const rebuilt = await commitTailoredResume(db, store(userId, jobId, false, "two"));
      expect(rebuilt).toBe("rebuilt");
      const kept = await db.prepare("SELECT resume_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(kept?.n).toBe(1);
      const stillOne = await db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE job_id = ? AND kind = 'spend_resume'").bind(jobId).first<{ n: number }>();
      expect(stillOne?.n).toBe(1);
      const updated = await db.prepare("SELECT ciphertext FROM resumes WHERE job_id = ?").bind(jobId).first<{ ciphertext: string }>();
      expect(updated?.ciphertext).toBe("resume-two");

      const raced = await commitTailoredResume(db, store(userId, jobId, true, "three"));
      expect(raced).toBe("rebuilt");
      const afterRace = await db.prepare("SELECT resume_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(afterRace?.n).toBe(1);

      await db.prepare("UPDATE users SET resume_credits = 0 WHERE id = ?").bind(userId).run();
      const unpaid = await commitTailoredResume(db, store(userId, failId, true, "none"));
      expect(unpaid).toBe("unpaid");
      const stillInterview = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(failId).first<{ status: string }>();
      expect(stillInterview?.status).toBe("interview");
      const noResume = await db.prepare("SELECT job_id FROM resumes WHERE job_id = ?").bind(failId).first();
      expect(noResume).toBeNull();
      const noLedger = await db.prepare("SELECT id FROM credit_ledger WHERE job_id = ?").bind(failId).first();
      expect(noLedger).toBeNull();

      await db.prepare("UPDATE users SET resume_credits = 1 WHERE id = ?").bind(userId).run();
      await db.prepare(
        `CREATE TRIGGER _resume_artifact_fail BEFORE INSERT ON resume_artifacts WHEN NEW.job_id = '${failId}' BEGIN SELECT RAISE(ROLLBACK, 'forced artifact failure'); END`,
      ).run();
      await expect(commitTailoredResume(db, store(userId, failId, true, "fail"))).rejects.toThrow();
      const refunded = await db.prepare("SELECT resume_credits AS n FROM users WHERE id = ?").bind(userId).first<{ n: number }>();
      expect(refunded?.n).toBe(1);
      const ghost = await db.prepare("SELECT job_id FROM resumes WHERE job_id = ?").bind(failId).first();
      expect(ghost).toBeNull();
      const ghostLedger = await db.prepare("SELECT id FROM credit_ledger WHERE job_id = ?").bind(failId).first();
      expect(ghostLedger).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER IF EXISTS _resume_artifact_fail").run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  });
});
