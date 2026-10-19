import { coverLetterPlainText, type ApplicationFile } from "./engine/documents";
import { escapeHtml } from "./resumeFile";
import { RESUME_CSS } from "./resumeHtml";

/** Tighter one-page letter: same family as the resume, less section chrome. */
const COVER_CSS = `${RESUME_CSS}
.resume { min-height: auto; padding: 14mm 16mm; }
.resume h1 { font-size: 18pt; }
.resume h2 { margin: 7pt 0 3pt; font-size: 9pt; }
.resume p { margin: 0 0 5pt; text-align: left; }
.resume ul { margin: 0 0 4pt 12pt; }
.resume li { margin: 0 0 3.5pt; text-align: left; }
.resume .letter-sign { margin-top: 8pt; }
.resume a { color: #0b4f8a; text-decoration: none; word-break: break-all; }
.resume .role-line { margin: 4pt 0 0; color: #4a5a6b; font-size: 9pt; }
@media print {
  @page { size: A4; margin: 14mm 16mm; }
}
`;

function documentShell(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title || "Cover letter")}</title>`,
    `<style>${COVER_CSS}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("");
}

/** Deterministic one-page HTML cover letter. First person; links and projects, not a resume. */
export function renderCoverLetterHtml(file: ApplicationFile): string {
  const app = {
    ...file,
    paragraphs: file.paragraphs ?? [],
    evidence: file.evidence ?? [],
    workLinks: file.workLinks ?? [],
    email: file.email ?? "",
    phone: file.phone ?? "",
  };
  const title = app.candidate ? `${app.candidate} — Cover letter` : "Cover letter";
  const chunks: string[] = ['<article class="resume">', "<header>", `<h1>${escapeHtml(app.candidate || "Cover letter")}</h1>`];
  if (app.headline) chunks.push(`<div class="headline">${escapeHtml(app.headline)}</div>`);
  const contact = [app.email, app.phone].filter(Boolean).join("  |  ");
  if (contact) chunks.push(`<div class="contact">${escapeHtml(contact)}</div>`);
  const roleLine = [app.role, app.company].filter(Boolean).join(" · ");
  if (roleLine) chunks.push(`<p class="role-line">Application for ${escapeHtml(roleLine)}</p>`);
  chunks.push("</header>");

  chunks.push("<section>", "<p>Dear Hiring Team,</p>");
  for (const paragraph of app.paragraphs) {
    chunks.push(`<p>${escapeHtml(paragraph)}</p>`);
  }
  chunks.push("</section>");

  if (app.workLinks.length || app.evidence.length) {
    chunks.push("<section>", "<h2>Examples of my work</h2>", "<ul>");
    for (const link of app.workLinks) {
      const href = escapeHtml(link.url);
      chunks.push(`<li><strong>${escapeHtml(link.label)}:</strong> <a href="${href}">${href}</a></li>`);
    }
    for (const item of app.evidence) {
      chunks.push(`<li><strong>${escapeHtml(item.label)} —</strong> ${escapeHtml(item.text)}</li>`);
    }
    chunks.push("</ul>", "</section>");
  }

  chunks.push(
    "<section>",
    '<p class="letter-sign">Thank you for your consideration.</p>',
    `<p>${escapeHtml(app.candidate || "Applicant")}</p>`,
    "</section>",
    "</article>",
  );
  return documentShell(title, chunks.join(""));
}

export function coverLetterFilename(candidate: string, company: string): string {
  const base = [candidate, company ? `Cover letter ${company}` : "Cover letter"].filter(Boolean).join(" - ");
  return base || "Cover letter";
}

export { coverLetterPlainText };
