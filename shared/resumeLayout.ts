import type { TailoredResume } from "./types";

export function roleDates(start: string, end: string, location: string): string {
  const span = [start, end].filter(Boolean).join(" to ");
  return [span, location].filter(Boolean).join(" | ");
}

export function roleHeading(company: string, title: string): string {
  return company ? `${company}, ${title}` : title;
}

export function educationLine(resume: TailoredResume): string {
  return resume.education
    .map((item) => [item.degree, item.institution].filter(Boolean).join(", ") + (item.year ? ` (${item.year})` : ""))
    .filter(Boolean)
    .join(" | ");
}

export function certificationLine(resume: TailoredResume): string {
  return resume.certifications
    .map((item) => [item.name, item.issuer, item.year].filter(Boolean).join(", "))
    .filter(Boolean)
    .join(" | ");
}

export function profileParagraphs(resume: TailoredResume): string[] {
  return resume.profileParagraphs?.length ? resume.profileParagraphs : [resume.summary].filter(Boolean);
}
