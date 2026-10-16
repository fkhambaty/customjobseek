import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import {
  assignSearchPath,
  countryLabelFor,
  jobPayPlace,
  nextPathSet,
  planJobChanges,
  planJobPathAction,
  summarizeChanges,
  type JobChange,
  type PathCommit,
  type PathPreview,
  type SearchPath,
  type TrackedJob,
} from "../shared/engine/searchPaths";
import type { FitResult, Preferences, Profile, SalaryPeriod } from "../shared/types";
import { abortBatchWhen } from "./batchGuard";
import { HttpError } from "./env";

interface PathRow {
  id: string;
  name: string;
  location_mode: string;
  cities_json: string;
  excluded_cities_json: string;
  pay_min: number;
  pay_max: number;
  currency: string;
  salary_period: string;
  sort_order: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

function locationMode(value: string): SearchPath["locationMode"] {
  switch (value) {
    case "cities":
    case "remote":
    case "country":
      return value;
    default:
      throw new HttpError(500, "A search path could not be read.");
  }
}

function salaryPeriod(value: string): SalaryPeriod {
  switch (value) {
    case "year":
    case "month":
    case "hour":
    case "lpa":
      return value;
    default:
      throw new HttpError(500, "A search path could not be read.");
  }
}

function parseCitiesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function toPath(row: PathRow): SearchPath {
  return {
    id: row.id,
    name: row.name,
    locationMode: locationMode(row.location_mode),
    cities: parseCitiesJson(row.cities_json),
    excludedCities: parseCitiesJson(row.excluded_cities_json),
    payMin: row.pay_min,
    payMax: row.pay_max,
    currency: row.currency,
    salaryPeriod: salaryPeriod(row.salary_period),
    sortOrder: row.sort_order,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function retryTransientRead<T>(read: () => Promise<D1Result<T>>): Promise<D1Result<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      lastError = err;
      if (!errorText(err).includes("Failed to get session commit token")) throw err;
      await Promise.resolve();
    }
  }
  throw lastError;
}

export async function listSearchPaths(db: D1Database, userId: string): Promise<SearchPath[]> {
  const { results } = await retryTransientRead(() =>
    db.prepare(
      `SELECT id, name, location_mode, cities_json, excluded_cities_json, pay_min, pay_max, currency, salary_period, sort_order, revision, created_at, updated_at
       FROM search_paths WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .bind(userId)
    .all<PathRow>());
  return results.map(toPath);
}

async function loadJobs(db: D1Database, userId: string, currency: string): Promise<TrackedJob[]> {
  const { results } = await retryTransientRead(() =>
    db.prepare("SELECT id, location, pay_low, pay_high, lane, search_path_id, archived_at FROM jobs WHERE user_id = ?")
    .bind(userId)
    .all<{
      id: string;
      location: string;
      pay_low: number | null;
      pay_high: number | null;
      lane: string;
      search_path_id: string | null;
      archived_at: string | null;
    }>());
  return results.map((row) => ({
    id: row.id,
    location: row.location,
    payLow: row.pay_low,
    payHigh: row.pay_high,
    currency,
    searchPathId: row.search_path_id,
    lane: row.lane,
    archivedAt: row.archived_at,
  }));
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err ?? "");
  const cause = "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  return `${err.message} ${cause}`;
}

async function prepareChange(
  db: D1Database,
  userId: string,
  preferences: Preferences,
  commit: PathCommit,
): Promise<{ before: SearchPath[]; after: SearchPath[]; changes: JobChange[] }> {
  const before = await listSearchPaths(db, userId);
  const jobs = await loadJobs(db, userId, preferences.currency);
  const planned = nextPathSet(
    before,
    commit,
    Array.from({ length: 6 }, () => crypto.randomUUID()),
    new Date().toISOString(),
    countryLabelFor(preferences),
  );
  if (!planned.ok) throw new HttpError(planned.status, planned.error);
  const changes = planJobChanges({
    jobs,
    after: planned.after,
    disposition: commit.disposition,
    deletedId: planned.deletedId,
    moveToId: planned.moveToId,
    now: new Date().toISOString(),
    preferences,
  });
  return { before, after: planned.after, changes };
}

export function searchPathRevisionGuard(db: D1Database, userId: string, before: SearchPath[]): D1PreparedStatement {
  if (!before.length) {
    return db.prepare(abortBatchWhen("(SELECT COUNT(*) FROM search_paths WHERE user_id = ?) != 0")).bind(userId);
  }
  const mismatches = before.map(() => "NOT EXISTS (SELECT 1 FROM search_paths WHERE user_id = ? AND id = ? AND revision = ?)").join(" OR ");
  const sql = abortBatchWhen(`(SELECT COUNT(*) FROM search_paths WHERE user_id = ?) != ? OR ${mismatches}`);
  const binds: unknown[] = [userId, before.length];
  for (const path of before) binds.push(userId, path.id, path.revision);
  return db.prepare(sql).bind(...binds);
}

function sameSnapshot(before: SearchPath[], now: SearchPath[]): boolean {
  if (before.length !== now.length) return false;
  return before.every((path) => now.some((row) => row.id === path.id && row.revision === path.revision));
}

function writeStatements(db: D1Database, userId: string, before: SearchPath[], after: SearchPath[], changes: JobChange[]): D1PreparedStatement[] {
  const kept = new Set(after.map((path) => path.id));
  const statements: D1PreparedStatement[] = [
    searchPathRevisionGuard(db, userId, before),
    ...changes.map((change) =>
    db
      .prepare(
        `UPDATE jobs SET search_path_id = ?, lane = ?, archived_at = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(change.searchPathId, change.lane, change.archivedAt, change.id, userId)),
  ];
  statements.push(db.prepare("UPDATE search_paths SET sort_order = sort_order + 100 WHERE user_id = ?").bind(userId));
  for (const path of before) {
    if (!kept.has(path.id)) statements.push(db.prepare("DELETE FROM search_paths WHERE id = ? AND user_id = ?").bind(path.id, userId));
  }
  for (const path of after) {
    const citiesJson = JSON.stringify(path.cities);
    const excludedJson = JSON.stringify(path.excludedCities);
    const existed = before.some((row) => row.id === path.id);
    if (existed) {
      statements.push(
        db
          .prepare(
            `UPDATE search_paths
             SET name = ?, location_mode = ?, cities_json = ?, excluded_cities_json = ?, pay_min = ?, pay_max = ?, currency = ?, salary_period = ?, sort_order = ?, revision = revision + 1, updated_at = datetime('now')
             WHERE id = ? AND user_id = ?`,
          )
          .bind(
            path.name,
            path.locationMode,
            citiesJson,
            excludedJson,
            path.payMin,
            path.payMax,
            path.currency,
            path.salaryPeriod,
            path.sortOrder,
            path.id,
            userId,
          ),
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO search_paths
             (id, user_id, name, location_mode, cities_json, excluded_cities_json, pay_min, pay_max, currency, salary_period, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            path.id,
            userId,
            path.name,
            path.locationMode,
            citiesJson,
            excludedJson,
            path.payMin,
            path.payMax,
            path.currency,
            path.salaryPeriod,
            path.sortOrder,
            path.createdAt,
            path.updatedAt,
          ),
      );
    }
  }
  statements.push(db.prepare(abortBatchWhen("(SELECT COUNT(*) FROM search_paths WHERE user_id = ?) > 6")).bind(userId));
  return statements;
}

export async function previewSearchPaths(db: D1Database, userId: string, preferences: Preferences, commit: PathCommit): Promise<PathPreview> {
  const prepared = await prepareChange(db, userId, preferences, commit);
  return summarizeChanges(prepared.changes);
}

export async function commitSearchPaths(db: D1Database, userId: string, preferences: Preferences, commit: PathCommit): Promise<SearchPath[]> {
  const prepared = await prepareChange(db, userId, preferences, commit);
  try {
    await db.batch(writeStatements(db, userId, prepared.before, prepared.after, prepared.changes));
  } catch (err) {
    const text = errorText(err);
    if (text.includes("search path limit")) throw new HttpError(400, "You can keep up to 6 search paths.");
    if (text.includes("ok = 1")) {
      const now = await listSearchPaths(db, userId);
      if (!sameSnapshot(prepared.before, now)) {
        throw new HttpError(409, "Search paths changed while this was saving. Reload and try again.");
      }
      throw new HttpError(400, "You can keep up to 6 search paths.");
    }
    throw err;
  }
  return listSearchPaths(db, userId);
}

export async function assignmentFor(
  db: D1Database,
  userId: string,
  profile: Profile,
  location: string,
  parsed: FitResult["parsedSalary"],
): Promise<{ searchPathId: string | null; lane: string; payNotPublished: boolean }> {
  const paths = await listSearchPaths(db, userId);
  return assignSearchPath({
    ...jobPayPlace(location, parsed),
    paths,
    preferences: profile.preferences,
  });
}

export async function applyJobPathAction(
  db: D1Database,
  userId: string,
  profile: Profile,
  job: { id: string; location: string; pay_low: number | null; pay_high: number | null; lane: string; search_path_id: string | null; archived_at: string | null },
  action: "restore" | "reclassify",
): Promise<void> {
  const paths = await listSearchPaths(db, userId);
  const place = jobPayPlace(job.location, payFit(job, profile.preferences.currency));
  const plan = planJobPathAction(action, {
    ...place,
    id: job.id,
    lane: job.lane,
    searchPathId: job.search_path_id,
    archivedAt: job.archived_at,
  }, paths, profile.preferences);
  switch (plan.kind) {
    case "assign":
      await db
        .prepare("UPDATE jobs SET search_path_id = ?, lane = ?, archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .bind(plan.searchPathId, plan.lane, job.id, userId)
        .run();
      return;
    case "legacy":
      await db
        .prepare("UPDATE jobs SET search_path_id = NULL, lane = ?, archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .bind(plan.lane, job.id, userId)
        .run();
      return;
    case "unchanged":
      return;
    case "archive":
      await db
        .prepare(
          "UPDATE jobs SET search_path_id = NULL, lane = ?, archived_at = COALESCE(archived_at, ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        )
        .bind(plan.lane, new Date().toISOString(), job.id, userId)
        .run();
      return;
    case "refuse":
      throw new HttpError(409, "No search path matches this job, so it stays archived.");
    default: {
      const never: never = plan;
      throw new HttpError(400, String(never));
    }
  }
}

function payFit(
  job: { pay_low: number | null; pay_high: number | null },
  currency: string,
): FitResult["parsedSalary"] {
  if (job.pay_low === null && job.pay_high === null) return null;
  const low = job.pay_low ?? job.pay_high ?? 0;
  const high = job.pay_high ?? job.pay_low ?? 0;
  return { min: low, max: high, currency, period: "year", annualMin: low, annualMax: high };
}
