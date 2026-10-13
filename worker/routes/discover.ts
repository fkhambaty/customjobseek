import { Hono } from "hono";
import { locationCheck, titleAlignment, titleTokens } from "../../shared/engine/fit";
import type { AppEnv } from "../env";
import { requireUser } from "../session";
import { loadProfile } from "./profile";

export interface DiscoverRow {
  title: string;
  location: string;
  url: string;
  company: string;
  ats: string;
  seenAt: string;
  match: number;
  locationNote: string;
}

const MAX_KEYWORDS = 10;

/** Openings from scanned boards that match the person's target titles and places, before any credit is spent. */
export const discover = new Hono<AppEnv>().use(requireUser).get("/", async (c) => {
  const user = c.get("user");
  const profile = await loadProfile(c.env, user.id, user.email);
  const targets = profile.preferences.targetRoles;
  const keywords = [...new Set(targets.flatMap(titleTokens))].filter((w) => w.length >= 3).slice(0, MAX_KEYWORDS);
  if (!keywords.length) return c.json({ needsTargets: true, rows: [] as DiscoverRow[] });

  const { results } = await c.env.DB.prepare(
    `SELECT o.title, o.location, o.url, o.updated_at, co.name AS company, co.ats
     FROM openings o JOIN companies co ON co.id = o.company_id
     WHERE (${keywords.map(() => "LOWER(o.title) LIKE ?").join(" OR ")})
       AND o.url NOT IN (SELECT url FROM jobs WHERE user_id = ? AND url != '')
     ORDER BY o.updated_at DESC LIMIT 4000`,
  )
    .bind(...keywords.map((k) => `%${k}%`), user.id)
    .all<{ title: string; location: string; url: string; updated_at: string; company: string; ats: string }>();

  const excluded = profile.preferences.excludedTitleWords.map((w) => w.toLowerCase()).filter(Boolean);
  const rows: DiscoverRow[] = [];
  for (const o of results) {
    const lower = o.title.toLowerCase();
    if (excluded.some((w) => lower.includes(w))) continue;
    const match = titleAlignment(o.title, targets);
    if (match < 0.5) continue;
    const place = locationCheck({ title: o.title, company: o.company, location: o.location, salaryText: "", description: "" }, profile);
    if (place.blocker) continue;
    rows.push({
      title: o.title,
      location: o.location,
      url: o.url,
      company: o.company,
      ats: o.ats,
      seenAt: o.updated_at,
      match: Math.round(match * 100),
      locationNote: place.note ?? "",
    });
  }
  rows.sort((a, b) => b.match - a.match || b.seenAt.localeCompare(a.seenAt));
  return c.json({ needsTargets: false, rows: rows.slice(0, 150) });
});
