import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";

const MIGRATIONS = import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Splits a migration into single statements. Trigger bodies stay whole until their closing `END;`. */
export function migrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  let inTrigger = false;
  for (const raw of sql.split("\n")) {
    const line = raw.replace(/--.*$/, "").trimEnd();
    if (!line.trim()) continue;
    current.push(line);
    if (/^\s*CREATE\s+TRIGGER\b/i.test(line)) inTrigger = true;
    const ends = inTrigger ? /^\s*END;\s*$/i.test(line) : line.endsWith(";");
    if (ends) {
      statements.push(current.join("\n"));
      current = [];
      inTrigger = false;
    }
  }
  if (current.length) statements.push(current.join("\n"));
  return statements;
}

export function migrationFiles(): string[] {
  return Object.keys(MIGRATIONS).sort();
}

/**
 * A private in-memory D1 with every migration applied. Test files never share a
 * database file, so one file closing its proxy cannot lock the next one out.
 */
export async function freshPlatformProxy() {
  const proxy = await getPlatformProxy({ persist: false });
  const db = proxy.env.DB as D1Database;
  for (const file of migrationFiles()) {
    for (const statement of migrationStatements(MIGRATIONS[file] ?? "")) {
      await db.prepare(statement).run();
    }
  }
  return proxy;
}
