import { discoveryTokens } from "../shared/capacity";
import { payProvenanceFor } from "../shared/agency";
import { laneFor, routeFromUrl } from "../shared/engine/classify";
import { buildApplication, buildJobFile } from "../shared/engine/documents";
import { evaluateFit, locationCheck, marketLocationOk, titleTokens, type JobInput } from "../shared/engine/fit";
import { occupationSearchWords, resolveRole } from "../shared/engine/occupations";
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
  const jobRole = resolveRole(title);
  let best = 0;
  for (const role of targets) {
    const target = resolveRole(role);
    if (jobRole.occupationId && target.occupationId === jobRole.occupationId) {
      best = Math.max(best, 0.92);
      continue;
    }
    const roleTokens = titleTokens(role);
    const specific = roleTokens.filter((word) => !GENERIC_TITLE_WORDS.has(word));
    if (!roleTokens.length || !specific.some((token) => jobTokens.has(token))) continue;
    const hit = roleTokens.filter((token) => jobTokens.has(token)).length;
    best = Math.max(best, hit / roleTokens.length);
  }
  return best >= 0.5 ? best : 0;
}

export function indiaMarketLocation(location: string): boolean {
  return marketLocationOk(location, "IN");
}

export async function matchingRows(env: Env, userId: string, profile: Profile): Promise<DiscoverRow[]> {
  const targets = profile.preferences.targetRoles;
  const keywords = discoveryTokens(
    [...new Set([...targets.flatMap(titleTokens), ...occupationSearchWords(targets)])].filter((word) => !GENERIC_TITLE_WORDS.has(word)),
  ).slice(0, MAX_KEYWORDS);
  if (!keywords.length) return [];

  const nowIso = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT o.title, o.location, o.url, o.updated_at, co.name AS company, co.ats
     FROM opening_search s
     JOIN openings o ON o.company_id = s.company_id AND o.external_id = s.external_id
     JOIN companies co ON co.id = o.company_id
     WHERE s.token IN (${keywords.map(() => "?").join(", ")})
       AND (o.expires_at IS NULL OR o.expires_at > ?)
       AND o.url NOT IN (SELECT url FROM jobs WHERE user_id = ? AND url != '')
     GROUP BY o.company_id, o.external_id
     ORDER BY o.updated_at DESC LIMIT ${MAX_TITLE_CANDIDATES}`,
  )
    .bind(...keywords, nowIso, userId)
    .all<{ title: string; location: string; url: string; updated_at: string; company: string; ats: string }>();

  const excluded = profile.preferences.excludedTitleWords.map((w) => w.toLowerCase()).filter(Boolean);
  const rows: DiscoverRow[] = [];
  for (const o of results) {
    if (profile.preferences.country && !marketLocationOk(o.location, profile.preferences.country)) continue;
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

export interface ScanChargeGate {
  scanId: string;
  chargeToken: string;
  jobId: string;
}

/** Turns `INSERT ... VALUES (...)` into `INSERT ... SELECT ...` so a WHERE gate can follow. */
export function chargeGatedInsert(insertSql: string): string {
  const selectSql = insertSql.replace("VALUES (", "SELECT ").replace(/\)\s*$/, "");
  if (selectSql.includes("VALUES") || !selectSql.includes("SELECT")) {
    throw new Error("Scan charge insert could not be gated.");
  }
  return selectSql;
}

function gated(
  db: D1Database,
  insertSql: string,
  binds: unknown[],
  gate: ScanChargeGate | null,
  duplicateSql: string,
  duplicateBinds: unknown[],
): D1PreparedStatement {
  if (!gate) return db.prepare(insertSql).bind(...binds);
  const selectSql = chargeGatedInsert(insertSql);
  return db.prepare(
    `${selectSql}
     WHERE EXISTS (SELECT 1 FROM market_scans WHERE id = ? AND charge_token = ?)
       AND NOT EXISTS (${duplicateSql})`,
  ).bind(...binds, gate.scanId, gate.chargeToken, ...duplicateBinds);
}

export async function packStatements(
  env: Env,
  userId: string,
  profile: Profile,
  checked: CheckedOpening,
  gate: ScanChargeGate | null = null,
): Promise<{ id: string; statements: D1PreparedStatement[] }> {
  const { input, fit } = checked;
  const id = gate?.jobId ?? crypto.randomUUID();
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

  const jobBinds = [
    id, userId, input.title, input.company, input.location, input.url, input.salaryText, input.description,
    JSON.stringify(fit), laneFor(input.location, pay.low, pay.high, profile.preferences), routeFromUrl(input.url),
    pay.low, pay.high,
    payProvenanceFor({ salaryText: input.salaryText, payEstimated: false, parsed: fit.parsedSalary !== null }),
    contacts.length, packed[3],
  ];
  return {
    id,
    statements: [
      gated(
        env.DB,
        `INSERT INTO jobs
         (id, user_id, title, company, location, url, salary_text, description, status, fit_json, lane, route, pay_low, pay_high, pay_provenance, contact_count, details_ciphertext)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'resume_ready', ?, ?, ?, ?, ?, ?, ?, ?)`,
        jobBinds,
        gate,
        "SELECT 1 FROM jobs WHERE id = ?",
        [id],
      ),
      gated(env.DB, "INSERT INTO resumes (job_id, user_id, ciphertext) VALUES (?, ?, ?)", [id, userId, packed[0]], gate, "SELECT 1 FROM resumes WHERE job_id = ?", [id]),
      gated(env.DB, "INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'application', ?)", [id, userId, packed[1]], gate, "SELECT 1 FROM packs WHERE job_id = ? AND kind = 'application'", [id]),
      gated(env.DB, "INSERT INTO packs (job_id, user_id, kind, ciphertext) VALUES (?, ?, 'jd', ?)", [id, userId, packed[2]], gate, "SELECT 1 FROM packs WHERE job_id = ? AND kind = 'jd'", [id]),
      gated(
        env.DB,
        "INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, job_id, note) VALUES (?, 'spend_scan_pack', -1, -1, ?, 'prepared by job scan')",
        [userId, id],
        gate,
        "SELECT 1 FROM credit_ledger WHERE job_id = ? AND kind = 'spend_scan_pack'",
        [id],
      ),
    ],
  };
}
