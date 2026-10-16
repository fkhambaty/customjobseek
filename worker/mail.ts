import { CODE_TTL_MINUTES } from "../shared/password";
import { sha256 } from "./crypto";
import { HttpError, type Env } from "./env";

export { CODE_TTL_MINUTES };

export async function sendMail(env: Env, to: string, subject: string, text: string, headers?: Record<string, string>): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log(`Email not configured. Would send to ${to}: ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text, headers }),
  });
  if (!res.ok) {
    console.error("Resend failed", res.status);
    throw new HttpError(502, "The email could not be sent. Try again in a minute.");
  }
}

function newCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
}

const GAP_MS = 60_000;
const CODE_TTL_MS = CODE_TTL_MINUTES * 60_000;

export interface IssuedCode {
  id: number;
  createdAt: string;
  expiresAt: string;
  expiresInMinutes: number;
}

export async function issueCode(env: Env, email: string, purpose: "signup" | "reset"): Promise<IssuedCode | null> {
  const recent = await env.DB.prepare(
    "SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, purpose)
    .first<{ created_at: string }>();
  if (recent && Date.now() - Date.parse(recent.created_at) < GAP_MS) return null;

  const code = newCode();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  const row = await env.DB.prepare(
    "INSERT INTO email_codes (email, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(email, purpose, await sha256(code), expiresAt, createdAt)
    .first<{ id: number }>();
  if (!row) throw new HttpError(500, "The email could not be sent. Try again in a minute.");

  const action = purpose === "signup" ? "confirm your CustomJobSeek account" : "set a new CustomJobSeek password";
  await sendMail(
    env,
    email,
    purpose === "signup" ? "Your CustomJobSeek code" : "Reset your CustomJobSeek password",
    `Your code to ${action} is ${code}.\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for this, ignore the email.`,
  );
  return { id: row.id, createdAt, expiresAt, expiresInMinutes: CODE_TTL_MINUTES };
}

export async function takeCode(env: Env, email: string, purpose: "signup" | "reset", code: string): Promise<IssuedCode | null> {
  const row = await env.DB.prepare(
    "SELECT id, code_hash, attempts, created_at FROM email_codes WHERE email = ? AND purpose = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, purpose, new Date().toISOString())
    .first<{ id: number; code_hash: string; attempts: number; created_at: string }>();
  if (!row || row.attempts >= 5) return null;
  if (row.code_hash !== (await sha256(code.trim()))) {
    await env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return null;
  }
  await env.DB.prepare("DELETE FROM email_codes WHERE email = ? AND purpose = ?").bind(email, purpose).run();
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: new Date(Date.parse(row.created_at) + CODE_TTL_MS).toISOString(),
    expiresInMinutes: CODE_TTL_MINUTES,
  };
}
