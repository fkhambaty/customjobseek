import { describe, expect, it } from "vitest";
import {
  aesGcmPayloadBytes,
  ARTIFACT_ROW_OVERHEAD_BYTES,
  ciphertextRowFits,
  D1_MAX_VALUE_BYTES,
  MAX_ORIGINAL_PDF_BYTES,
  originalPdfLimitMessage,
  UPLOAD_HTML_BUDGET_BYTES,
} from "../shared/resumeStorage";
import { encryptBytes } from "../worker/crypto";

function key(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of raw) text += String.fromCharCode(byte);
  return btoa(text);
}

describe("original PDF storage limit", () => {
  it("matches the AES-GCM base64 payload and stays inside a D1 row", async () => {
    const secret = key();
    for (const size of [0, 1, 2, 3, 16, 100]) {
      const stored = await encryptBytes(secret, new Uint8Array(size));
      expect(stored.length).toBe(aesGcmPayloadBytes(size));
    }
    expect(MAX_ORIGINAL_PDF_BYTES % 1024).toBe(0);
    expect(MAX_ORIGINAL_PDF_BYTES).toBeGreaterThan(200_000);
    expect(MAX_ORIGINAL_PDF_BYTES).toBeLessThan(1_500_000);
    const htmlStored = aesGcmPayloadBytes(UPLOAD_HTML_BUDGET_BYTES);
    const pdfStored = aesGcmPayloadBytes(MAX_ORIGINAL_PDF_BYTES);
    expect(ciphertextRowFits(htmlStored, pdfStored)).toBe(true);
    expect(ciphertextRowFits(htmlStored, aesGcmPayloadBytes(D1_MAX_VALUE_BYTES))).toBe(false);
    expect(aesGcmPayloadBytes(MAX_ORIGINAL_PDF_BYTES)).toBeLessThanOrEqual(D1_MAX_VALUE_BYTES);
    expect(aesGcmPayloadBytes(MAX_ORIGINAL_PDF_BYTES) + ARTIFACT_ROW_OVERHEAD_BYTES).toBeLessThanOrEqual(D1_MAX_VALUE_BYTES);
    const message = originalPdfLimitMessage();
    expect(message).toContain(`${MAX_ORIGINAL_PDF_BYTES / 1024} KB`);
    expect(message).not.toContain("2 MB");
  });
});
