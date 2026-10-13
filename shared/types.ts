export type SkillLevel = "expert" | "working" | "familiar";

export interface Skill {
  name: string;
  level: SkillLevel;
  years?: number;
}

export interface Bullet {
  id: string;
  text: string;
}

export interface Experience {
  id: string;
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  bullets: Bullet[];
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  year: string;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  year: string;
}

export type SalaryPeriod = "year" | "month" | "hour" | "lpa";

export interface Preferences {
  country: string;
  cities: string[];
  remoteOk: boolean;
  currency: string;
  minSalary: number | null;
  maxSalary: number | null;
  salaryPeriod: SalaryPeriod;
  targetRoles: string[];
  excludedTitleWords: string[];
}

export interface Profile {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  links: string[];
  summary: string;
  totalYears: number | null;
  skills: Skill[];
  neverClaim: string[];
  experience: Experience[];
  education: Education[];
  certifications: Certification[];
  preferences: Preferences;
}

export type Decision = "apply" | "stretch" | "skip";

export interface Blocker {
  kind: "salary" | "location" | "title" | "never_claim" | "experience";
  message: string;
}

export interface ParsedSalary {
  min: number;
  max: number;
  currency: string;
  /** The unit the posting used. min and max are in that unit, not annualised. */
  period: SalaryPeriod;
  /** min and max converted to one year, in major currency units (rupees, dollars). */
  annualMin: number;
  annualMax: number;
}

export interface FitResult {
  score: number;
  decision: Decision;
  imported?: boolean;
  matchedRequired: string[];
  matchedOther: string[];
  missingRequired: string[];
  missingOther: string[];
  blockers: Blocker[];
  notes: string[];
  jdYearsRequired: number | null;
  parsedSalary: ParsedSalary | null;
}

export interface TailoredRole {
  experienceId: string;
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  bullets: Bullet[];
  omittedBulletCount: number;
}

export interface TailoredResume {
  fullName: string;
  headline: string;
  contact: string[];
  summary: string;
  coreStrengths: string[];
  skills: string[];
  roles: TailoredRole[];
  education: Education[];
  certifications: Certification[];
  provenance: { untraceableLines: string[]; neverClaimHits: string[] };
  generatedFor: { jobId: string; title: string; company: string };
}

export const JOB_STATUSES = [
  "evaluated",
  "resume_ready",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Contact {
  id: string;
  name: string;
  role: string;
  url: string;
  email: string;
}

export interface LiveCheck {
  verdict: string;
  evidence: string;
  on: string;
}

/** Private, per-job research. Stored encrypted. */
export interface JobDetails {
  verification: string;
  compensation: string;
  payNote: string;
  fitNarrative: string;
  evidence: string[];
  warnings: string[];
  contacts: Contact[];
  liveCheck: LiveCheck | null;
}

export const EVENT_KINDS = ["status", "message", "reply", "note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const CHANNELS = ["linkedin", "email", "phone", "referral", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface JobEvent {
  id: string;
  jobId: string;
  kind: EventKind;
  status: JobStatus | "";
  channel: Channel | "";
  at: string;
  person: string;
  note: string;
}

export interface JobRecord {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  salaryText: string;
  description: string;
  status: JobStatus;
  fit: FitResult;
  notes: string;
  nextActionAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasResume: boolean;
  lane: string;
  route: string;
  family: string;
  requisition: string;
  /** Yearly pay in the job's currency. Estimated when the posting did not publish it. */
  payLow: number | null;
  payHigh: number | null;
  payEstimated: boolean;
  postedAt: string | null;
  rejectedAt: string | null;
  closedAt: string | null;
  contactCount: number;
  messagesSent: number;
  replies: number;
  lastTouchAt: string | null;
}

export interface JobFull extends JobRecord {
  details: JobDetails;
  events: JobEvent[];
}

export function emptyDetails(): JobDetails {
  return { verification: "", compensation: "", payNote: "", fitNarrative: "", evidence: [], warnings: [], contacts: [], liveCheck: null };
}

export interface Account {
  email: string;
  plan: string;
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  creditsExpireAt: string | null;
}

export function emptyProfile(email = ""): Profile {
  return {
    fullName: "",
    headline: "",
    email,
    phone: "",
    links: [],
    summary: "",
    totalYears: null,
    skills: [],
    neverClaim: [],
    experience: [],
    education: [],
    certifications: [],
    preferences: {
      country: "",
      cities: [],
      remoteOk: true,
      currency: "USD",
      minSalary: null,
      maxSalary: null,
      salaryPeriod: "year",
      targetRoles: [],
      excludedTitleWords: [],
    },
  };
}
