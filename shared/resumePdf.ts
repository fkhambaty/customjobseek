import regeneratorRuntime from "regenerator-runtime";
import fontkit from "@pdf-lib/fontkit/dist/fontkit.es.min.js";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { isPdf } from "./resumeFile";
import type { TailoredResume } from "./types";
import boldBytes from "./fonts/NotoSansDevanagari-Bold.ttf";
import regularBytes from "./fonts/NotoSansDevanagari-Regular.ttf";

const runtimeHost = globalThis as typeof globalThis & { regeneratorRuntime: object };
runtimeHost.regeneratorRuntime = regeneratorRuntime;

/**
 * Subset of Noto Sans Devanagari (SIL OFL, see shared/fonts/OFL.txt).
 * One family covers Latin, Latin-1, Latin Extended-A, common punctuation,
 * currency including ₹, and the Devanagari block. Characters outside that
 * set are refused. They are never replaced with "?".
 */
export const PDF_FONT_LIMIT =
  "Resume PDFs embed Noto Sans Devanagari for Latin, common accents, the rupee sign, and Devanagari. If a character is missing, the PDF is refused and the exact HTML resume stays available.";

export const PDF_FONT_BYTES = regularBytes.byteLength + boldBytes.byteLength;

export const PDF_REFUSAL_PREFIX = "CJS-PDF-UNSUPPORTED\n";

export const PDF_A4 = { width: 595.28, height: 841.89 } as const;

const A4: [number, number] = [PDF_A4.width, PDF_A4.height];
const MARGIN_X = 36.85;
const MARGIN_TOP = 34.02;
const MARGIN_BOTTOM = 34.02;
const CONTENT_WIDTH = PDF_A4.width - MARGIN_X * 2;

const TEAL = rgb(11 / 255, 79 / 255, 138 / 255);
const INK = rgb(15 / 255, 27 / 255, 40 / 255);
const MUTED = rgb(74 / 255, 90 / 255, 107 / 255);

/** Format characters with no visible glyph. They are omitted from the PDF, not replaced. */
const IGNORABLE = new Set<number>([0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff]);

export class PdfGlyphError extends Error {
  readonly characters: string;

  constructor(characters: string) {
    super(pdfUnsupportedMessage(characters));
    this.name = "PdfGlyphError";
    this.characters = characters;
  }
}

export function pdfUnsupportedMessage(characters: string): string {
  const list = [...new Set([...characters])];
  const shown = list.slice(0, 8).join(" ");
  const extra = list.length > 8 ? ` and ${list.length - 8} more` : "";
  return `This PDF cannot draw these characters: ${shown}${extra}. The exact HTML resume is unchanged and still available.`;
}

export function pdfRefusalBytes(message: string): Uint8Array {
  return new TextEncoder().encode(`${PDF_REFUSAL_PREFIX}${message}`);
}

export function pdfRefusalMessage(bytes: Uint8Array): string | null {
  if (isPdf(bytes)) return null;
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(PDF_REFUSAL_PREFIX)) return null;
  const message = text.slice(PDF_REFUSAL_PREFIX.length).trim();
  return message || pdfUnsupportedMessage("");
}

interface Pen {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
}

let coveredCache: Set<number> | null = null;

function coveredCodePoints(): Set<number> {
  if (coveredCache) return coveredCache;
  const regular = new Set(fontkit.create(regularBytes).characterSet);
  const both = new Set<number>();
  for (const codePoint of fontkit.create(boldBytes).characterSet) {
    if (regular.has(codePoint)) both.add(codePoint);
  }
  coveredCache = both;
  return both;
}

function isGap(character: string, covered: Set<number>): boolean {
  if (character === "\n" || character === "\r" || character === "\t") return false;
  const codePoint = character.codePointAt(0) ?? 0;
  if (IGNORABLE.has(codePoint) && !covered.has(codePoint)) return false;
  return !covered.has(codePoint);
}

function assertCovered(parts: readonly string[]): void {
  const covered = coveredCodePoints();
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const character of part.normalize("NFC")) {
      if (!isGap(character, covered) || seen.has(character)) continue;
      seen.add(character);
      missing.push(character);
    }
  }
  if (missing.length > 0) throw new PdfGlyphError(missing.join(""));
}

function clean(text: string): string {
  const covered = coveredCodePoints();
  let out = "";
  for (const character of text.normalize("NFC")) {
    if (character === "\n" || character === "\r" || character === "\t") {
      out += " ";
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (IGNORABLE.has(codePoint) && !covered.has(codePoint)) continue;
    if (!covered.has(codePoint)) throw new PdfGlyphError(character);
    out += character;
  }
  return out;
}

function addPage(pen: Pen): void {
  pen.page = pen.doc.addPage(A4);
  pen.y = PDF_A4.height - MARGIN_TOP;
}

function room(pen: Pen, needed: number): void {
  if (pen.y - needed < MARGIN_BOTTOM) addPage(pen);
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    if (font.widthOfTextAtSize(word, size) <= width) {
      current = word;
      continue;
    }
    let piece = "";
    for (const character of word) {
      const trial = piece + character;
      if (font.widthOfTextAtSize(trial, size) <= width) piece = trial;
      else {
        if (piece) lines.push(piece);
        piece = character;
      }
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines;
}

function drawLines(pen: Pen, lines: string[], font: PDFFont, size: number, color: ReturnType<typeof rgb>, x: number): void {
  for (const line of lines) {
    room(pen, size + 3);
    pen.page.drawText(line, { x, y: pen.y - size, size, font, color });
    pen.y -= size + 3;
  }
}

function drawParagraph(pen: Pen, text: string, font: PDFFont, size: number, color: ReturnType<typeof rgb>, x = MARGIN_X, width = CONTENT_WIDTH): void {
  drawLines(pen, wrap(font, text, size, width), font, size, color, x);
}

function drawRule(pen: Pen): void {
  room(pen, 8);
  pen.y -= 3;
  pen.page.drawLine({
    start: { x: MARGIN_X, y: pen.y },
    end: { x: PDF_A4.width - MARGIN_X, y: pen.y },
    thickness: 1.2,
    color: TEAL,
  });
  pen.y -= 8;
}

function drawHeading(pen: Pen, title: string): void {
  if (pen.y - 28 < MARGIN_BOTTOM) addPage(pen);
  pen.y -= 8;
  const size = 11;
  const shown = clean(title.toUpperCase());
  pen.page.drawText(shown, { x: MARGIN_X, y: pen.y - size, size, font: pen.bold, color: TEAL });
  pen.y -= size + 2;
  pen.page.drawLine({
    start: { x: MARGIN_X, y: pen.y },
    end: { x: PDF_A4.width - MARGIN_X, y: pen.y },
    thickness: 1,
    color: TEAL,
  });
  pen.y -= 6;
}

async function startPdf(title: string): Promise<Pen> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as never); // minified fontkit matches at runtime, not in pdf-lib's Fontkit type
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(title || "Resume");
  doc.setProducer("CustomJobSeek");
  doc.setCreator("CustomJobSeek");
  const fixed = new Date(Date.UTC(2026, 0, 1));
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const page = doc.addPage(A4);
  return { doc, page, y: PDF_A4.height - MARGIN_TOP, font, bold };
}

function finishPdf(pen: Pen): Promise<Uint8Array> {
  return pen.doc.save({ useObjectStreams: false });
}

function drawName(pen: Pen, name: string): void {
  const size = 23;
  const shown = clean((name || "Resume").toUpperCase());
  room(pen, size + 4);
  pen.page.drawText(shown, { x: MARGIN_X, y: pen.y - size, size, font: pen.bold, color: INK });
  pen.y -= size + 4;
}

function drawRole(
  pen: Pen,
  title: string,
  company: string,
  start: string,
  end: string,
  location: string,
  bullets: string[],
  environment: string[],
): void {
  const leftRaw = company ? `${company}, ${title}` : title;
  const dateRaw = [start, end].filter(Boolean).join(" – ");
  const left = clean(leftRaw);
  const date = clean(dateRaw);
  const dateWidth = date ? pen.font.widthOfTextAtSize(date, 9) : 0;
  const sharesLine = Boolean(date) && pen.bold.widthOfTextAtSize(left, 10) + dateWidth + 12 <= CONTENT_WIDTH;
  if (sharesLine && date) {
    room(pen, 14);
    const baseline = pen.y - 10;
    pen.page.drawText(left, { x: MARGIN_X, y: baseline, size: 10, font: pen.bold, color: INK });
    pen.page.drawText(date, { x: PDF_A4.width - MARGIN_X - dateWidth, y: baseline, size: 9, font: pen.font, color: MUTED });
    pen.y = baseline - 4;
  } else {
    drawParagraph(pen, leftRaw, pen.bold, 10, INK);
    if (dateRaw) {
      const shown = clean(dateRaw);
      const width = pen.font.widthOfTextAtSize(shown, 9);
      room(pen, 12);
      pen.page.drawText(shown, {
        x: PDF_A4.width - MARGIN_X - width,
        y: pen.y - 9,
        size: 9,
        font: pen.font,
        color: MUTED,
      });
      pen.y -= 12;
    }
  }
  if (location) drawParagraph(pen, location, pen.font, 9, MUTED);
  for (const bullet of bullets) {
    const lines = wrap(pen.font, bullet, 10, CONTENT_WIDTH - 14);
    lines.forEach((line, index) => {
      room(pen, 13);
      const prefix = index === 0 ? "• " : "  ";
      pen.page.drawText(`${prefix}${line}`, { x: MARGIN_X + 2, y: pen.y - 10, size: 10, font: pen.font, color: INK });
      pen.y -= 13;
    });
  }
  if (environment.length > 0) {
    pen.y -= 2;
    drawParagraph(pen, `Environment: ${environment.join(", ")}`, pen.font, 8.4, MUTED);
  }
  pen.y -= 6;
}

function resumeParts(resume: TailoredResume): string[] {
  const parts = [
    resume.fullName || "Resume",
    (resume.fullName || "Resume").toUpperCase(),
    resume.headline,
    resume.contact.join("  |  "),
    resume.summary,
    resume.coreStrengths.join("  •  "),
    ...(resume.selectedImpact ?? []),
    ...(resume.capabilityGroups ?? []).flatMap((group) => [group.name, ...group.items]),
    resume.aiAssistedDelivery ?? "",
    resume.skills.join(", "),
    "Profile",
    "Selected Impact",
    "Core Capabilities",
    "AI-Assisted Delivery",
    "Core Strengths",
    "Professional Experience",
    "Skills",
    "Education & Certifications",
    "Environment",
    "•",
  ];
  for (const role of resume.roles) {
    const date = [role.start, role.end].filter(Boolean).join(" – ");
    parts.push(role.title, role.company, role.location, role.start, role.end, date, role.company ? `${role.title}, ${role.company}` : role.title);
    for (const bullet of role.bullets) parts.push(bullet.text);
    parts.push(...(role.environment ?? []));
  }
  for (const item of resume.education) parts.push(item.degree, item.institution, item.year, item.year ? `${item.degree} (${item.year})` : item.degree);
  for (const item of resume.certifications) parts.push(item.name, item.issuer, item.year);
  return parts;
}

export async function renderResumePdf(resume: TailoredResume): Promise<Uint8Array> {
  assertCovered(resumeParts(resume));
  const pen = await startPdf(resume.fullName || "Resume");
  drawName(pen, resume.fullName || "Resume");
  if (resume.headline) drawParagraph(pen, resume.headline, pen.bold, 10, TEAL);
  if (resume.contact.length > 0) drawParagraph(pen, resume.contact.join("  |  "), pen.font, 9, INK);
  drawRule(pen);
  if (resume.summary) {
    drawHeading(pen, "Profile");
    drawParagraph(pen, resume.summary, pen.font, 10, INK);
  }
  if ((resume.selectedImpact?.length ?? 0) > 0) {
    drawHeading(pen, "Selected Impact");
    for (const line of resume.selectedImpact ?? []) {
      const lines = wrap(pen.font, line, 9.2, CONTENT_WIDTH - 14);
      lines.forEach((wrapped, index) => {
        room(pen, 12);
        pen.page.drawText(`${index === 0 ? "• " : "  "}${wrapped}`, {
          x: MARGIN_X + 2,
          y: pen.y - 9.2,
          size: 9.2,
          font: pen.font,
          color: INK,
        });
        pen.y -= 12;
      });
    }
  }
  if ((resume.capabilityGroups?.length ?? 0) > 0) {
    drawHeading(pen, "Core Capabilities");
    for (const group of resume.capabilityGroups ?? []) {
      drawParagraph(pen, `${group.name}: ${group.items.join(", ")}`, pen.font, 9.2, INK);
      pen.y -= 2;
    }
  } else if (resume.coreStrengths.length > 0) {
    drawHeading(pen, "Core Strengths");
    drawParagraph(pen, resume.coreStrengths.join("  •  "), pen.font, 10, INK);
  }
  if (resume.aiAssistedDelivery) {
    drawHeading(pen, "AI-Assisted Delivery");
    drawParagraph(pen, resume.aiAssistedDelivery, pen.font, 9.2, INK);
  }
  if (resume.roles.length > 0) {
    drawHeading(pen, "Professional Experience");
    for (const role of resume.roles) {
      drawRole(
        pen,
        role.title,
        role.company,
        role.start,
        role.end,
        role.location,
        role.bullets.map((bullet) => bullet.text),
        role.environment ?? [],
      );
    }
  }
  if ((resume.capabilityGroups?.length ?? 0) === 0 && resume.skills.length > 0) {
    drawHeading(pen, "Skills");
    drawParagraph(pen, resume.skills.join(", "), pen.font, 10, INK);
  }
  if (resume.education.length > 0 || resume.certifications.length > 0) {
    drawHeading(pen, "Education & Certifications");
    for (const item of resume.education) {
      const line = [item.degree, item.institution].filter(Boolean).join(", ");
      drawParagraph(pen, item.year ? `${line} (${item.year})` : line, pen.font, 9.2, INK);
    }
    const certifications = resume.certifications.map((item) => {
      const line = [item.name, item.issuer].filter(Boolean).join(", ");
      return item.year ? `${line} (${item.year})` : line;
    });
    if (certifications.length > 0) {
      drawParagraph(pen, certifications.join("  |  "), pen.font, 9.2, INK);
    }
  }
  return finishPdf(pen);
}

export async function renderTextPdf(title: string, text: string): Promise<Uint8Array> {
  const heading = title || "Resume";
  assertCovered([heading, heading.toUpperCase(), text, "•"]);
  const pen = await startPdf(heading);
  drawName(pen, heading);
  drawRule(pen);
  const blocks = text.split(/\n/);
  if (blocks.every((block) => !block.trim())) {
    drawParagraph(pen, " ", pen.font, 10, INK);
  }
  for (const block of blocks) {
    if (!block.trim()) {
      pen.y -= 8;
      continue;
    }
    drawParagraph(pen, block, pen.font, 10, INK);
    pen.y -= 2;
  }
  return finishPdf(pen);
}
