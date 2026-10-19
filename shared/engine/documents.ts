import type { FitResult, ParsedSalary, Profile, ShowableWork, TailoredResume } from "../types";
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
  /** First-person letter body. Not a resume rewrite. */
  paragraphs: string[];
  /** Project notes and outcomes (company label only — never a job-title spam list). */
  evidence: { label: string; text: string }[];
  /** GitHub, demos, portfolio sites, and other showable links. */
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

/** LinkedIn is contact context, not a work sample for the cover letter. */
const SKIP_SHOWABLE_HOST = /^(?:[\w-]+\.)*(linkedin\.com)$/i;

const PROJECT_PICKS: { company: RegExp; prefer: RegExp; label: string }[] = [
  { company: /opengov/i, prefer: /10\s*suites|unif|central|snowflake|warehouse/i, label: "OpenGov" },
  { company: /allscripts|veradigm/i, prefer: /government|healthcare|medicaid|federal|\bus\b/i, label: "Allscripts" },
  { company: /ivalua/i, prefer: /\bvw\b|volkswagen|analytics|end.to.end|platform/i, label: "Ivalua" },
];

/** Default cover-letter examples (same owner defaults pattern as DEFAULT_GITHUB). Editable on Profile. */
export const DEFAULT_SHOWABLE_WORK: Omit<ShowableWork, "id">[] = [
  {
    title: "GitHub",
    detail: "Public repositories and code samples",
    url: "https://github.com/fkhambaty",
    company: "",
  },
  {
    title: "YouTube · Snowflake projects",
    detail: "Snowflake project walkthroughs and demos",
    url: "https://youtube.com/@fakhruddinkhambaty",
    company: "",
  },
  {
    title: "datafordummies.in",
    detail: "External site with data engineering material",
    url: "https://datafordummies.in",
    company: "",
  },
  {
    title: "Central Snowflake warehouse",
    detail: "Unifying 10 product suites into a central Snowflake warehouse",
    url: "",
    company: "OpenGov",
  },
  {
    title: "US government healthcare platform",
    detail: "US government healthcare platform setup",
    url: "",
    company: "Allscripts",
  },
  {
    title: "VW analytics data platform",
    detail: "End-to-end data platform for analytics at Volkswagen",
    url: "",
    company: "Ivalua",
  },
];

function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostOf(raw: string): string {
  try {
    return new URL(withScheme(raw)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Stable label for a showable link. Host-based; never invents a project name. */
export function workLinkLabel(raw: string): string {
  const href = withScheme(raw);
  try {
    const host = hostOf(href);
    const path = new URL(href).pathname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.io")) return "GitHub";
    if (host === "gitlab.com") return "GitLab";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "LinkedIn";
    if (host === "youtube.com" || host === "youtu.be") {
      if (path.includes("snowflake") || /@fakhruddin/i.test(href)) return "YouTube · Snowflake projects";
      return "YouTube";
    }
    if (host === "datafordummies.in") return "datafordummies.in";
    if (host === "figma.com") return "Figma";
    if (host === "notion.so" || host.endsWith(".notion.site")) return "Write-up";
    if (host === "vercel.app" || host === "netlify.app" || host === "pages.dev") return "Live demo";
    return host || "External link";
  } catch {
    return "External link";
  }
}

function linkRank(raw: string): number {
  const host = hostOf(raw);
  if (host === "github.com" || host.endsWith(".github.io")) return 0;
  if (host === "youtube.com" || host === "youtu.be") return 1;
  if (host === "datafordummies.in") return 2;
  if (host.endsWith(".in") || host.endsWith(".dev") || host.endsWith(".io")) return 3;
  return 4;
}

export function workLinksFromProfile(links: string[]): WorkLink[] {
  const cleaned = links
    .map((raw) => ({ raw, href: withScheme(raw) }))
    .filter((item) => item.href && !SKIP_SHOWABLE_HOST.test(hostOf(item.href)));
  cleaned.sort((a, b) => linkRank(a.href) - linkRank(b.href) || a.href.localeCompare(b.href));
  const out: WorkLink[] = [];
  const seen = new Set<string>();
  for (const item of cleaned) {
    let key = item.href;
    try {
      key = new URL(item.href).href;
    } catch {
      /* keep */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: workLinkLabel(item.raw), url: item.href });
    if (out.length >= 6) break;
  }
  return out;
}

function showableFromProfile(items: ShowableWork[] | undefined): { evidence: { label: string; text: string }[]; workLinks: WorkLink[] } {
  const evidence: { label: string; text: string }[] = [];
  const workLinks: WorkLink[] = [];
  const seenUrl = new Set<string>();
  for (const item of items ?? []) {
    const title = item.title.trim();
    const detail = item.detail.trim();
    const company = item.company.trim();
    const url = withScheme(item.url);
    if (url && !seenUrl.has(url)) {
      seenUrl.add(url);
      workLinks.push({ label: title || workLinkLabel(url), url });
    }
    const text = detail || title;
    if (!text) continue;
    const label = company || title || "Project";
    if (evidence.some((row) => row.text === text)) continue;
    evidence.push({ label, text });
  }
  return { evidence: evidence.slice(0, 5), workLinks: workLinks.slice(0, 6) };
}

/** Prefer one strong project note per known company from the full career profile. */
export function workExamplesFromProfile(profile: Profile): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const usedCompanies = new Set<string>();
  for (const pick of PROJECT_PICKS) {
    const role = profile.experience.find((exp) => pick.company.test(exp.company));
    if (!role) continue;
    const preferred = role.bullets.find((b) => pick.prefer.test(b.text));
    const bullet = preferred ?? role.bullets[0];
    if (!bullet?.text.trim()) continue;
    out.push({ label: pick.label || role.company, text: bullet.text.trim() });
    usedCompanies.add(role.company.toLowerCase());
  }
  for (const role of profile.experience) {
    if (out.length >= 4) break;
    if (usedCompanies.has(role.company.toLowerCase())) continue;
    const bullet = role.bullets.find((b) => b.text.trim().length >= 40) ?? role.bullets[0];
    if (!bullet?.text.trim()) continue;
    out.push({ label: role.company || role.title || "Experience", text: bullet.text.trim() });
    usedCompanies.add(role.company.toLowerCase());
  }
  return out.slice(0, 4);
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
  const contact = [app.email, app.phone].filter(Boolean);
  if (contact.length) chunks.push(contact.join("  |  "));
  chunks.push("");
  chunks.push("Dear Hiring Team,");
  chunks.push("");
  for (const paragraph of app.paragraphs) {
    chunks.push(paragraph);
    chunks.push("");
  }
  if (app.workLinks.length || app.evidence.length) {
    chunks.push("Examples of my work");
    for (const link of app.workLinks) chunks.push(`• ${link.label}: ${link.url}`);
    for (const item of app.evidence) chunks.push(`• ${item.label} — ${item.text}`);
    chunks.push("");
  }
  chunks.push("Thank you for your consideration.");
  chunks.push("");
  chunks.push(app.candidate || "Applicant");
  return `${chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * First-person cover letter from the profile. Links and project notes only —
 * not a third-person summary and not a resume rewrite.
 */
export function buildApplication(
  profile: Profile,
  fit: FitResult,
  resume: TailoredResume,
  options?: { expectedCtc?: string },
): ApplicationFile {
  const role = resume.generatedFor;
  const curated = showableFromProfile(profile.showableWork);
  const workLinks = curated.workLinks.length ? curated.workLinks : workLinksFromProfile(profile.links);
  const evidence = curated.evidence.length ? curated.evidence : workExamplesFromProfile(profile);

  const paragraphs = [
    `I am applying for ${role.title}${role.company ? ` at ${role.company}` : ""}.`,
    "Below are examples of my work you can open — GitHub, demos, sites, and a few project outcomes from my experience. This is not a restatement of my resume.",
  ];
  if (fit.matchedRequired.length) {
    paragraphs.push(`Skills from my profile that this posting asks for: ${fit.matchedRequired.slice(0, 8).join(", ")}.`);
  }

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
