import { laneFor, routeFromUrl } from "../shared/engine/classify";
import { buildApplication, buildJobFile } from "../shared/engine/documents";
import { evaluateFit, locationCheck, titleTokens, type JobInput } from "../shared/engine/fit";
import { tailorResume } from "../shared/engine/tailor";
import { emptyDetails, type Contact, type Profile } from "../shared/types";
import { encryptJson } from "./crypto";
import type { Env } from "./env";
import { fetchJob, isFetchableUrl } from "./jobFetch";

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
export const MAX_DEEP_CHECKS = 24;
export const PACKS_PER_SCAN = 3;
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

export function indiaMarketLocation(location: string): boolean {
  const value = location.trim().toLowerCase();
  if (!value) return true;
  if (/\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|mumbai|chennai|kolkata|ahmedabad|delhi|ncr|kochi|cochin|jaipur|chandigarh|indore|bhubaneswar|thiruvananthapuram)\b/.test(value)) return true;
  if (!/\b(remote|work from home|anywhere)\b/.test(value)) return false;
  return !/\b(us|usa|uk|ca|canada|be|belgium|au|australia|europe|emea|americas|latin america|united states|united kingdom|germany|france|spain|netherlands|singapore|japan)\b/.test(value);
}

export async function matchingRows(env: Env, userId: string, profile: Profile): Promise<DiscoverRow[]> {
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
    if (profile.preferences.country === "IN" && !indiaMarketLocation(o.location)) continue;
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

export interface CheckedOpening {
  row: DiscoverRow;
  input: JobInput & { url: string };
  fit: ReturnType<typeof evaluateFit>;
}

export async function checkOpening(row: DiscoverRow, profile: Profile): Promise<CheckedOpening | null> {
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

function annualPay(input: JobInput, profile: Profile): { low: number | null; high: number | null } {
  const fit = evaluateFit(input, profile);
  const pay = fit.parsedSalary;
  if (!pay || pay.currency !== profile.preferences.currency) return { low: null, high: null };
  return { low: pay.annualMin, high: pay.annualMax };
}

export async function packStatements(
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

  return {
    id,
    statements: [
      env.DB.prepare(
        `INSERT INTO jobs
         (id, user_id, title, company, location, url, salary_text, description, status, fit_json, lane, route, pay_low, pay_high, contact_count, details_ciphertext)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'resume_ready', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, userId, input.title, input.company, input.location, input.url, input.salaryText, input.description,
        JSON.stringify(fit), laneFor(input.location, pay.low, pay.high, profile.preferences), routeFromUrl(input.url),
        pay.low, pay.high, contacts.length, packed[3],
      ),
      env.DB.prepare("INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)").bind(id, userId, packed[0]),
      env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'resume', ?)").bind(id, userId, packed[0]),
      env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'application', ?)").bind(id, userId, packed[1]),
      env.DB.prepare("INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'jd', ?)").bind(id, userId, packed[2]),
      env.DB.prepare(
        "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id, note) VALUES (?, 'spend_scan_pack', -1, -1, ?, 'prepared by job scan')",
      ).bind(userId, id),
    ],
  };
}
