import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/env";

const QUOTA_ERROR = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

function fakeDb(handle: (sql: string) => unknown): D1Database {
  const statement = (sql: string) => {
    const stmt = {
      bind: () => stmt,
      first: async () => handle(sql),
      run: async () => handle(sql),
      all: async () => ({ results: [handle(sql)].filter(Boolean) }),
    };
    return stmt;
  };
  return { prepare: statement, batch: async () => [] } as unknown as D1Database;
}

function env(db: D1Database, analytics = false): Env {
  return {
    DB: db,
    DATA_KEY: "test",
    ...(analytics ? { CF_ACCOUNT_ID: "acct", CF_ANALYTICS_API_TOKEN: "token" } : {}),
  } as unknown as Env;
}

function nearlyFullAnalytics() {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 1000, rowsWritten: 90_000 } }] }] } },
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe("capacity pause responses", () => {
  it("turns the D1 daily-limit error into a friendly 503 with the reset time", async () => {
    const db = fakeDb(() => { throw new Error(QUOTA_ERROR); });
    const res = await worker.fetch(new Request("https://x.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "long-enough-password" }),
    }), env(db), ctx);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as Record<string, string>;
    expect(body.code).toBe("capacity_paused");
    expect(body.reason).toBe("quota_reached");
    expect(body.resetAt).toMatch(/T00:00:00\.000Z$/);
    expect(body.error).not.toMatch(/Something went wrong/);
  });

  it("pauses a free account near the limit but lets a paying one through", async () => {
    nearlyFullAnalytics();
    const free = await worker.fetch(new Request("https://x.test/api/nothing-here", { headers: { cookie: "cjs_session=abc" } }),
      env(fakeDb((sql) => (sql.includes("AS paid") ? { paid: 0 } : null)), true), ctx);
    expect(free.status).toBe(503);
    expect(((await free.json()) as Record<string, string>).reason).toBe("saving_for_paid");

    const paid = await worker.fetch(new Request("https://x.test/api/nothing-here", { headers: { cookie: "cjs_session=abc" } }),
      env(fakeDb((sql) => (sql.includes("AS paid") ? { paid: 1 } : null)), true), ctx);
    expect(paid.status).toBe(404);
  });

  it("applies the same capacity protection to mobile bearer sessions", async () => {
    nearlyFullAnalytics();
    const headers = { authorization: `Bearer cjsma_${"a".repeat(43)}` };
    const free = await worker.fetch(new Request("https://x.test/api/nothing-here", { headers }),
      env(fakeDb((sql) => (sql.includes("AS paid") ? { paid: 0 } : null)), true), ctx);
    expect(free.status).toBe(503);

    const paid = await worker.fetch(new Request("https://x.test/api/nothing-here", { headers }),
      env(fakeDb((sql) => (sql.includes("AS paid") ? { paid: 1 } : null)), true), ctx);
    expect(paid.status).toBe(404);
  });

  it("keeps payment webhooks open even when free accounts are paused", async () => {
    nearlyFullAnalytics();
    const res = await worker.fetch(new Request("https://x.test/api/plans"), env(fakeDb(() => ({ paid: 0 })), true), ctx);
    expect(res.status).toBe(200);
  });
});
