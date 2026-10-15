import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { freshPlatformProxy } from "./localDb";
import { resumeFileLinks } from "../shared/resumeFile";
import { emptyProfile, type Profile } from "../shared/types";
import { encryptJson, sha256 } from "../worker/crypto";
import worker from "../worker/index";
import type { Env } from "../worker/env";

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

function profile(email: string): Profile {
  const base = emptyProfile(email);
  return {
    ...base,
    fullName: "Asha Rao",
    headline: "Analytics Lead",
    summary: "Analytics lead who turns messy data into decisions people trust.",
    totalYears: 9,
    skills: [
      { name: "SQL", level: "expert" },
      { name: "Python", level: "expert" },
      { name: "Tableau", level: "working" },
    ],
    experience: [
      {
        id: "e1",
        company: "Acme Bank",
        title: "Analytics Manager",
        location: "Pune",
        start: "2019",
        end: "Present",
        bullets: [
          { id: "b1", text: "Led a team of six analysts building SQL and Python models for credit risk" },
          { id: "b2", text: "Built Tableau dashboards used weekly by the retail banking leadership team" },
        ],
      },
    ],
    preferences: { ...base.preferences, country: "IN", cities: ["Pune"], targetRoles: ["Analytics Lead"] },
  };
}

const DESCRIPTION = `Citi is hiring an Analytics and Insights Lead (Vice President) in Pune.
You will lead analytics for retail banking, build SQL and Python models, and present insights to leadership.
Requirements: 8+ years in analytics, strong SQL, Python, Tableau, and stakeholder management.`;

describe("build from profile for an imported job", () => {
  it("builds, stores, and serves the resume for a job id with spaces, pipes, colons, and slashes", async () => {
    const proxy = await freshPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const dataKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const env = { DB: db, DATA_KEY: dataKey } as unknown as Env;
    const userId = crypto.randomUUID();
    const email = `${userId}@example.com`;
    const token = `test-${crypto.randomUUID()}`;
    const jobIds = [
      `cc:Citi|26995386|Citi_Analytics_and_Insights_Lead_Vice_President_${userId.slice(0, 8)}`,
      `cc:A/B Bank (India)|req-${userId.slice(0, 8)}|Analytics_Lead`,
    ];
    try {
      await db.prepare("INSERT INTO users (id, email, password_hash, email_verified, plan, resume_credits) VALUES (?, ?, 'x', 1, 'pro', 5)")
        .bind(userId, email).run();
      await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(await sha256(token), userId, new Date(Date.now() + 600_000).toISOString()).run();
      await db.prepare("INSERT INTO profiles (user_id, ciphertext) VALUES (?, ?)")
        .bind(userId, await encryptJson(dataKey, profile(email))).run();
      for (const id of jobIds) {
        await db.prepare("INSERT INTO jobs (id, user_id, title, company, location, description, fit_json) VALUES (?, ?, ?, 'Citi', 'Pune', ?, '{}')")
          .bind(id, userId, "Analytics and Insights Lead - Vice President", DESCRIPTION).run();
      }
      const headers = { cookie: `cjs_session=${token}` };
      const call = (path: string, init: RequestInit = {}) =>
        worker.fetch(new Request(`https://x.test${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, ctx);

      for (const id of jobIds) {
        const built = await call(`/api/jobs/${encodeURIComponent(id)}/resume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(built.status, await built.clone().text()).toBe(200);
        const body = (await built.json()) as { resume: { fullName: string } };
        expect(body.resume.fullName).toBe("Asha Rao");

        const links = resumeFileLinks("job", id);
        const pdf = await call(links.pdf);
        expect(pdf.status).toBe(200);
        expect(pdf.headers.get("content-type")).toBe("application/pdf");
        expect(new TextDecoder("latin1").decode(new Uint8Array(await pdf.arrayBuffer()).subarray(0, 8))).toContain("%PDF-");

        const download = await call(links.download);
        expect(download.status).toBe(200);
        expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);

        const html = await call(links.html);
        expect(html.status).toBe(200);
        expect(await html.text()).toContain("Asha Rao");

        const pack = await call(`/api/jobs/${encodeURIComponent(id)}/pack`);
        expect(pack.status).toBe(200);
        expect(((await pack.json()) as { resume: unknown }).resume).not.toBeNull();
      }

      const rebuilt = await call(`/api/jobs/${encodeURIComponent(jobIds[0]!)}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(rebuilt.status).toBe(200);
      const credits = await db.prepare("SELECT resume_credits FROM users WHERE id = ?").bind(userId).first<{ resume_credits: number }>();
      expect(credits?.resume_credits).toBe(3);
    } finally {
      for (const table of ["resume_artifacts", "packs", "resumes", "credit_ledger", "jobs", "profiles", "sessions", "usage_snapshots", "product_events"]) {
        await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run().catch(() => undefined);
      }
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  }, 60_000);
});
