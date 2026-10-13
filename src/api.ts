import type { Plan, PlanId } from "../shared/plans";
import type { ApplicationFile, JobDescriptionFile } from "../shared/engine/documents";
import type { Account, JobRecord, JobStatus, Profile, TailoredResume } from "../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  resume: TailoredResume;
  application: ApplicationFile;
  jobFile: JobDescriptionFile;
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
    const res = await fetch("/api/profile/resume-file", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/pdf" }, body: await file.arrayBuffer() });
    const data = (await res.json().catch(() => ({}))) as { error?: string; profile?: Profile; missing?: string[] };
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Upload failed");
    return data as { profile: Profile; missing: string[] };
  },

  fetchJob: (url: string) => call<FetchedJob>("POST", "/jobs/fetch", { url }),
  listJobs: () => call<JobRecord[]>("GET", "/jobs"),
  createJob: (j: NewJob) => call<JobRecord>("POST", "/jobs", j),
  getJob: (id: string) => call<JobRecord>("GET", `/jobs/${id}`),
  updateJob: (id: string, patch: { status?: JobStatus; notes?: string; nextActionAt?: string | null }) =>
    call<JobRecord>("PATCH", `/jobs/${id}`, patch),
  rescoreJob: (id: string) => call<JobRecord>("POST", `/jobs/${id}/rescore`),
  deleteJob: (id: string) => call<{ ok: true }>("DELETE", `/jobs/${id}`),
  getResume: (id: string) => call<TailoredResume>("GET", `/jobs/${id}/resume`),
  getPack: (id: string) => call<Pack>("GET", `/jobs/${id}/pack`),
  makeResume: (id: string) => call<Pack>("POST", `/jobs/${id}/resume`),
  companies: () => call<CompanyRow[]>("GET", "/companies"),
  openings: (id: string) => call<{ title: string; location: string; url: string }[]>("GET", `/companies/${id}/openings`),
  reportMissed: (url: string, note: string) =>
    call<{ companyId: string; name: string; ats: string; count: number; error: string }>("POST", "/companies/missed", { url, note }),

  plans: () => call<Plan[]>("GET", "/plans"),
  checkout: (plan: PlanId) => call<{ url: string }>("POST", "/checkout", { plan }),
};
