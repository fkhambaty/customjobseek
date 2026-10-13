import type { Account, FitResult, JobRecord, JobStatus } from "../../shared/types";
import type { UserRow } from "../env";

export interface JobRow {
  id: string;
  user_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  salary_text: string;
  description: string;
  status: string;
  fit_json: string;
  notes: string;
  next_action_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  has_resume?: number;
}

export function toAccount(u: UserRow): Account {
  return {
    email: u.email,
    plan: u.plan,
    evalCredits: u.eval_credits,
    resumeCredits: u.resume_credits,
    creditsExpireAt: u.credits_expire_at,
  };
}

export function toJob(r: JobRow): JobRecord {
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location,
    url: r.url,
    salaryText: r.salary_text,
    description: r.description,
    status: r.status as JobStatus,
    fit: JSON.parse(r.fit_json) as FitResult,
    notes: r.notes,
    nextActionAt: r.next_action_at,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasResume: Boolean(r.has_resume),
  };
}
