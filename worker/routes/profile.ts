import { Hono } from "hono";
import { emptyProfile, type Profile } from "../../shared/types";
import { profileReadiness, sanitiseProfile } from "../../shared/validate";
import { decryptJson, encryptJson } from "../crypto";
import type { AppEnv, Env } from "../env";
import { requireUser } from "../session";

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
  });
