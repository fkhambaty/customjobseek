import type { TailoredResume } from "./types";
import { escapeHtml } from "./resumeFile";

/** Mirrors src/components/resume.css so a stored HTML file matches the on-screen resume. */
export const RESUME_CSS = `.resume {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 11mm 14mm 12mm;
  background: #fff;
  color: #182534;
  font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.33;
  box-shadow: 0 10px 35px rgba(17, 37, 58, 0.14);
  text-align: left;
}
.resume header {
  border-bottom: 2px solid #0e4a52;
  padding-bottom: 7px;
  margin-bottom: 7px;
}
.resume h1 {
  margin: 0;
  color: #0e4a52;
  font-size: 21pt;
  line-height: 1;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.resume .headline {
  margin-top: 5px;
  color: #0e4a52;
  font-size: 9.8pt;
  font-weight: 700;
  letter-spacing: 0.35px;
}
.resume .contact {
  margin-top: 5px;
  color: #2c3d4a;
  font-size: 9.2pt;
  white-space: pre-wrap;
}
.resume h2 {
  margin: 10px 0 5px;
  padding-bottom: 3px;
  border-bottom: 2px solid #0e4a52;
  color: #0e4a52;
  font-size: 10.2pt;
  letter-spacing: 0.85px;
  text-transform: uppercase;
  break-after: avoid;
}
.resume p { margin: 0 0 4px; white-space: pre-wrap; }
.resume ul { margin: 2px 0 0 16px; padding: 0; }
.resume li { margin: 0 0 4.5px; padding-left: 1px; }
.resume .job { margin-bottom: 11px; }
.resume .job-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 1px;
  break-after: avoid;
  break-inside: avoid;
}
.resume .job-title { color: #0e4a52; font-size: 10pt; font-weight: 700; }
.resume .job-company { color: #182534; font-weight: 700; }
.resume .job-date { color: #3d4f5c; font-size: 9pt; white-space: nowrap; }
.resume .subrole { color: #3d4f5c; font-size: 9pt; margin-bottom: 2px; }
.resume li { break-inside: avoid; }
body { margin: 0; background: #f4f1ec; }
@media screen and (max-width: 800px) {
  body { background: #fff; }
  .resume {
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 16px 14px 28px;
    box-shadow: none;
  }
  .resume h1 { font-size: 18pt; overflow-wrap: anywhere; }
  .resume .headline, .resume .contact, .resume p, .resume li { overflow-wrap: anywhere; }
  .resume .job-header { flex-wrap: wrap; }
  .resume .job-date { white-space: normal; }
}
@media print {
  @page { size: A4; margin: 11mm 14mm 12mm; }
  body { background: #fff; }
  .resume { box-shadow: none; margin: 0; padding: 0; width: auto; min-height: auto; }
}`;

function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

function documentShell(title: string, body: string, extraCss = ""): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title || "Resume")}</title>`,
    `<style>${RESUME_CSS}${extraCss}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("");
}

/** Deterministic HTML for a tailored resume. Same input always yields the same document. */
export function renderResumeHtml(resume: TailoredResume): string {
  const chunks: string[] = ['<article class="resume">', "<header>", `<h1>${escapeHtml(resume.fullName)}</h1>`];
  if (resume.headline) chunks.push(`<div class="headline">${escapeHtml(resume.headline)}</div>`);
  if (resume.contact.length > 0) chunks.push(`<div class="contact">${escapeHtml(resume.contact.join("  |  "))}</div>`);
  chunks.push("</header>");

  if (resume.summary) {
    chunks.push("<section>", "<h2>Profile</h2>", `<p>${escapeHtml(resume.summary)}</p>`, "</section>");
  }
  if (resume.coreStrengths.length > 0) {
    chunks.push("<section>", "<h2>Core Strengths</h2>", `<p>${escapeHtml(resume.coreStrengths.join("  •  "))}</p>`, "</section>");
  }
  if (resume.roles.length > 0) {
    chunks.push("<section>", "<h2>Professional Experience</h2>");
    for (const role of resume.roles) {
      chunks.push('<div class="job">', '<div class="job-header">', '<span class="job-title">', escapeHtml(role.title));
      if (role.company) chunks.push(`<span class="job-company">, ${escapeHtml(role.company)}</span>`);
      chunks.push("</span>", `<span class="job-date">${escapeHtml(dates(role.start, role.end))}</span>`, "</div>");
      if (role.location) chunks.push(`<div class="subrole">${escapeHtml(role.location)}</div>`);
      chunks.push("<ul>");
      for (const bullet of role.bullets) chunks.push(`<li>${escapeHtml(bullet.text)}</li>`);
      chunks.push("</ul>", "</div>");
    }
    chunks.push("</section>");
  }
  if (resume.skills.length > 0) {
    chunks.push("<section>", "<h2>Skills</h2>", `<p>${escapeHtml(resume.skills.join(", "))}</p>`, "</section>");
  }
  if (resume.education.length > 0) {
    chunks.push("<section>", "<h2>Education</h2>");
    for (const item of resume.education) {
      chunks.push(
        `<p><strong>${escapeHtml(item.degree)}</strong>${item.institution ? `, ${escapeHtml(item.institution)}` : ""}${item.year ? ` (${escapeHtml(item.year)})` : ""}</p>`,
      );
    }
    chunks.push("</section>");
  }
  if (resume.certifications.length > 0) {
    chunks.push("<section>", "<h2>Certifications</h2>", "<ul>");
    for (const item of resume.certifications) {
      chunks.push(
        `<li>${escapeHtml(item.name)}${item.issuer ? `, ${escapeHtml(item.issuer)}` : ""}${item.year ? ` (${escapeHtml(item.year)})` : ""}</li>`,
      );
    }
    chunks.push("</ul>", "</section>");
  }
  chunks.push("</article>");
  return documentShell(resume.fullName || "Resume", chunks.join(""));
}

/** Escaped text page for an uploaded resume. The original PDF is stored separately. */
export function renderPlainTextHtml(title: string, text: string): string {
  const body = `<article class="resume"><header><h1>${escapeHtml(title || "Resume")}</h1></header><pre class="resume-text">${escapeHtml(text)}</pre></article>`;
  return documentShell(title, body, "pre.resume-text{margin:0;font:inherit;white-space:pre-wrap;}");
}

/** Visible words from a stored HTML resume, used when an older file has no PDF yet. */
export function htmlToVisibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|li|tr|section|header)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
