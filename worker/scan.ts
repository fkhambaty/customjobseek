import type { Ats, BoardRef } from "../shared/engine/boards";
import { detectBoard } from "../shared/engine/boards";
import type { Env } from "./env";

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export interface Opening {
  externalId: string;
  title: string;
  location: string;
  url: string;
  description: string;
}

interface Row {
  id: string;
  name: string;
  career_url: string;
  ats: string;
  board_token: string;
  opening_count: number;
  scan_status: string;
  last_scan_at: string | null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Board responded ${res.status}`);
  return res.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Board responded ${res.status}`);
  return res.json();
}

function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function asList(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

function isIndiaLocation(location: string): boolean {
  return /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|mumbai|chennai|kolkata|ahmedabad)\b/i.test(location);
}

export async function listOpenings(board: BoardRef): Promise<Opening[]> {
  switch (board.ats) {
    case "greenhouse": {
      const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs`)) as {
        jobs?: Record<string, unknown>[];
      };
      return asList(data.jobs).map((j) => ({
        externalId: text(j.id),
        title: text(j.title),
        location: text((j.location as { name?: string } | undefined)?.name),
        url: text(j.absolute_url),
        description: htmlToText(text(j.content)),
      }));
    }
    case "lever": {
      const data = asList(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`));
      return data.map((j) => {
        const cats = (j.categories as Record<string, unknown> | undefined) ?? {};
        const lists = asList(j.lists).map((l) => `${text(l.text)}\n${htmlToText(text(l.content))}`);
        return {
          externalId: text(j.id),
          title: text(j.text),
          location: text(cats.location),
          url: text(j.hostedUrl),
          description: [text(j.descriptionPlain), ...lists].filter(Boolean).join("\n"),
        };
      });
    }
    case "ashby": {
      const data = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}`)) as {
        jobs?: Record<string, unknown>[];
      };
      return asList(data.jobs)
        .filter((j) => j.isListed !== false)
        .map((j) => ({
          externalId: text(j.id),
          title: text(j.title),
          location: text(j.location),
          url: text(j.jobUrl) || `${board.careerUrl}/${text(j.id)}`,
          description: text(j.descriptionPlain) || htmlToText(text(j.descriptionHtml)),
        }));
    }
    case "workable": {
      const data = (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board.token)}`)) as Record<string, unknown>;
      return asList(data.jobs ?? data.results).map((j) => ({
        externalId: text(j.shortcode) || text(j.id),
        title: text(j.title),
        location: text(j.location) || text((j.location as { city?: string } | undefined)?.city),
        url: text(j.url) || text(j.application_url),
        description: htmlToText(text(j.description)),
      }));
    }
    case "smartrecruiters": {
      const jobs: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 2000; offset += 100) {
        const data = (await getJson(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings?limit=100&offset=${offset}`,
        )) as { content?: Record<string, unknown>[]; totalFound?: number };
        const page = asList(data.content);
        jobs.push(...page);
        if (page.length < 100 || jobs.length >= Number(data.totalFound ?? 0)) break;
      }
      return jobs.map((j) => ({
        externalId: text(j.id),
        title: text(j.name),
        location: text((j.location as { city?: string } | undefined)?.city),
        url: text(j.ref) || `${board.careerUrl}/${text(j.id)}`,
        description: "",
      }));
    }
    case "workday": {
      const career = new URL(board.careerUrl);
      const tenant = career.hostname.split(".")[0] ?? "";
      const parts = career.pathname.split("/").filter(Boolean);
      const site = parts.at(-1) ?? "";
      if (!tenant || !site) throw new Error("Workday board needs its public site name");
      const jobs: Record<string, unknown>[] = [];
      let total = 1;
      for (let offset = 0; offset < total && offset < 2000; offset += 20) {
        const data = (await postJson(
          `${career.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
          { appliedFacets: {}, limit: 20, offset, searchText: "" },
        )) as { jobPostings?: Record<string, unknown>[]; total?: number };
        jobs.push(...asList(data.jobPostings));
        total = Number(data.total ?? jobs.length);
      }
      return jobs.map((j) => ({
        externalId: text(j.externalPath).split("/").filter(Boolean).at(-1) ?? text(j.externalPath),
        title: text(j.title),
        location: text(j.locationsText),
        url: `${career.origin}${text(j.externalPath)}`,
        description: "",
      }));
    }
    case "website":
      return [];
    default: {
      const never: never = board.ats;
      return never;
    }
  }
}

const SCANNABLE: Ats[] = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday"];

async function saveOpenings(env: Env, companyId: string, openings: Opening[]): Promise<void> {
  const listed = openings.filter((o) => o.externalId && o.title).slice(0, 2000);
  const hasIndiaOpenings = listed.some((opening) => isIndiaLocation(opening.location));
  const now = new Date();
  const statements = [
    env.DB.prepare("DELETE FROM openings WHERE company_id = ?").bind(companyId),
    ...listed.map((o) =>
      env.DB.prepare(
        "INSERT INTO openings (company_id, external_id, title, location, url, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(companyId, o.externalId, o.title.slice(0, 200), o.location.slice(0, 200), o.url.slice(0, 1000), new Date().toISOString()),
    ),
    env.DB.prepare(
      `UPDATE companies SET scan_status = 'ok', last_error = '', opening_count = ?, last_scan_at = ?,
       next_scan_at = ?, consecutive_failures = 0,
       country = CASE WHEN ? = 1 THEN 'IN' ELSE country END,
       source_url = CASE WHEN ? = 1 AND source_url = '' THEN career_url ELSE source_url END,
       verified_at = CASE WHEN ? = 1 THEN COALESCE(verified_at, ?) ELSE verified_at END
       WHERE id = ?`,
    ).bind(
      listed.length, now.toISOString(), new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
      hasIndiaOpenings ? 1 : 0, hasIndiaOpenings ? 1 : 0, hasIndiaOpenings ? 1 : 0, now.toISOString(), companyId,
    ),
  ];
  // D1 batches are capped. Chunk the inserts.
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}

export async function scanCompany(env: Env, companyId: string): Promise<{ count: number; error: string }> {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first<Row>();
  if (!company) return { count: 0, error: "Company not found" };
  if (!SCANNABLE.includes(company.ats as Ats)) {
    await env.DB.prepare(
      "UPDATE companies SET scan_status = 'unsupported', last_scan_at = ?, next_scan_at = ?, last_error = '' WHERE id = ?",
    )
      .bind(new Date().toISOString(), new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(), companyId)
      .run();
    return { count: 0, error: "" };
  }
  try {
    const openings = await listOpenings({
      ats: company.ats as Ats,
      token: company.board_token,
      careerUrl: company.career_url,
      nameHint: company.name,
    });
    await saveOpenings(env, companyId, openings);
    return { count: Math.min(openings.filter((o) => o.externalId && o.title).length, 2000), error: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await env.DB.prepare(
      `UPDATE companies SET scan_status = 'error', last_error = ?, last_scan_at = ?,
       consecutive_failures = consecutive_failures + 1,
       next_scan_at = datetime('now', '+' || MIN(24, (consecutive_failures + 1) * 2) || ' hours')
       WHERE id = ?`,
    )
      .bind(message.slice(0, 300), new Date().toISOString(), companyId)
      .run();
    return { count: 0, error: message };
  }
}

export async function addCareerPage(env: Env, rawUrl: string, userId: string | null, note = ""): Promise<{ companyId: string; name: string; ats: Ats; count: number; error: string }> {
  const board = detectBoard(rawUrl);
  if (!board) throw new Error("That link is not a web address.");
  const existing = await env.DB.prepare("SELECT id FROM companies WHERE career_url = ?").bind(board.careerUrl).first<{ id: string }>();
  const companyId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    const domain = new URL(board.careerUrl).hostname.toLowerCase().replace(/^www\./, "");
    await env.DB.prepare(
      `INSERT INTO companies
       (id, name, career_url, ats, board_token, added_by, country, source_url, normalized_domain, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?)`,
    )
      .bind(companyId, board.nameHint, board.careerUrl, board.ats, board.token, userId, rawUrl, domain, new Date().toISOString())
      .run();
  }
  if (userId) {
    await env.DB.prepare("INSERT INTO missed_reports (id, user_id, url, note, company_id) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), userId, rawUrl.slice(0, 1000), note.slice(0, 500), companyId)
      .run();
  }
  const scanned = await scanCompany(env, companyId);
  return { companyId, name: board.nameHint, ats: board.ats, count: scanned.count, error: scanned.error };
}

export async function scanDue(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM companies
     WHERE active = 1 AND ats IN ('greenhouse','lever','ashby','workable','smartrecruiters','workday')
       AND (next_scan_at IS NULL OR next_scan_at <= ?)
     ORDER BY scan_priority DESC, last_scan_at IS NOT NULL, last_scan_at LIMIT 20`,
  ).bind(new Date().toISOString()).all<{ id: string }>();
  for (const row of results) await scanCompany(env, row.id);
}

export async function openingByUrl(rawUrl: string): Promise<Opening | null> {
  const board = detectBoard(rawUrl);
  if (!board || !SCANNABLE.includes(board.ats)) return null;
  const openings = await listOpenings(board).catch(() => []);
  const id = new URL(rawUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  return openings.find((o) => o.url === rawUrl || o.externalId === id || o.url.includes(id)) ?? null;
}
