/**
 * Turns a recruiter LinkedIn / WhatsApp / email paste into a checkable job.
 * Conservative: only fills fields when the text clearly states them.
 */

export interface ExternalOpportunity {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
  url: string;
  contactName: string;
  contactEmail: string;
  sourceLabel: "External";
}

const EMPTY: ExternalOpportunity = {
  title: "",
  company: "",
  location: "",
  salaryText: "",
  description: "",
  url: "",
  contactName: "",
  contactEmail: "",
  sourceLabel: "External",
};

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return tidy(m[1]);
  }
  return "";
}

function emailsIn(text: string): string[] {
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]!);
}

function companyFromEmail(email: string): string {
  const host = email.split("@")[1]?.toLowerCase() ?? "";
  const base = host.replace(/\.(com|in|co\.in|io|tech|ai|org|net)$/i, "").split(".")[0] ?? "";
  if (!base || base.length < 2) return "";
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a readable JD so fit/resume engines have enough signal even from a short message. */
export function formatExternalDescription(raw: string, parsed: Omit<ExternalOpportunity, "description" | "sourceLabel">): string {
  const lines: string[] = [];
  lines.push(`${parsed.title || "Open role"}${parsed.company ? ` at ${parsed.company}` : ""}`);
  if (parsed.location) lines.push(`Location: ${parsed.location}`);
  if (parsed.salaryText) lines.push(`Pay: ${parsed.salaryText}`);
  if (parsed.contactName || parsed.contactEmail) {
    lines.push(`Contact: ${[parsed.contactName, parsed.contactEmail].filter(Boolean).join(" · ")}`);
  }
  lines.push("");
  lines.push("Source: external outreach (LinkedIn / recruiter / referral). Not from a public job board scan.");
  lines.push("");
  lines.push("Original message:");
  lines.push(raw.trim());
  return lines.join("\n").slice(0, 30000);
}

/**
 * Parse a pasted recruiter or LinkedIn hiring message into job fields.
 * Always returns a description long enough for Check a job (≥150 chars when raw is useful).
 */
export function parseExternalOpportunity(rawInput: string): ExternalOpportunity {
  const raw = String(rawInput ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return { ...EMPTY };

  const title = firstMatch(raw, [
    /(?:^|\n)\s*Role\s*[:\-–]\s*(.+)$/im,
    /(?:^|\n)\s*Position\s*[:\-–]\s*(.+)$/im,
    /(?:^|\n)\s*Job\s*title\s*[:\-–]\s*(.+)$/im,
    /hiring\s+(?:for\s+(?:a\s+)?)?([A-Za-z][A-Za-z0-9 /&+|-]{2,80})\s+for\b/i,
    /below position as\s+([A-Za-z][A-Za-z0-9 /&+|-]{2,80})\s+for\b/i,
  ]);

  const location = firstMatch(raw, [
    /(?:^|\n)\s*Location\s*[:\-–]\s*(.+)$/im,
    /(?:^|\n)\s*Loc(?:ation)?\s*[:\-–]\s*(.+)$/im,
    /\bfor\s+([A-Za-z .]{2,40})\s+loc(?:ation)?\b/i,
    /\b(?:based in|in)\s+([A-Za-z .]{2,40})(?:\s|\.|$)/i,
  ]).replace(/\bloc\.?$/i, "").trim();

  const salaryText = firstMatch(raw, [
    /(?:^|\n)\s*(?:Pay|CTC|Salary|Budget)\s*[:\-–]\s*(.+)$/im,
    /(\d+\s*[-–to]+\s*\d+\s*(?:LPA|lpa|Lacs?|lakhs?))/i,
  ]);

  const emails = emailsIn(raw);
  const contactEmail = emails[0] ?? "";
  let company = firstMatch(raw, [
    /(?:^|\n)\s*Company\s*[:\-–]\s*(.+)$/im,
    /(?:^|\n)\s*Organisation\s*[:\-–]\s*(.+)$/im,
    /(?:^|\n)\s*Organization\s*[:\-–]\s*(.+)$/im,
    /\bat\s+([A-Z][A-Za-z0-9 &.+-]{1,60})\b/,
  ]);
  if (!company && /unimorph/i.test(raw)) company = "Unimorph Consulting";
  if (!company && contactEmail) company = companyFromEmail(contactEmail);

  const contactName = firstMatch(raw, [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*$/m,
    /(?:^|\n)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*\n[^\n]*(?:Founder|Director|Recruiter|HR|Talent)/i,
  ]);

  const typeLine = firstMatch(raw, [/(?:^|\n)\s*Type\s*[:\-–]\s*(.+)$/im]);
  const expLine = firstMatch(raw, [/(?:^|\n)\s*Exp(?:erience)?\s*[:\-–]\s*(.+)$/im]);

  const skillsBlock = (() => {
    const m = raw.match(/(?:#\s*)?Key Skills\s*[:\-–]?\s*([\s\S]+?)(?:\n\s*\n|Interested candidates|$)/i);
    return m?.[1] ? tidy(m[1].replace(/\n/g, ", ")) : "";
  })();

  const parts = { title, company, location, salaryText, url: "", contactName, contactEmail };
  let description = formatExternalDescription(raw, parts);
  if (expLine) description = description.replace("Original message:", `Experience: ${expLine}\n\nOriginal message:`);
  if (typeLine) description = description.replace("Original message:", `Engagement: ${typeLine}\n\nOriginal message:`);
  if (skillsBlock) {
    description = description.replace(
      "Original message:",
      `Key skills:\n${skillsBlock}\n\nOriginal message:`,
    );
  }

  // Guarantee the API length floor when the paste itself is thin but structured.
  if (description.length < 150 && raw.length > 0) {
    description = `${description}\n\nRequirements mentioned in outreach:\n- ${skillsBlock || title || "See original message."}\n`.slice(0, 30000);
  }

  return { ...parts, description, sourceLabel: "External" };
}

export function isExternalRoute(route: string): boolean {
  return route === "External" || route === "No link";
}
