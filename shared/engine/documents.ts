import type { FitResult, ParsedSalary, Profile, TailoredResume } from "../types";
import { splitLines } from "./fit";

export interface ApplicationFile {
  candidate: string;
  headline: string;
  role: string;
  company: string;
  paragraphs: string[];
  evidence: { label: string; text: string }[];
  gaps: string[];
}

export interface JobDescriptionFile {
  title: string;
  company: string;
  location: string;
  url: string;
  salaryText: string;
  salary: ParsedSalary | null;
  yearsRequired: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  requirementLines: string[];
  responsibilityLines: string[];
  fullText: string;
}

const REQUIREMENT_HEADER = /^\W*(requirements?|qualifications?|must have|what you('| wi)ll need|you have|what we('| a)re looking for|about you)\b/i;
const DUTY_HEADER = /^\W*(responsibilities|what you('| wi)ll do|the role|about the role|duties|job description)\b/i;

function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

// Every sentence is assembled from the profile and the fit result. No line is paraphrased.
export function buildApplication(
  profile: Profile,
  fit: FitResult,
  resume: TailoredResume,
  options?: { expectedCtc?: string },
): ApplicationFile {
  const role = resume.generatedFor;
  const recent = resume.roles[0];
  const paragraphs = [
    `${profile.fullName || "The candidate"} is applying for ${role.title}${role.company ? ` at ${role.company}` : ""}.`,
  ];
  if (recent) {
    const when = dates(recent.start, recent.end);
    paragraphs.push(
      `The closest verified role is ${recent.title}${recent.company ? ` at ${recent.company}` : ""}${when ? ` (${when})` : ""}.`,
    );
  }
  if (fit.matchedRequired.length) {
    paragraphs.push(`Required skills already on the profile: ${fit.matchedRequired.join(", ")}.`);
  }
  if (options?.expectedCtc?.trim()) {
    paragraphs.push(`Expected CTC (grade-benchmark estimate for forms; not employer-published pay): ${options.expectedCtc.trim()}`);
  }
  const evidence = (recent?.bullets ?? []).slice(0, 4).map((b) => ({ label: recent?.title ?? "Experience", text: b.text }));
  const gaps = fit.missingRequired.map((s) => `${s} is asked for and is not on the profile.`);
  if (fit.blockers.length) {
    gaps.push(...fit.blockers.map((b) => b.message));
  }
  return {
    candidate: profile.fullName,
    headline: profile.headline,
    role: role.title,
    company: role.company,
    paragraphs,
    evidence,
    gaps,
  };
}

export function buildJobFile(
  job: { title: string; company: string; location: string; url: string; salaryText: string; description: string },
  fit: FitResult,
): JobDescriptionFile {
  const lines = splitLines(job.description);
  let mode: "req" | "duty" | "" = "";
  const requirementLines: string[] = [];
  const responsibilityLines: string[] = [];
  for (const line of lines) {
    if (REQUIREMENT_HEADER.test(line)) {
      mode = "req";
      continue;
    }
    if (DUTY_HEADER.test(line)) {
      mode = "duty";
      continue;
    }
    if (line.length < 8) continue;
    if (mode === "req") requirementLines.push(line);
    else if (mode === "duty") responsibilityLines.push(line);
  }
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    salaryText: job.salaryText,
    salary: fit.parsedSalary,
    yearsRequired: fit.jdYearsRequired,
    requiredSkills: [...fit.matchedRequired, ...fit.missingRequired],
    preferredSkills: [...fit.matchedOther, ...fit.missingOther],
    requirementLines: requirementLines.slice(0, 30),
    responsibilityLines: responsibilityLines.slice(0, 30),
    fullText: job.description,
  };
}
