import { Hono } from "hono";
import { HttpError, type AppEnv } from "../env";
import { isFetchableUrl } from "../jobFetch";
import { addCareerPage } from "../scan";
import { requireUser } from "../session";

export const companies = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, career_url, ats, scan_status, opening_count, last_scan_at FROM companies ORDER BY opening_count DESC, name LIMIT 200",
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
