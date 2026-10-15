import type { TailoredResume } from "./types";
import { escapeHtml } from "./resumeFile";

/** Mirrors src/components/resume.css so a stored HTML file matches the on-screen resume. */
export const RESUME_CSS = `.resume {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 12mm 13mm;
  background: #fff;
  color: #1a2430;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 10.1pt;
  line-height: 1.44;
  box-shadow: 0 10px 35px rgba(17, 37, 58, 0.14);
  text-align: left;
}
.resume header {
  border-bottom: 2pt solid #0b4f8a;
  padding-bottom: 8pt;
}
.resume h1 {
  margin: 0;
  color: #0f1b28;
  font-size: 23pt;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.4pt;
  text-transform: uppercase;
}
.resume .headline {
  margin-top: 4pt;
  color: #0b4f8a;
  font-size: 9.6pt;
  font-weight: 800;
  letter-spacing: 0.3pt;
  line-height: 1.3;
  text-transform: uppercase;
}
.resume .contact {
  margin-top: 5pt;
  color: #4a5a6b;
  font-size: 8.9pt;
  white-space: pre-wrap;
}
.resume h2 {
  margin: 8pt 0 3pt;
  padding-bottom: 2pt;
  border-bottom: 0.8pt solid #c9d6e3;
  color: #0b4f8a;
  font-size: 9.6pt;
  font-weight: 800;
  letter-spacing: 0.9pt;
  text-transform: uppercase;
  break-after: avoid;
  page-break-after: avoid;
}
.resume p { margin: 0 0 4.5pt; text-align: justify; white-space: pre-wrap; }
.resume ul { margin: 0 0 0 13pt; padding: 0; }
.resume li { margin: 0 0 3pt; text-align: justify; break-inside: avoid; page-break-inside: avoid; }
.resume .impact { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16pt; row-gap: 3.5pt; margin-left: 13pt; }
.resume .impact li { margin: 0 0 0 12pt; text-align: left; }
.resume .cap { margin-bottom: 3.5pt; font-size: 9.2pt; line-height: 1.4; text-align: left; break-inside: avoid; page-break-inside: avoid; }
.resume strong { color: #0f1b28; font-weight: 700; }
.resume .job { margin-bottom: 6pt; }
.resume .job-header {
  display: flex;
  justify-content: space-between;
  gap: 10pt;
  align-items: baseline;
  margin-bottom: 1.5pt;
  break-after: avoid;
  break-inside: avoid;
  page-break-after: avoid;
}
.resume .job-title { color: #0f1b28; font-size: 10.8pt; font-weight: 800; }
.resume .job-company { color: #0f1b28; font-weight: 800; }
.resume .job-date { color: #4a5a6b; font-size: 8.6pt; font-style: italic; white-space: nowrap; }
.resume .subrole { color: #4a5a6b; font-size: 8.9pt; font-style: italic; margin-bottom: 3.5pt; }
.resume .environment { margin-top: 3.5pt; padding-top: 2.5pt; border-top: 0.4pt dotted #c9d6e3; color: #4a5a6b; font-size: 8.4pt; }
.resume .environment strong { color: #0b4f8a; }
.resume .education { font-size: 9.2pt; text-align: left; }
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
  @page { size: A4; margin: 12mm 13mm; }
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
  if ((resume.selectedImpact?.length ?? 0) > 0) {
    chunks.push("<section>", "<h2>Selected Impact</h2>", '<ul class="impact">');
    for (const line of resume.selectedImpact ?? []) chunks.push(`<li>${escapeHtml(line)}</li>`);
    chunks.push("</ul>", "</section>");
  }
  if ((resume.capabilityGroups?.length ?? 0) > 0) {
    chunks.push("<section>", "<h2>Core Capabilities</h2>");
    for (const group of resume.capabilityGroups ?? []) {
      chunks.push(`<p class="cap"><strong>${escapeHtml(group.name)}:</strong> ${escapeHtml(group.items.join(", "))}</p>`);
    }
    chunks.push("</section>");
  } else if (resume.coreStrengths.length > 0) {
    chunks.push("<section>", "<h2>Core Strengths</h2>", `<p>${escapeHtml(resume.coreStrengths.join("  •  "))}</p>`, "</section>");
  }
  if (resume.aiAssistedDelivery) {
    chunks.push("<section>", "<h2>AI-Assisted Delivery</h2>", `<p>${escapeHtml(resume.aiAssistedDelivery)}</p>`, "</section>");
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
      chunks.push("</ul>");
      if ((role.environment?.length ?? 0) > 0) {
        chunks.push(`<div class="environment"><strong>Environment:</strong> ${escapeHtml(role.environment?.join(", ") ?? "")}</div>`);
      }
      chunks.push("</div>");
    }
    chunks.push("</section>");
  }
  if ((resume.capabilityGroups?.length ?? 0) === 0 && resume.skills.length > 0) {
    chunks.push("<section>", "<h2>Skills</h2>", `<p>${escapeHtml(resume.skills.join(", "))}</p>`, "</section>");
  }
  if (resume.education.length > 0 || resume.certifications.length > 0) {
    chunks.push("<section>", "<h2>Education &amp; Certifications</h2>");
    for (const item of resume.education) {
      chunks.push(
        `<p class="education"><strong>${escapeHtml(item.degree)}</strong>${item.institution ? `, ${escapeHtml(item.institution)}` : ""}${item.year ? ` (${escapeHtml(item.year)})` : ""}</p>`,
      );
    }
    if (resume.certifications.length > 0) {
      const certifications = resume.certifications.map((item) =>
        `${item.name}${item.issuer ? `, ${item.issuer}` : ""}${item.year ? ` (${item.year})` : ""}`,
      ).join("  |  ");
      chunks.push(`<p class="education">${escapeHtml(certifications)}</p>`);
    }
    chunks.push("</section>");
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
