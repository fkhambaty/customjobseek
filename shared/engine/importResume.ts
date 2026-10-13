import type { Profile } from "../types";
import { emptyProfile } from "../types";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;
const LINK = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/\S+|github\.com\/\S+|[\w-]+\.(?:com|in|org|dev|io)\/\S*)/gi;

const SECTION = /^(profile|summary|about|professional summary|core strengths|skills|technical skills|interests|professional experience|experience|work experience|employment|education|certifications?|projects|software|accomplishments?|achievements?|awards?|languages?|publications?|volunteering)\b/i;

function linesOf(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s•\-*·]+/, "").trim())
    .filter(Boolean);
}

function isHeading(line: string): string | null {
  const m = line.match(SECTION);
  if (!m) return null;
  const word = (m[1] ?? "").toLowerCase();
  if (/experience|employment/.test(word)) return "experience";
  if (/education/.test(word)) return "education";
  if (/certification/.test(word)) return "certification";
  if (/skill|strength|interest/.test(word)) return "skills";
  if (/profile|summary|about/.test(word)) return "summary";
  return "other";
}

function looksLikeDate(line: string): boolean {
  return /\b(19|20)\d{2}\b/.test(line) && /\b(present|current|now|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i.test(line);
}

function dates(line: string): string[] {
  return line.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b|\bPresent\b/gi) ?? [];
}

function roleParts(line: string): { title: string; company: string } {
  const at = line.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) return { title: at[1] ?? line, company: at[2] ?? "" };
  const comma = line.match(/^([^,]{2,100}),\s*([^,]{2,100})$/);
  if (comma) return { title: comma[1] ?? line, company: comma[2] ?? "" };
  const dash = line.match(/^(.{2,100}?)\s+[–—-]\s+(.{2,100})$/);
  if (dash && !/^(?:intern|associate|lead|manager|director|consultant)$/i.test(dash[2] ?? "")) {
    return { title: dash[1] ?? line, company: dash[2] ?? "" };
  }
  return { title: line, company: "" };
}

function organisationFromDescription(line: string): string {
  const match = line.match(/^(.{2,80}?)\s+is\s+(?:a|an|the|India'?s|Centre\b)/i);
  return match?.[1]?.trim() ?? "";
}

function parseExperience(input: string[]): Profile["experience"] {
  const experience: Profile["experience"] = [];
  let current: Profile["experience"][number] | null = null;
  const flush = () => {
    if (current && (current.company || current.title || current.bullets.length)) experience.push(current);
    current = null;
  };
  for (let i = 0; i < input.length; i++) {
    const line = input[i] ?? "";
    const next = input[i + 1] ?? "";
    if (looksLikeDate(next) && next.length < 60) {
      flush();
      const role = roleParts(line);
      const range = dates(next);
      current = {
        id: `exp${experience.length}`,
        title: role.title.slice(0, 120),
        company: role.company.slice(0, 120),
        location: "",
        start: range[0] ?? "",
        end: range[1] ?? (/\bpresent\b/i.test(next) ? "Present" : ""),
        bullets: [],
      };
      i++;
      continue;
    }
    if (!current) continue;
    const company = organisationFromDescription(line);
    if (company && !current.company) {
      current.company = company.slice(0, 120);
      continue;
    }
    current.bullets.push({ id: `${current.id}b${current.bullets.length}`, text: line.slice(0, 400) });
  }
  flush();
  const month = (value: string): number => {
    const parsed = Date.parse(`1 ${value}`);
    return Number.isNaN(parsed) ? Number(value.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0) * 12 : new Date(parsed).getUTCFullYear() * 12 + new Date(parsed).getUTCMonth();
  };
  return experience.sort((a, b) => month(b.start) - month(a.start));
}

function parseEducation(input: string[]): Profile["education"] {
  const education: Profile["education"] = [];
  let degree: string[] = [];
  for (const line of input) {
    const institutionLine = line.match(/^(.{2,120}?)\s+[–—-]\s+((?:19|20)\d{2}(?:\s*[–—-]\s*(?:19|20)\d{2})?)$/);
    if (institutionLine) {
      education.push({
        id: `edu${education.length}`,
        institution: institutionLine[1]?.trim() ?? "",
        degree: degree.join(" ").trim().slice(0, 160),
        year: institutionLine[2]?.trim() ?? "",
      });
      degree = [];
      continue;
    }
    degree.push(line);
  }
  if (degree.length) {
    const line = degree.join(" ");
    education.push({ id: `edu${education.length}`, institution: "", degree: line.slice(0, 160), year: dates(line).join(" – ") });
  }
  return education;
}

// Turns extracted resume text into a profile draft. The person reviews it before it is saved.
// It only copies lines that are already in the file.
export function profileFromResumeText(text: string, emailFallback = ""): Profile {
  const draft = emptyProfile(emailFallback);
  const rawLines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const email = text.match(EMAIL)?.[0] ?? emailFallback;
  const phone = text.match(PHONE)?.[0]?.trim() ?? "";
  const links = Array.from(new Set((text.match(LINK) ?? []).map((l) => l.replace(/[.,;]+$/, "")))).slice(0, 5);
  const name = rawLines.find((l) =>
    !isHeading(l) && !EMAIL.test(l) && !PHONE.test(l) && /^[A-Za-z][A-Za-z .'-]+$/.test(l) &&
    l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5 && l.length < 60,
  ) ?? "";

  let section = "";
  const summary: string[] = [];
  const skills: string[] = [];
  const experienceLines: string[] = [];
  const educationLines: string[] = [];
  const certifications: Profile["certifications"] = [];

  for (const line of linesOf(text)) {
    const heading = isHeading(line);
    if (heading) {
      section = heading;
      continue;
    }
    if (section === "summary") {
      summary.push(line);
      continue;
    }
    if (section === "skills") {
      skills.push(...line.split(/[,|•·]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 60));
      continue;
    }
    if (section === "education") {
      educationLines.push(line);
      continue;
    }
    if (section === "certification") {
      certifications.push({ id: `cert${certifications.length}`, name: line, issuer: "", year: line.match(/\b(19|20)\d{2}\b/)?.[0] ?? "" });
      continue;
    }
    if (section === "experience") {
      experienceLines.push(line);
    }
  }
  const experience = parseExperience(experienceLines);
  const education = parseEducation(educationLines);

  return {
    ...draft,
    fullName: name,
    email,
    phone,
    links,
    summary: summary.join(" ").slice(0, 1500),
    skills: Array.from(new Set(skills)).slice(0, 80).map((name) => ({ name, level: "working" as const })),
    headline: experience[0]?.title ?? "",
    experience: experience.slice(0, 15),
    education: education.slice(0, 6),
    certifications: certifications.slice(0, 15),
  };
}
