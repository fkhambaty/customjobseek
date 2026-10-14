import { Hono } from "hono";
import {
  companyListCursor,
  companyNameLike,
  pageSlice,
  parseCompanyCursor,
  parseCompanyPageLimit,
  type CompanyCursor,
} from "../../shared/capacity";
import { countryByCode } from "../../shared/geo";
import { featuredCatalogCounts, sourceCatalog } from "../../shared/engine/sourceCatalog";
import { HttpError, type AppContext, type AppEnv } from "../env";
import { isFetchableUrl } from "../jobFetch";
import { enforceRateLimit, requestIp } from "../rateLimit";
import { addCareerPage } from "../scan";
import { requireUser } from "../session";

interface ListedCompany extends CompanyCursor {
  id: string;
  name: string;
  career_url: string;
  ats: string;
  scan_status: string;
  opening_count: number;
  last_scan_at: string | null;
  country: string;
  sectors: string;
  verified_at: string | null;
  active: number;
  scan_priority: number;
}

function cacheStore(): Cache | null {
  const storage = (globalThis as { caches?: { default?: Cache } }).caches;
  return storage?.default ?? null;
}

/** A cache hit is frozen. Security headers still need a response they can change. */
function editableResponse(response: Response, extra?: Record<string, string>): Response {
  const headers = new Headers();
  response.headers.forEach((value, key) => headers.set(key, value));
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readPublic(c: AppContext, load: () => Promise<Response>): Promise<Response> {
  await enforceRateLimit(c.env.DB, "companies_read", requestIp((name) => c.req.header(name)));
  const cache = cacheStore();
  const key = new Request(c.req.url, { method: "GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return editableResponse(hit);
  }
  const response = await load();
  const cached = editableResponse(response, { "cache-control": "public, max-age=60" });
  if (cache) c.executionCtx?.waitUntil(cache.put(key, cached.clone()));
  return cached;
}

export const companies = new Hono<AppEnv>()
  .get("/stats", async (c) => {
    return readPublic(c, async () => {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS employers,
       SUM(CASE WHEN active = 1 AND scan_status = 'ok' THEN 1 ELSE 0 END) AS readable,
       SUM(CASE WHEN active = 1 AND scan_status = 'unsupported' THEN 1 ELSE 0 END) AS unsupported,
       SUM(CASE WHEN active = 1 THEN opening_count ELSE 0 END) AS openings,
       MAX(CASE WHEN scan_status = 'ok' THEN last_scan_at END) AS freshest_at
       FROM companies`,
    ).first<{ employers: number; readable: number; openings: number; unsupported: number; freshest_at: string | null }>();
    const { results } = await c.env.DB.prepare(
      `SELECT country,
       COUNT(*) AS employers,
       SUM(CASE WHEN active = 1 AND scan_status = 'ok' THEN 1 ELSE 0 END) AS readable
       FROM companies WHERE country != '' GROUP BY country`,
    ).all<{ country: string; employers: number; readable: number }>();
    const stored = new Map(results.map((item) => [item.country, item]));
    const health = await c.env.DB.prepare(
      "SELECT ats, last_ok_at, consecutive_failures FROM source_adapters",
    ).all<{ ats: string; last_ok_at: string | null; consecutive_failures: number }>();
    return c.json({
      employers: row?.employers ?? 0,
      readable: row?.readable ?? 0,
      unsupported: row?.unsupported ?? 0,
      openings: row?.openings ?? 0,
      freshestAt: row?.freshest_at ?? null,
      catalogBoards: sourceCatalog().length,
      countries: featuredCatalogCounts().map((item) => ({
        code: item.country,
        name: countryByCode(item.country)?.name ?? item.country,
        catalog: item.catalog,
        employers: stored.get(item.country)?.employers ?? 0,
        readable: stored.get(item.country)?.readable ?? 0,
      })),
      health: health.results.map((item) => ({
        ats: item.ats,
        lastOkAt: item.last_ok_at,
        failures: item.consecutive_failures,
      })),
    });
    });
  })
  .get("/", async (c) => {
    return readPublic(c, async () => {
      const limit = parseCompanyPageLimit(c.req.query("limit"));
      const cursor = parseCompanyCursor(c.req.query("cursor"));
      const like = companyNameLike(c.req.query("q"));
      const clauses: string[] = [];
      const binds: (string | number)[] = [];
      if (like) {
        clauses.push("(name LIKE ? ESCAPE '\\' OR career_url LIKE ? ESCAPE '\\' OR ats LIKE ? ESCAPE '\\')");
        binds.push(like, like, like);
      }
      if (cursor) {
        clauses.push(`(
          active < ? OR
          (active = ? AND scan_priority < ?) OR
          (active = ? AND scan_priority = ? AND opening_count < ?) OR
          (active = ? AND scan_priority = ? AND opening_count = ? AND name > ?) OR
          (active = ? AND scan_priority = ? AND opening_count = ? AND name = ? AND id > ?)
        )`);
        binds.push(
          cursor.active,
          cursor.active, cursor.priority,
          cursor.active, cursor.priority, cursor.openings,
          cursor.active, cursor.priority, cursor.openings, cursor.name,
          cursor.active, cursor.priority, cursor.openings, cursor.name, cursor.id,
        );
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const { results } = await c.env.DB.prepare(
        `SELECT id, name, career_url, ats, scan_status, opening_count, last_scan_at, country, sectors,
         verified_at, active, scan_priority FROM companies
         ${where}
         ORDER BY active DESC, scan_priority DESC, opening_count DESC, name ASC, id ASC
         LIMIT ?`,
      ).bind(...binds, limit + 1).all<ListedCompany>();
      const page = pageSlice(results, limit);
      const last = page.rows[page.rows.length - 1];
      return c.json({
        companies: page.rows.map((row) => ({
          id: row.id,
          name: row.name,
          career_url: row.career_url,
          ats: row.ats,
          scan_status: row.scan_status,
          opening_count: row.opening_count,
          last_scan_at: row.last_scan_at,
          country: row.country,
          sectors: row.sectors,
          verified_at: row.verified_at,
          active: row.active,
        })),
        nextCursor: page.hasMore && last
          ? companyListCursor({
            active: last.active ? 1 : 0,
            priority: last.scan_priority,
            openings: last.opening_count,
            name: last.name,
            id: last.id,
          })
          : null,
      });
    });
  })
  .get("/:id/openings", async (c) => {
    return readPublic(c, async () => {
      const { results } = await c.env.DB.prepare(
        `SELECT title, location, url FROM openings
         WHERE company_id = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY title LIMIT 300`,
      )
        .bind(c.req.param("id"), new Date().toISOString())
        .all();
      return c.json(results);
    });
  })
  .post("/missed", requireUser, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
    if (!isFetchableUrl(url)) throw new HttpError(400, "Enter a full link starting with https://");
    const added = await addCareerPage(c.env, url, c.get("user").id, note);
    return c.json(added, 201);
  });
