import { Hono } from "hono";
import { HttpError, type AppEnv } from "../env";
import { isFetchableUrl } from "../jobFetch";
import { addCareerPage } from "../scan";
import { requireUser } from "../session";

export const companies = new Hono<AppEnv>()
  .get("/stats", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS employers,
       SUM(CASE WHEN active = 1 AND scan_status = 'ok' THEN 1 ELSE 0 END) AS readable,
       SUM(CASE WHEN active = 1 THEN opening_count ELSE 0 END) AS openings,
       MAX(last_scan_at) AS freshest_at
       FROM companies WHERE country = 'IN'`,
    ).first<{ employers: number; readable: number; openings: number; freshest_at: string | null }>();
    return c.json({
      employers: row?.employers ?? 0,
      readable: row?.readable ?? 0,
      openings: row?.openings ?? 0,
      freshestAt: row?.freshest_at ?? null,
    });
  })
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, career_url, ats, scan_status, opening_count, last_scan_at, country, sectors,
       verified_at, active FROM companies ORDER BY active DESC, scan_priority DESC, opening_count DESC, name LIMIT 5000`,
    ).all();
    return c.json(results);
  })
  .get("/:id/openings", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT title, location, url FROM openings WHERE company_id = ? ORDER BY title LIMIT 300",
    )
      .bind(c.req.param("id"))
      .all();
    return c.json(results);
  })
  .post("/missed", requireUser, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
    if (!isFetchableUrl(url)) throw new HttpError(400, "Enter a full link starting with https://");
    const added = await addCareerPage(c.env, url, c.get("user").id, note);
    return c.json(added, 201);
  });
