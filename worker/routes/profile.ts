import { Hono } from "hono";
import { profileFromResumeText } from "../../shared/engine/importResume";
import { emptyProfile, type Profile } from "../../shared/types";
import { profileReadiness, sanitiseProfile } from "../../shared/validate";
import { decryptJson, encryptJson } from "../crypto";
import { HttpError, type AppEnv, type Env } from "../env";
import { requireUser } from "../session";
import { extractText, getDocumentProxy } from "unpdf";

export async function loadProfile(env: Env, userId: string, email: string): Promise<Profile> {
  const row = await env.DB.prepare("SELECT ciphertext FROM profiles WHERE user_id = ?").bind(userId).first<{ ciphertext: string }>();
  return row ? sanitiseProfile(await decryptJson(env.DATA_KEY, row.ciphertext)) : emptyProfile(email);
}

export const profile = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const p = await loadProfile(c.env, user.id, user.email);
    return c.json({ profile: p, missing: profileReadiness(p) });
  })
  .put("/", async (c) => {
    const user = c.get("user");
    const p = sanitiseProfile(await c.req.json().catch(() => ({})));
    await c.env.DB.prepare(
      `INSERT INTO profiles (user_id, ciphertext, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    )
      .bind(user.id, await encryptJson(c.env.DATA_KEY, p))
      .run();
    return c.json({ profile: p, missing: profileReadiness(p) });
  })
  .post("/resume-file", async (c) => {
    const user = c.get("user");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength < 100 || bytes.byteLength > 2_000_000) throw new HttpError(400, "Upload a PDF under 2 MB.");
    const doc = await getDocumentProxy(bytes).catch(() => null);
    if (!doc) throw new HttpError(422, "That file could not be read. Use a text-based PDF, not a scanned image.");
    const extracted = await extractText(doc, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    if (!text || text.trim().length < 80) throw new HttpError(422, "Almost no text came out of that PDF. It may be a scan.");
    const draft = sanitiseProfile(profileFromResumeText(text, user.email));
    const filename = (c.req.header("x-file-name") ?? "").replace(/[^\w .()-]/g, "").slice(0, 120) || "Uploaded resume.pdf";
    await c.env.DB.prepare("INSERT INTO resume_uploads (id, user_id, filename, label, format, text_ciphertext) VALUES (?, ?, ?, ?, 'text', ?)")
      .bind(crypto.randomUUID(), user.id, filename, filename.replace(/\.pdf$/i, ""), await encryptJson(c.env.DATA_KEY, { text: text.slice(0, 100_000) }))
      .run();
    return c.json({ profile: draft, missing: profileReadiness(draft) });
  });
