import { describe, expect, it } from "vitest";
import { publicErrorBody, publicErrorLog, scanFailureRecord } from "../worker/publicError";

describe("unexpected API errors", () => {
  it("returns a reference and leaves email and query strings out of the log", () => {
    const reference = "6f1e2a3b-0000-4000-8000-000000000001";
    const line = publicErrorLog({
      reference,
      method: "POST",
      path: "/api/jobs?email=asha@example.com",
      err: new Error("insert failed for asha@example.com while saving the posting"),
    });
    const logged = JSON.parse(line) as { reference: string; method: string; path: string; message: string };
    expect(logged.reference).toBe(reference);
    expect(logged.method).toBe("POST");
    expect(logged.path).toBe("/api/jobs");
    expect(logged.message).not.toContain("asha@example.com");
    expect(logged.message).toContain("[redacted]");
    expect(line).not.toContain("?");

    const body = publicErrorBody(reference);
    expect(body.reference).toBe(reference);
    expect(body.error).toContain(reference);
    expect(body.error).not.toContain("@");
  });

  it("stores a public scan message and reference, and keeps the cause out of that message", () => {
    const reference = "6f1e2a3b-0000-4000-8000-000000000002";
    const record = scanFailureRecord(
      new Error("board failed for asha@example.com?token=secret"),
      "/internal/company-scan/acme?email=asha@example.com",
      reference,
    );
    expect(record.reference).toBe(reference);
    expect(record.message).toContain(reference);
    expect(record.message).not.toContain("asha");
    expect(record.message).not.toContain("secret");
    expect(record.message).toContain("Nothing was charged");
    const logged = JSON.parse(record.log) as { reference: string; path: string; message: string };
    expect(logged.reference).toBe(reference);
    expect(logged.path).toBe("/internal/company-scan/acme");
    expect(logged.message).not.toContain("asha@example.com");
    expect(logged.message).toContain("[redacted]");
    expect(record.log).not.toContain("token=secret");
  });
});
