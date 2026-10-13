import type { Ats } from "./engine/boards";
import { liveListingAts, sourceById, type SourceCompliance } from "./engine/sources";
import { PLANS, RUN_PACKS, parsePlanId, planRank, type PlanId } from "./plans";
import type { Profile } from "./types";

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_ADDRESS.test(value);
}

export const SUPPORT_TOPIC_LABELS = {
  account: "Account and sign-in",
  billing: "Plans and payments",
  privacy: "Privacy and my data",
  scanning: "Job scanning",
  match: "A job match looks wrong",
  other: "Something else",
} as const;

export type SupportTopic = keyof typeof SUPPORT_TOPIC_LABELS;
export const SUPPORT_TOPICS = Object.keys(SUPPORT_TOPIC_LABELS) as SupportTopic[];

export function parseSupportTopic(value: unknown): SupportTopic | null {
  if (typeof value !== "string" || !Object.hasOwn(SUPPORT_TOPIC_LABELS, value)) return null;
  return value as SupportTopic;
}

export function supportTopicLabel(topic: SupportTopic): string {
  return SUPPORT_TOPIC_LABELS[topic];
}

export const COOKIE_CHOICES = {
  essential: "Sign-in cookie only",
  analytics: "Sign-in cookie and anonymous counts",
} as const;

/** Shown on the cookies page and the Account choice, so the two cannot drift. */
export const ANALYTICS_COUNT_COPY =
  "Anonymous counts are stored only when you allow them on the Account page. Each count is an event name and a day. It is not tied to an account. Those counts stay in our database and are not sent to Cloudflare.";

export function shouldRecordAnalytics(cookies: string | null | undefined): boolean {
  return cookies === "analytics";
}

export type CookieChoice = keyof typeof COOKIE_CHOICES;

export function parseCookieChoice(value: unknown): CookieChoice | null {
  if (typeof value !== "string" || !Object.hasOwn(COOKIE_CHOICES, value)) return null;
  return value as CookieChoice;
}

export type OnboardingStep = "profile" | "resume" | "preferences" | "first_check";

export function onboardingColumn(step: OnboardingStep): "profile_done" | "resume_done" | "preferences_done" | "first_check_done" {
  switch (step) {
    case "profile":
      return "profile_done";
    case "resume":
      return "resume_done";
    case "preferences":
      return "preferences_done";
    case "first_check":
      return "first_check_done";
    default: {
      const unexpected: never = step;
      throw new Error(String(unexpected));
    }
  }
}

export function onboardingMarks(profile: Pick<Profile, "fullName" | "experience" | "preferences">): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  if (profile.fullName.trim() && profile.experience.length > 0) steps.push("profile");
  if (profile.preferences.targetRoles.length > 0) steps.push("preferences");
  return steps;
}

export type UsageField = "checks" | "resumes" | "scans" | "fetches" | "imports";

export function usageColumn(field: UsageField): UsageField {
  switch (field) {
    case "checks":
    case "resumes":
    case "scans":
    case "fetches":
    case "imports":
      return field;
    default: {
      const unexpected: never = field;
      throw new Error(String(unexpected));
    }
  }
}

export function utcDay(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export type ProductEventName =
  | "signup"
  | "login"
  | "resume_import"
  | "job_fetch"
  | "scan_queued"
  | "checkout_attempt"
  | "support_request"
  | "data_export";

export function canonicalProductEvent(name: ProductEventName): ProductEventName {
  switch (name) {
    case "signup":
    case "login":
    case "resume_import":
    case "job_fetch":
    case "scan_queued":
    case "checkout_attempt":
    case "support_request":
    case "data_export":
      return name;
    default: {
      const unexpected: never = name;
      throw new Error(String(unexpected));
    }
  }
}

export type RateLimitAction =
  | "auth_ip"
  | "auth_email"
  | "resume_import"
  | "job_fetch"
  | "scan"
  | "checkout"
  | "checkout_recover"
  | "support"
  | "export"
  | "companies_read";

export interface RateRule {
  limit: number;
  windowMs: number;
}

export function ruleFor(action: RateLimitAction): RateRule {
  switch (action) {
    case "auth_ip":
      return { limit: 30, windowMs: 15 * 60_000 };
    case "auth_email":
      return { limit: 10, windowMs: 15 * 60_000 };
    case "resume_import":
      return { limit: 8, windowMs: 60 * 60_000 };
    case "job_fetch":
      return { limit: 30, windowMs: 60 * 60_000 };
    case "scan":
      // Manual scans already wait six hours. This only stops a tight loop if that wait is skipped.
      return { limit: 20, windowMs: 60 * 60_000 };
    case "checkout":
      return { limit: 10, windowMs: 60 * 60_000 };
    case "checkout_recover":
      return { limit: 20, windowMs: 60 * 60_000 };
    case "support":
      return { limit: 5, windowMs: 60 * 60_000 };
    case "export":
      return { limit: 5, windowMs: 60 * 60_000 };
    case "companies_read":
      return { limit: 30, windowMs: 60_000 };
    default: {
      const unexpected: never = action;
      throw new Error(String(unexpected));
    }
  }
}

export function windowStartIso(nowMs: number, windowMs: number): string {
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Rate limit window needs a real time and a positive length.");
  }
  const start = Math.floor(nowMs / windowMs) * windowMs;
  return new Date(start).toISOString();
}

export const OWNER_ALERT_WINDOW_MS = 6 * 60 * 60_000;

export const OWNER_ALERT_SUBJECTS = {
  support_request: "CustomJobSeek: new support request",
  source_unhealthy: "CustomJobSeek: a job-board reader is failing",
  payment_needs_attention: "CustomJobSeek: a payment needs attention",
  verified_signup: "CustomJobSeek: a new account was confirmed",
  quota_watch: "CustomJobSeek: a free-plan quota needs a look",
  quota_critical: "CustomJobSeek: a free-plan quota is nearly used up",
  telemetry_unavailable: "CustomJobSeek: usage numbers could not be read",
  scan_failure_spike: "CustomJobSeek: job scans are failing",
} as const;

export type OwnerAlertKind = keyof typeof OWNER_ALERT_SUBJECTS;

export function ownerAlertSubject(kind: OwnerAlertKind): string {
  return OWNER_ALERT_SUBJECTS[kind];
}

export function shouldSendOwnerEmail(lastEmailedAt: string | null, nowMs: number, windowMs: number): boolean {
  if (!lastEmailedAt) return true;
  const then = Date.parse(lastEmailedAt);
  if (Number.isNaN(then)) return true;
  return nowMs - then >= windowMs;
}

const SECRET = /\b(?:rzp_(?:test|live)_[A-Za-z0-9]+|sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)\b/g;
const BEARER = /bearer\s+\S+/gi;
const LONG_NUMBER = /\b\d{12,19}\b/g;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SHORT_CODE = /\b\d{6}\b/g;

/** Owner mail is a short operational note. Strip anything that could be a password, code, or inbox. */
export function safeOwnerSummary(summary: string): string {
  const cleaned = summary
    .replace(/[\r\n\t]+/g, " ")
    .replace(BEARER, "bearer [secret]")
    .replace(SECRET, "[secret]")
    .replace(LONG_NUMBER, "[number]")
    .replace(EMAIL_IN_TEXT, "[email]")
    .replace(SHORT_CODE, "[code]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "Notice";
}

export function newReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export type PaidSku = "starter" | "growth" | "pro" | "runs5" | "runs15" | "runs30";

export function isPaidSku(sku: string): sku is PaidSku {
  switch (sku) {
    case "starter":
    case "growth":
    case "pro":
    case "runs5":
    case "runs15":
    case "runs30":
      return true;
    default:
      return false;
  }
}

export interface CreditGrant {
  sku: PaidSku;
  kind: "plan" | "run_pack";
  plan: Exclude<PlanId, "free"> | null;
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  validityDays: number;
  amountInr: number;
}

export function grantForSku(sku: string): CreditGrant | null {
  if (!isPaidSku(sku)) return null;
  return grantForPaidSku(sku);
}

export function grantForPaidSku(sku: PaidSku): CreditGrant {
  switch (sku) {
    case "starter":
    case "growth":
    case "pro": {
      const plan = PLANS[sku];
      return {
        sku,
        kind: "plan",
        plan: sku,
        evalCredits: plan.evalCredits,
        resumeCredits: plan.resumeCredits,
        scanRuns: plan.scanRuns,
        validityDays: plan.validityDays,
        amountInr: plan.priceInr,
      };
    }
    case "runs5":
    case "runs15":
    case "runs30": {
      const pack = RUN_PACKS.find((item) => item.id === sku);
      if (!pack) throw new Error(`Missing run pack ${sku}`);
      return {
        sku,
        kind: "run_pack",
        plan: null,
        evalCredits: 0,
        resumeCredits: 0,
        scanRuns: pack.runs,
        validityDays: 0,
        amountInr: pack.priceInr,
      };
    }
    default: {
      const unexpected: never = sku;
      throw new Error(String(unexpected));
    }
  }
}

export function entitlementExpiry(validityDays: number, nowMs: number): string | null {
  if (validityDays <= 0) return null;
  return new Date(nowMs + validityDays * 86_400_000).toISOString();
}

/**
 * A cheaper plan adds its credits. It does not replace a higher plan name
 * or pull the expiry forward.
 */
export function mergePaidPlan(input: {
  currentPlan: string;
  currentExpiry: string | null;
  kind: "plan" | "run_pack";
  nextPlan: string | null;
  nextExpiry: string | null;
}): { plan: string; creditsExpireAt: string | null } {
  if (input.kind !== "plan" || !input.nextPlan) {
    return { plan: input.currentPlan, creditsExpireAt: input.currentExpiry };
  }
  const currentRank = planRank(parsePlanId(input.currentPlan) ?? "free");
  const next = parsePlanId(input.nextPlan);
  const nextRank = next ? planRank(next) : 0;
  const plan = next && nextRank > currentRank ? next : input.currentPlan;
  const current = input.currentExpiry ?? "";
  const incoming = input.nextExpiry ?? "";
  if (current && current > incoming) return { plan, creditsExpireAt: input.currentExpiry };
  return { plan, creditsExpireAt: input.nextExpiry ?? input.currentExpiry };
}

export type OrderStatus = "created" | "paid" | "failed" | "refunded";

export function parseOrderStatus(value: string): OrderStatus | null {
  switch (value) {
    case "created":
    case "paid":
    case "failed":
    case "refunded":
      return value;
    default:
      return null;
  }
}

export const ATS_READY = {
  greenhouse: true,
  lever: true,
  ashby: true,
  workable: true,
  smartrecruiters: true,
  workday: true,
  teamtailor: true,
  recruitee: true,
  icims: true,
  oracle_recruiting: true,
  successfactors: true,
  public_feed: true,
  licensed: true,
  aggregator: true,
  website: true,
} as const satisfies Record<Ats, true>;

export function parseAts(value: string): Ats | null {
  if (!Object.hasOwn(ATS_READY, value)) return null;
  return value as Ats;
}

export type AdapterCompliance = SourceCompliance;

const LIVE_READERS = new Set<Ats>(liveListingAts());

export function complianceFor(ats: Ats): AdapterCompliance {
  return sourceById(ats).compliance;
}

export function adapterEnabled(ats: Ats): boolean {
  return LIVE_READERS.has(ats);
}
