import { Hono } from "hono";
import type { AppEnv } from "../env";

function page(message: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email choices</title><body style="margin:0;background:#f6f3ee;color:#1c1915;font:16px/1.5 Georgia,serif"><main style="max-width:32rem;margin:12vh auto;padding:0 24px"><p style="letter-spacing:.08em;text-transform:uppercase;font:600 12px system-ui,sans-serif;color:#6b645c">CustomJobSeek</p><h1 style="font-weight:500;font-size:32px;margin:8px 0">Email choices</h1><p>${message}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#6b645c">We do not sell candidate data. Account mail is separate from these notes.</p></main></body></html>`;
}

async function optOut(db: D1Database, token: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(token)) return false;
  const now = new Date().toISOString();
  const updated = await db.prepare(
    `UPDATE consent_preferences
     SET marketing_email = 0, product_email = 0, marketing_opt_out_at = COALESCE(marketing_opt_out_at, ?), updated_at = ?
     WHERE unsubscribe_token = ?`,
  ).bind(now, now, token).run();
  return Boolean(updated.meta.changes);
}

export const mailPrefs = new Hono<AppEnv>()
  .get("/unsubscribe", async (c) => {
    const ok = await optOut(c.env.DB, c.req.query("token") ?? "");
    if (!ok) return c.html(page("This link is not valid."), 400);
    return c.html(page("Marketing email is off. Mail about a finished scan, low credits, or an expiring plan stays as you set it in Account."));
  })
  .post("/unsubscribe", async (c) => {
    const ok = await optOut(c.env.DB, c.req.query("token") ?? "");
    if (!ok) return c.body("This link is not valid.", 400);
    return c.body("Marketing email is off.", 200);
  });
