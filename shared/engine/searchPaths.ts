import { cityNames, countryByCode, currencies } from "../geo";
import { emptyProfile, type Blocker, type Decision, type FitResult, type Preferences, type SalaryPeriod } from "../types";
import { laneFor } from "./classify";
import { annualise, locationCheck, marketLocationOk, type FitOptions, type PathPayFloor } from "./fit";

export const SEARCH_PATH_LIMIT = 6;
export const UNASSIGNED_PATH_FILTER = "__unassigned";

export const PAY_NOT_PUBLISHED = "Pay not published";

/** Pay bands are inclusive on both ends: midpoint matches when payMin ≤ midpoint ≤ payMax (after annualising the band). */
export const PAY_MIDPOINT_NOTE =
  "A job matches when the midpoint of the published pay falls inside the path's pay band, inclusive on both the lower and upper limit. If only one number is published, that number is used. If the posting has no pay, the job can be reviewed on its own. A missing number is never guessed.";

export const LOCATION_MODES = ["cities", "remote", "country"] as const;
export type LocationMode = (typeof LOCATION_MODES)[number];

export const JOB_DISPOSITIONS = ["reclassify", "archive", "move"] as const;
export type JobDisposition = (typeof JOB_DISPOSITIONS)[number];

export type EditDisposition = "reclassify" | "archive";

export interface SearchPath {
  id: string;
  name: string;
  locationMode: LocationMode;
  cities: string[];
  excludedCities: string[];
  payMin: number;
  payMax: number;
  currency: string;
  salaryPeriod: SalaryPeriod;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchPathDraft {
  id?: string;
  locationMode: LocationMode;
  cities: string[];
  excludedCities: string[];
  payMin: number;
  payMax: number;
  currency: string;
  salaryPeriod: SalaryPeriod;
  sortOrder: number;
}

export interface JobPayPlace {
  location: string;
  payLow: number | null;
  payHigh: number | null;
  currency: string;
}

export interface PathAssignment {
  searchPathId: string | null;
  lane: string;
  payNotPublished: boolean;
}

export interface TrackedJob extends JobPayPlace {
  id: string;
  searchPathId: string | null;
  lane: string;
  archivedAt: string | null;
}

export interface JobChange {
  id: string;
  searchPathId: string | null;
  lane: string;
  archivedAt: string | null;
}

export interface PathPreview {
  affected: number;
  assigned: number;
  archived: number;
}

export type PathCommit =
  | { action: "create"; draft: SearchPathDraft; disposition: EditDisposition }
  | { action: "update"; id: string; draft: SearchPathDraft; disposition: EditDisposition }
  | { action: "delete"; id: string; disposition: JobDisposition; moveToId: string | null }
  | { action: "reorder"; ids: string[]; disposition: EditDisposition }
  | { action: "replace"; drafts: SearchPathDraft[]; disposition: EditDisposition };

export type CommitPlan =
  | { ok: true; after: SearchPath[]; deletedId: string | null; moveToId: string | null }
  | { ok: false; status: 400 | 404; error: string };

const SALARY_PERIODS = ["year", "month", "hour", "lpa"] as const;
const WIDE_PAY_MAX = 1_000_000_000;

export function payMidpoint(low: number | null, high: number | null): number | null {
  if (low === null && high === null) return null;
  if (low !== null && high !== null) return (low + high) / 2;
  return high ?? low;
}

export function isRemoteLocation(location: string): boolean {
  return /remote|anywhere|work from home|wfh/i.test(location);
}

function mentionsPlace(location: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(location);
}

function mentionsAnyCity(location: string, cities: string[]): boolean {
  return cities.some((city) => cityNames(city).some((name) => mentionsPlace(location, name)));
}

export function countryLabelFor(prefs: Pick<Preferences, "country"> | string): string {
  const code = typeof prefs === "string" ? prefs : prefs.country;
  return countryByCode(code)?.name ?? "Country";
}

export function locationMatches(
  location: string,
  path: Pick<SearchPath, "locationMode" | "cities" | "excludedCities">,
  countryCode = "",
): boolean {
  const remote = isRemoteLocation(location);
  switch (path.locationMode) {
    case "remote":
      return remote;
    case "cities": {
      if (remote) return false;
      return mentionsAnyCity(location, path.cities);
    }
    case "country": {
      if (remote) return false;
      if (!marketLocationOk(location, countryCode)) return false;
      if (mentionsAnyCity(location, path.excludedCities)) return false;
      return true;
    }
    default: {
      const never: never = path.locationMode;
      return never;
    }
  }
}

function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((item) => item.type === "currency");
    return part?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(amount);
}

export function formatPayBand(payMin: number, payMax: number, currency: string, period: SalaryPeriod): string {
  const symbol = currencySymbol(currency);
  const band = `${symbol}${formatAmount(payMin)}–${symbol}${formatAmount(payMax)}`;
  switch (period) {
    case "lpa":
      return `${band} LPA`;
    case "year":
      return `${band} per year`;
    case "month":
      return `${band} per month`;
    case "hour":
      return `${band} per hour`;
    default: {
      const never: never = period;
      return never;
    }
  }
}

function placeName(
  path: Pick<SearchPath, "locationMode" | "cities" | "excludedCities">,
  countryLabel = "Country",
): string {
  switch (path.locationMode) {
    case "remote":
      return "Remote";
    case "cities":
      return path.cities.map((city) => city.trim()).filter(Boolean).join(", ");
    case "country": {
      const excluded = path.excludedCities.map((city) => city.trim()).filter(Boolean);
      if (!excluded.length) return countryLabel;
      return `${countryLabel} except ${excluded.join(", ")}`;
    }
    default: {
      const never: never = path.locationMode;
      return never;
    }
  }
}

export function searchPathLabel(
  path: Pick<SearchPath, "locationMode" | "cities" | "excludedCities" | "payMin" | "payMax" | "currency" | "salaryPeriod">,
  countryLabel = "Country",
): string {
  return `${placeName(path, countryLabel)} · ${formatPayBand(path.payMin, path.payMax, path.currency, path.salaryPeriod)}`;
}

function byOrder(a: SearchPath, b: SearchPath): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

/** Inclusive on both ends after annualising the path band into the same units as stored job pay. */
function payMatches(path: SearchPath, midpoint: number, currency: string): boolean {
  if (path.currency !== currency) return false;
  const min = annualise(path.payMin, path.salaryPeriod);
  const max = annualise(path.payMax, path.salaryPeriod);
  return midpoint >= min && midpoint <= max;
}

/** First path in sort order whose place and pay band both fit. Unknown pay never matches a band. */
export function firstOrderedMatch(paths: SearchPath[], job: JobPayPlace, countryCode = ""): SearchPath | null {
  const located = [...paths].sort(byOrder).filter((path) => locationMatches(job.location, path, countryCode));
  const midpoint = payMidpoint(job.payLow, job.payHigh);
  if (midpoint === null) return null;
  for (const path of located) {
    if (payMatches(path, midpoint, job.currency)) return path;
  }
  return null;
}

/** First path whose place rule fits, used as the pay floor for fit deal-breakers. */
export function placePathPayFloor(
  paths: SearchPath[],
  location: string,
  countryCode = "",
  countryLabel = "Country",
): PathPayFloor | null {
  const hit = [...paths].sort(byOrder).find((path) => locationMatches(location, path, countryCode));
  if (!hit) return null;
  return {
    payMin: hit.payMin,
    payMax: hit.payMax,
    currency: hit.currency,
    salaryPeriod: hit.salaryPeriod,
    label: searchPathLabel(hit, countryLabel),
  };
}

/** Fit salary options derived from saved search paths for a job location. */
export function fitOptionsForPaths(paths: SearchPath[], location: string, preferences: Preferences): FitOptions {
  if (!paths.length) return {};
  return {
    hasSearchPaths: true,
    pathPay: placePathPayFloor(paths, location, preferences.country, countryLabelFor(preferences)),
  };
}

export function assignSearchPath(input: JobPayPlace & { paths: SearchPath[]; preferences: Preferences }): PathAssignment {
  if (input.paths.length === 0) {
    return {
      searchPathId: null,
      lane: laneFor(input.location, input.payLow, input.payHigh, input.preferences),
      payNotPublished: false,
    };
  }
  const match = firstOrderedMatch(input.paths, input, input.preferences.country);
  if (match) {
    return {
      searchPathId: match.id,
      lane: searchPathLabel(match, countryLabelFor(input.preferences)),
      payNotPublished: false,
    };
  }
  return { searchPathId: null, lane: "", payNotPublished: payMidpoint(input.payLow, input.payHigh) === null };
}

/** Parsed annual pay keeps its own currency. A missing parse stays unknown. Amounts are never converted. */
export function jobPayPlace(
  location: string,
  parsed: { currency: string; annualMin: number; annualMax: number } | null,
): JobPayPlace {
  if (!parsed) return { location, payLow: null, payHigh: null, currency: "" };
  return { location, payLow: parsed.annualMin, payHigh: parsed.annualMax, currency: parsed.currency };
}

type KnownPay = "posting" | "estimated" | "stated" | "unknown" | "";

function publishedPayKnown(provenance: KnownPay | undefined): boolean {
  switch (provenance) {
    case "posting":
    case "estimated":
    case "stated":
      return true;
    case "unknown":
    case "":
    case undefined:
      return false;
    default: {
      const never: never = provenance;
      return never;
    }
  }
}

export function showPayNotPublished(
  job: {
    searchPathId?: string | null;
    payLow: number | null;
    payHigh: number | null;
    archivedAt?: string | null;
    salaryText?: string;
    payProvenance?: KnownPay;
  },
  hasPaths: boolean,
): boolean {
  if (!hasPaths || job.searchPathId || job.archivedAt) return false;
  if (payMidpoint(job.payLow, job.payHigh) !== null) return false;
  if (job.salaryText?.trim()) return false;
  return !publishedPayKnown(job.payProvenance);
}

export function draftWithPeriod(draft: SearchPathDraft, salaryPeriod: SalaryPeriod): SearchPathDraft {
  if (salaryPeriod === "lpa") return { ...draft, salaryPeriod, currency: "INR" };
  return { ...draft, salaryPeriod };
}

export function draftWithCurrency(draft: SearchPathDraft, currency: string): SearchPathDraft {
  if (currency !== "INR" && draft.salaryPeriod === "lpa") return { ...draft, currency, salaryPeriod: "year" };
  return { ...draft, currency };
}

/** Rescore and resume rebuild never touch archived_at. An archived job with no new match keeps its lane. */
export function rescorePathFields(
  job: { archivedAt: string | null; lane: string; searchPathId: string | null },
  assigned: { searchPathId: string | null; lane: string } | null,
): { lane: string; searchPathId: string | null } {
  if (!assigned || (job.archivedAt && !assigned.searchPathId)) {
    return { lane: job.lane, searchPathId: job.searchPathId };
  }
  return { lane: assigned.lane, searchPathId: assigned.searchPathId };
}

export type JobPathPlan =
  | { kind: "assign"; searchPathId: string; lane: string }
  | { kind: "legacy"; lane: string }
  | { kind: "unchanged" }
  | { kind: "archive"; lane: string }
  | { kind: "refuse" };

export function planJobPathAction(
  action: "restore" | "reclassify",
  job: TrackedJob,
  paths: SearchPath[],
  preferences: Preferences,
): JobPathPlan {
  const match = paths.length ? firstOrderedMatch(paths, job, preferences.country) : null;
  const label = match ? searchPathLabel(match, countryLabelFor(preferences)) : "";
  switch (action) {
    case "restore":
      if (!paths.length) return { kind: "legacy", lane: laneFor(job.location, job.payLow, job.payHigh, preferences) };
      if (!match) return { kind: "refuse" };
      return { kind: "assign", searchPathId: match.id, lane: label };
    case "reclassify":
      if (match) return { kind: "assign", searchPathId: match.id, lane: label };
      if (!paths.length) return { kind: "legacy", lane: laneFor(job.location, job.payLow, job.payHigh, preferences) };
      if (!job.searchPathId) return { kind: "unchanged" };
      return { kind: "archive", lane: job.lane };
    default: {
      const never: never = action;
      throw new Error(String(never));
    }
  }
}

export function storedAnnualPay(
  parsed: { currency: string; annualMin: number; annualMax: number } | null,
  currency: string,
): { low: number | null; high: number | null } {
  if (!parsed || parsed.currency !== currency) return { low: null, high: null };
  return { low: parsed.annualMin, high: parsed.annualMax };
}

export function placePathLabel(paths: SearchPath[], location: string, countryCode = "", countryLabel = "Country"): string {
  const hit = [...paths].sort(byOrder).find((path) => locationMatches(location, path, countryCode));
  return hit ? `${placeName(hit, countryLabel)} · pay checked after opening is read` : "";
}

function suggestedPayBand(prefs: Preferences): { payMin: number; payMax: number } {
  const min = prefs.minSalary !== null && prefs.minSalary > 0 ? prefs.minSalary : null;
  const max = prefs.maxSalary !== null && prefs.maxSalary > 0 ? prefs.maxSalary : null;
  if (min !== null && max !== null && max > min) return { payMin: min, payMax: max };
  if (min !== null) {
    const wide = Math.min(Math.max(min * 10, min + 1), WIDE_PAY_MAX);
    return { payMin: min, payMax: wide };
  }
  if (max !== null) return { payMin: 1, payMax: max };
  return { payMin: 1, payMax: WIDE_PAY_MAX };
}

export function suggestSearchPaths(prefs: Preferences): SearchPathDraft[] {
  const cities = [...new Set(prefs.cities.map((city) => city.trim()).filter(Boolean))];
  const includeRemote = prefs.remoteOk;
  const cityRoom = SEARCH_PATH_LIMIT - (includeRemote ? 1 : 0);
  const salaryPeriod: SalaryPeriod = prefs.salaryPeriod === "lpa" && prefs.currency !== "INR" ? "year" : prefs.salaryPeriod;
  const currency = salaryPeriod === "lpa" ? "INR" : prefs.currency || "INR";
  const { payMin, payMax } = suggestedPayBand(prefs);
  const drafts: SearchPathDraft[] = cities.slice(0, Math.max(0, cityRoom)).map((city, sortOrder) => ({
    locationMode: "cities",
    cities: [city],
    excludedCities: [],
    payMin,
    payMax,
    currency,
    salaryPeriod,
    sortOrder,
  }));
  if (includeRemote && drafts.length < SEARCH_PATH_LIMIT) {
    drafts.push({
      locationMode: "remote",
      cities: [],
      excludedCities: [],
      payMin,
      payMax,
      currency,
      salaryPeriod,
      sortOrder: drafts.length,
    });
  }
  return drafts;
}

export function openingLocationAllowed(location: string, prefs: Preferences, paths: SearchPath[]): boolean {
  if (prefs.country && !marketLocationOk(location, prefs.country)) return false;
  if (paths.length === 0) {
    const profile = emptyProfile();
    profile.preferences = prefs;
    const place = locationCheck({ title: "", company: "", location, salaryText: "", description: "" }, profile);
    return !place.blocker;
  }
  return paths.some((path) => locationMatches(location, path, prefs.country));
}

function isPlaceOrPayBlocker(kind: Blocker["kind"]): boolean {
  switch (kind) {
    case "salary":
    case "location":
      return true;
    case "title":
    case "never_claim":
    case "experience":
      return false;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export function withoutPlaceAndPayBlockers(fit: FitResult): FitResult {
  const blockers = fit.blockers.filter((blocker) => !isPlaceOrPayBlocker(blocker.kind));
  if (blockers.length === fit.blockers.length) return fit;
  const decision: Decision = blockers.length ? "skip" : fit.score >= 70 ? "apply" : fit.score >= 50 ? "stretch" : "skip";
  return { ...fit, blockers, decision };
}

export type ScanPathDecision = "legacy" | "prepare" | "review" | "skip";

export function scanCandidateDecision(paths: SearchPath[], job: JobPayPlace, countryCode = ""): ScanPathDecision {
  if (paths.length === 0) return "legacy";
  if (!paths.some((path) => locationMatches(job.location, path, countryCode))) return "skip";
  if (payMidpoint(job.payLow, job.payHigh) === null) return "review";
  return firstOrderedMatch(paths, job, countryCode) ? "prepare" : "skip";
}

/** Legacy scans keep every blocker. Path scans ignore place and pay blockers and use the path rules. */
export function scanOpeningAcceptance(
  paths: SearchPath[],
  job: JobPayPlace,
  blockerKinds: Blocker["kind"][],
  countryCode = "",
): "pack" | "skip" {
  const decision = scanCandidateDecision(paths, job, countryCode);
  switch (decision) {
    case "skip":
      return "skip";
    case "legacy":
      return blockerKinds.length ? "skip" : "pack";
    case "prepare":
    case "review":
      return blockerKinds.some((kind) => !isPlaceOrPayBlocker(kind)) ? "skip" : "pack";
    default: {
      const never: never = decision;
      return never;
    }
  }
}

export function jobInPipelineGroup(
  job: { status: string; archivedAt?: string | null },
  groupId: string,
  statuses: readonly string[],
): boolean {
  if (groupId === "archived") return Boolean(job.archivedAt);
  if (job.archivedAt) return false;
  return statuses.includes(job.status);
}

export function matchesPathFilter(
  job: { searchPathId?: string | null; lane: string },
  filter: string,
  hasPaths: boolean,
): boolean {
  if (!filter) return true;
  if (hasPaths) {
    if (filter === UNASSIGNED_PATH_FILTER) return !job.searchPathId;
    return (job.searchPathId ?? "") === filter;
  }
  return job.lane === filter;
}

function parseLocationMode(value: unknown): LocationMode | null {
  switch (value) {
    case "cities":
    case "remote":
    case "country":
      return value;
    default:
      return null;
  }
}

function parseSalaryPeriod(value: unknown): SalaryPeriod | null {
  switch (value) {
    case "year":
    case "month":
    case "hour":
    case "lpa":
      return value;
    default:
      return null;
  }
}

function parseEditDisposition(value: unknown): EditDisposition | null {
  switch (value) {
    case "reclassify":
    case "archive":
      return value;
    default:
      return null;
  }
}

function parseJobDisposition(value: unknown): JobDisposition | null {
  switch (value) {
    case "reclassify":
    case "archive":
    case "move":
      return value;
    default:
      return null;
  }
}

function parseRequiredAmount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseCityList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cities: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    cities.push(item);
  }
  return cities;
}

function cleanCities(cities: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const city of cities) {
    const trimmed = city.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function validateSearchPathDraft(draft: SearchPathDraft): string | null {
  switch (draft.locationMode) {
    case "cities":
      if (!draft.cities.length) return "Add at least one city for this search path.";
      if (draft.cities.some((city) => city.length > 80)) return "City names can be up to 80 characters.";
      if (draft.excludedCities.length) return "A cities path does not exclude cities.";
      break;
    case "remote":
      if (draft.cities.length || draft.excludedCities.length) return "A remote search path does not take cities.";
      break;
    case "country":
      if (draft.cities.length) return "A country path lists exclusions, not included cities.";
      if (draft.excludedCities.some((city) => city.length > 80)) return "City names can be up to 80 characters.";
      break;
    default: {
      const never: never = draft.locationMode;
      return never;
    }
  }
  if (!currencies().includes(draft.currency)) return "Choose a supported currency.";
  if (!SALARY_PERIODS.includes(draft.salaryPeriod)) return "Choose a pay period.";
  if (draft.salaryPeriod === "lpa" && draft.currency !== "INR") return "LPA is only available for INR.";
  if (!(draft.payMin > 0) || draft.payMin > WIDE_PAY_MAX) return "Enter a pay minimum above zero.";
  if (!(draft.payMax > draft.payMin) || draft.payMax > WIDE_PAY_MAX) {
    return "Enter a pay maximum higher than the minimum.";
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder >= SEARCH_PATH_LIMIT) {
    return "Search paths stay in an order from 1 to 6.";
  }
  return null;
}

function fail(status: 400 | 404, error: string): CommitPlan {
  return { ok: false, status, error };
}

function succeed(after: SearchPath[], deletedId: string | null, moveToId: string | null): CommitPlan {
  return { ok: true, after, deletedId, moveToId };
}

function withOrder(paths: SearchPath[], countryLabel: string): SearchPath[] {
  return paths.map((path, sortOrder) => {
    const next = { ...path, sortOrder };
    next.name = searchPathLabel(next, countryLabel);
    return next;
  });
}

function realize(draft: SearchPathDraft, id: string, sortOrder: number, stamp: string, countryLabel: string): SearchPath {
  const path: SearchPath = {
    id,
    name: "",
    locationMode: draft.locationMode,
    cities: draft.locationMode === "cities" ? draft.cities : [],
    excludedCities: draft.locationMode === "country" ? draft.excludedCities : [],
    payMin: draft.payMin,
    payMax: draft.payMax,
    currency: draft.currency,
    salaryPeriod: draft.salaryPeriod,
    sortOrder,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
  path.name = searchPathLabel(path, countryLabel);
  return path;
}

function normalizeDraft(draft: SearchPathDraft, sortOrder: number): SearchPathDraft {
  const cities = cleanCities(draft.cities);
  const excludedCities = cleanCities(draft.excludedCities);
  switch (draft.locationMode) {
    case "cities":
      return { ...draft, sortOrder, cities, excludedCities: [] };
    case "remote":
      return { ...draft, sortOrder, cities: [], excludedCities: [] };
    case "country":
      return { ...draft, sortOrder, cities: [], excludedCities };
    default: {
      const never: never = draft.locationMode;
      return never;
    }
  }
}

function owned(current: SearchPath[], id: string): SearchPath | undefined {
  return current.find((path) => path.id === id);
}

function bumpRevisions(current: SearchPath[], after: SearchPath[]): SearchPath[] {
  return after.map((path) => {
    const previous = owned(current, path.id);
    return { ...path, revision: previous ? previous.revision + 1 : 0 };
  });
}

export function nextPathSet(
  current: SearchPath[],
  commit: PathCommit,
  newIds: string[],
  stamp = "",
  countryLabel = "Country",
): CommitPlan {
  switch (commit.action) {
    case "create": {
      if (current.length >= SEARCH_PATH_LIMIT) return fail(400, "You can keep up to 6 search paths.");
      const draft = normalizeDraft(commit.draft, current.length);
      const error = validateSearchPathDraft(draft);
      if (error) return fail(400, error);
      return succeed(
        bumpRevisions(current, withOrder([...current, realize(draft, newIds[0] ?? crypto.randomUUID(), current.length, stamp, countryLabel)], countryLabel)),
        null,
        null,
      );
    }
    case "update": {
      const existing = owned(current, commit.id);
      if (!existing) return fail(404, "That search path was not found.");
      const draft = normalizeDraft(commit.draft, existing.sortOrder);
      const error = validateSearchPathDraft(draft);
      if (error) return fail(400, error);
      const after = current.map((path) =>
        path.id === commit.id ? realize(draft, commit.id, path.sortOrder, path.createdAt || stamp, countryLabel) : path,
      );
      return succeed(bumpRevisions(current, withOrder(after, countryLabel)), null, null);
    }
    case "delete": {
      if (!owned(current, commit.id)) return fail(404, "That search path was not found.");
      const after = bumpRevisions(current, withOrder(current.filter((path) => path.id !== commit.id), countryLabel));
      if (commit.disposition === "move") {
        if (!commit.moveToId || commit.moveToId === commit.id || !after.some((path) => path.id === commit.moveToId)) {
          return fail(400, "Choose one of your other search paths to move the jobs to.");
        }
        return succeed(after, commit.id, commit.moveToId);
      }
      return succeed(after, commit.id, null);
    }
    case "reorder": {
      if (commit.ids.length !== current.length) return fail(400, "Put every search path in the new order.");
      const seen = new Set<string>();
      const after: SearchPath[] = [];
      for (const id of commit.ids) {
        if (seen.has(id)) return fail(400, "Each search path can appear only once.");
        seen.add(id);
        const path = owned(current, id);
        if (!path) return fail(404, "That search path was not found.");
        after.push(path);
      }
      return succeed(bumpRevisions(current, withOrder(after, countryLabel)), null, null);
    }
    case "replace": {
      if (commit.drafts.length > SEARCH_PATH_LIMIT) return fail(400, "You can keep up to 6 search paths.");
      const after: SearchPath[] = [];
      let fresh = 0;
      for (const [index, raw] of commit.drafts.entries()) {
        const draft = normalizeDraft(raw, index);
        const error = validateSearchPathDraft(draft);
        if (error) return fail(400, error);
        let id = raw.id ?? "";
        if (!id || id.startsWith("draft-")) {
          id = newIds[fresh] ?? crypto.randomUUID();
          fresh += 1;
        } else if (!owned(current, id)) {
          return fail(404, "That search path was not found.");
        }
        const previous = owned(current, id);
        after.push(realize(draft, id, index, previous?.createdAt || stamp, countryLabel));
      }
      if (new Set(after.map((path) => path.id)).size !== after.length) return fail(400, "Each search path can appear only once.");
      return succeed(bumpRevisions(current, withOrder(after, countryLabel)), null, null);
    }
    default: {
      const never: never = commit;
      return fail(400, String(never));
    }
  }
}

function sameAssignment(job: TrackedJob, change: JobChange): boolean {
  return (job.searchPathId ?? null) === change.searchPathId && job.lane === change.lane && (job.archivedAt ?? null) === change.archivedAt;
}

export function planJobChanges(input: {
  jobs: TrackedJob[];
  after: SearchPath[];
  disposition: JobDisposition;
  deletedId: string | null;
  moveToId: string | null;
  now: string;
  preferences: Preferences;
}): JobChange[] {
  const countryLabel = countryLabelFor(input.preferences);
  if (input.after.length === 0 && input.disposition === "reclassify") {
    return input.jobs.flatMap((job) => {
      if (!job.searchPathId && !job.archivedAt) return [];
      const change = {
        id: job.id,
        searchPathId: null,
        lane: laneFor(job.location, job.payLow, job.payHigh, input.preferences),
        archivedAt: null,
      };
      return sameAssignment(job, change) ? [] : [change];
    });
  }
  if (input.after.length === 0 && input.disposition === "archive") {
    return input.jobs.flatMap((job) => {
      if (!job.searchPathId) return [];
      const change = { id: job.id, searchPathId: null, lane: job.lane, archivedAt: job.archivedAt ?? input.now };
      return sameAssignment(job, change) ? [] : [change];
    });
  }

  const moveTo = input.moveToId ? input.after.find((path) => path.id === input.moveToId) ?? null : null;
  const changes: JobChange[] = [];
  for (const job of input.jobs) {
    const next = firstOrderedMatch(input.after, job, input.preferences.country);
    const nextId = next?.id ?? null;
    const currentId = job.searchPathId ?? null;
    let change: JobChange | null = null;
    switch (input.disposition) {
      case "move":
        if (input.deletedId && job.searchPathId === input.deletedId && moveTo) {
          change = {
            id: job.id,
            searchPathId: moveTo.id,
            lane: searchPathLabel(moveTo, countryLabel),
            archivedAt: job.archivedAt,
          };
        }
        break;
      case "archive":
        if (currentId !== nextId) {
          const stillThere = currentId !== null && input.after.some((path) => path.id === currentId);
          change = {
            id: job.id,
            searchPathId: stillThere ? currentId : null,
            lane: job.lane,
            archivedAt: job.archivedAt ?? input.now,
          };
        }
        break;
      case "reclassify": {
        const nextLabel = next ? searchPathLabel(next, countryLabel) : "";
        if (next && (currentId !== next.id || job.archivedAt || job.lane !== nextLabel)) {
          change = { id: job.id, searchPathId: next.id, lane: nextLabel, archivedAt: null };
        } else if (!next && currentId !== null) {
          change = { id: job.id, searchPathId: null, lane: job.lane, archivedAt: job.archivedAt ?? input.now };
        }
        break;
      }
      default: {
        const never: never = input.disposition;
        throw new Error(String(never));
      }
    }
    if (change && !sameAssignment(job, change)) changes.push(change);
  }
  return changes;
}

export function summarizeChanges(changes: JobChange[]): PathPreview {
  return {
    affected: changes.length,
    assigned: changes.filter((change) => change.archivedAt === null && change.searchPathId !== null).length,
    archived: changes.filter((change) => change.archivedAt !== null).length,
  };
}

function readDraft(value: unknown, sortOrder: number): { ok: true; draft: SearchPathDraft } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "A search path is missing." };
  const body = value as Record<string, unknown>;
  const locationMode = parseLocationMode(body.locationMode);
  if (!locationMode) return { ok: false, error: "Choose cities, Remote, or whole country." };
  const salaryPeriod = parseSalaryPeriod(body.salaryPeriod);
  if (!salaryPeriod) return { ok: false, error: "Choose a pay period." };
  const payMin = parseRequiredAmount(body.payMin);
  if (payMin === undefined) return { ok: false, error: "Enter the pay minimum as a number." };
  const payMax = parseRequiredAmount(body.payMax);
  if (payMax === undefined) return { ok: false, error: "Enter the pay maximum as a number." };
  const cities = parseCityList(body.cities);
  if (!cities) return { ok: false, error: "Cities must be a list of names." };
  const excludedCities = parseCityList(body.excludedCities);
  if (!excludedCities) return { ok: false, error: "Excluded cities must be a list of names." };
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 80) : undefined;
  return {
    ok: true,
    draft: normalizeDraft(
      { id, locationMode, cities, excludedCities, payMin, payMax, currency, salaryPeriod, sortOrder },
      sortOrder,
    ),
  };
}

export function parsePathCommit(value: unknown): { ok: true; commit: PathCommit } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Say what should happen to the search path." };
  const body = value as Record<string, unknown>;
  switch (body.action) {
    case "create":
    case "update": {
      const disposition = parseEditDisposition(body.disposition);
      if (!disposition) return { ok: false, error: "Choose reclassify or archive for the jobs this change touches." };
      const draft = readDraft(body.draft, 0);
      if (!draft.ok) return draft;
      if (body.action === "create") return { ok: true, commit: { action: "create", draft: draft.draft, disposition } };
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!id) return { ok: false, error: "That search path was not found." };
      return { ok: true, commit: { action: "update", id, draft: draft.draft, disposition } };
    }
    case "delete": {
      const disposition = parseJobDisposition(body.disposition);
      if (!disposition) return { ok: false, error: "Choose reclassify, archive, or move for the jobs on this search path." };
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!id) return { ok: false, error: "That search path was not found." };
      const moveToId = typeof body.moveToId === "string" && body.moveToId.trim() ? body.moveToId.trim() : null;
      return { ok: true, commit: { action: "delete", id, disposition, moveToId } };
    }
    case "reorder": {
      const disposition = parseEditDisposition(body.disposition);
      if (!disposition) return { ok: false, error: "Choose reclassify or archive for the jobs this change touches." };
      if (!Array.isArray(body.ids)) return { ok: false, error: "Put every search path in the new order." };
      const ids: string[] = [];
      for (const id of body.ids) {
        if (typeof id !== "string" || !id.trim()) return { ok: false, error: "Put every search path in the new order." };
        ids.push(id.trim());
      }
      return { ok: true, commit: { action: "reorder", ids, disposition } };
    }
    case "replace": {
      const disposition = parseEditDisposition(body.disposition);
      if (!disposition) return { ok: false, error: "Choose reclassify or archive for the jobs this change touches." };
      if (!Array.isArray(body.drafts)) return { ok: false, error: "Send the search paths to save." };
      const drafts: SearchPathDraft[] = [];
      for (const [index, raw] of body.drafts.entries()) {
        const draft = readDraft(raw, index);
        if (!draft.ok) return draft;
        drafts.push(draft.draft);
      }
      return { ok: true, commit: { action: "replace", drafts, disposition } };
    }
    default:
      return { ok: false, error: "Say what should happen to the search path." };
  }
}
