const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function publicErrorLog(input: { reference: string; method: string; path: string; err: unknown }): string {
  const name = input.err instanceof Error ? input.err.name : "Error";
  const raw = input.err instanceof Error ? input.err.message : "";
  const message = raw
    .replace(EMAIL, "[redacted]")
    .replace(/[?&][^\s]*/g, "")
    .replace(/\btoken=\S+/gi, "token=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const path = input.path.split("?")[0] ?? "";
  return JSON.stringify({ reference: input.reference, method: input.method, path, name, message });
}

export function publicErrorBody(reference: string): { error: string; reference: string } {
  return {
    reference,
    error: `Something went wrong on our side. Please try again. Reference ${reference}.`,
  };
}

export function publicScanMessage(reference: string): string {
  return `The scan stopped before it finished. Nothing was charged. Reference ${reference}.`;
}

/** A failed scan stores this message and reference. The log keeps a short redacted cause. */
export function scanFailureRecord(err: unknown, path: string, reference = crypto.randomUUID()): {
  reference: string;
  message: string;
  log: string;
} {
  return {
    reference,
    message: publicScanMessage(reference),
    log: publicErrorLog({ reference, method: "SCAN", path: path.split("?")[0] ?? "", err }),
  };
}
