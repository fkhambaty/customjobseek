import { daysBetween } from "./engine/insights";
import { QUOTA_LIMITS } from "./capacity";
import type { FitResult, JobRecord, JobStatus } from "./types";

export const LIVE_STATUSES = ["live", "stale", "closed", "unknown"] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export const PAY_PROVENANCE = ["posting", "estimated", "stated", "unknown"] as const;
export type PayProvenance = (typeof PAY_PROVENANCE)[number];

export const INTERVIEW_STAGES = ["recruiter", "hiring_manager", "panel", "final"] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

export const BAD_MATCH_REASONS = {
  wrong_role: "The role is not what I am looking for",
  wrong_place: "The location does not fit",
  pay: "The pay does not match what was shown",
  stale: "The job looks closed or out of date",
  poor_fit: "The fit score does not match my experience",
} as const;

export type BadMatchReason = keyof typeof BAD_MATCH_REASONS;

export const LIFECYCLE_KINDS = [
  "scan_complete",
  "onboarding_recovery",
  "low_credits",
  "weekly_priorities",
  "expiring_entitlement",
] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

export type MailClass = "transactional" | "marketing";

/** Fit checks and resumes granted once, to the referrer, after the referred person's first verified payment. */
export const REFERRAL_EVAL_CREDITS = 3;
export const REFERRAL_RESUME_CREDITS = 3;

const DAY_MS = 86_400_000;
const FRESH_DAYS = 14;
const AGING_DAYS = 45;

/** Leave room for sign-in codes and owner alerts. Lifecycle mail stops before the Resend cap. */
const RESEND_DAILY_HEADROOM = 20;
const RESEND_MONTHLY_HEADROOM = 200;
const LIFECYCLE_DAILY_CAP = 40;
const LIFECYCLE_DAILY_CAP_UNKNOWN = 15;

export function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

export function parseLiveStatus(value: unknown): LiveStatus {
  if (typeof value === "string" && (LIVE_STATUSES as readonly string[]).includes(value)) return value as LiveStatus;
  return "unknown";
}

export function parsePayProvenance(value: unknown): PayProvenance | "" {
  if (typeof value === "string" && (PAY_PROVENANCE as readonly string[]).includes(value)) return value as PayProvenance;
  return "";
}

export function parseInterviewStage(value: unknown): InterviewStage | "" {
  if (typeof value === "string" && (INTERVIEW_STAGES as readonly string[]).includes(value)) return value as InterviewStage;
  return "";
}

export function parseBadMatchReason(value: unknown): BadMatchReason | null {
  if (typeof value !== "string" || !Object.hasOwn(BAD_MATCH_REASONS, value)) return null;
  return value as BadMatchReason;
}

export function payProvenanceFor(input: { salaryText: string; payEstimated: boolean; parsed: boolean }): PayProvenance {
  if (input.payEstimated) return "estimated";
  if (input.parsed) return "posting";
  if (input.salaryText.trim()) return "stated";
  return "unknown";
}

export function payProvenanceLabel(provenance: PayProvenance): string {
  switch (provenance) {
    case "posting":
      return "From the posting";
    case "estimated":
      return "Estimated";
    case "stated":
      return "Entered by you";
    case "unknown":
      return "Pay not stated";
    default: {
      const unexpected: never = provenance;
      return unexpected;
    }
  }
}

export function interviewStageLabel(stage: InterviewStage): string {
  switch (stage) {
    case "recruiter":
      return "Recruiter screen";
    case "hiring_manager":
      return "Hiring manager";
    case "panel":
      return "Panel";
    case "final":
      return "Final round";
    default: {
      const unexpected: never = stage;
      return unexpected;
    }
  }
}

export function resumeCoverage(fit: Pick<FitResult, "matchedRequired" | "missingRequired">): number | null {
  const required = fit.matchedRequired.length + fit.missingRequired.length;
  if (!required) return null;
  return Math.round((fit.matchedRequired.length / required) * 100);
}

export function packageGaps(input: { hasResume: boolean; hasPack: boolean; fit: Pick<FitResult, "blockers" | "decision"> }): string[] {
  const gaps: string[] = [];
  if (!input.hasResume) gaps.push("Resume not built");
  if (!input.hasPack) gaps.push("Application pack missing");
  if (input.fit.blockers.length > 0) gaps.push("A fit blocker is still open");
  if (input.fit.decision === "skip") gaps.push("Marked as a skip");
  return gaps;
}

export interface Freshness {
  status: LiveStatus;
  label: string;
}

export function sourceFreshness(input: {
  liveStatus: LiveStatus;
  postedAt: string | null;
  sourceCheckedAt: string | null;
  route: string;
  today: string;
}): Freshness {
  const source = input.route && input.route !== "No link" && input.route !== "External" ? input.route : "Source";
  if (input.liveStatus === "closed") return { status: "closed", label: `${source} closed` };
  const checkedAge = daysBetween(input.sourceCheckedAt, input.today);
  if (input.liveStatus === "live") {
    const when = checkedAge === null ? "" : checkedAge <= 0 ? " · checked today" : ` · checked ${checkedAge}d ago`;
    return { status: "live", label: `${source} live${when}` };
  }
  if (input.liveStatus === "stale") return { status: "stale", label: `${source} stale` };
  const postedAge = daysBetween(input.postedAt, input.today);
  if (postedAge === null) return { status: "unknown", label: `${source} not dated` };
  if (postedAge <= FRESH_DAYS) return { status: "live", label: `${source} fresh · posted ${postedAge}d ago` };
  if (postedAge <= AGING_DAYS) return { status: "stale", label: `${source} aging · posted ${postedAge}d ago` };
  return { status: "stale", label: `${source} old · posted ${postedAge}d ago` };
}

export interface OutreachReadiness {
  ready: boolean;
  note: string;
}

export function outreachReadiness(job: Pick<JobRecord, "status" | "contactCount" | "messagesSent" | "replies" | "lastTouchAt">, today: string): OutreachReadiness {
  if (job.status !== "applied" && job.status !== "interview" && job.status !== "offer") {
    return { ready: false, note: "" };
  }
  if (job.contactCount < 1) return { ready: false, note: "Add a person" };
  if (job.replies > 0) return { ready: true, note: "They replied" };
  if (job.messagesSent === 0) return { ready: true, note: "Ready to write" };
  const age = daysBetween(job.lastTouchAt, today);
  if (age !== null && age >= 7) return { ready: true, note: "Follow-up due" };
  return { ready: false, note: "Waiting on them" };
}

export function stageHint(status: JobStatus, interviewStage: InterviewStage | "", ready: boolean): string {
  if (status === "evaluated" || status === "resume_ready") return ready ? "Ready to send" : "Pack incomplete";
  if (status === "backfill") return "Backfill · outside current filters";
  if (status === "interview") return interviewStage ? `Interviewing · ${interviewStageLabel(interviewStage)}` : "Interviewing";
  if (status === "offer") return "Offer";
  if (status === "applied") return "Applied";
  if (status === "rejected") return "Rejected";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "closed") return "Closed";
  return "";
}

export interface RowEvidence {
  freshness: Freshness;
  payProvenance: PayProvenance;
  payLabel: string;
  coverage: number | null;
  packageReady: boolean;
  packageGaps: string[];
  outreach: OutreachReadiness;
  stage: string;
  blocker: string;
}

type EvidenceJob = Pick<
  JobRecord,
  | "status"
  | "postedAt"
  | "payEstimated"
  | "salaryText"
  | "hasResume"
  | "contactCount"
  | "messagesSent"
  | "replies"
  | "lastTouchAt"
  | "route"
  | "fit"
> & {
  liveStatus?: LiveStatus;
  sourceCheckedAt?: string | null;
  payProvenance?: PayProvenance | "";
  interviewStage?: InterviewStage | "";
  hasPack?: boolean;
};

export function rowEvidence(job: EvidenceJob, today: string): RowEvidence {
  const storedPay = job.payProvenance ? job.payProvenance : "";
  const payProvenance = storedPay
    ? storedPay
    : payProvenanceFor({
        salaryText: job.salaryText,
        payEstimated: job.payEstimated,
        parsed: job.fit.parsedSalary !== null,
      });
  const gaps = packageGaps({ hasResume: job.hasResume, hasPack: job.hasPack === true, fit: job.fit });
  const ready = gaps.length === 0;
  const interviewStage = job.interviewStage ?? "";
  return {
    freshness: sourceFreshness({
      liveStatus: job.liveStatus ?? "unknown",
      postedAt: job.postedAt,
      sourceCheckedAt: job.sourceCheckedAt ?? null,
      route: job.route,
      today,
    }),
    payProvenance,
    payLabel: payProvenanceLabel(payProvenance),
    coverage: resumeCoverage(job.fit),
    packageReady: ready,
    packageGaps: gaps,
    outreach: outreachReadiness(job, today),
    stage: stageHint(job.status, interviewStage, ready),
    blocker: job.fit.blockers[0]?.message ?? "",
  };
}

export interface PackageGapRow {
  id: string;
  title: string;
  company: string;
  gaps: string[];
}

const AUDIT_STATUSES = new Set<JobStatus>(["evaluated", "resume_ready", "applied"]);

export function packageAudit(jobs: JobRecord[], today: string): PackageGapRow[] {
  return jobs
    .filter((job) => AUDIT_STATUSES.has(job.status))
    .map((job) => ({ job, evidence: rowEvidence(job, today) }))
    .filter((row) => !row.evidence.packageReady)
    .sort((a, b) => b.job.fit.score - a.job.fit.score)
    .map((row) => ({ id: row.job.id, title: row.job.title, company: row.job.company, gaps: row.evidence.packageGaps }));
}

export interface SourceEffect {
  source: string;
  sent: number;
  replied: number;
  interviews: number;
}

export interface AgencyOutcomes {
  submitted: number;
  silent: number;
  medianSilenceDays: number | null;
  messaged: number;
  messageReplies: number;
  replyRate: number | null;
  interviews: number;
  interviewRate: number | null;
  medianRejectionDays: number | null;
  sources: SourceEffect[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

/** Outcomes from the user's own applications. No other person's data is included. */
export function agencyOutcomes(jobs: JobRecord[], today: string): AgencyOutcomes {
  const submitted = jobs.filter((job) => job.appliedAt !== null);
  const silent = submitted.filter((job) => job.status === "applied" && job.replies === 0 && job.rejectedAt === null);
  const silenceAges = silent
    .map((job) => daysBetween(job.appliedAt, today))
    .filter((days): days is number => days !== null && days >= 0);
  const messaged = submitted.filter((job) => job.messagesSent > 0);
  const messageReplies = messaged.filter((job) => job.replies > 0).length;
  const interviews = submitted.filter((job) => job.status === "interview" || job.status === "offer").length;
  const rejectionDays = submitted
    .filter((job) => job.status === "rejected")
    .map((job) => daysBetween(job.appliedAt, job.rejectedAt))
    .filter((days): days is number => days !== null && days >= 0);
  const bySource = new Map<string, SourceEffect>();
  for (const job of submitted) {
    const source = job.route || "No link";
    const row = bySource.get(source) ?? { source, sent: 0, replied: 0, interviews: 0 };
    row.sent += 1;
    if (job.replies > 0) row.replied += 1;
    if (job.status === "interview" || job.status === "offer") row.interviews += 1;
    bySource.set(source, row);
  }
  return {
    submitted: submitted.length,
    silent: silent.length,
    medianSilenceDays: median(silenceAges),
    messaged: messaged.length,
    messageReplies,
    replyRate: rate(messageReplies, messaged.length),
    interviews,
    interviewRate: rate(interviews, submitted.length),
    medianRejectionDays: median(rejectionDays),
    sources: [...bySource.values()].sort((a, b) => b.sent - a.sent || a.source.localeCompare(b.source)),
  };
}

export function silenceDays(lastOutAt: string | null, lastInAt: string | null, today: string): number | null {
  if (!lastOutAt) return null;
  if (lastInAt && lastInAt >= lastOutAt) return null;
  const days = daysBetween(lastOutAt, today);
  return days !== null && days >= 0 ? days : null;
}

export function lifecycleClass(kind: LifecycleKind): MailClass {
  switch (kind) {
    case "scan_complete":
    case "low_credits":
    case "expiring_entitlement":
      return "transactional";
    case "onboarding_recovery":
    case "weekly_priorities":
      return "marketing";
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

export function lifecycleQuietDays(kind: LifecycleKind): number {
  switch (kind) {
    case "scan_complete":
      return 0;
    case "onboarding_recovery":
      return 14;
    case "low_credits":
      return 14;
    case "weekly_priorities":
      return 6;
    case "expiring_entitlement":
      return 7;
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

export type LifecycleDeny = "preference" | "quiet" | "quota";

export function decideLifecycle(input: {
  kind: LifecycleKind;
  transactional: boolean;
  marketing: boolean;
  lastSentAt: string | null;
  lastMarketingAt: string | null;
  nowMs: number;
  dailyUsed: number | null;
  monthlyUsed: number | null;
  lifecycleSentToday: number;
}): { send: true } | { send: false; reason: LifecycleDeny } {
  const mailClass = lifecycleClass(input.kind);
  if (mailClass === "transactional" && !input.transactional) return { send: false, reason: "preference" };
  if (mailClass === "marketing" && !input.marketing) return { send: false, reason: "preference" };
  const quietMs = lifecycleQuietDays(input.kind) * DAY_MS;
  if (input.lastSentAt && quietMs > 0) {
    const then = Date.parse(input.lastSentAt);
    if (!Number.isNaN(then) && input.nowMs - then < quietMs) return { send: false, reason: "quiet" };
  }
  if (mailClass === "marketing" && input.lastMarketingAt) {
    const then = Date.parse(input.lastMarketingAt);
    if (!Number.isNaN(then) && input.nowMs - then < 7 * DAY_MS) return { send: false, reason: "quiet" };
  }
  const dailyLimit = QUOTA_LIMITS.resend_daily;
  const monthlyLimit = QUOTA_LIMITS.resend_monthly;
  if (input.dailyUsed !== null && input.dailyUsed >= dailyLimit - RESEND_DAILY_HEADROOM) return { send: false, reason: "quota" };
  if (input.monthlyUsed !== null && input.monthlyUsed >= monthlyLimit - RESEND_MONTHLY_HEADROOM) return { send: false, reason: "quota" };
  const cap = input.dailyUsed === null && input.monthlyUsed === null ? LIFECYCLE_DAILY_CAP_UNKNOWN : LIFECYCLE_DAILY_CAP;
  if (input.lifecycleSentToday >= cap) return { send: false, reason: "quota" };
  return { send: true };
}

export function isoWeekKey(nowMs: number): string {
  const date = new Date(nowMs);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function appOrigin(value: string | undefined): string {
  const fallback = "https://customjobseek.com";
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export interface LifecycleFacts {
  packs?: number;
  todo?: number;
  due?: number;
  evalCredits?: number;
  resumeCredits?: number;
  expiresOn?: string;
}

/** Counts and dates only. No company, contact, or resume text. */
export function lifecycleCopy(kind: LifecycleKind, facts: LifecycleFacts, origin: string, unsubscribeUrl: string | null): { subject: string; text: string } {
  const account = `Email choices are in Account: ${origin}/account`;
  let subject = "CustomJobSeek";
  let body = "";
  switch (kind) {
    case "scan_complete":
      subject = "Your scan is ready";
      body = `Your scan finished. ${facts.packs ?? 0} application packs are waiting on Today.\n\nOpen ${origin}/today when you want to review them.`;
      break;
    case "onboarding_recovery":
      subject = "Your setup is still open";
      body = `Your CustomJobSeek setup is not finished yet. It takes a few minutes, and nothing is sent to employers until you choose to apply.\n\nContinue at ${origin}/onboarding`;
      break;
    case "low_credits":
      subject = "You are low on credits";
      body = `You have ${facts.evalCredits ?? 0} fit checks and ${facts.resumeCredits ?? 0} resumes left.\n\nOpen Account to see what is left: ${origin}/account`;
      break;
    case "weekly_priorities":
      subject = "What to do this week";
      body = `This week: ${facts.todo ?? 0} roles still to apply, ${facts.due ?? 0} follow-ups due.\n\nOpen ${origin}/today`;
      break;
    case "expiring_entitlement":
      subject = "Paid credits expire soon";
      body = `Paid credits expire on ${facts.expiresOn ?? "the date in Account"}. Unused credits are not extended automatically.\n\nSee Account: ${origin}/account`;
      break;
    default: {
      const unexpected: never = kind;
      throw new Error(String(unexpected));
    }
  }
  const extra = lifecycleClass(kind) === "marketing" && unsubscribeUrl
    ? `\n\nTo stop notes like this, open ${unsubscribeUrl}\nAccount mail about scans and credits is a separate choice.`
    : `\n\n${account}`;
  return { subject, text: `${body}${extra}` };
}

export interface ReferralIntentRow {
  code: string;
  emailCodeId: number | null;
  createdAt: string;
}

export type ReferralProof =
  | { purpose: "signup"; codeId: number }
  | { purpose: "reset"; issuedAt: string };

/**
 * A referral is attached only when this proof covers the saved intent.
 * A code that arrived after the proof was issued is dropped, not attached.
 */
export function referralIntentAction(intent: ReferralIntentRow | null, proof: ReferralProof): "attach" | "clear" | "ignore" {
  if (!intent) return "ignore";
  let covered = false;
  switch (proof.purpose) {
    case "signup":
      covered = intent.emailCodeId === null || intent.emailCodeId === proof.codeId;
      break;
    case "reset":
      covered = intent.emailCodeId === null || intent.createdAt <= proof.issuedAt;
      break;
    default: {
      const unexpected: never = proof;
      return unexpected;
    }
  }
  if (!covered) return "clear";
  if (!/^[a-f0-9]{16}$/.test(intent.code)) return "clear";
  return "attach";
}

export function shouldRewardReferral(input: {
  hasReferral: boolean;
  alreadyRewarded: boolean;
  otherAppliedPayments: number;
  paymentApplied: boolean;
}): boolean {
  return input.hasReferral && !input.alreadyRewarded && input.paymentApplied && input.otherAppliedPayments === 0;
}

export function badMatchSupportMessage(reason: BadMatchReason, jobId: string, note: string): string {
  const extra = note.replace(/\s+/g, " ").trim().slice(0, 500);
  const text = `A suggested job looks wrong. Reason: ${BAD_MATCH_REASONS[reason]}. Job reference ${jobId.slice(0, 8)}.${extra ? ` ${extra}` : ""}`;
  return text.slice(0, 2000);
}
