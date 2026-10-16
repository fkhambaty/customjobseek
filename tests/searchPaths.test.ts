import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { freshPlatformProxy } from "./localDb";
import { laneFor } from "../shared/engine/classify";
import { todayQueues } from "../shared/engine/insights";
import { shouldPersistSearchPaths } from "../shared/onboardingWizard";
import {
  assignSearchPath,
  draftWithCurrency,
  draftWithPeriod,
  firstOrderedMatch,
  jobInPipelineGroup,
  jobPayPlace,
  locationMatches,
  matchesPathFilter,
  nextPathSet,
  parsePathCommit,
  planJobChanges,
  planJobPathAction,
  rescorePathFields,
  scanCandidateDecision,
  scanOpeningAcceptance,
  searchPathLabel,
  showPayNotPublished,
  suggestSearchPaths,
  UNASSIGNED_PATH_FILTER,
  validateSearchPathDraft,
  type SearchPath,
  type SearchPathDraft,
  type TrackedJob,
} from "../shared/engine/searchPaths";
import { emptyProfile, type JobRecord, type Preferences, type SalaryPeriod } from "../shared/types";
import { commitSearchPaths, listSearchPaths, searchPathRevisionGuard } from "../worker/searchPathStore";

function prefs(over: Partial<Preferences> = {}): Preferences {
  return {
    ...emptyProfile().preferences,
    country: "IN",
    cities: ["Pune"],
    remoteOk: true,
    currency: "INR",
    minSalary: 30,
    maxSalary: 50,
    salaryPeriod: "lpa",
    ...over,
  };
}

function makePath(over: Partial<SearchPath> & Pick<SearchPath, "id" | "sortOrder" | "locationMode">): SearchPath {
  const path: SearchPath = {
    id: over.id,
    name: "",
    locationMode: over.locationMode,
    cities: over.cities ?? (over.locationMode === "cities" ? ["Pune"] : []),
    excludedCities: over.excludedCities ?? [],
    payMin: over.payMin ?? 30,
    payMax: over.payMax ?? 50,
    currency: over.currency ?? "INR",
    salaryPeriod: over.salaryPeriod ?? "lpa",
    sortOrder: over.sortOrder,
    revision: over.revision ?? 0,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
  };
  path.name = over.name ?? searchPathLabel(path, over.locationMode === "country" ? "India" : "Country");
  return path;
}

function draft(over: Partial<SearchPathDraft> = {}): SearchPathDraft {
  return {
    locationMode: "cities",
    cities: ["Pune"],
    excludedCities: [],
    payMin: 30,
    payMax: 50,
    currency: "INR",
    salaryPeriod: "lpa",
    sortOrder: 0,
    ...over,
  };
}

function tracked(over: Partial<TrackedJob> = {}): TrackedJob {
  return {
    id: "job-1",
    location: "Pune, India",
    payLow: 3_000_000,
    payHigh: 5_000_000,
    currency: "INR",
    searchPathId: null,
    lane: "",
    archivedAt: null,
    ...over,
  };
}

describe("search path labels, place, and pay", () => {
  it("builds labels for multi-city, remote, country exclude, currencies, and periods", () => {
    expect(searchPathLabel(makePath({ id: "a", sortOrder: 0, locationMode: "cities", cities: ["Pune", "Mumbai"], payMin: 30, payMax: 45 }))).toBe(
      "Pune, Mumbai · ₹30–₹45 LPA",
    );
    expect(searchPathLabel(makePath({ id: "b", sortOrder: 0, locationMode: "remote", payMin: 80_000, payMax: 120_000, currency: "USD", salaryPeriod: "year" }))).toBe(
      "Remote · $80,000–$120,000 per year",
    );
    expect(
      searchPathLabel(
        makePath({ id: "c", sortOrder: 0, locationMode: "country", excludedCities: ["Pune"], payMin: 40, payMax: 80 }),
        "India",
      ),
    ).toBe("India except Pune · ₹40–₹80 LPA");
    expect(searchPathLabel(makePath({ id: "d", sortOrder: 0, locationMode: "cities", cities: ["Austin"], payMin: 100_000, payMax: 150_000, currency: "USD", salaryPeriod: "year" }))).toBe(
      "Austin · $100,000–$150,000 per year",
    );
    expect(searchPathLabel(makePath({ id: "e", sortOrder: 0, locationMode: "cities", cities: ["London"], payMin: 4_000, payMax: 5_000, currency: "GBP", salaryPeriod: "month" }))).toBe(
      "London · £4,000–£5,000 per month",
    );
    expect(searchPathLabel(makePath({ id: "f", sortOrder: 0, locationMode: "remote", payMin: 30, payMax: 60, currency: "EUR", salaryPeriod: "hour" }))).toBe(
      "Remote · €30–€60 per hour",
    );
    expect(searchPathLabel(makePath({ id: "g", sortOrder: 0, locationMode: "country", excludedCities: [], payMin: 1, payMax: 1_000_000_000 }), "India")).toBe(
      "India · ₹1–₹1,000,000,000 LPA",
    );
  });

  it("matches multi-city, remote, and country-exclude modes", () => {
    const metro = makePath({ id: "metro", sortOrder: 0, locationMode: "cities", cities: ["Pune", "Mumbai"], payMin: 1, payMax: 1e9 });
    const bengaluru = makePath({ id: "blr", sortOrder: 1, locationMode: "cities", cities: ["Bengaluru"], payMin: 1, payMax: 1e9 });
    const remote = makePath({ id: "remote", sortOrder: 2, locationMode: "remote", payMin: 1, payMax: 1e9 });
    const indiaExceptPune = makePath({
      id: "india",
      sortOrder: 3,
      locationMode: "country",
      excludedCities: ["Pune"],
      payMin: 1,
      payMax: 1e9,
    });

    expect(locationMatches("Pune, India", metro)).toBe(true);
    expect(locationMatches("Mumbai, India", metro)).toBe(true);
    expect(locationMatches("Hyderabad, India", metro)).toBe(false);
    expect(locationMatches("Pune, India", remote)).toBe(false);
    expect(locationMatches("Bangalore, India", bengaluru)).toBe(true);
    expect(locationMatches("Remote (India)", remote)).toBe(true);
    expect(locationMatches("Remote (India)", metro)).toBe(false);
    expect(locationMatches("Work from home", remote)).toBe(true);

    expect(locationMatches("Bengaluru, India", indiaExceptPune, "IN")).toBe(true);
    expect(locationMatches("Pune, India", indiaExceptPune, "IN")).toBe(false);
    expect(locationMatches("Remote (India)", indiaExceptPune, "IN")).toBe(false);
    expect(locationMatches("Austin, TX", indiaExceptPune, "IN")).toBe(false);
  });

  it("compares the published midpoint with an inclusive annualised pay band", () => {
    const band = makePath({ id: "band", sortOrder: 0, locationMode: "cities", cities: ["Pune"], payMin: 35, payMax: 50 });
    const wide = makePath({ id: "wide", sortOrder: 1, locationMode: "cities", cities: ["Pune"], payMin: 1, payMax: 1e9 });
    const usd = makePath({ id: "usd", sortOrder: 2, locationMode: "cities", cities: ["Pune"], payMin: 100_000, payMax: 200_000, currency: "USD", salaryPeriod: "year" });
    const hourly = makePath({ id: "hour", sortOrder: 0, locationMode: "remote", payMin: 30, payMax: 50, currency: "USD", salaryPeriod: "hour" });
    const monthly = makePath({ id: "month", sortOrder: 0, locationMode: "cities", cities: ["London"], payMin: 4_000, payMax: 6_000, currency: "GBP", salaryPeriod: "month" });

    // 35 LPA = 3_500_000; inclusive on both ends
    expect(firstOrderedMatch([band], { location: "Pune", payLow: 3_500_000, payHigh: 3_500_000, currency: "INR" })?.id).toBe("band");
    expect(firstOrderedMatch([band], { location: "Pune", payLow: 5_000_000, payHigh: 5_000_000, currency: "INR" })?.id).toBe("band");
    expect(firstOrderedMatch([band], { location: "Pune", payLow: 3_000_000, payHigh: 3_000_000, currency: "INR" })).toBeNull();
    expect(firstOrderedMatch([band], { location: "Pune", payLow: 5_500_000, payHigh: 5_500_000, currency: "INR" })).toBeNull();
    expect(firstOrderedMatch([band, wide], { location: "Pune", payLow: null, payHigh: null, currency: "INR" })).toBeNull();
    expect(firstOrderedMatch([band], { location: "Pune", payLow: null, payHigh: null, currency: "INR" })).toBeNull();
    expect(firstOrderedMatch([usd, wide], { location: "Pune", payLow: 4_000_000, payHigh: 4_000_000, currency: "INR" })?.id).toBe("wide");
    expect(firstOrderedMatch([hourly], { location: "Remote", payLow: 70_000, payHigh: 70_000, currency: "USD" })?.id).toBe("hour");
    expect(firstOrderedMatch([hourly], { location: "Remote", payLow: 50_000, payHigh: 50_000, currency: "USD" })).toBeNull();
    expect(firstOrderedMatch([monthly], { location: "London, UK", payLow: 60_000, payHigh: 60_000, currency: "GBP" })?.id).toBe("month");

    const foreign = jobPayPlace("Pune", { currency: "USD", annualMin: 120_000, annualMax: 140_000 });
    expect(foreign.currency).toBe("USD");
    expect(firstOrderedMatch([band], foreign)).toBeNull();
    expect(firstOrderedMatch([band, wide], foreign)).toBeNull();
    expect(firstOrderedMatch([band, wide, usd], foreign)?.id).toBe("usd");
    const foreignAssignment = assignSearchPath({ ...foreign, paths: [band], preferences: prefs() });
    expect(foreignAssignment).toMatchObject({ searchPathId: null, payNotPublished: false });
    expect(scanCandidateDecision([band], foreign)).toBe("skip");
    expect(scanOpeningAcceptance([band], foreign, [])).toBe("skip");
    expect(scanCandidateDecision([band], { location: "Pune", payLow: null, payHigh: null, currency: "" })).toBe("review");
    expect(showPayNotPublished({ searchPathId: null, payLow: null, payHigh: null, payProvenance: "posting" }, true)).toBe(false);
    expect(showPayNotPublished({ searchPathId: null, payLow: null, payHigh: null, salaryText: "$120,000" }, true)).toBe(false);
  });

  it("uses sort order, then id, and keeps the no-path lane", () => {
    const later = makePath({ id: "b", sortOrder: 1, locationMode: "cities", cities: ["Pune"], payMin: 1, payMax: 1e9 });
    const earlier = makePath({ id: "a", sortOrder: 0, locationMode: "cities", cities: ["Pune"], payMin: 30, payMax: 80 });
    const tieHigh = makePath({ id: "m", sortOrder: 0, locationMode: "cities", cities: ["Pune"], payMin: 1, payMax: 1e9 });
    const tieLow = makePath({ id: "c", sortOrder: 0, locationMode: "cities", cities: ["Pune"], payMin: 1, payMax: 1e9 });
    expect(firstOrderedMatch([later, earlier], { location: "Pune", payLow: 4_000_000, payHigh: 4_000_000, currency: "INR" })?.id).toBe("a");
    expect(firstOrderedMatch([tieHigh, tieLow], { location: "Pune", payLow: 4_000_000, payHigh: 4_000_000, currency: "INR" })?.id).toBe("c");

    const preferences = prefs();
    const assigned = assignSearchPath({ location: "Pune, India", payLow: 3_500_000, payHigh: 4_500_000, currency: "INR", paths: [], preferences });
    expect(assigned).toEqual({
      searchPathId: null,
      lane: laneFor("Pune, India", 3_500_000, 4_500_000, preferences),
      payNotPublished: false,
    });
    const unknown = assignSearchPath({
      location: "Pune, India",
      payLow: null,
      payHigh: null,
      currency: "INR",
      paths: [earlier],
      preferences,
    });
    expect(unknown.payNotPublished).toBe(true);
    expect(showPayNotPublished({ searchPathId: null, payLow: null, payHigh: null, archivedAt: null }, true)).toBe(true);
    expect(showPayNotPublished({ searchPathId: null, payLow: null, payHigh: null, archivedAt: null }, false)).toBe(false);
    expect(matchesPathFilter({ searchPathId: null, lane: "" }, UNASSIGNED_PATH_FILTER, true)).toBe(true);
    expect(matchesPathFilter({ searchPathId: "a", lane: earlier.name }, UNASSIGNED_PATH_FILTER, true)).toBe(false);
  });

  it("suggests one path per city plus remote, capped at six, with INR default and a pay band", () => {
    const suggested = suggestSearchPaths(prefs({ cities: ["Pune", "Bengaluru"], minSalary: 30, maxSalary: 50 }));
    expect(suggested.map((path) => searchPathLabel(path))).toEqual([
      "Pune · ₹30–₹50 LPA",
      "Bengaluru · ₹30–₹50 LPA",
      "Remote · ₹30–₹50 LPA",
    ]);
    expect(suggested[0]?.currency).toBe("INR");
    expect(suggested[0]?.cities).toEqual(["Pune"]);
    const many = suggestSearchPaths(prefs({
      cities: ["Pune", "Mumbai", "Delhi", "Chennai", "Hyderabad", "Kolkata"],
      remoteOk: true,
      minSalary: null,
      maxSalary: null,
    }));
    expect(many).toHaveLength(6);
    expect(many.filter((path) => path.locationMode === "cities")).toHaveLength(5);
    expect(many.at(-1)?.locationMode).toBe("remote");
    expect(many[0]?.payMin).toBe(1);
    expect(many[0]?.payMax).toBe(1_000_000_000);
    const london = suggestSearchPaths(prefs({
      country: "GB",
      cities: ["London"],
      remoteOk: false,
      currency: "GBP",
      minSalary: 80_000,
      maxSalary: 120_000,
      salaryPeriod: "year",
    }));
    expect(searchPathLabel(london[0]!)).toBe("London · £80,000–£120,000 per year");
    const inrDefault = suggestSearchPaths(prefs({ currency: "", cities: ["Pune"], remoteOk: false, minSalary: 20, maxSalary: 40 }));
    expect(inrDefault[0]?.currency).toBe("INR");
  });

  it("rejects an invalid path and a seventh path", () => {
    expect(validateSearchPathDraft(draft({ cities: [] }))).toMatch(/city/i);
    expect(validateSearchPathDraft(draft({ locationMode: "remote", cities: ["Pune"] }))).toMatch(/remote/i);
    expect(validateSearchPathDraft(draft({ locationMode: "country", cities: ["Pune"], excludedCities: [] }))).toMatch(/exclus/i);
    expect(validateSearchPathDraft(draft({ payMin: 0, payMax: 50 }))).toMatch(/minimum/i);
    expect(validateSearchPathDraft(draft({ payMin: 50, payMax: 50 }))).toMatch(/maximum/i);
    expect(validateSearchPathDraft(draft({ currency: "XXX" }))).toMatch(/currency/i);
    expect(validateSearchPathDraft(draft({ currency: "USD", salaryPeriod: "lpa" }))).toMatch(/INR/);
    expect(draftWithPeriod(draft({ currency: "USD", salaryPeriod: "year" }), "lpa")).toMatchObject({ currency: "INR", salaryPeriod: "lpa" });
    expect(draftWithCurrency(draft({ currency: "INR", salaryPeriod: "lpa" }), "GBP")).toMatchObject({ currency: "GBP", salaryPeriod: "year" });
    expect(shouldPersistSearchPaths("paths", "confirm")).toBe(true);
    expect(shouldPersistSearchPaths("paths", "market")).toBe(false);
    expect(shouldPersistSearchPaths("market", "paths")).toBe(false);
    expect(parsePathCommit({ action: "create", disposition: "move", draft: draft() }).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, index) => makePath({
      id: `p${index}`,
      sortOrder: index,
      locationMode: "cities",
      cities: [`City${index}`],
      payMin: 1,
      payMax: 1e9,
    }));
    const extra = nextPathSet(six, { action: "create", draft: draft({ cities: ["Noida"], sortOrder: 6 }), disposition: "reclassify" }, ["new"]);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error).toMatch(/6/);
  });
});

describe("job disposition", () => {
  const pune = makePath({ id: "pune", sortOrder: 0, locationMode: "cities", cities: ["Pune"], payMin: 50, payMax: 100 });
  const remote = makePath({ id: "remote", sortOrder: 1, locationMode: "remote", payMin: 1, payMax: 1e9 });
  const preferences = prefs();

  it("reclassifies onto the first remaining match, archives the rest, and restores a later match", () => {
    const jobs = [
      tracked({ id: "high", payLow: 6_000_000, payHigh: 6_000_000, searchPathId: "pune", lane: pune.name }),
      tracked({ id: "low", payLow: 2_000_000, payHigh: 2_000_000, searchPathId: "pune", lane: pune.name }),
      tracked({ id: "remote-job", location: "Remote", payLow: null, payHigh: null, searchPathId: "remote", lane: remote.name }),
    ];
    const archived = planJobChanges({
      jobs,
      after: [remote],
      disposition: "reclassify",
      deletedId: "pune",
      moveToId: null,
      now: "2026-10-14T12:00:00Z",
      preferences,
    });
    expect(archived.find((change) => change.id === "high")).toMatchObject({ searchPathId: null, lane: pune.name, archivedAt: "2026-10-14T12:00:00Z" });
    expect(archived.find((change) => change.id === "remote-job")).toMatchObject({ searchPathId: null, archivedAt: "2026-10-14T12:00:00Z" });
    const restored = planJobChanges({
      jobs: jobs.map((job) => (job.id === "low" ? { ...job, searchPathId: null, archivedAt: "2026-10-14T12:00:00Z" } : job)),
      after: [pune, remote, makePath({ id: "wide", sortOrder: 2, locationMode: "cities", cities: ["Pune"], payMin: 1, payMax: 1e9 })],
      disposition: "reclassify",
      deletedId: null,
      moveToId: null,
      now: "2026-10-14T13:00:00Z",
      preferences,
    });
    expect(restored.find((change) => change.id === "low")).toMatchObject({ searchPathId: "wide", archivedAt: null });
  });

  it("moves every job on a deleted path, or archives while keeping the label", () => {
    const jobs = [tracked({ id: "remote-job", location: "Remote", searchPathId: "remote", lane: remote.name, payLow: 2_000_000, payHigh: 2_000_000 })];
    const moved = planJobChanges({
      jobs,
      after: [pune],
      disposition: "move",
      deletedId: "remote",
      moveToId: "pune",
      now: "2026-10-14T12:00:00Z",
      preferences,
    });
    expect(moved).toEqual([{ id: "remote-job", searchPathId: "pune", lane: pune.name, archivedAt: null }]);
    const keptArchive = planJobChanges({
      jobs: [{ ...jobs[0]!, archivedAt: "2026-10-01T00:00:00Z" }],
      after: [pune],
      disposition: "move",
      deletedId: "remote",
      moveToId: "pune",
      now: "2026-10-14T12:00:00Z",
      preferences,
    });
    expect(keptArchive).toEqual([{ id: "remote-job", searchPathId: "pune", lane: pune.name, archivedAt: "2026-10-01T00:00:00Z" }]);
    const kept = planJobChanges({
      jobs,
      after: [pune],
      disposition: "archive",
      deletedId: "remote",
      moveToId: null,
      now: "2026-10-14T12:00:00Z",
      preferences,
    });
    expect(kept[0]).toMatchObject({ searchPathId: null, lane: remote.name, archivedAt: "2026-10-14T12:00:00Z" });
  });

  it("packs scan matches and unknown pay, skips a known miss, and leaves people without paths alone", () => {
    const job = { location: "Pune", payLow: 4_000_000, payHigh: 4_000_000, currency: "INR" };
    expect(scanOpeningAcceptance([pune], job, [])).toBe("skip");
    expect(scanOpeningAcceptance([pune], { ...job, payLow: 6_000_000, payHigh: 6_000_000 }, ["salary"])).toBe("pack");
    expect(scanOpeningAcceptance([pune], { ...job, payLow: null, payHigh: null }, [])).toBe("pack");
    expect(scanOpeningAcceptance([pune], { location: "Hyderabad", payLow: 9_000_000, payHigh: 9_000_000, currency: "INR" }, [])).toBe("skip");
    expect(scanOpeningAcceptance([], job, [])).toBe("pack");
    expect(scanOpeningAcceptance([], job, ["location"])).toBe("skip");
    const manual = assignSearchPath({ ...job, payLow: 6_000_000, payHigh: 6_000_000, paths: [pune], preferences });
    expect(manual.searchPathId).toBe("pune");
    expect(manual.lane).toBe(pune.name);
  });

  it("hides archived jobs from today and shows them only in the archived pipeline group", () => {
    expect(jobInPipelineGroup({ status: "applied", archivedAt: "2026-10-14" }, "archived", ["applied"])).toBe(true);
    expect(jobInPipelineGroup({ status: "applied", archivedAt: "2026-10-14" }, "applied", ["applied"])).toBe(false);
    expect(jobInPipelineGroup({ status: "applied", archivedAt: null }, "applied", ["applied"])).toBe(true);
    const archived = { id: "a", status: "evaluated", archivedAt: "2026-10-14", fit: { imported: false, decision: "apply", score: 80 } } as JobRecord;
    const open = { ...archived, id: "b", archivedAt: null } as JobRecord;
    const queues = todayQueues([archived, open], "2026-10-14");
    expect(queues.applyNext.map((job) => job.id)).toEqual(["b"]);
  });

  it("restores with the old lane when no paths remain, and does not archive an active job that still has no path", () => {
    const active = tracked({ searchPathId: null, lane: "", payLow: null, payHigh: null });
    const assigned = tracked({ searchPathId: "pune", lane: pune.name, payLow: 1_000_000, payHigh: 1_000_000 });
    expect(planJobPathAction("reclassify", active, [pune], preferences).kind).toBe("unchanged");
    expect(planJobPathAction("reclassify", assigned, [pune], preferences)).toMatchObject({ kind: "archive", lane: pune.name });
    expect(planJobPathAction("restore", assigned, [], preferences)).toMatchObject({
      kind: "legacy",
      lane: laneFor(assigned.location, assigned.payLow, assigned.payHigh, preferences),
    });
    expect(rescorePathFields({ archivedAt: "2026-10-01", lane: "Pune · ₹50–₹100 LPA", searchPathId: "pune" }, { searchPathId: null, lane: "" })).toEqual({
      lane: "Pune · ₹50–₹100 LPA",
      searchPathId: "pune",
    });
    expect(rescorePathFields({ archivedAt: null, lane: "old", searchPathId: "pune" }, { searchPathId: null, lane: "" })).toEqual({
      lane: "",
      searchPathId: null,
    });
  });
});

describe("search path storage", () => {
  it("enforces six paths, ownership, and archive, move, and reclassify", async () => {
    const proxy = await freshPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const userId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    const preferences = prefs();
    try {
      await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").bind(userId, `${userId}@example.com`).run();
      await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").bind(otherId, `${otherId}@example.com`).run();
      let paths: SearchPath[] = [];
      for (let index = 0; index < 6; index += 1) {
        const period: SalaryPeriod = index === 5 ? "year" : "lpa";
        paths = await commitSearchPaths(db, userId, preferences, {
          action: "create",
          disposition: "reclassify",
          draft: draft({
            cities: [index === 5 ? "London" : `City${index}`],
            currency: index === 5 ? "GBP" : "INR",
            salaryPeriod: period,
            payMin: index === 5 ? 80_000 : 30,
            payMax: index === 5 ? 120_000 : 50,
            sortOrder: index,
          }),
        });
      }
      expect(paths).toHaveLength(6);
      expect(paths[0]?.revision).toBe(5);
      expect(paths[5]?.revision).toBe(0);
      await expect(commitSearchPaths(db, userId, preferences, {
        action: "create",
        disposition: "reclassify",
        draft: draft({ cities: ["Noida"], sortOrder: 6 }),
      })).rejects.toThrow(/6/);
      await expect(db.prepare(
        "INSERT INTO search_paths (id, user_id, name, location_mode, cities_json, excluded_cities_json, pay_min, pay_max, currency, salary_period, sort_order) VALUES (?, ?, 'Extra', 'cities', ?, '[]', 1, 2, 'INR', 'lpa', 9)",
      ).bind(crypto.randomUUID(), userId, JSON.stringify(["Noida"])).run()).rejects.toThrow(/search path limit/);

      const owned = paths[0];
      expect(owned).toBeTruthy();
      await expect(commitSearchPaths(db, otherId, preferences, {
        action: "update",
        id: owned!.id,
        disposition: "reclassify",
        draft: draft({ cities: ["Stolen"] }),
      })).rejects.toThrow(/not found/);

      const pune = await commitSearchPaths(db, otherId, preferences, {
        action: "create",
        disposition: "reclassify",
        draft: draft({ cities: ["Pune"], payMin: 50, payMax: 100 }),
      });
      const remote = await commitSearchPaths(db, otherId, preferences, {
        action: "create",
        disposition: "reclassify",
        draft: draft({ locationMode: "remote", cities: [], excludedCities: [], payMin: 1, payMax: 1e9, sortOrder: 1 }),
      });
      const puneId = pune[0]!.id;
      const remoteId = remote[1]!.id;
      await db.prepare(
        "INSERT INTO jobs (id, user_id, title, location, description, fit_json, lane, pay_low, pay_high, search_path_id) VALUES (?, ?, 'Role', 'Pune', 'A long enough description for the row.', '{}', ?, 2000000, 2000000, ?)",
      ).bind(`${otherId}-low`, otherId, pune[0]!.name, puneId).run();
      await db.prepare(
        "INSERT INTO jobs (id, user_id, title, location, description, fit_json, lane, pay_low, pay_high, search_path_id, archived_at) VALUES (?, ?, 'Role', 'Remote', 'A long enough description for the row.', '{}', ?, 2000000, 2000000, ?, ?)",
      ).bind(`${otherId}-remote`, otherId, remote[1]!.name, remoteId, "2026-10-01T00:00:00.000Z").run();

      const moved = await commitSearchPaths(db, otherId, preferences, {
        action: "delete",
        id: remoteId,
        disposition: "move",
        moveToId: puneId,
      });
      expect(moved.map((path) => path.id)).toEqual([puneId]);
      const remoteJob = await db.prepare("SELECT lane, search_path_id, archived_at FROM jobs WHERE id = ?").bind(`${otherId}-remote`).first<{ lane: string; search_path_id: string | null; archived_at: string | null }>();
      expect(remoteJob).toMatchObject({ lane: pune[0]!.name, search_path_id: puneId, archived_at: "2026-10-01T00:00:00.000Z" });

      const stale = await listSearchPaths(db, userId);
      await db.prepare("UPDATE search_paths SET revision = revision + 1 WHERE user_id = ?").bind(userId).run();
      await expect(db.batch([searchPathRevisionGuard(db, userId, stale)])).rejects.toThrow();
      await expect(db.batch([searchPathRevisionGuard(db, userId, [])])).rejects.toThrow();
      const fresh = await listSearchPaths(db, userId);
      await db.batch([searchPathRevisionGuard(db, userId, fresh)]);

      const archived = await commitSearchPaths(db, otherId, preferences, {
        action: "delete",
        id: puneId,
        disposition: "archive",
        moveToId: null,
      });
      expect(archived).toEqual([]);
      const low = await db.prepare("SELECT lane, search_path_id, archived_at FROM jobs WHERE id = ?").bind(`${otherId}-low`).first<{ lane: string; search_path_id: string | null; archived_at: string | null }>();
      expect(low?.lane).toBe(pune[0]!.name);
      expect(low?.search_path_id).toBeNull();
      expect(low?.archived_at).toBeTruthy();

      const restored = await commitSearchPaths(db, otherId, preferences, {
        action: "create",
        disposition: "reclassify",
        draft: draft({ cities: ["Pune"], payMin: 1, payMax: 1e9 }),
      });
      const back = await db.prepare("SELECT search_path_id, archived_at FROM jobs WHERE id = ?").bind(`${otherId}-low`).first<{ search_path_id: string | null; archived_at: string | null }>();
      expect(back).toEqual({ search_path_id: restored[0]!.id, archived_at: null });
    } finally {
      await db.prepare("DELETE FROM jobs WHERE user_id IN (?, ?)").bind(userId, otherId).run();
      await db.prepare("DELETE FROM search_paths WHERE user_id IN (?, ?)").bind(userId, otherId).run();
      await db.prepare("DELETE FROM users WHERE id IN (?, ?)").bind(userId, otherId).run();
      await proxy.dispose();
    }
  }, 60_000);
});
