import type { Plan, PlanId, RunPack } from "../shared/plans";
import type { ApplicationFile, JobDescriptionFile } from "../shared/engine/documents";
import type { MessageSet } from "../shared/engine/outreach";
import type { Account, Channel, Contact, JobEvent, JobFull, JobRecord, JobStatus, Profile, TailoredResume } from "../shared/types";

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
}

export interface DiscoverScan {
  prepared: JobRecord[];
  locked: DiscoverRow[];
  checked: number;
}

export interface ScanSchedule {
  schedule: { hourIst: number; enabled: boolean; nextRunAt: string | null; pausedReason: string } | null;
  scanRuns: number;
  manualAllowedAt: string | null;
  manualNote: string;
  runs: { id: string; trigger: string; startedAt: string; preparedCount: number; charged: boolean; note: string }[];
}

export interface ResumeLibrary {
  tailored: { jobId: string; title: string; company: string; status: JobStatus; madeAt: string; built: boolean; saved: boolean }[];
  base: { id: string; label: string; format: string; createdAt: string }[];
}

export interface JobPatch {
  status?: JobStatus;
  notes?: string;
  nextActionAt?: string | null;
  on?: string;
  appliedAt?: string;
}

export interface NewEvent {
  kind: "message" | "reply" | "note";
  channel?: Channel | "";
  person?: string;
  note?: string;
  on?: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  career_url: string;
  ats: string;
  scan_status: string;
  opening_count: number;
  last_scan_at: string | null;
}

export const api = {
  signup: (email: string, password: string) => call<{ ok: true; needsVerification: true }>("POST", "/auth/signup", { email, password }),
  verify: (email: string, code: string) => call<{ ok: true }>("POST", "/auth/verify", { email, code }),
  resendCode: (email: string, purpose: "signup" | "reset") => call<{ ok: true }>("POST", "/auth/resend-code", { email, purpose }),
  forgot: (email: string) => call<{ ok: true }>("POST", "/auth/forgot", { email }),
  reset: (email: string, code: string, password: string) => call<{ ok: true }>("POST", "/auth/reset", { email, code, password }),
  login: (email: string, password: string) => call<{ ok: true }>("POST", "/auth/login", { email, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
  me: () => call<Account>("GET", "/auth/me"),
  deleteAccount: (password: string) => call<{ ok: true }>("DELETE", "/auth/me", { password }),

  getProfile: () => call<{ profile: Profile; missing: string[] }>("GET", "/profile"),
  saveProfile: (p: Profile) => call<{ profile: Profile; missing: string[] }>("PUT", "/profile", p),
  importResume: async (file: File) => {
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
  listJobs: () => call<JobRecord[]>("GET", "/jobs"),
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
  discover: () => call<{ needsTargets: boolean; rows: DiscoverRow[] }>("GET", "/discover"),
  scanDiscover: () => call<DiscoverScan>("POST", "/discover/scan"),
  scanSchedule: () => call<ScanSchedule>("GET", "/discover/schedule"),
  saveScanSchedule: (body: { enabled: boolean; hourIst: number }) => call<ScanSchedule>("PUT", "/discover/schedule", body),
  resumes: () => call<ResumeLibrary>("GET", "/resumes"),
  masterResume: () => call<TailoredResume>("GET", "/resumes/master"),
  deleteBaseResume: (id: string) => call<{ ok: true }>("DELETE", `/resumes/base/${id}`),
  deleteJob: (id: string) => call<{ ok: true }>("DELETE", `/jobs/${enc(id)}`),
  getResume: (id: string) => call<TailoredResume>("GET", `/jobs/${enc(id)}/resume`),
  getPack: (id: string) => call<Pack>("GET", `/jobs/${enc(id)}/pack`),
  makeResume: (id: string) => call<Pack>("POST", `/jobs/${enc(id)}/resume`),
  companies: () => call<CompanyRow[]>("GET", "/companies"),
  openings: (id: string) => call<{ title: string; location: string; url: string }[]>("GET", `/companies/${id}/openings`),
  reportMissed: (url: string, note: string) =>
    call<{ companyId: string; name: string; ats: string; count: number; error: string }>("POST", "/companies/missed", { url, note }),

  plans: () => call<Plan[]>("GET", "/plans"),
  checkout: (plan: PlanId) => call<{ url: string }>("POST", "/checkout", { plan }),
  checkoutRuns: (runPack: RunPack["id"]) => call<{ url: string }>("POST", "/checkout", { runPack }),
};
