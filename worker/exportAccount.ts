import { parseCookieChoice, type CookieChoice } from "../shared/commercial";
import type { JobDetails, Profile } from "../shared/types";
import { decryptJson } from "./crypto";
import type { Env, UserRow } from "./env";
import { readOnboarding } from "./onboarding";
import { loadProfile } from "./routes/profile";
import { referralSummary } from "./referrals";

const CAP = 2000;

interface ConsentRow {
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
  cookies: string;
  product_email: number;
  transactional_email?: number | null;
  marketing_email?: number | null;
}

export interface ConsentView {
  cookies: CookieChoice;
  productEmail: boolean;
  transactionalEmail: boolean;
  marketingEmail: boolean;
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
}

export function consentView(row: ConsentRow | null): ConsentView {
  const marketing = row ? Boolean(row.marketing_email ?? row.product_email) : false;
  return {
    cookies: parseCookieChoice(row?.cookies) ?? "essential",
    productEmail: marketing,
    transactionalEmail: row ? row.transactional_email !== 0 : true,
    marketingEmail: marketing,
    termsAcceptedAt: row?.terms_accepted_at ?? null,
    privacyAcceptedAt: row?.privacy_accepted_at ?? null,
  };
}

export async function readConsent(db: D1Database, userId: string): Promise<ConsentView> {
  const row = await db.prepare(
    `SELECT terms_accepted_at, privacy_accepted_at, cookies, product_email, transactional_email, marketing_email
     FROM consent_preferences WHERE user_id = ?`,
  ).bind(userId).first<ConsentRow>();
  return consentView(row);
}

interface ReadResult<T> {
  value: T | null;
  unreadable: boolean;
}

async function readEncrypted<T>(secret: string, payload: string): Promise<ReadResult<T>> {
  if (!payload) return { value: null, unreadable: false };
  try {
    return { value: await decryptJson<T>(secret, payload), unreadable: false };
  } catch {
    return { value: null, unreadable: true };
  }
}

function readJson(payload: string): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

interface JobExportRow {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  salary_text: string;
  description: string;
  status: string;
  notes: string;
  fit_json: string;
  details_ciphertext: string;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

interface EventExportRow {
  id: string;
  job_id: string;
  kind: string;
  status: string;
  channel: string;
  at: string;
  ciphertext: string;
}

/**
 * A copy of the signed-in person's data. Password hashes, session tokens,
 * email-code hashes, rate-limit buckets, and raw ciphertext are left out.
 */
export async function buildAccountExport(env: Env, user: UserRow): Promise<Record<string, unknown>> {
  const secret = env.DATA_KEY;
  let profile: Profile | null = null;
  let profileUnreadable = false;
  try {
    profile = await loadProfile(env, user.id, user.email);
  } catch {
    profileUnreadable = true;
  }

  const [jobs, events, packs, resumes, uploads, orders, entitlements, support, usage, credits, scans, missed, schedule, consent, onboarding, referral, productEvents] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, company, location, url, salary_text, description, status, notes, fit_json, details_ciphertext,
              created_at, updated_at, applied_at
       FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(user.id, CAP + 1).all<JobExportRow>(),
    env.DB.prepare(
      "SELECT id, job_id, kind, status, channel, at, ciphertext FROM job_events WHERE user_id = ? ORDER BY at DESC LIMIT ?",
    ).bind(user.id, CAP + 1).all<EventExportRow>(),
    env.DB.prepare("SELECT job_id, kind, ciphertext, created_at FROM packs WHERE user_id = ? LIMIT ?")
      .bind(user.id, CAP + 1).all<{ job_id: string; kind: string; ciphertext: string; created_at: string }>(),
    env.DB.prepare("SELECT job_id, ciphertext, created_at FROM resumes WHERE user_id = ? LIMIT ?")
      .bind(user.id, CAP + 1).all<{ job_id: string; ciphertext: string; created_at: string }>(),
    env.DB.prepare("SELECT id, filename, label, format, text_ciphertext, created_at FROM resume_uploads WHERE user_id = ? LIMIT ?")
      .bind(user.id, CAP + 1).all<{ id: string; filename: string; label: string; format: string; text_ciphertext: string; created_at: string }>(),
    env.DB.prepare(
      "SELECT id, kind, sku, amount_inr, currency, status, created_at, updated_at FROM orders WHERE user_id = ? ORDER BY created_at DESC",
    ).bind(user.id).all<{ id: string; kind: string; sku: string; amount_inr: number; currency: string; status: string; created_at: string; updated_at: string }>(),
    env.DB.prepare(
      "SELECT sku, eval_credits, resume_credits, scan_runs, applied, applied_at, created_at FROM entitlements WHERE user_id = ? ORDER BY created_at DESC",
    ).bind(user.id).all<{ sku: string; eval_credits: number; resume_credits: number; scan_runs: number; applied: number; applied_at: string | null; created_at: string }>(),
    env.DB.prepare("SELECT id, topic, message, created_at FROM support_requests WHERE user_id = ? OR email = ? ORDER BY created_at DESC")
      .bind(user.id, user.email).all<{ id: string; topic: string; message: string; created_at: string }>(),
    env.DB.prepare("SELECT day, checks, resumes, scans, fetches, imports FROM usage_snapshots WHERE user_id = ? ORDER BY day DESC")
      .bind(user.id).all<{ day: string; checks: number; resumes: number; scans: number; fetches: number; imports: number }>(),
    env.DB.prepare("SELECT kind, eval_delta, resume_delta, runs_delta, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(user.id, CAP + 1).all<{ kind: string; eval_delta: number; resume_delta: number; runs_delta: number; note: string; created_at: string }>(),
    env.DB.prepare(
      "SELECT id, trigger, status, stage, queued_at, completed_at, handpicked_count, charged, error FROM market_scans WHERE user_id = ? ORDER BY queued_at DESC LIMIT ?",
    ).bind(user.id, CAP + 1).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT url, note, created_at FROM missed_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(user.id, CAP + 1).all<{ url: string; note: string; created_at: string }>(),
    env.DB.prepare("SELECT hour_ist, enabled, next_run_at, paused_reason, timezone, schedule_version FROM scan_schedules WHERE user_id = ?")
      .bind(user.id).first<{ hour_ist: number; enabled: number; next_run_at: string | null; paused_reason: string; timezone: string; schedule_version: number }>(),
    readConsent(env.DB, user.id),
    readOnboarding(env.DB, user.id),
    referralSummary(env.DB, user.id),
    env.DB.prepare("SELECT name, day, created_at FROM product_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(user.id, CAP + 1).all<{ name: string; day: string; created_at: string }>(),
  ]);

  let truncated = false;
  const take = <T>(rows: T[]): T[] => {
    if (rows.length > CAP) {
      truncated = true;
      return rows.slice(0, CAP);
    }
    return rows;
  };

  const eventRows = take(events.results);
  const eventsByJob = new Map<string, Record<string, unknown>[]>();
  for (const event of eventRows) {
    const body = await readEncrypted<{ person?: string; note?: string }>(secret, event.ciphertext);
    const list = eventsByJob.get(event.job_id) ?? [];
    list.push({
      id: event.id,
      kind: event.kind,
      status: event.status,
      channel: event.channel,
      at: event.at,
      person: body.value?.person ?? "",
      note: body.value?.note ?? "",
      unreadable: body.unreadable,
    });
    eventsByJob.set(event.job_id, list);
  }

  const jobRows = await Promise.all(take(jobs.results).map(async (job) => {
    const details = await readEncrypted<JobDetails>(secret, job.details_ciphertext);
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      salaryText: job.salary_text,
      description: job.description,
      status: job.status,
      notes: job.notes,
      fit: readJson(job.fit_json),
      details: details.value,
      detailsUnreadable: details.unreadable,
      events: eventsByJob.get(job.id) ?? [],
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      appliedAt: job.applied_at,
    };
  }));

  const packedResumeJobs = new Set(packs.results.filter((pack) => pack.kind === "resume" && pack.ciphertext).map((pack) => pack.job_id));
  const packRows = await Promise.all(take(packs.results).filter((pack) => pack.kind !== "resume" || pack.ciphertext).map(async (pack) => {
    const body = await readEncrypted<unknown>(secret, pack.ciphertext);
    return { jobId: pack.job_id, kind: pack.kind, createdAt: pack.created_at, body: body.value, unreadable: body.unreadable };
  }));
  for (const resume of take(resumes.results)) {
    if (packedResumeJobs.has(resume.job_id)) continue;
    const body = await readEncrypted<unknown>(secret, resume.ciphertext);
    packRows.push({ jobId: resume.job_id, kind: "resume", createdAt: resume.created_at, body: body.value, unreadable: body.unreadable });
  }

  const uploadRows = await Promise.all(take(uploads.results).map(async (upload) => {
    const body = await readEncrypted<{ text?: string }>(secret, upload.text_ciphertext);
    return {
      id: upload.id,
      filename: upload.filename,
      label: upload.label,
      format: upload.format,
      createdAt: upload.created_at,
      text: body.value?.text ?? "",
      unreadable: body.unreadable,
    };
  }));

  const creditRows = take(credits.results);
  const scanRows = take(scans.results);
  const missedRows = take(missed.results);
  const eventNameRows = take(productEvents.results);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    truncated,
    account: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      emailVerified: Boolean(user.email_verified),
      evalCredits: user.eval_credits,
      resumeCredits: user.resume_credits,
      scanRuns: user.scan_runs ?? 0,
      creditsExpireAt: user.credits_expire_at,
      createdAt: user.created_at,
    },
    profile,
    profileUnreadable,
    consent,
    onboarding,
    referral,
    jobs: jobRows,
    packs: packRows,
    resumeUploads: uploadRows,
    orders: orders.results.map((order) => ({
      id: order.id,
      kind: order.kind,
      sku: order.sku,
      amountInr: order.amount_inr,
      currency: order.currency,
      status: order.status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    })),
    entitlements: entitlements.results.map((row) => ({
      sku: row.sku,
      evalCredits: row.eval_credits,
      resumeCredits: row.resume_credits,
      scanRuns: row.scan_runs,
      applied: Boolean(row.applied),
      appliedAt: row.applied_at,
      createdAt: row.created_at,
    })),
    supportRequests: support.results,
    usage: usage.results,
    credits: creditRows,
    scans: scanRows,
    missedCompanies: missedRows,
    scanSchedule: schedule,
    productEvents: eventNameRows,
  };
}
