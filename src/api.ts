import type { Plan, PlanId } from "../shared/plans";
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

export const api = {
  signup: (email: string, password: string) => call<{ ok: true }>("POST", "/auth/signup", { email, password }),
  login: (email: string, password: string) => call<{ ok: true }>("POST", "/auth/login", { email, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
  me: () => call<Account>("GET", "/auth/me"),
  deleteAccount: (password: string) => call<{ ok: true }>("DELETE", "/auth/me", { password }),

  getProfile: () => call<{ profile: Profile; missing: string[] }>("GET", "/profile"),
  saveProfile: (p: Profile) => call<{ profile: Profile; missing: string[] }>("PUT", "/profile", p),

  fetchJob: (url: string) => call<FetchedJob>("POST", "/jobs/fetch", { url }),
  listJobs: () => call<JobRecord[]>("GET", "/jobs"),
  createJob: (j: NewJob) => call<JobRecord>("POST", "/jobs", j),
  getJob: (id: string) => call<JobRecord>("GET", `/jobs/${id}`),
  updateJob: (id: string, patch: { status?: JobStatus; notes?: string; nextActionAt?: string | null }) =>
    call<JobRecord>("PATCH", `/jobs/${id}`, patch),
  rescoreJob: (id: string) => call<JobRecord>("POST", `/jobs/${id}/rescore`),
  deleteJob: (id: string) => call<{ ok: true }>("DELETE", `/jobs/${id}`),
  getResume: (id: string) => call<TailoredResume>("GET", `/jobs/${id}/resume`),
  makeResume: (id: string) => call<TailoredResume>("POST", `/jobs/${id}/resume`),

  plans: () => call<Plan[]>("GET", "/plans"),
  checkout: (plan: PlanId) => call<{ url: string }>("POST", "/checkout", { plan }),
};
