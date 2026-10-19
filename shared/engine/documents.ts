import type { FitResult, ParsedSalary, Profile, TailoredResume } from "../types";
import { splitLines } from "./fit";

export interface WorkLink {
  label: string;
  url: string;
}

export interface ApplicationFile {
  candidate: string;
  headline: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  /** Letter body only. Not a resume rewrite. */
  paragraphs: string[];
  /** Concrete work examples taken from profile bullets. */
  evidence: { label: string; text: string }[];
  /** GitHub, demos, portfolio sites, and other showable links from the profile. */
  workLinks: WorkLink[];
  gaps: string[];
  /** Form-only note. Never printed on the cover letter PDF. */
  expectedCtc?: string;
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

function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Stable label for a showable link. Host only; never invents a project name. */
export function workLinkLabel(raw: string): string {
  const href = withScheme(raw);
  try {
    const host = new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "github.com" || host.endsWith(".github.io")) return "GitHub";
    if (host === "gitlab.com") return "GitLab";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "LinkedIn";
    if (host === "youtube.com" || host === "youtu.be") return "Demo video";
    if (host === "figma.com") return "Figma";
    if (host === "notion.so" || host.endsWith(".notion.site")) return "Write-up";
    if (host === "vercel.app" || host === "netlify.app" || host === "pages.dev") return "Live demo";
    return host || "External link";
  } catch {
    return "External link";
  }
}

export function workLinksFromProfile(links: string[]): WorkLink[] {
  const out: WorkLink[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const href = withScheme(raw);
    if (!href) continue;
    let key = href;
    try {
      key = new URL(href).href;
    } catch {
      /* keep raw */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: workLinkLabel(raw), url: href });
    if (out.length >= 8) break;
  }
  return out;
}

/** Up to five verified bullets across recent roles. Not a full experience section. */
export function workExamplesFromResume(resume: TailoredResume): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const role of resume.roles.slice(0, 3)) {
    const label = [role.title, role.company].filter(Boolean).join(", ") || "Experience";
    for (const bullet of role.bullets.slice(0, 2)) {
      const text = bullet.text.trim();
      if (!text) continue;
      out.push({ label, text });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function normaliseApplication(file: ApplicationFile): ApplicationFile {
  return {
    candidate: file.candidate ?? "",
    headline: file.headline ?? "",
    role: file.role ?? "",
    company: file.company ?? "",
    email: file.email ?? "",
    phone: file.phone ?? "",
    paragraphs: Array.isArray(file.paragraphs) ? file.paragraphs : [],
    evidence: Array.isArray(file.evidence) ? file.evidence : [],
    workLinks: Array.isArray(file.workLinks) ? file.workLinks : [],
    gaps: Array.isArray(file.gaps) ? file.gaps : [],
    expectedCtc: file.expectedCtc?.trim() || undefined,
  };
}

/** Plain text for copy/paste. Matches the downloadable letter, not the private gaps list. */
export function coverLetterPlainText(file: ApplicationFile): string {
  const app = normaliseApplication(file);
  const chunks: string[] = [];
  if (app.candidate) chunks.push(app.candidate);
  if (app.headline) chunks.push(app.headline);
  const contact = [app.email, app.phone, ...app.workLinks.map((link) => link.url)].filter(Boolean);
  if (contact.length) chunks.push(contact.join("  |  "));
  chunks.push("");
  chunks.push("Dear Hiring Team,");
  chunks.push("");
  for (const paragraph of app.paragraphs) {
    chunks.push(paragraph);
    chunks.push("");
  }
  if (app.evidence.length) {
    chunks.push("Examples of my work");
    for (const item of app.evidence) chunks.push(`• ${item.text} (${item.label})`);
    chunks.push("");
  }
  if (app.workLinks.length) {
    chunks.push("Work I can show");
    for (const link of app.workLinks) chunks.push(`• ${link.label}: ${link.url}`);
    chunks.push("");
  }
  chunks.push("Thank you for your consideration.");
  chunks.push("");
  chunks.push(app.candidate || "Applicant");
  return chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
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
    `I am applying for ${role.title}${role.company ? ` at ${role.company}` : ""}.`,
  ];
  if (recent) {
    const when = dates(recent.start, recent.end);
    paragraphs.push(
      `The closest verified role on my profile is ${recent.title}${recent.company ? ` at ${recent.company}` : ""}${when ? ` (${when})` : ""}. The examples below are taken from that work, not a restatement of my resume.`,
    );
  } else {
    paragraphs.push("The examples below are taken from my profile. They are not a restatement of my resume.");
  }
  if (fit.matchedRequired.length) {
    paragraphs.push(`Required skills already on my profile: ${fit.matchedRequired.join(", ")}.`);
  }
  const evidence = workExamplesFromResume(resume);
  const workLinks = workLinksFromProfile(profile.links);
  const gaps = fit.missingRequired.map((s) => `${s} is asked for and is not on the profile.`);
  if (fit.blockers.length) {
    gaps.push(...fit.blockers.map((b) => b.message));
  }
  return {
    candidate: profile.fullName,
    headline: profile.headline,
    role: role.title,
    company: role.company,
    email: profile.email,
    phone: profile.phone,
    paragraphs,
    evidence,
    workLinks,
    gaps,
    expectedCtc: options?.expectedCtc?.trim() || undefined,
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
