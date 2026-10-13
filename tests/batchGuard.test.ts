import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { abortBatchWhen } from "../worker/batchGuard";

describe("atomic batch guard", () => {
  it("fails the batch through the empty guard table", () => {
    expect(abortBatchWhen("changes() = 0")).toBe("INSERT INTO batch_guards (ok) SELECT 0 WHERE changes() = 0");
  });

  it("rolls back a claimed debit when the guard fires and does not debit twice", async () => {
    const proxy = await getPlatformProxy();
    const db = proxy.env.DB as D1Database;
    try {
      await db.prepare("DROP TABLE IF EXISTS _batch_probe").run();
      await db.prepare(
        `CREATE TABLE _batch_probe (
           id INTEGER PRIMARY KEY,
           n INTEGER NOT NULL,
           flag TEXT NOT NULL DEFAULT '',
           ok INTEGER NOT NULL DEFAULT 1 CHECK (ok = 1)
         )`,
      ).run();
      await db.prepare("INSERT INTO _batch_probe (id, n) VALUES (1, 10)").run();

      const debit = (flag: string, need: number) => [
        db.prepare("UPDATE _batch_probe SET flag = ? WHERE id = 1 AND flag = ''").bind(flag),
        db.prepare("UPDATE _batch_probe SET n = n - 4 WHERE id = 1 AND n >= ? AND changes() = 1 AND flag = ?").bind(need, flag),
        db.prepare(
          "INSERT INTO _batch_probe (n, ok) SELECT 0, 0 WHERE changes() = 0 AND EXISTS (SELECT 1 FROM _batch_probe WHERE id = 1 AND flag = ?)",
        ).bind(flag),
      ];

      await db.batch(debit("claimed", 4));
      const kept = await db.prepare("SELECT n, flag FROM _batch_probe WHERE id = 1").first<{ n: number; flag: string }>();
      expect(kept).toEqual({ n: 6, flag: "claimed" });

      await expect(db.batch(debit("claimed", 4))).rejects.toThrow(/CHECK constraint failed: ok = 1/);
      const once = await db.prepare("SELECT n, flag FROM _batch_probe WHERE id = 1").first<{ n: number; flag: string }>();
      expect(once).toEqual({ n: 6, flag: "claimed" });

      await db.prepare("UPDATE _batch_probe SET flag = '' WHERE id = 1").run();
      await expect(db.batch(debit("short", 100))).rejects.toThrow(/CHECK constraint failed: ok = 1/);
      const rolled = await db.prepare("SELECT n, flag FROM _batch_probe WHERE id = 1").first<{ n: number; flag: string }>();
      expect(rolled).toEqual({ n: 6, flag: "" });

      const divided = await db.prepare("SELECT 1/0 AS z").first<{ z: null }>();
      expect(divided?.z).toBeNull();
      await expect(
        db.prepare("WITH claim AS (UPDATE _batch_probe SET n = 1 WHERE id = 1 RETURNING id) SELECT COUNT(*) AS c FROM claim").first(),
      ).rejects.toThrow(/near "UPDATE"/);
    } finally {
      await db.prepare("DROP TABLE IF EXISTS _batch_probe").run();
      await proxy.dispose();
    }
  });
});
