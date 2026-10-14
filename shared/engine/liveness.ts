import type { LiveStatus } from "../agency";
import type { JobStatus } from "../types";
import { JOB_STATUSES } from "../types";
import { detectBoard } from "./boards";
import {
  greenhouseJobUrl,
  leverPostingUrl,
  recruiteeOfferUrl,
  smartRecruitersPostingUrl,
} from "./listings";

/**
 * One request per posting. A market scan already reads up to 24 openings,
 * so this stays small enough to leave room for Worker subrequests and CPU.
 */
export const PIPELINE_CHECKS_PER_SCAN = 6;
/** Two probes at a time. The rest wait, so a slow board cannot fan out. */
export const PIPELINE_FETCH_CONCURRENCY = 2;
/** Checked postings wait out a day-minus-a-bit, and the next scan takes the next oldest. */
export const PIPELINE_RECHECK_MS = 20 * 60 * 60 * 1000;
/** Rows read while looking for a checkable link. Aggregators are left out of this query. */
export const PIPELINE_DUE_READ_CAP = 48;

const PIPELINE_STATUS_LIST = ["evaluated", "resume_ready", "applied", "interview", "offer"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUS_LIST)[number];

const CLOSED_JSON_STATES = new Set(["closed", "filled", "archived", "expired", "inactive", "unpublished"]);

/** Closed-page headings only. A job description that mentions sponsorship or remote work must not match. */
const CLOSED_PHRASES: readonly RegExp[] = [
  /\b(?:this|the) (?:job|position|role|posting|opening) is no longer (?:available|open)\b/i,
  /\b(?:job|position|role|posting|opening) you (?:requested|are looking for) is no longer (?:available|open)\b/i,
  /\bno longer accepting applications\b/i,
  /\b(?:this|the) (?:job|position|role|posting|opening) (?:is|has been|was) (?:now )?(?:closed|filled|expired|removed)\b/i,
  /\b(?:this )?(?:job|position|role|posting|opening) has been (?:closed|filled|removed)\b/i,
  /\bposting (?:has expired|is closed|has been closed)\b/i,
];

const STABLE_JOB_APIS = new Set<ProbeSource>(["greenhouse", "lever", "smartrecruiters", "recruitee"]);

export type HttpClass = "closed" | "unknown" | "success" | "other";
export type ProbeFailure = "timeout" | "network";
export type ProbeSource = "greenhouse" | "lever" | "smartrecruiters" | "recruitee" | "page";
export type ClosureEffect = "close_workflow" | "flag_posting" | "none";
/** `exact` may close on one read. `page` needs a second confirming read after the due interval. */
export type CloseStrength = "exact" | "page" | "none";

export interface ProbeVerdict {
  status: LiveStatus;
  strength: CloseStrength;
}

export interface LivenessProbe {
  url: string;
  accept: "application/json" | "text/html";
  source: ProbeSource;
}

export interface ProbeInput {
  httpStatus: number | null;
  body: string;
  contentType: string;
  failure: ProbeFailure | null;
  nowMs?: number;
}

export interface PipelineCandidate {
  id: string;
  url: string;
  status: JobStatus;
  sourceCheckedAt: string | null;
  closureStreak?: number;
  autoClosedFrom?: JobStatus | null;
}

export function isPipelineStatus(status: JobStatus): status is PipelineStatus {
  switch (status) {
    case "evaluated":
    case "resume_ready":
    case "applied":
    case "interview":
    case "offer":
      return true;
    case "rejected":
    case "withdrawn":
    case "closed":
      return false;
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

export function pipelineStatuses(): readonly PipelineStatus[] {
  return PIPELINE_STATUS_LIST;
}

export function closureEffect(status: JobStatus, outcome: LiveStatus): ClosureEffect {
  if (outcome !== "closed") return "none";
  switch (status) {
    case "evaluated":
    case "resume_ready":
      return "close_workflow";
    case "applied":
    case "interview":
    case "offer":
      return "flag_posting";
    case "rejected":
    case "withdrawn":
    case "closed":
      return "none";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

/** What to say when a saved posting has been confirmed closed. */
export function postingClosedCopy(status: JobStatus): string {
  switch (status) {
    case "evaluated":
    case "resume_ready":
      return "The employer listing is closed, so this is marked closed.";
    case "applied":
    case "interview":
    case "offer":
      return "The employer listing is closed. Your application stays active, because a posting can come down while you are still in process.";
    case "closed":
      return "The employer listing is closed, and this job is marked closed.";
    case "rejected":
    case "withdrawn":
      return "The employer listing is closed.";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

export function pipelineCountLabel(checked: number, closed: number): string {
  const links = checked === 1 ? "1 pipeline link checked" : `${checked} pipeline links checked`;
  const postings = closed === 1 ? "1 posting closed" : `${closed} postings closed`;
  return `${links} · ${postings}`;
}

export function classifyHttpStatus(status: number): HttpClass {
  if (status === 404 || status === 410) return "closed";
  if (status === 403 || status === 429 || status >= 500) return "unknown";
  if (status >= 200 && status < 300) return "success";
  return "other";
}

export function isStableJobApi(source: ProbeSource): boolean {
  return STABLE_JOB_APIS.has(source);
}

/** A page signal closes only after an earlier confirming read. An exact API signal closes immediately. */
export function closureConfirmed(priorStreak: number, strength: CloseStrength): boolean {
  switch (strength) {
    case "exact":
      return true;
    case "page":
      return priorStreak >= 1;
    case "none":
      return false;
    default: {
      const unexpected: never = strength;
      return unexpected;
    }
  }
}

export function explicitClosedText(text: string): boolean {
  const heading = text.replace(/\s+/g, " ").trim().slice(0, 180);
  return CLOSED_PHRASES.some((pattern) => pattern.test(heading));
}

/** Read at most `cap` bytes, then cancel so the rest of the body is not downloaded. */
export async function readBoundedText(stream: ReadableStream<Uint8Array> | null, cap: number): Promise<string> {
  if (!stream || cap <= 0) {
    await stream?.cancel().catch(() => undefined);
    return "";
  }
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done || !value || value.byteLength === 0) break;
      const take = Math.min(value.byteLength, cap - total);
      const copy = new Uint8Array(take);
      copy.set(value.subarray(0, take));
      parts.push(copy);
      total += take;
      if (take < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A script shell with no readable posting. Never treat this as closed. */
export function scriptUnreadable(html: string): boolean {
  const text = visibleText(html);
  const scriptHeavy = /<script\b/i.test(html) && text.length < 180;
  const spaShell = /id=["'](?:root|app|__next)["']/i.test(html) && text.length < 180;
  return scriptHeavy || spaShell;
}

export function interpretProbe(input: ProbeInput): LiveStatus {
  return judgeProbe(input, "page").status;
}

export function judgeProbe(input: ProbeInput, source: ProbeSource): ProbeVerdict {
  if (input.failure || input.httpStatus === null) return { status: "unknown", strength: "none" };
  const kind = classifyHttpStatus(input.httpStatus);
  switch (kind) {
    case "closed":
      return { status: "closed", strength: isStableJobApi(source) ? "exact" : "page" };
    case "unknown":
    case "other":
      return { status: "unknown", strength: "none" };
    case "success":
      return judgeSuccess(input, source);
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

export function pipelineCheckDue(sourceCheckedAt: string | null, nowMs: number, recheckMs = PIPELINE_RECHECK_MS): boolean {
  if (!sourceCheckedAt) return true;
  const then = Date.parse(sourceCheckedAt);
  if (Number.isNaN(then)) return true;
  return nowMs - then >= recheckMs;
}

export function selectDuePipelineJobs(
  jobs: readonly PipelineCandidate[],
  nowMs: number,
  limit = PIPELINE_CHECKS_PER_SCAN,
): PipelineCandidate[] {
  return jobs
    .filter((job) => canRecheck(job) && job.url.trim() !== "" && pipelineCheckDue(job.sourceCheckedAt, nowMs) && livenessProbe(job.url) !== null)
    .sort((a, b) => {
      const aChecked = a.sourceCheckedAt ?? "";
      const bChecked = b.sourceCheckedAt ?? "";
      if (!aChecked && bChecked) return -1;
      if (aChecked && !bChecked) return 1;
      if (aChecked !== bChecked) return aChecked < bChecked ? -1 : 1;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, Math.max(0, limit));
}

export function livenessProbe(raw: string): LivenessProbe | null {
  if (!isPublicHttpUrl(raw)) return null;
  const board = detectBoard(raw);
  if (!board) return null;
  switch (board.ats) {
    case "greenhouse":
      return greenhouseProbe(raw);
    case "lever":
      return leverProbe(raw);
    case "smartrecruiters":
      return smartRecruitersProbe(raw);
    case "recruitee":
      return recruiteeProbe(raw);
    case "aggregator":
      return null;
    case "ashby":
    case "workable":
    case "workday":
    case "teamtailor":
    case "icims":
    case "oracle_recruiting":
    case "successfactors":
    case "public_feed":
    case "licensed":
    case "website":
      return { url: raw, accept: "text/html", source: "page" };
    default: {
      const unexpected: never = board.ats;
      return unexpected;
    }
  }
}

export function jobStatusFromDb(value: string): JobStatus | null {
  if ((JOB_STATUSES as readonly string[]).includes(value)) return value as JobStatus;
  return null;
}

function canRecheck(job: PipelineCandidate): boolean {
  if (isPipelineStatus(job.status)) return true;
  return job.status === "closed" && (job.autoClosedFrom === "evaluated" || job.autoClosedFrom === "resume_ready");
}

function judgeSuccess(input: ProbeInput, source: ProbeSource): ProbeVerdict {
  const trimmed = input.body.trim();
  if (!trimmed) return { status: "unknown", strength: "none" };
  const jsonLike = input.contentType.toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (jsonLike) {
    const structured = structuredClosure(trimmed, input.nowMs ?? Date.now());
    if (structured === "closed") return { status: "closed", strength: isStableJobApi(source) ? "exact" : "page" };
    if (structured === "live") return { status: "live", strength: "none" };
    if (explicitClosedText(trimmed)) return { status: "closed", strength: "page" };
    return { status: "unknown", strength: "none" };
  }
  if (explicitClosedText(visibleText(trimmed))) return { status: "closed", strength: "page" };
  if (scriptUnreadable(trimmed)) return { status: "stale", strength: "none" };
  if (visibleText(trimmed).length >= 200) return { status: "live", strength: "none" };
  return { status: "unknown", strength: "none" };
}

function structuredClosure(body: string, nowMs: number): "closed" | "live" | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  if (!root) return null;
  const row = asRecord(root.offer) ?? asRecord(root.job) ?? asRecord(root.posting) ?? root;
  const dated = closingTimestamp(row.closed_at ?? row.close_at, nowMs);
  if (dated === "future") return "live";
  if (dated === "past") return "closed";
  if (row.active === false) return "closed";
  const status = typeof row.status === "string" ? row.status.toLowerCase() : typeof row.state === "string" ? row.state.toLowerCase() : "";
  if (CLOSED_JSON_STATES.has(status)) return "closed";
  if (typeof row.title === "string" && row.title.trim()) return "live";
  if (typeof row.text === "string" && row.text.trim()) return "live";
  if (typeof row.name === "string" && row.name.trim()) return "live";
  return null;
}

function closingTimestamp(value: unknown, nowMs: number): "future" | "past" | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return when > nowMs ? "future" : "past";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return true;
}

function greenhouseProbe(raw: string): LivenessProbe {
  const url = new URL(raw);
  const parts = url.pathname.split("/").filter(Boolean);
  const jobsAt = parts.indexOf("jobs");
  const board = (jobsAt > 0 ? parts[jobsAt - 1] : url.searchParams.get("for")) ?? "";
  const id = (jobsAt >= 0 ? parts[jobsAt + 1] : url.searchParams.get("token")) ?? "";
  if (board && /^\d+$/.test(id)) {
    return { url: greenhouseJobUrl(board, id), accept: "application/json", source: "greenhouse" };
  }
  return { url: raw, accept: "text/html", source: "page" };
}

function leverProbe(raw: string): LivenessProbe {
  const parts = new URL(raw).pathname.split("/").filter(Boolean);
  const company = parts[0] ?? "";
  const id = parts[1] ?? "";
  if (company && id) return { url: leverPostingUrl(company, id), accept: "application/json", source: "lever" };
  return { url: raw, accept: "text/html", source: "page" };
}

function smartRecruitersProbe(raw: string): LivenessProbe {
  const parts = new URL(raw).pathname.split("/").filter(Boolean);
  const company = parts[0] ?? "";
  const segment = parts[1] ?? "";
  const id = /^(\d+)/.exec(segment)?.[1] ?? "";
  if (company && id) return { url: smartRecruitersPostingUrl(company, id), accept: "application/json", source: "smartrecruiters" };
  return { url: raw, accept: "text/html", source: "page" };
}

function recruiteeProbe(raw: string): LivenessProbe {
  const url = new URL(raw);
  const token = url.hostname.toLowerCase().replace(/\.recruitee\.com$/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const offerAt = parts.indexOf("o");
  const slug = offerAt >= 0 ? parts[offerAt + 1] ?? "" : "";
  if (!token || token.includes(".") || !slug) return { url: raw, accept: "text/html", source: "page" };
  try {
    return { url: recruiteeOfferUrl(token, slug), accept: "application/json", source: "recruitee" };
  } catch {
    return { url: raw, accept: "text/html", source: "page" };
  }
}
