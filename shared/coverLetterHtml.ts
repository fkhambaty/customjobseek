import { coverLetterPlainText, type ApplicationFile } from "./engine/documents";
import { escapeHtml } from "./resumeFile";
import { RESUME_CSS } from "./resumeHtml";

const COVER_CSS = `${RESUME_CSS}
.resume h2 { letter-spacing: 0.6pt; }
.resume .letter-sign { margin-top: 10pt; }
.resume a { color: #0b4f8a; text-decoration: none; word-break: break-all; }
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

function contactLine(app: ApplicationFile): string {
  return [app.email, app.phone, ...app.workLinks.map((link) => link.url)].filter(Boolean).join("  |  ");
}

/** Deterministic HTML cover letter. Examples and links only — not a resume. */
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
  const contact = contactLine(app);
  if (contact) chunks.push(`<div class="contact">${escapeHtml(contact)}</div>`);
  chunks.push("</header>");

  const roleLine = [app.role, app.company].filter(Boolean).join(" · ");
  if (roleLine) {
    chunks.push("<section>", "<h2>Role</h2>", `<p>${escapeHtml(roleLine)}</p>`, "</section>");
  }

  chunks.push("<section>", "<h2>Cover letter</h2>", "<p>Dear Hiring Team,</p>");
  for (const paragraph of app.paragraphs) {
    chunks.push(`<p>${escapeHtml(paragraph)}</p>`);
  }
  chunks.push("</section>");

  if (app.evidence.length) {
    chunks.push("<section>", "<h2>Examples of my work</h2>", "<ul>");
    for (const item of app.evidence) {
      chunks.push(`<li><strong>${escapeHtml(item.label)}.</strong> ${escapeHtml(item.text)}</li>`);
    }
    chunks.push("</ul>", "</section>");
  }

  if (app.workLinks.length) {
    chunks.push("<section>", "<h2>Work I can show</h2>", "<ul>");
    for (const link of app.workLinks) {
      const href = escapeHtml(link.url);
      chunks.push(`<li><strong>${escapeHtml(link.label)}:</strong> <a href="${href}">${href}</a></li>`);
    }
    chunks.push("</ul>", "</section>");
  }

  chunks.push(
    "<section>",
    '<p class="letter-sign">Thank you for your consideration.</p>',
    `<p class="letter-sign">${escapeHtml(app.candidate || "Applicant")}</p>`,
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
