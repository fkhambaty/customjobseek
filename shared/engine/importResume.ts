import type { Profile } from "../types";
import { emptyProfile } from "../types";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;
const LINK = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/\S+|github\.com\/\S+|[\w-]+\.(?:com|in|org|dev|io)\/\S*)/gi;

const SECTION = /^(profile|summary|about|professional summary|core strengths|skills|technical skills|professional experience|experience|work experience|employment|education|certifications?|projects)\b/i;

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
  if (/skill|strength/.test(word)) return "skills";
  if (/profile|summary|about/.test(word)) return "summary";
  return null;
}

function looksLikeDate(line: string): boolean {
  return /\b(19|20)\d{2}\b/.test(line) && /\b(present|current|now|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i.test(line);
}

// Turns extracted resume text into a profile draft. The person reviews it before it is saved.
// It only copies lines that are already in the file.
export function profileFromResumeText(text: string, emailFallback = ""): Profile {
  const draft = emptyProfile(emailFallback);
  const rawLines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const email = text.match(EMAIL)?.[0] ?? emailFallback;
  const phone = text.match(PHONE)?.[0]?.trim() ?? "";
  const links = Array.from(new Set((text.match(LINK) ?? []).map((l) => l.replace(/[.,;]+$/, "")))).slice(0, 5);
  const name = rawLines.find((l) => !EMAIL.test(l) && !PHONE.test(l) && l.split(/\s+/).length <= 5 && l.length < 60) ?? "";

  let section = "";
  const summary: string[] = [];
  const skills: string[] = [];
  const experience: Profile["experience"] = [];
  const education: Profile["education"] = [];
  const certifications: Profile["certifications"] = [];
  let current: Profile["experience"][number] | null = null;

  const flush = () => {
    if (current && (current.company || current.title || current.bullets.length)) experience.push(current);
    current = null;
  };

  for (const line of linesOf(text)) {
    const heading = isHeading(line);
    if (heading) {
      if (heading !== "experience") flush();
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
      education.push({ id: `edu${education.length}`, institution: "", degree: line, year: line.match(/\b(19|20)\d{2}\b/)?.[0] ?? "" });
      continue;
    }
    if (section === "certification") {
      certifications.push({ id: `cert${certifications.length}`, name: line, issuer: "", year: line.match(/\b(19|20)\d{2}\b/)?.[0] ?? "" });
      continue;
    }
    if (section === "experience") {
      if (looksLikeDate(line) && current && !current.bullets.length) {
        const years = line.match(/\b(?:[A-Za-z]{3,9}\s+)?(?:19|20)\d{2}\b|\bPresent\b/gi) ?? [];
        current.start = years[0] ?? current.start;
        current.end = years[1] ?? (/\bpresent\b/i.test(line) ? "Present" : current.end);
        continue;
      }
      const roleHeader = line.length < 90 && /[–—,]\s+\S|\s+at\s+/i.test(line);
      if (!current || (roleHeader && (current.bullets.length || current.start))) {
        flush();
        const [left, right] = line.split(/\s+[–—-]\s+|\s+at\s+|,\s+/);
        current = {
          id: `exp${experience.length}`,
          title: (left ?? line).slice(0, 120),
          company: (right ?? "").slice(0, 120),
          location: "",
          start: "",
          end: "",
          bullets: [],
        };
        continue;
      }
      current.bullets.push({ id: `${current.id}b${current.bullets.length}`, text: line.slice(0, 400) });
    }
  }
  flush();

  return {
    ...draft,
    fullName: name,
    email,
    phone,
    links,
    summary: summary.join(" ").slice(0, 1500),
    skills: Array.from(new Set(skills)).slice(0, 80).map((name) => ({ name, level: "working" as const })),
    experience: experience.slice(0, 15),
    education: education.slice(0, 6),
    certifications: certifications.slice(0, 15),
  };
}
