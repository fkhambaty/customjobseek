export const RESUME_ARTIFACT_KINDS = ["master", "job", "upload"] as const;
export type ResumeArtifactKind = (typeof RESUME_ARTIFACT_KINDS)[number];

export type ResumeFileFormat = "pdf" | "html";
export type ResumeFileDisposition = "inline" | "attachment";

export interface ResumeFileRoute {
  kind: ResumeArtifactKind;
  id: string;
  format: ResumeFileFormat;
  disposition: ResumeFileDisposition;
}

export interface ResumeArtifactIdentity {
  kind: ResumeArtifactKind;
  artifactKey: string;
  jobId: string | null;
  uploadId: string | null;
}

// Imported job ids look like `cc:Company (Name)|req-1|Title_Words` and can reach 170 characters.
// Ids are only ever bound as SQL parameters next to the owner's user id, never used as file paths.
const MAX_ID_LENGTH = 200;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

export function isResumeArtifactKind(value: string): value is ResumeArtifactKind {
  return (RESUME_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function isSafeResumeId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && id.trim() === id && !CONTROL_CHAR.test(id) && !DOT_SEGMENT.test(id);
}

/** True only when the row belongs to the signed-in account. Anyone else is treated as absent. */
export function sameOwner(ownerId: string, requesterId: string): boolean {
  return ownerId.length > 0 && ownerId === requesterId;
}

export function visibleToOwner<T extends { user_id: string }>(row: T | null, requesterId: string): T | null {
  if (!row || !sameOwner(row.user_id, requesterId)) return null;
  return row;
}

export function artifactIdentity(kind: ResumeArtifactKind, id: string): ResumeArtifactIdentity {
  switch (kind) {
    case "master":
      return { kind, artifactKey: "master", jobId: null, uploadId: null };
    case "job":
      if (!isSafeResumeId(id)) throw new Error("Invalid job id");
      return { kind, artifactKey: `job:${id}`, jobId: id, uploadId: null };
    case "upload":
      if (!isSafeResumeId(id)) throw new Error("Invalid upload id");
      return { kind, artifactKey: `upload:${id}`, jobId: null, uploadId: id };
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

/** Router params arrive decoded. Decoding again would corrupt ids that contain `%`. */
export function parseResumeFileRoute(kindRaw: string, id: string, formatRaw: string, download: string | null): ResumeFileRoute | null {
  if (!isResumeArtifactKind(kindRaw)) return null;
  if (formatRaw !== "pdf" && formatRaw !== "html") return null;
  if (!isSafeResumeId(id)) return null;
  if (kindRaw === "master" && id !== "master") return null;
  const disposition: ResumeFileDisposition = formatRaw === "pdf" && (download === "1" || download === "true") ? "attachment" : "inline";
  return { kind: kindRaw, id, format: formatRaw, disposition };
}

export function safeResumeFilename(name: string, ext: "pdf" | "html"): string {
  const cleaned = name
    .replace(/\.(pdf|html)$/i, "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return `${cleaned || "Resume"}.${ext}`;
}

export function contentDisposition(disposition: ResumeFileDisposition, filename: string): string {
  const ext = filename.toLowerCase().endsWith(".html") ? "html" : "pdf";
  const safe = safeResumeFilename(filename, ext);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`.replace(/[\r\n]/g, "");
}

export function filenameFromContentDisposition(header: string | null): string {
  if (!header) return "";
  const starred = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (starred?.[1]) {
    try {
      return decodeURIComponent(starred[1]);
    } catch {
      return "";
    }
  }
  const plain = /filename="([^"]*)"/.exec(header);
  return plain?.[1] ?? "";
}

export function resumeFileHeaders(
  route: { format: ResumeFileFormat; disposition: ResumeFileDisposition },
  filename: string,
): Record<string, string> {
  const named = safeResumeFilename(filename, route.format);
  const csp =
    route.format === "pdf"
      ? "default-src 'none'; frame-ancestors 'self'"
      : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'";
  return {
    "content-type": route.format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
    "content-disposition": contentDisposition(route.disposition, named),
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "cache-control": "private, no-store",
  };
}

export function isPdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, 1024);
  return new TextDecoder("latin1").decode(bytes.subarray(0, limit)).includes("%PDF-");
}

function fileQuery(opts?: { download?: boolean; version?: string }): string {
  const query = new URLSearchParams();
  if (opts?.download) query.set("download", "1");
  if (opts?.version) query.set("v", opts.version);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function resumePdfPath(kind: ResumeArtifactKind, id: string, opts?: { download?: boolean; version?: string }): string {
  return `/api/resumes/files/${kind}/${encodeURIComponent(id)}/pdf${fileQuery(opts)}`;
}

export function resumeHtmlPath(kind: ResumeArtifactKind, id: string, opts?: { version?: string }): string {
  return `/api/resumes/files/${kind}/${encodeURIComponent(id)}/html${fileQuery({ version: opts?.version })}`;
}

export function resumeViewerPath(kind: ResumeArtifactKind, id: string): string {
  return `/resumes/view/${kind}/${encodeURIComponent(id)}`;
}

export function resumeFileLinks(kind: ResumeArtifactKind, id: string, version?: string) {
  return {
    view: resumeViewerPath(kind, id),
    pdf: resumePdfPath(kind, id, { version }),
    download: resumePdfPath(kind, id, { download: true, version }),
    html: resumeHtmlPath(kind, id, { version }),
  };
}

/** Library rows are metadata only. Ciphertext and file bytes stay out of JSON. */
export function toPublicResumeUpload(row: {
  id: string;
  label: string;
  filename: string;
  format: string;
  created_at: string;
  text_ciphertext?: string;
  html_ciphertext?: string;
  pdf_ciphertext?: string;
}): { id: string; label: string; format: string; createdAt: string } {
  return {
    id: row.id,
    label: row.label || row.filename,
    format: row.format,
    createdAt: row.created_at,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
