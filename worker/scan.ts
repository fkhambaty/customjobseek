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

function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function asList(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
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
      const data = (await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings?limit=100`)) as {
        content?: Record<string, unknown>[];
      };
      return asList(data.content).map((j) => ({
        externalId: text(j.id),
        title: text(j.name),
        location: text((j.location as { city?: string } | undefined)?.city),
        url: text(j.ref) || `${board.careerUrl}/${text(j.id)}`,
        description: "",
      }));
    }
    case "workday":
    case "website":
      return [];
    default: {
      const never: never = board.ats;
      return never;
    }
  }
}

const SCANNABLE: Ats[] = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"];

async function saveOpenings(env: Env, companyId: string, openings: Opening[]): Promise<void> {
  const listed = openings.filter((o) => o.externalId && o.title).slice(0, 2000);
  const statements = [
    env.DB.prepare("DELETE FROM openings WHERE company_id = ?").bind(companyId),
    ...listed.map((o) =>
      env.DB.prepare(
        "INSERT INTO openings (company_id, external_id, title, location, url, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(companyId, o.externalId, o.title.slice(0, 200), o.location.slice(0, 200), o.url.slice(0, 1000), new Date().toISOString()),
    ),
    env.DB.prepare(
      "UPDATE companies SET scan_status = 'ok', last_error = '', opening_count = ?, last_scan_at = ? WHERE id = ?",
    ).bind(listed.length, new Date().toISOString(), companyId),
  ];
  // D1 batches are capped. Chunk the inserts.
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}

export async function scanCompany(env: Env, companyId: string): Promise<{ count: number; error: string }> {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first<Row>();
  if (!company) return { count: 0, error: "Company not found" };
  if (!SCANNABLE.includes(company.ats as Ats)) {
    await env.DB.prepare("UPDATE companies SET scan_status = 'unsupported', last_scan_at = ?, last_error = '' WHERE id = ?")
      .bind(new Date().toISOString(), companyId)
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
    await env.DB.prepare("UPDATE companies SET scan_status = 'error', last_error = ?, last_scan_at = ? WHERE id = ?")
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
    await env.DB.prepare(
      "INSERT INTO companies (id, name, career_url, ats, board_token, added_by) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(companyId, board.nameHint, board.careerUrl, board.ats, board.token, userId)
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
    `SELECT id FROM companies WHERE ats IN ('greenhouse','lever','ashby','workable','smartrecruiters')
     ORDER BY last_scan_at IS NOT NULL, last_scan_at LIMIT 20`,
  ).all<{ id: string }>();
  for (const row of results) await scanCompany(env, row.id);
}

export async function openingByUrl(rawUrl: string): Promise<Opening | null> {
  const board = detectBoard(rawUrl);
  if (!board || !SCANNABLE.includes(board.ats)) return null;
  const openings = await listOpenings(board).catch(() => []);
  const id = new URL(rawUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  return openings.find((o) => o.url === rawUrl || o.externalId === id || o.url.includes(id)) ?? null;
}
