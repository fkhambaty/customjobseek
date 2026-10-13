import { companyKey, silenceDays } from "../shared/agency";
import type { Channel } from "../shared/types";
import { decryptJson, encryptJson } from "./crypto";
import type { Env } from "./env";

export async function ensureThread(db: D1Database, userId: string, companyName: string): Promise<{ id: string; company: string } | null> {
  const key = companyKey(companyName);
  const company = companyName.trim().slice(0, 200);
  if (!key || !company) return null;
  const existing = await db.prepare("SELECT id, company_name FROM company_threads WHERE user_id = ? AND company_key = ?")
    .bind(userId, key)
    .first<{ id: string; company_name: string }>();
  if (existing) return { id: existing.id, company: existing.company_name };
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO company_threads (id, user_id, company_key, company_name) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, company_key) DO NOTHING",
  ).bind(id, userId, key, company).run();
  const row = await db.prepare("SELECT id, company_name FROM company_threads WHERE user_id = ? AND company_key = ?")
    .bind(userId, key)
    .first<{ id: string; company_name: string }>();
  return row ? { id: row.id, company: row.company_name } : null;
}

export async function logCompanyMessage(env: Env, input: {
  userId: string;
  company: string;
  jobId: string | null;
  eventId: string | null;
  direction: "out" | "in";
  channel: Channel | "";
  at: string;
  person: string;
  note: string;
}): Promise<void> {
  const thread = await ensureThread(env.DB, input.userId, input.company);
  if (!thread) return;
  const id = crypto.randomUUID();
  const ciphertext = await encryptJson(env.DATA_KEY, { person: input.person.slice(0, 120), note: input.note.slice(0, 2000) });
  const inserted = await env.DB.prepare(
    `INSERT INTO thread_messages (id, thread_id, user_id, job_id, event_id, direction, channel, at, ciphertext)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) WHERE event_id IS NOT NULL DO NOTHING`,
  ).bind(
    id,
    thread.id,
    input.userId,
    input.jobId,
    input.eventId,
    input.direction,
    input.channel,
    input.at,
    ciphertext,
  ).run();
  if (!inserted.meta.changes) return;
  const column = input.direction === "in" ? "last_in_at" : "last_out_at";
  await env.DB.prepare(
    `UPDATE company_threads SET ${column} = CASE WHEN ${column} IS NULL OR ${column} < ? THEN ? ELSE ${column} END, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(input.at, input.at, thread.id, input.userId).run();
}

export interface ThreadSummary {
  id: string;
  company: string;
  companyKey: string;
  followUpOn: string | null;
  lastOutAt: string | null;
  lastInAt: string | null;
  silenceDays: number | null;
  messages: number;
  openRoles: number;
}

interface ThreadRow {
  id: string;
  company_name: string;
  company_key: string;
  follow_up_on: string | null;
  last_out_at: string | null;
  last_in_at: string | null;
  messages: number;
  open_roles: number;
}

export async function listThreads(db: D1Database, userId: string, today: string): Promise<ThreadSummary[]> {
  const { results } = await db.prepare(
    `SELECT t.id, t.company_name, t.company_key, t.follow_up_on, t.last_out_at, t.last_in_at,
            (SELECT COUNT(*) FROM thread_messages m WHERE m.thread_id = t.id) AS messages,
            0 AS open_roles
     FROM company_threads t
     WHERE t.user_id = ?
     ORDER BY COALESCE(t.follow_up_on, t.updated_at) DESC`,
  ).bind(userId).all<ThreadRow>();
  const { results: roles } = await db.prepare(
    "SELECT company, status FROM jobs WHERE user_id = ? AND status NOT IN ('rejected', 'withdrawn', 'closed')",
  ).bind(userId).all<{ company: string; status: string }>();
  const openByCompany = new Map<string, number>();
  for (const role of roles) {
    const key = companyKey(role.company);
    if (!key) continue;
    openByCompany.set(key, (openByCompany.get(key) ?? 0) + 1);
  }
  return results.map((row) => ({
    id: row.id,
    company: row.company_name,
    companyKey: row.company_key,
    followUpOn: row.follow_up_on,
    lastOutAt: row.last_out_at,
    lastInAt: row.last_in_at,
    silenceDays: silenceDays(row.last_out_at, row.last_in_at, today),
    messages: row.messages,
    openRoles: openByCompany.get(row.company_key) ?? 0,
  }));
}

export interface ThreadMessageView {
  id: string;
  jobId: string | null;
  direction: "out" | "in";
  channel: string;
  at: string;
  person: string;
  note: string;
  title: string;
}

export async function threadMessages(env: Env, userId: string, threadId: string): Promise<ThreadMessageView[] | null> {
  const thread = await env.DB.prepare("SELECT id FROM company_threads WHERE id = ? AND user_id = ?")
    .bind(threadId, userId)
    .first<{ id: string }>();
  if (!thread) return null;
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.job_id, m.direction, m.channel, m.at, m.ciphertext, COALESCE(j.title, '') AS title
     FROM thread_messages m
     LEFT JOIN jobs j ON j.id = m.job_id AND j.user_id = m.user_id
     WHERE m.thread_id = ? AND m.user_id = ?
     ORDER BY m.at DESC`,
  ).bind(threadId, userId).all<{
    id: string;
    job_id: string | null;
    direction: string;
    channel: string;
    at: string;
    ciphertext: string;
    title: string;
  }>();
  return Promise.all(results.map(async (row) => {
    const body = row.ciphertext
      ? await decryptJson<{ person?: string; note?: string }>(env.DATA_KEY, row.ciphertext)
      : { person: "", note: "" };
    const direction: "out" | "in" = row.direction === "in" ? "in" : "out";
    return {
      id: row.id,
      jobId: row.job_id,
      direction,
      channel: row.channel,
      at: row.at,
      person: body.person ?? "",
      note: body.note ?? "",
      title: row.title,
    };
  }));
}
