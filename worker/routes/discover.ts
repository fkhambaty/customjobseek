import { Hono } from "hono";
import { laneFor, routeFromUrl } from "../../shared/engine/classify";
import { buildApplication, buildJobFile } from "../../shared/engine/documents";
import { evaluateFit, locationCheck, titleTokens, type JobInput } from "../../shared/engine/fit";
import { tailorResume } from "../../shared/engine/tailor";
import { emptyDetails, type Contact, type Profile } from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { encryptJson } from "../crypto";
import { HttpError, type AppEnv, type Env } from "../env";
import { fetchJob, isFetchableUrl } from "../jobFetch";
import { requireUser } from "../session";
import { loadProfile } from "./profile";
import { JOB_SELECT, toJob, type JobRow } from "./serialise";

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
const MAX_TITLE_CANDIDATES = 800;
const MAX_DEEP_CHECKS = 24;
const PACKS_PER_SCAN = 3;
const GENERIC_TITLE_WORDS = new Set([
  "senior", "junior", "lead", "manager", "director", "consultant", "specialist", "associate", "principal", "head", "staff", "intern", "internal", "corporate",
]);

export function meaningfulTitleMatch(title: string, targets: string[]): number {
  const jobTokens = new Set(titleTokens(title));
  let best = 0;
  for (const role of targets) {
    const roleTokens = titleTokens(role);
    const specific = roleTokens.filter((word) => !GENERIC_TITLE_WORDS.has(word));
    if (!roleTokens.length || !specific.some((token) => jobTokens.has(token))) continue;
    const hit = roleTokens.filter((token) => jobTokens.has(token)).length;
    best = Math.max(best, hit / roleTokens.length);
  }
  return best >= 0.5 ? best : 0;
}

async function matchingRows(env: Env, userId: string, profile: Profile): Promise<DiscoverRow[]> {
  const targets = profile.preferences.targetRoles;
  const keywords = [...new Set(targets.flatMap(titleTokens))].filter((w) => w.length >= 3).slice(0, MAX_KEYWORDS);
  if (!keywords.length) return [];

  const { results } = await env.DB.prepare(
    `SELECT o.title, o.location, o.url, o.updated_at, co.name AS company, co.ats
     FROM openings o JOIN companies co ON co.id = o.company_id
     WHERE (${keywords.map(() => "LOWER(o.title) LIKE ?").join(" OR ")})
       AND o.url NOT IN (SELECT url FROM jobs WHERE user_id = ? AND url != '')
     ORDER BY o.updated_at DESC LIMIT ${MAX_TITLE_CANDIDATES}`,
  )
    .bind(...keywords.map((k) => `%${k}%`), userId)
    .all<{ title: string; location: string; url: string; updated_at: string; company: string; ats: string }>();

  const excluded = profile.preferences.excludedTitleWords.map((w) => w.toLowerCase()).filter(Boolean);
  const rows: DiscoverRow[] = [];
  for (const o of results) {
    const lower = o.title.toLowerCase();
    if (excluded.some((w) => lower.includes(w))) continue;
    const match = meaningfulTitleMatch(o.title, targets);
    if (!match) continue;
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
  return rows.slice(0, 150);
}

function annualPay(input: JobInput, profile: Profile): { low: number | null; high: number | null } {
  const fit = evaluateFit(input, profile);
  const pay = fit.parsedSalary;
  if (!pay || pay.currency !== profile.preferences.currency) return { low: null, high: null };
  return { low: pay.annualMin, high: pay.annualMax };
}

/** Only contacts printed in the posting are retained, encrypted in this user's job details. */
export function contactsFrom(description: string): Contact[] {
  const found = new Map<string, Contact>();
  let previousEmailEnd = 0;
  for (const match of description.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = (match[0] ?? "").toLowerCase();
    if (!email || found.has(email)) continue;
    const index = match.index ?? 0;
    const before = description.slice(Math.max(previousEmailEnd, index - 140), index);
    const named = [...before.matchAll(/\b(?:[Cc]ontact|[Rr]ecruiter|[Rr]each out to)\s+(?:our\s+)?([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})/g)].at(-1);
    found.set(email, {
      id: `posting-contact-${found.size}`,
      name: named?.[1] ?? "",
      role: /\brecruiter\b/i.test(before) ? "Recruiter named in the posting" : "Contact listed in the posting",
      url: "",
      email,
    });
    previousEmailEnd = index + email.length;
    if (found.size === 10) break;
  }
  return [...found.values()];
}

interface CheckedOpening {
  row: DiscoverRow;
  input: JobInput & { url: string };
  fit: ReturnType<typeof evaluateFit>;
}

async function checkOpening(row: DiscoverRow, profile: Profile): Promise<CheckedOpening | null> {
  const url = isFetchableUrl(row.url);
  if (!url) return null;
  const fetched = await fetchJob(url).catch(() => null);
  if (!fetched || fetched.description.length < 150) return null;
  const input = {
    ...fetched,
    title: fetched.title || row.title,
    company: fetched.company || row.company,
    location: fetched.location || row.location,
    url: row.url,
  };
  return { row, input, fit: evaluateFit(input, profile) };
}

async function packStatements(
  env: Env,
  userId: string,
  profile: Profile,
  checked: CheckedOpening,
): Promise<{ id: string; statements: D1PreparedStatement[] }> {
  const { input, fit } = checked;
  const id = crypto.randomUUID();
  const resume = tailorResume(profile, fit, { id, title: input.title, company: input.company });
  const application = buildApplication(profile, fit, resume);
  const jobFile = buildJobFile(input, fit);
  const contacts = contactsFrom(input.description);
  const details = { ...emptyDetails(), contacts };
  const pay = annualPay(input, profile);
  const packed = await Promise.all([
    encryptJson(env.DATA_KEY, resume),
    encryptJson(env.DATA_KEY, application),
    encryptJson(env.DATA_KEY, jobFile),
    encryptJson(env.DATA_KEY, details),
  ]);

  return { id, statements: [
    env.DB.prepare(
      `INSERT INTO jobs
       (id, user_id, title, company, location, url, salary_text, description, status, fit_json, lane, route, pay_low, pay_high, contact_count, details_ciphertext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'resume_ready', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      input.title,
      input.company,
      input.location,
      input.url,
      input.salaryText,
      input.description,
      JSON.stringify(fit),
      laneFor(input.location, pay.low, pay.high, profile.preferences),
      routeFromUrl(input.url),
      pay.low,
      pay.high,
      contacts.length,
      packed[3],
    ),
    env.DB.prepare("INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)").bind(id, userId, packed[0]),
    env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'resume', ?)").bind(id, userId, packed[0]),
    env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'application', ?)").bind(id, userId, packed[1]),
    env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'jd', ?)").bind(id, userId, packed[2]),
    env.DB.prepare(
      "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id, note) VALUES (?, 'spend_scan_pack', -1, -1, ?, 'prepared by job scan')",
    ).bind(userId, id),
  ] };
}

/** Openings whose title and place match, before any credit is spent. */
export const discover = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const needsTargets = profile.preferences.targetRoles.length === 0;
    return c.json({ needsTargets, rows: needsTargets ? [] : await matchingRows(c.env, user.id, profile) });
  })
  .post("/scan", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const missing = profileReadiness(profile);
    if (missing.length) throw new HttpError(400, `Finish your profile first: add ${missing.join(", ")}.`);
    if (!profile.preferences.targetRoles.length) throw new HttpError(400, "Add the job titles you want to your profile first.");

    const available = Math.min(PACKS_PER_SCAN, user.eval_credits, user.resume_credits);
    if (available < 1) throw new HttpError(402, "You have used all your application packs. Pick a plan to scan again.");

    const rows = await matchingRows(c.env, user.id, profile);
    const readable = (await Promise.all(rows.slice(0, MAX_DEEP_CHECKS).map((row) => checkOpening(row, profile))))
      .filter((item): item is CheckedOpening => item !== null && item.fit.blockers.length === 0);
    const chosen = readable
      .sort((a, b) => b.row.match - a.row.match || b.fit.score - a.fit.score)
      .slice(0, available);
    if (!chosen.length) {
      throw new HttpError(422, "The strongest title matches could not be read or had a deal-breaker. Nothing was charged.");
    }

    const reserved = await c.env.DB.prepare(
      "UPDATE users SET eval_credits = eval_credits - ?, resume_credits = resume_credits - ? WHERE id = ? AND eval_credits >= ? AND resume_credits >= ?",
    ).bind(chosen.length, chosen.length, user.id, chosen.length, chosen.length).run();
    if (!reserved.meta.changes) throw new HttpError(409, "Your credits changed while this scan was running. Refresh and try again.");

    let packs: { id: string; statements: D1PreparedStatement[] }[];
    try {
      packs = [];
      for (const item of chosen) packs.push(await packStatements(c.env, user.id, profile, item));
      await c.env.DB.batch(packs.flatMap((pack) => pack.statements));
    } catch (error) {
      await c.env.DB.prepare("UPDATE users SET eval_credits = eval_credits + ?, resume_credits = resume_credits + ? WHERE id = ?")
        .bind(chosen.length, chosen.length, user.id)
        .run();
      throw error;
    }
    const prepared = await Promise.all(packs.map(async (pack) => {
      const row = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ? AND j.user_id = ?`).bind(pack.id, user.id).first<JobRow>();
      if (!row) throw new Error("Prepared job was not saved");
      return toJob(row);
    }));
    const preparedUrls = new Set(prepared.map((job) => job.url));
    return c.json({
      prepared,
      locked: rows.filter((row) => !preparedUrls.has(row.url)),
      checked: Math.min(rows.length, MAX_DEEP_CHECKS),
    });
  });
