import { renderPlainTextHtml } from "./resumeHtml";

/** Cloudflare D1 rejects a string, blob, or whole row above this many bytes. */
export const D1_MAX_VALUE_BYTES = 2_000_000;
/** Room for ids, the filename, timestamps, and the SQLite record header on a resume file row. */
export const ARTIFACT_ROW_OVERHEAD_BYTES = 2_048;
/** Extracted text kept beside the original PDF. The HTML copy is built from this. */
export const UPLOAD_TEXT_CAP = 100_000;

const encoder = new TextEncoder();

function worstUploadHtmlBytes(): number {
  const unit = "&<>\"'";
  const text = unit.repeat(Math.ceil(UPLOAD_TEXT_CAP / unit.length)).slice(0, UPLOAD_TEXT_CAP);
  return encoder.encode(renderPlainTextHtml("<".repeat(120), text)).byteLength;
}

/** AES-GCM stores a 12-byte IV, a dot, and base64 of the ciphertext plus the 16-byte tag. */
export function aesGcmPayloadBytes(plainBytes: number): number {
  if (plainBytes < 0 || !Number.isFinite(plainBytes)) return 0;
  const cipherBytes = Math.floor(plainBytes) + 16;
  return 16 + 1 + 4 * Math.ceil(cipherBytes / 3);
}

function largestPlain(storedBudget: number): number {
  let lo = 0;
  let hi = Math.max(0, storedBudget);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (aesGcmPayloadBytes(mid) <= storedBudget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const UPLOAD_HTML_BUDGET_BYTES = worstUploadHtmlBytes();
const PDF_BYTE_BUDGET = D1_MAX_VALUE_BYTES - ARTIFACT_ROW_OVERHEAD_BYTES - aesGcmPayloadBytes(UPLOAD_HTML_BUDGET_BYTES);

/** Largest original PDF whose encrypted HTML copy and encrypted PDF still fit in one D1 row. */
export const MAX_ORIGINAL_PDF_BYTES = Math.floor(Math.max(0, largestPlain(PDF_BYTE_BUDGET)) / 1024) * 1024;

export function originalPdfLimitMessage(): string {
  const kb = MAX_ORIGINAL_PDF_BYTES / 1024;
  return `Upload a text PDF of ${kb} KB or smaller. A larger file cannot be stored.`;
}

export function ciphertextRowFits(htmlCipherChars: number, pdfCipherChars: number): boolean {
  return htmlCipherChars <= D1_MAX_VALUE_BYTES
    && pdfCipherChars <= D1_MAX_VALUE_BYTES
    && htmlCipherChars + pdfCipherChars + ARTIFACT_ROW_OVERHEAD_BYTES <= D1_MAX_VALUE_BYTES;
}
