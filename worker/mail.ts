import { sha256 } from "./crypto";
import { HttpError, type Env } from "./env";

export async function sendMail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log(`Email not configured. Would send to ${to}: ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
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

export async function issueCode(env: Env, email: string, purpose: "signup" | "reset"): Promise<void> {
  const recent = await env.DB.prepare(
    "SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, purpose)
    .first<{ created_at: string }>();
  if (recent && Date.now() - Date.parse(recent.created_at) < GAP_MS) return;

  const code = newCode();
  const now = new Date();
  await env.DB.prepare(
    "INSERT INTO email_codes (email, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(email, purpose, await sha256(code), new Date(now.getTime() + 15 * 60_000).toISOString(), now.toISOString())
    .run();

  const action = purpose === "signup" ? "confirm your CustomJobSeek account" : "set a new CustomJobSeek password";
  await sendMail(
    env,
    email,
    purpose === "signup" ? "Your CustomJobSeek code" : "Reset your CustomJobSeek password",
    `Your code to ${action} is ${code}.\n\nIt expires in 15 minutes. If you did not ask for this, ignore the email.`,
  );
}

export async function takeCode(env: Env, email: string, purpose: "signup" | "reset", code: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id, code_hash, attempts FROM email_codes WHERE email = ? AND purpose = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, purpose, new Date().toISOString())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= 5) return false;
  if (row.code_hash !== (await sha256(code.trim()))) {
    await env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return false;
  }
  await env.DB.prepare("DELETE FROM email_codes WHERE email = ? AND purpose = ?").bind(email, purpose).run();
  return true;
}
