import { titleTokens } from "./engine/fit";
import { isExpired } from "./engine/sources";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Free-plan ceilings we watch. Paid accounts can raise these in one place. */
export const QUOTA_LIMITS = {
  workers_requests: 100_000,
  workers_cpu_ms: 1_000_000,
  d1_requests: 100_000,
  d1_rows_read: 5_000_000,
  d1_rows_written: 100_000,
  d1_storage_bytes: 5 * 1024 * 1024 * 1024,
  resend_daily: 100,
  resend_monthly: 3_000,
} as const;

export type QuotaMeter = keyof typeof QUOTA_LIMITS;

export const QUOTA_LABELS: Record<QuotaMeter, string> = {
  workers_requests: "Worker requests",
  workers_cpu_ms: "Worker CPU time",
  d1_requests: "Database requests",
  d1_rows_read: "Database rows read",
  d1_rows_written: "Database rows written",
  d1_storage_bytes: "Database storage",
  resend_daily: "Email sent today",
  resend_monthly: "Email sent this month",
};

export type RefreshBand = "hot" | "warm" | "cool" | "cold";

const BAND_HOURS: Record<RefreshBand, number> = {
  hot: 2,
  warm: 6,
  cool: 12,
  cold: 24,
};

export function refreshBand(priority: number): RefreshBand {
  if (priority >= 80) return "hot";
  if (priority >= 40) return "warm";
  if (priority >= 10) return "cool";
  return "cold";
}

/**
 * Hot and warm boards use their band even when the source default is six hours.
 * Cool and cold boards wait at least as long as the source asks.
 * Failures double the wait, and a quiet board stretches it, both capped at a week.
 */
export function nextRefreshDelayMs(input: {
  priority: number;
  consecutiveFailures: number;
  unchangedScans: number;
  freshnessHours: number | null;
}): number {
  const band = refreshBand(input.priority);
  const bandHours = BAND_HOURS[band];
  const freshness = input.freshnessHours && input.freshnessHours > 0 ? input.freshnessHours : bandHours;
  const baseHours = band === "hot" || band === "warm" ? bandHours : Math.max(bandHours, freshness);
  const failures = Math.max(0, Math.floor(input.consecutiveFailures));
  if (failures > 0) {
    const factor = 2 ** Math.min(failures, 4);
    return Math.min(7 * DAY_MS, baseHours * factor * HOUR_MS);
  }
  const quiet = Math.min(Math.max(0, Math.floor(input.unchangedScans)), 4);
  const stretched = baseHours * (1 + quiet * 0.5);
  return Math.min(7 * DAY_MS, stretched * HOUR_MS);
}

export function openingContentHash(input: {
  externalId: string;
  canonicalUrl: string;
  title: string;
  location: string;
}): string {
  const text = [input.externalId.trim().toLowerCase(), input.canonicalUrl, input.title, input.location].join("\u001f");
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function searchTokens(title: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of titleTokens(title)) {
    const word = token.toLowerCase();
    if (word.length < 3 || word.length > 40 || seen.has(word)) continue;
    if (!/^[a-z0-9+#.]+$/.test(word)) continue;
    seen.add(word);
    tokens.push(word);
    if (tokens.length === 12) break;
  }
  return tokens;
}

export function discoveryTokens(words: string[]): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const word of words) {
    const token = word.toLowerCase();
    if (!/^[a-z0-9+#.]{3,40}$/.test(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length === 10) break;
  }
  return tokens;
}

export interface StoredOpening {
  externalId: string;
  dedupKey: string;
  canonicalUrl: string;
  contentHash: string;
  firstSeenAt: string | null;
  provenance: string;
  expiresAt: string | null;
}

export interface IncomingOpening {
  externalId: string;
  title: string;
  location: string;
  url: string;
  dedupKey: string;
  canonicalUrl: string;
  titleKey: string;
  locationKey: string;
  employerKey: string;
  provenance: string;
  contentHash: string;
  expiresAt: string | null;
  tokens: string[];
}

export interface OpeningWriteRow {
  externalId: string;
  title: string;
  location: string;
  url: string;
  dedupKey: string;
  canonicalUrl: string;
  titleKey: string;
  locationKey: string;
  employerKey: string;
  provenance: string;
  contentHash: string;
  expiresAt: string | null;
  firstSeenAt: string;
  tokens: string[];
}

export type OpeningOp =
  | { kind: "add"; row: OpeningWriteRow }
  | { kind: "change"; storedExternalId: string; row: OpeningWriteRow }
  | { kind: "reactivate"; storedExternalId: string; row: OpeningWriteRow }
  | { kind: "expire"; externalId: string };

export interface OpeningDelta {
  ops: OpeningOp[];
  unchanged: number;
  liveCount: number;
}

function keptProvenance(stored: string, incoming: string): string {
  const existing = stored.trim();
  return existing || incoming;
}

function keptCanonical(stored: string, incoming: string): string {
  return incoming.trim() || stored;
}

function writeRow(incoming: IncomingOpening, stored: StoredOpening | null, nowIso: string): OpeningWriteRow {
  return {
    externalId: incoming.externalId,
    title: incoming.title,
    location: incoming.location,
    url: incoming.url,
    dedupKey: incoming.dedupKey,
    canonicalUrl: keptCanonical(stored?.canonicalUrl ?? "", incoming.canonicalUrl),
    titleKey: incoming.titleKey,
    locationKey: incoming.locationKey,
    employerKey: incoming.employerKey,
    provenance: keptProvenance(stored?.provenance ?? "", incoming.provenance),
    contentHash: incoming.contentHash,
    expiresAt: incoming.expiresAt,
    firstSeenAt: stored?.firstSeenAt || nowIso,
    tokens: incoming.tokens,
  };
}

export interface OpeningRead<T> {
  openings: T[];
  complete: boolean;
  truncated: boolean;
  suspiciousEmpty: boolean;
}

/** A partial or unreadable board must not be treated as a full list. */
export function describeOpeningRead<T>(openings: T[], input: { truncated: boolean; recognized: boolean }): OpeningRead<T> {
  const suspiciousEmpty = openings.length === 0 && !input.recognized;
  const truncated = input.truncated;
  const complete = input.recognized && !truncated && !suspiciousEmpty;
  return { openings, complete, truncated, suspiciousEmpty };
}

export function shouldExpireOmittedOpenings(read: { complete: boolean; truncated: boolean; suspiciousEmpty: boolean }): boolean {
  return read.complete && !read.truncated && !read.suspiciousEmpty;
}

/**
 * Decides the rows to write. A board that drops a role expires that one row.
 * A truncated or unreadable read does not expire rows it simply did not return.
 * Nothing here deletes the company's openings.
 */
export function planOpeningDelta(
  stored: StoredOpening[],
  incoming: IncomingOpening[],
  nowIso: string,
  expireOmitted = true,
): OpeningDelta {
  const byExternal = new Map<string, StoredOpening>();
  const byDedup = new Map<string, StoredOpening>();
  const byCanonical = new Map<string, StoredOpening>();
  for (const row of stored) {
    byExternal.set(row.externalId, row);
    if (row.dedupKey) byDedup.set(row.dedupKey, row);
    if (row.canonicalUrl) byCanonical.set(row.canonicalUrl, row);
  }
  const claimed = new Set<string>();
  const claim = (row: StoredOpening | undefined): StoredOpening | null => {
    if (!row || claimed.has(row.externalId)) return null;
    claimed.add(row.externalId);
    return row;
  };
  const ops: OpeningOp[] = [];
  let unchanged = 0;
  const nowMs = Date.parse(nowIso);
  for (const row of incoming) {
    const match =
      claim(byExternal.get(row.externalId)) ??
      (row.dedupKey ? claim(byDedup.get(row.dedupKey)) : null) ??
      (row.canonicalUrl ? claim(byCanonical.get(row.canonicalUrl)) : null);
    if (!match) {
      ops.push({ kind: "add", row: writeRow(row, null, nowIso) });
      continue;
    }
    const written = writeRow(row, match, nowIso);
    if (isExpired(match.expiresAt, nowMs)) {
      ops.push({ kind: "reactivate", storedExternalId: match.externalId, row: written });
      continue;
    }
    if (match.contentHash !== row.contentHash || match.externalId !== row.externalId) {
      ops.push({ kind: "change", storedExternalId: match.externalId, row: written });
      continue;
    }
    unchanged += 1;
  }
  if (expireOmitted) {
    for (const row of stored) {
      if (claimed.has(row.externalId)) continue;
      if (isExpired(row.expiresAt, nowMs)) continue;
      ops.push({ kind: "expire", externalId: row.externalId });
    }
  }
  return { ops, unchanged, liveCount: incoming.length };
}

/** One opening write costs dozens of D1 rows once search tokens and indexes count, so each pass writes at most this many. */
export const MAX_OPENING_WRITES_PER_PASS = 250;

/** Keeps every expiry and the first `limit` adds, changes and reactivations. The rest wait for the next pass. */
export function capOpeningWrites(ops: OpeningOp[], limit = MAX_OPENING_WRITES_PER_PASS): { ops: OpeningOp[]; deferred: number } {
  const kept: OpeningOp[] = [];
  let writes = 0;
  let deferred = 0;
  for (const op of ops) {
    switch (op.kind) {
      case "expire":
        kept.push(op);
        break;
      case "add":
      case "change":
      case "reactivate":
        if (writes < limit) {
          kept.push(op);
          writes += 1;
        } else {
          deferred += 1;
        }
        break;
      default: {
        const unexpected: never = op;
        throw new Error(String(unexpected));
      }
    }
  }
  return { ops: kept, deferred };
}

export const COMPANY_PAGE_DEFAULT = 40;
export const COMPANY_PAGE_MAX = 80;

export interface CompanyCursor {
  active: number;
  priority: number;
  openings: number;
  name: string;
  id: string;
}

export function companyListCursor(cursor: CompanyCursor): string {
  const json = JSON.stringify([cursor.active, cursor.priority, cursor.openings, cursor.name, cursor.id]);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function parseCompanyCursor(raw: string | undefined): CompanyCursor | null {
  if (!raw || raw.length > 600) return null;
  try {
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const binary = atob(raw.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [active, priority, openings, name, id] = parsed;
    if (active !== 0 && active !== 1) return null;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1_000_000) return null;
    if (!Number.isInteger(openings) || openings < 0 || openings > 1_000_000) return null;
    if (typeof name !== "string" || typeof id !== "string") return null;
    if (name.length > 200 || id.length > 80 || !/^[\w-]+$/.test(id)) return null;
    return { active, priority, openings, name, id };
  } catch {
    return null;
  }
}

export function parseCompanyPageLimit(limitRaw: string | undefined): number {
  const parsed = Number(limitRaw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, COMPANY_PAGE_MAX) : COMPANY_PAGE_DEFAULT;
}

/** Escapes a public search box for a LIKE pattern. Empty input means no filter. */
export function companyNameLike(raw: string | undefined): string | null {
  const q = (raw ?? "").trim().slice(0, 80);
  if (!q) return null;
  return `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function pageSlice<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  if (rows.length <= limit) return { rows, hasMore: false };
  return { rows: rows.slice(0, limit), hasMore: true };
}

export const JOB_PAGE_DEFAULT = 40;
export const JOB_PAGE_MAX = 80;

export function parseJobListQuery(
  limitRaw: string | undefined,
  cursorRaw: string | undefined,
): { limit: number; cursor: { createdAt: string; id: string } | null } {
  const parsed = Number(limitRaw);
  const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, JOB_PAGE_MAX) : JOB_PAGE_DEFAULT;
  if (!cursorRaw) return { limit, cursor: null };
  // Imported job ids contain "|", ":" and spaces, so only the first "|" separates the timestamp.
  const splitAt = cursorRaw.indexOf("|");
  if (splitAt <= 0) return { limit, cursor: null };
  const createdAt = cursorRaw.slice(0, splitAt);
  const id = cursorRaw.slice(splitAt + 1);
  if (!createdAt || !id || createdAt.length > 40 || id.length > 300) return { limit, cursor: null };
  if (!/^[\w.: +-]+$/.test(createdAt) || /[\u0000-\u001f]/.test(id)) return { limit, cursor: null };
  return { limit, cursor: { createdAt, id } };
}

export function jobListCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

/**
 * Build the next-page cursor from the rows actually fetched from D1 (before any UI collapse).
 * Passing a collapsed shorter list here used to end paging early and hide the rest of the pipeline.
 */
export function nextJobCursor(rows: { createdAt: string; id: string }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (!last) return null;
  return jobListCursor(last.createdAt, last.id);
}

/** True when this DB page was full — more rows may exist even if the UI collapsed some. */
export function jobListPageHasMore(fetchedCount: number, limit: number): boolean {
  return fetchedCount >= limit;
}

export const RETENTION_DAYS = {
  sessionBackstop: 45,
  scanCandidates: 14,
  jobEvents: 400,
  quotaSamples: 120,
} as const;

export function utcCutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export function sqliteCutoff(now: Date, days: number): string {
  return utcCutoffIso(now, days).slice(0, 19).replace("T", " ");
}

/** The :17 hourly trigger also carries the daily quota pass. One extra cron would still fit in five, but this does not spend a slot. */
export const DAILY_QUOTA_UTC_HOUR = 6;
export const HOURLY_SCAN_CRON = "17 * * * *";

export function shouldCollectQuotas(cron: string, now: Date): boolean {
  return cron === HOURLY_SCAN_CRON && now.getUTCHours() === DAILY_QUOTA_UTC_HOUR;
}

export function scanFailureSpike(attempted: number, failed: number): boolean {
  if (attempted <= 0 || failed <= 0) return false;
  if (failed >= 5) return true;
  return attempted >= 4 && failed / attempted >= 0.5;
}

export interface QuotaSample {
  day: string;
  used: number;
  limit: number;
}

export type QuotaSeverity = "ok" | "watch" | "critical";

/** Project used units seven days ahead from the average day-to-day change. */
export function forecastUsed(samples: QuotaSample[], today: string): number | null {
  const ordered = samples
    .filter((sample) => sample.day <= today && Number.isFinite(sample.used))
    .sort((a, b) => a.day.localeCompare(b.day));
  const latest = ordered[ordered.length - 1];
  if (!latest) return null;
  const window = ordered.slice(-8);
  if (window.length < 2) return latest.used;
  let slope = 0;
  for (let i = 1; i < window.length; i++) slope += window[i]!.used - window[i - 1]!.used;
  const average = slope / (window.length - 1);
  return Math.max(0, latest.used + average * 7);
}

export function quotaSeverity(used: number, limit: number, forecast: number | null): QuotaSeverity {
  if (!(limit > 0) || !Number.isFinite(used)) return "ok";
  const ratio = used / limit;
  const ahead = forecast === null ? 0 : forecast / limit;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.8 || ahead >= 0.9) return "watch";
  return "ok";
}

export function quotaSummary(meter: QuotaMeter, severity: Exclude<QuotaSeverity, "ok">, used: number, limit: number, forecast: number | null): string {
  const pct = (value: number) => `${Math.round((value / limit) * 100)} percent`;
  const ahead = forecast === null ? "" : ` A seven-day forecast reaches ${pct(forecast)}.`;
  const tone = severity === "critical" ? "is past 90 percent" : "needs a look";
  return `${QUOTA_LABELS[meter]} ${tone}: ${pct(used)} of the watched ceiling is used.${ahead}`;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    const parsed = Number(value);
    return parsed >= 0 ? parsed : null;
  }
  return null;
}

function addNumericFields(node: unknown, into: Map<string, number>, how: "sum" | "max"): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const parsed = finiteNumber(value);
    if (parsed === null) continue;
    const prior = into.get(key) ?? (how === "max" ? 0 : 0);
    into.set(key, how === "max" ? Math.max(prior, parsed) : prior + parsed);
  }
}

/** Walk a GraphQL payload and total any sum/max/quantile objects. Unknown shapes contribute nothing. */
export function collectAnalyticsNumbers(payload: unknown): { sums: Map<string, number>; maxes: Map<string, number> } {
  const sums = new Map<string, number>();
  const maxes = new Map<string, number>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if ("sum" in record) addNumericFields(record.sum, sums, "sum");
    if ("max" in record) addNumericFields(record.max, maxes, "max");
    if ("quantiles" in record) addNumericFields(record.quantiles, maxes, "max");
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(payload, 0);
  return { sums, maxes };
}

export function cloudflareMeters(payload: unknown): Partial<Record<QuotaMeter, number>> {
  const { sums, maxes } = collectAnalyticsNumbers(payload);
  const meters: Partial<Record<QuotaMeter, number>> = {};
  const requests = sums.get("requests") ?? sums.get("requestCount");
  if (requests !== undefined) meters.workers_requests = requests;
  const cpuUs = sums.get("cpuTimeUs") ?? sums.get("cpuTimeMicroseconds");
  const cpuMs = sums.get("cpuTimeMs") ?? sums.get("cpuTime");
  if (cpuUs !== undefined) meters.workers_cpu_ms = cpuUs / 1000;
  else if (cpuMs !== undefined) meters.workers_cpu_ms = cpuMs;
  const reads = sums.get("rowsRead") ?? sums.get("rows_read");
  const writes = sums.get("rowsWritten") ?? sums.get("rows_written");
  if (reads !== undefined) meters.d1_rows_read = reads;
  if (writes !== undefined) meters.d1_rows_written = writes;
  const readQueries = sums.get("readQueries") ?? sums.get("read_queries") ?? 0;
  const writeQueries = sums.get("writeQueries") ?? sums.get("write_queries") ?? 0;
  if (sums.has("readQueries") || sums.has("writeQueries") || sums.has("read_queries") || sums.has("write_queries")) {
    meters.d1_requests = readQueries + writeQueries;
  }
  const stored = maxes.get("databaseSizeBytes") ?? maxes.get("database_size_bytes") ?? sums.get("databaseSizeBytes");
  if (stored !== undefined) meters.d1_storage_bytes = stored;
  return meters;
}

/** Meters the daily collector must see. A missing database-request count is a gap, not zero. */
export const REQUIRED_CLOUDFLARE_METERS = [
  "workers_requests",
  "workers_cpu_ms",
  "d1_rows_read",
  "d1_rows_written",
  "d1_requests",
  "d1_storage_bytes",
] as const satisfies readonly QuotaMeter[];

export function missingQuotaMeters(meters: Partial<Record<QuotaMeter, number>>): QuotaMeter[] {
  return REQUIRED_CLOUDFLARE_METERS.filter((meter) => meters[meter] === undefined);
}

export function cloudflarePayloadFailed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const errors = (payload as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0 && Object.keys(cloudflareMeters(payload)).length === 0) return true;
  return false;
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

export interface ResendReading {
  daily: number | null;
  monthly: number | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
}

/** Accept the few public shapes Resend has used. If the window is unclear, return nulls. */
export function parseResendUsage(payload: unknown, today: string): ResendReading {
  const empty: ResendReading = { daily: null, monthly: null, dailyLimit: null, monthlyLimit: null };
  if (!payload || typeof payload !== "object") return empty;
  const record = payload as Record<string, unknown>;
  const nested = record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : null;
  const quota = record.quota && typeof record.quota === "object" ? (record.quota as Record<string, unknown>) : null;
  const daily =
    finiteNumber(record.sent_today) ??
    finiteNumber(record.daily) ??
    finiteNumber(nested?.day) ??
    finiteNumber(nested?.daily);
  const monthly =
    finiteNumber(record.sent_this_month) ??
    finiteNumber(record.monthly) ??
    finiteNumber(nested?.month) ??
    finiteNumber(nested?.monthly);
  const dailyLimit = finiteNumber(record.daily_quota) ?? finiteNumber(quota?.daily) ?? finiteNumber(record.dailyQuota);
  const monthlyLimit = finiteNumber(record.monthly_quota) ?? finiteNumber(quota?.monthly) ?? finiteNumber(record.monthlyQuota);
  if (daily !== null || monthly !== null) {
    return { daily, monthly, dailyLimit, monthlyLimit };
  }
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(payload) ? payload : null;
  if (!rows) return empty;
  let daySum = 0;
  let monthSum = 0;
  let sawDay = false;
  let sawMonth = false;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const date = typeof item.date === "string" ? item.date.slice(0, 10) : typeof item.day === "string" ? item.day.slice(0, 10) : "";
    const sent = finiteNumber(item.sent) ?? finiteNumber(item.count) ?? finiteNumber(item.emails);
    if (!date || sent === null) continue;
    if (date === today) {
      daySum += sent;
      sawDay = true;
    }
    if (monthOf(date) === monthOf(today)) {
      monthSum += sent;
      sawMonth = true;
    }
  }
  return {
    daily: sawDay ? daySum : null,
    monthly: sawMonth ? monthSum : null,
    dailyLimit,
    monthlyLimit,
  };
}

export function limitFor(meter: QuotaMeter, reported: number | null): number {
  if (reported !== null && reported > 0) return reported;
  return QUOTA_LIMITS[meter];
}
