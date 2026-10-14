import type { BadMatchReason, InterviewStage, LiveStatus } from "../shared/agency";
import type { Plan } from "../shared/plans";
import type { PaidSku, CookieChoice, SupportTopic } from "../shared/commercial";
import type { CheckoutSession, OrderView, PublicBillingStatus } from "../shared/payments";
import type { OnboardingProgress, StoredWizardStep, WizardStep } from "../shared/onboardingWizard";
import type { ApplicationFile, JobDescriptionFile } from "../shared/engine/documents";
import type { MessageSet } from "../shared/engine/outreach";
import type { PathCommit, PathPreview, SearchPath, SearchPathDraft } from "../shared/engine/searchPaths";
import type { Account, Channel, Contact, JobEvent, JobFull, JobRecord, JobStatus, Profile, TailoredResume } from "../shared/types";
import { MAX_ORIGINAL_PDF_BYTES, originalPdfLimitMessage } from "../shared/resumeStorage";
import { JOB_LIST_CAP, JOB_LIST_PAGE_LIMIT, jobListCapNotice, parseJobListResponse } from "./jobList";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const enc = encodeURIComponent;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined && method === "GET" ? {} : { "content-type": "application/json" },
    body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface FetchedJob {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
  url: string;
  source: "structured" | "page_text";
}

export interface NewJob {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
  url: string;
}

export interface Pack {
  resume: TailoredResume | null;
  application: ApplicationFile | null;
  jobFile: JobDescriptionFile | null;
  savedResume: boolean;
  applicationNotes: string | null;
  jobNotes: string | null;
  statusNotes: string | null;
}

export interface Activity extends JobEvent {
  title: string;
  company: string;
}

export interface Person {
  jobId: string;
  title: string;
  company: string;
  status: JobStatus;
  liveStatus: LiveStatus;
  contact: Contact;
}

export interface DiscoverRow {
  title: string;
  location: string;
  url: string;
  company: string;
  ats: string;
  seenAt: string;
  match: number;
  locationNote: string;
  pathLabel?: string;
}

export interface DiscoverScan {
  prepared: JobRecord[];
  locked: DiscoverRow[];
  checked: number;
}

export type MarketScanStage =
  | "queued"
  | "searching"
  | "reading"
  | "checking_fit"
  | "building_resumes"
  | "building_packs"
  | "complete"
  | "failed";

export interface MarketScan {
  id: string;
  trigger: "manual" | "scheduled";
  status: "queued" | "processing" | "complete" | "failed";
  stage: MarketScanStage;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estimatedSeconds: number;
  elapsedSeconds: number;
  queueAhead: number;
  candidateCount: number;
  checkedCount: number;
  handpickedCount: number;
  charged: boolean;
  progress: number | null;
  error: string;
  pipelineChecked: number;
  pipelineClosed: number;
  prepared: JobRecord[];
}

export interface MarketStats {
  employers: number;
  readable: number;
  openings: number;
  freshestAt: string | null;
  unsupported?: number;
  catalogBoards?: number;
  countries?: { code: string; name: string; catalog: number; employers: number; readable: number }[];
  health?: { ats: string; lastOkAt: string | null; failures: number }[];
}

export interface ScanSchedule {
  schedule: {
    hourIst: number;
    hourLocal: number;
    timeZone: string;
    scheduleVersion?: number;
    enabled: boolean;
    nextRunAt: string | null;
    pausedReason: string;
  } | null;
  timeZone: string;
  timeZoneLabel: string;
  country: string;
  countryName: string;
  scanRuns: number;
  manualAllowedAt: string | null;
  manualNote: string;
  runs: { id: string; trigger: string; startedAt: string; preparedCount: number; charged: boolean; note: string; pipelineChecked: number; pipelineClosed: number }[];
  lastScan: LastScan | null;
}

export interface LastScan {
  id: string;
  trigger: string;
  status: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  candidateCount: number;
  checkedCount: number;
  handpickedCount: number;
  charged: boolean;
  pipelineChecked: number;
  pipelineClosed: number;
  error: string;
}

export interface ResumeLibrary {
  tailored: { jobId: string; title: string; company: string; status: JobStatus; liveStatus: LiveStatus; madeAt: string; built: boolean; saved: boolean }[];
  base: { id: string; label: string; format: string; createdAt: string }[];
}

export interface JobPatch {
  status?: JobStatus;
  notes?: string;
  nextActionAt?: string | null;
  on?: string;
  appliedAt?: string;
  interviewStage?: InterviewStage | "";
}

export interface CompanyThread {
  id: string;
  company: string;
  companyKey: string;
  followUpOn: string | null;
  lastOutAt: string | null;
  lastInAt: string | null;
  silenceDays: number | null;
  messages: number;
  openRoles: number;
}

export interface ThreadMessage {
  id: string;
  jobId: string | null;
  direction: "out" | "in";
  channel: string;
  at: string;
  person: string;
  note: string;
  title: string;
}

export interface NewEvent {
  kind: "message" | "reply" | "note";
  channel?: Channel | "";
  person?: string;
  note?: string;
  on?: string;
}

export interface CompanyPage {
  companies: CompanyRow[];
  nextCursor: string | null;
}

export interface CompanyRow {
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
}

export interface AccountHome {
  preferences: {
    cookies: CookieChoice;
    productEmail: boolean;
    transactionalEmail: boolean;
    marketingEmail: boolean;
    termsAcceptedAt: string | null;
    privacyAcceptedAt: string | null;
  };
  onboarding: OnboardingProgress;
  referral: { code: string; uses: number; rewarded: number };
}

export const api = {
  signup: (email: string, password: string, referralCode?: string) =>
    call<{ ok: true; needsVerification: true }>("POST", "/auth/signup", { email, password, referralCode: referralCode || undefined }),
  verify: (email: string, code: string, referralCode?: string) =>
    call<{ ok: true }>("POST", "/auth/verify", { email, code, referralCode }),
  resendCode: (email: string, purpose: "signup" | "reset") => call<{ ok: true }>("POST", "/auth/resend-code", { email, purpose }),
  forgot: (email: string) => call<{ ok: true }>("POST", "/auth/forgot", { email }),
  reset: (email: string, code: string, password: string) => call<{ ok: true }>("POST", "/auth/reset", { email, code, password }),
  login: (email: string, password: string) => call<{ ok: true }>("POST", "/auth/login", { email, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
  me: () => call<Account & { onboardingStep: StoredWizardStep }>("GET", "/auth/me"),
  onboarding: () => call<{ profile: Profile; missing: string[]; onboarding: OnboardingProgress }>("GET", "/onboarding"),
  saveOnboardingStep: (step: WizardStep | "done") => call<{ onboarding: OnboardingProgress }>("PUT", "/onboarding", { step }),
  deleteAccount: (password: string) => call<{ ok: true }>("DELETE", "/auth/me", { password }),

  getProfile: () => call<{ profile: Profile; missing: string[] }>("GET", "/profile"),
  saveProfile: (p: Profile) => call<{ profile: Profile; missing: string[] }>("PUT", "/profile", p),
  listSearchPaths: () => call<{ paths: SearchPath[] }>("GET", "/search-paths"),
  previewSearchPaths: (body: PathCommit) => call<PathPreview>("POST", "/search-paths/preview", body),
  createSearchPath: (body: { draft: SearchPathDraft; disposition: "reclassify" | "archive" }) =>
    call<{ paths: SearchPath[] }>("POST", "/search-paths", body),
  updateSearchPath: (id: string, body: { draft: SearchPathDraft; disposition: "reclassify" | "archive" }) =>
    call<{ paths: SearchPath[] }>("PATCH", `/search-paths/${enc(id)}`, body),
  deleteSearchPath: (id: string, body: { disposition: "reclassify" | "archive" | "move"; moveToId?: string | null }) =>
    call<{ paths: SearchPath[] }>("DELETE", `/search-paths/${enc(id)}`, body),
  reorderSearchPaths: (body: { ids: string[]; disposition: "reclassify" | "archive" }) =>
    call<{ paths: SearchPath[] }>("PATCH", "/search-paths/order", body),
  replaceSearchPaths: (body: { drafts: SearchPathDraft[]; disposition: "reclassify" | "archive" }) =>
    call<{ paths: SearchPath[] }>("PUT", "/search-paths", body),
  restoreJobPath: (id: string) => call<JobFull>("POST", `/jobs/${enc(id)}/path`, { action: "restore" }),
  reclassifyJobPath: (id: string) => call<JobFull>("POST", `/jobs/${enc(id)}/path`, { action: "reclassify" }),
  importResume: async (file: File) => {
    if (file.size > MAX_ORIGINAL_PDF_BYTES) throw new ApiError(400, originalPdfLimitMessage());
    const res = await fetch("/api/profile/resume-file", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/pdf", "x-file-name": file.name.replace(/[^\w .()-]/g, "") },
      body: await file.arrayBuffer(),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; profile?: Profile; missing?: string[] };
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Upload failed");
    return data as { profile: Profile; missing: string[] };
  },

  fetchJob: (url: string) => call<FetchedJob>("POST", "/jobs/fetch", { url }),
  listJobs: async () => {
    const jobs: JobRecord[] = [];
    const seen = new Set<string>();
    let cursor = "";
    const pages = JOB_LIST_CAP / JOB_LIST_PAGE_LIMIT;
    for (let page = 0; page < pages; page++) {
      const query = new URLSearchParams({ limit: String(JOB_LIST_PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const data = parseJobListResponse(await call<unknown>("GET", `/jobs?${query}`));
      const fresh = data.jobs.filter((job) => !seen.has(job.id));
      for (const job of fresh) seen.add(job.id);
      jobs.push(...fresh);
      if (!data.nextCursor || data.nextCursor === cursor || fresh.length === 0) return { jobs, notice: "" };
      cursor = data.nextCursor;
      if (page === pages - 1) return { jobs, notice: jobListCapNotice(jobs.length, true) };
    }
    return { jobs, notice: "" };
  },
  createJob: (j: NewJob) => call<JobRecord>("POST", "/jobs", j),
  getJob: (id: string) => call<JobFull>("GET", `/jobs/${enc(id)}`),
  updateJob: (id: string, patch: JobPatch) => call<JobFull>("PATCH", `/jobs/${enc(id)}`, patch),
  rescoreJob: (id: string) => call<JobFull>("POST", `/jobs/${enc(id)}/rescore`),
  saveContacts: (id: string, contacts: Contact[]) => call<JobFull>("PUT", `/jobs/${enc(id)}/contacts`, { contacts }),
  logEvent: (id: string, e: NewEvent) => call<JobFull>("POST", `/jobs/${enc(id)}/events`, e),
  deleteEvent: (id: string, eventId: string) => call<JobFull>("DELETE", `/jobs/${enc(id)}/events/${eventId}`),
  messages: (id: string) => call<MessageSet[]>("GET", `/jobs/${enc(id)}/messages`),
  activity: () => call<Activity[]>("GET", "/jobs/activity"),
  people: () => call<Person[]>("GET", "/jobs/people"),
  reportMatch: (id: string, body: { reason: BadMatchReason; note?: string }) =>
    call<{ id: string }>("POST", `/jobs/${enc(id)}/report-match`, body),
  threads: () => call<{ threads: CompanyThread[] }>("GET", "/workspace/threads"),
  thread: (id: string) => call<{ messages: ThreadMessage[] }>("GET", `/workspace/threads/${enc(id)}`),
  saveThreadFollowUp: (id: string, followUpOn: string | null) =>
    call<{ threads: CompanyThread[] }>("PATCH", `/workspace/threads/${enc(id)}`, { followUpOn }),
  logThreadMessage: (id: string, body: { direction: "out" | "in"; channel?: Channel | ""; person?: string; note?: string; on?: string; jobId?: string }) =>
    call<{ messages: ThreadMessage[] }>("POST", `/workspace/threads/${enc(id)}/messages`, body),
  discover: () => call<{ needsTargets: boolean; rows: DiscoverRow[] }>("GET", "/discover"),
  scanDiscover: () => call<{ scan: MarketScan }>("POST", "/discover/scan"),
  currentMarketScan: () => call<{ scan: MarketScan | null }>("GET", "/discover/scan/current"),
  marketScan: (id: string) => call<{ scan: MarketScan }>("GET", `/discover/scan/${enc(id)}`),
  scanSchedule: () => call<ScanSchedule>("GET", "/discover/schedule"),
  saveScanSchedule: (body: { enabled: boolean; hourIst: number }) => call<ScanSchedule>("PUT", "/discover/schedule", body),
  resumes: () => call<ResumeLibrary>("GET", "/resumes"),
  masterResume: () => call<TailoredResume>("GET", "/resumes/master"),
  deleteBaseResume: (id: string) => call<{ ok: true }>("DELETE", `/resumes/base/${id}`),
  deleteJob: (id: string) => call<{ ok: true }>("DELETE", `/jobs/${enc(id)}`),
  getResume: (id: string) => call<TailoredResume>("GET", `/jobs/${enc(id)}/resume`),
  getPack: (id: string) => call<Pack>("GET", `/jobs/${enc(id)}/pack`),
  makeResume: (id: string) => call<Pack>("POST", `/jobs/${enc(id)}/resume`),
  companies: (cursor?: string, q?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (q) params.set("q", q);
    const suffix = params.size ? `?${params}` : "";
    return call<CompanyPage | CompanyRow[]>("GET", `/companies${suffix}`).then((data) => {
      if (Array.isArray(data)) return { companies: data, nextCursor: null };
      return { companies: data.companies ?? [], nextCursor: data.nextCursor ?? null };
    });
  },
  companyStats: () => call<MarketStats>("GET", "/companies/stats"),
  openings: (id: string) => call<{ title: string; location: string; url: string }[]>("GET", `/companies/${id}/openings`),
  reportMissed: (url: string, note: string) =>
    call<{ companyId: string; name: string; ats: string; count: number; error: string; coverage?: "live" | "unsupported" | "partnership"; message?: string }>("POST", "/companies/missed", { url, note }),

  plans: () => call<Plan[]>("GET", "/plans"),
  billingStatus: () => call<PublicBillingStatus>("GET", "/billing/status"),
  checkout: (body: { sku: PaidSku; idempotencyKey: string; displayCurrency?: string }) =>
    call<CheckoutSession>("POST", "/checkout", body),
  checkoutOrders: () => call<{ orders: OrderView[] }>("GET", "/checkout/orders"),
  checkoutOrder: (id: string, displayCurrency?: string) => {
    const query = displayCurrency ? `?displayCurrency=${enc(displayCurrency)}` : "";
    return call<OrderView>("GET", `/checkout/orders/${enc(id)}${query}`);
  },
  recoverCheckout: (id: string, displayCurrency?: string) =>
    call<OrderView>("POST", `/checkout/orders/${enc(id)}/recover`, { displayCurrency }),
  accountHome: () => call<AccountHome>("GET", "/account"),
  saveAccountPreferences: (body: { cookies: CookieChoice; productEmail: boolean; transactionalEmail: boolean; marketingEmail: boolean }) =>
    call<AccountHome["preferences"]>("PUT", "/account/preferences", body),
  accountExport: () => call<Record<string, unknown>>("GET", "/account/export"),
  support: (body: { email?: string; topic: SupportTopic; message: string }) => call<{ id: string }>("POST", "/support", body),
};

export { resumeFileLinks, resumeHtmlPath, resumePdfPath, resumeViewerPath, type ResumeArtifactKind } from "../shared/resumeFile";
