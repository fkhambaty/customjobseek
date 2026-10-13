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

export interface Preferences {
  cities: string[];
  remoteOk: boolean;
  minSalaryLpa: number | null;
  maxSalaryLpa: number | null;
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

export interface FitResult {
  score: number;
  decision: Decision;
  matchedRequired: string[];
  matchedOther: string[];
  missingRequired: string[];
  missingOther: string[];
  blockers: Blocker[];
  notes: string[];
  jdYearsRequired: number | null;
  parsedSalaryLpa: { min: number; max: number } | null;
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
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

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
}

export interface Account {
  email: string;
  plan: string;
  evalCredits: number;
  resumeCredits: number;
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
      cities: [],
      remoteOk: true,
      minSalaryLpa: null,
      maxSalaryLpa: null,
      targetRoles: [],
      excludedTitleWords: [],
    },
  };
}
