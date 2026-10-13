import { roleFamily, routeFromUrl } from "../../shared/engine/classify";
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
  lane: string;
  route: string;
  requisition: string;
  pay_low: number | null;
  pay_high: number | null;
  pay_estimated: number;
  posted_at: string | null;
  rejected_at: string | null;
  closed_at: string | null;
  contact_count: number;
  details_ciphertext: string;
  has_resume?: number;
  messages_sent?: number;
  replies?: number;
  last_touch_at?: string | null;
}

export const JOB_SELECT = `SELECT j.*,
  (EXISTS(SELECT 1 FROM resumes r WHERE r.job_id = j.id) OR EXISTS(SELECT 1 FROM packs p WHERE p.job_id = j.id AND p.kind IN ('resume', 'resume_html'))) AS has_resume,
  (SELECT COUNT(*) FROM job_events e WHERE e.job_id = j.id AND e.kind = 'message') AS messages_sent,
  (SELECT COUNT(*) FROM job_events e WHERE e.job_id = j.id AND e.kind = 'reply') AS replies,
  (SELECT MAX(e.at) FROM job_events e WHERE e.job_id = j.id AND e.kind IN ('message', 'reply')) AS last_touch_at
  FROM jobs j`;

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
    lane: r.lane,
    route: r.route || routeFromUrl(r.url),
    family: roleFamily(r.title),
    requisition: r.requisition,
    payLow: r.pay_low,
    payHigh: r.pay_high,
    payEstimated: Boolean(r.pay_estimated),
    postedAt: r.posted_at,
    rejectedAt: r.rejected_at,
    closedAt: r.closed_at,
    contactCount: r.contact_count,
    messagesSent: r.messages_sent ?? 0,
    replies: r.replies ?? 0,
    lastTouchAt: r.last_touch_at ?? null,
  };
}
