import { describe, expect, it } from "vitest";
import greenhouseJobs from "./fixtures/greenhouse-jobs.json";
import recruiteeOffers from "./fixtures/recruitee-offers.json";
import teamtailorRss from "./fixtures/teamtailor-jobs.rss?raw";
import migrationSql from "../migrations/0009_source_platform.sql?raw";
import { adapterEnabled, complianceFor } from "../shared/commercial";
import { detectBoard } from "../shared/engine/boards";
import { employerKey } from "../shared/engine/catalog";
import { FEATURED_MARKET_CODES } from "../shared/geo";
import {
  ashbyBoardUrl,
  publicJobUrl,
  greenhouseJobsUrl,
  leverPostingsUrl,
  parseAshbyJobs,
  parseGreenhouseJobs,
  parseLeverPostings,
  parseRecruiteeOffers,
  parseSmartRecruitersPostings,
  parseTeamtailorFeed,
  parseWorkableJobs,
  parseWorkdayPostings,
  recognizedListingPayload,
  recruiteeOffersUrl,
  smartRecruitersPageUrl,
  teamtailorFeedUrl,
  workableWidgetUrl,
  workdayJobsUrl,
} from "../shared/engine/listings";
import { industryCatalogCoverage, industryEmployerCatalog, sourceCatalog } from "../shared/engine/sourceCatalog";
import {
  callablePublicFeed,
  canonicalJobUrl,
  dedupeOpenings,
  hostedSlug,
  isExpired,
  keyedPublicFeedRequest,
  licensedProviderClient,
  liveListingAts,
  openingDedupKey,
  PUBLIC_FEEDS,
  SOURCES,
} from "../shared/engine/sources";

describe("source registry", () => {
  it("keeps the original readers live and leaves portals without a public API unscanned", () => {
    const live = liveListingAts();
    expect(live).toEqual(expect.arrayContaining(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "teamtailor", "recruitee"]));
    for (const id of ["icims", "oracle_recruiting", "successfactors", "public_feed", "licensed", "aggregator", "website"] as const) {
      expect(SOURCES[id].listing).toBe("none");
      expect(adapterEnabled(id)).toBe(false);
    }
    expect(complianceFor("greenhouse")).toBe("public_api");
    expect(complianceFor("workday")).toBe("public_site");
    expect(complianceFor("teamtailor")).toBe("public_feed");
    expect(complianceFor("icims")).toBe("paste_only");
    expect(complianceFor("aggregator")).toBe("partnership_required");
    expect(adapterEnabled("teamtailor")).toBe(true);
    expect(adapterEnabled("website")).toBe(false);
  });

  it("registers government feeds without calling any of them", () => {
    expect(PUBLIC_FEEDS.map((feed) => feed.countries[0])).toEqual(expect.arrayContaining([...FEATURED_MARKET_CODES]));
    for (const feed of PUBLIC_FEEDS) {
      expect(feed.listing).not.toBe("live");
      expect(feed.feedUrl).toBeNull();
      expect(callablePublicFeed(feed.id)).toBeNull();
    }
    const usajobs = keyedPublicFeedRequest("usajobs", "not-a-real-key");
    expect(usajobs.called).toBe(false);
    expect(usajobs.reason).toContain("No request was sent");
    expect(licensedProviderClient("reserved")).toBeNull();
  });
});

describe("board detection", () => {
  it("keeps the existing public board addresses", () => {
    expect(detectBoard("https://job-boards.greenhouse.io/anthropic/jobs/4461450008")).toMatchObject({
      ats: "greenhouse",
      token: "anthropic",
      careerUrl: "https://boards.greenhouse.io/anthropic",
    });
    expect(detectBoard("https://jobs.lever.co/palantir/abc")?.careerUrl).toBe("https://jobs.lever.co/palantir");
    expect(detectBoard("https://jobs.ashbyhq.com/openai")?.ats).toBe("ashby");
    expect(detectBoard("https://apply.workable.com/acme/j/1")?.ats).toBe("workable");
    expect(detectBoard("https://jobs.smartrecruiters.com/Visa/1")?.token).toBe("Visa");
    expect(detectBoard("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x")?.ats).toBe("workday");
  });

  it("reads Teamtailor and Recruitee hosts and refuses lookalike vendor sites", () => {
    expect(detectBoard("https://example.teamtailor.com/jobs/17-product-engineer")).toMatchObject({
      ats: "teamtailor",
      token: "example",
      careerUrl: "https://example.teamtailor.com",
    });
    expect(detectBoard("https://example-co.recruitee.com/o/customer-success-manager")?.ats).toBe("recruitee");
    expect(detectBoard("https://www.teamtailor.com/jobs")?.ats).toBe("website");
    expect(detectBoard("https://careers.example.com/jobs.rss")?.ats).toBe("website");
  });

  it("recognizes portals and job boards it does not scan", () => {
    expect(detectBoard("https://careers-acme.icims.com/jobs/1709/engineer/job")?.ats).toBe("icims");
    expect(detectBoard("https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1")?.ats).toBe("oracle_recruiting");
    expect(detectBoard("https://www.oracle.com/in/careers/")?.ats).toBe("website");
    expect(detectBoard("https://career5.successfactors.com/career?company=acme")?.ats).toBe("successfactors");
    expect(detectBoard("https://jobs.sap.com/search/")?.ats).toBe("website");
    expect(detectBoard("https://www.linkedin.com/jobs/view/1")).toMatchObject({ ats: "aggregator", nameHint: "LinkedIn" });
    expect(detectBoard("https://in.indeed.com/viewjob?jk=1")?.nameHint).toBe("Indeed");
    expect(detectBoard("https://www.naukri.com/job-listings-1")?.nameHint).toBe("Naukri");
    expect(detectBoard("https://www.seek.com.au/job/1")?.nameHint).toBe("SEEK");
  });
});

describe("listing parsers", () => {
  it("keeps the Greenhouse, Lever, Ashby, Workable, SmartRecruiters, and Workday field mapping", () => {
    const greenhouse = parseGreenhouseJobs(greenhouseJobs);
    expect(greenhouse[0]).toMatchObject({ externalId: "4461450008", title: "Research Engineer", location: "London", description: "Build careful systems." });
    const lever = parseLeverPostings([{
      id: "abc",
      text: "Engineer",
      hostedUrl: "https://jobs.lever.co/palantir/abc",
      categories: { location: "New York" },
      descriptionPlain: "Build.",
      lists: [{ text: "Must", content: "<p>SQL</p>" }],
    }]);
    expect(lever[0]).toMatchObject({ externalId: "abc", location: "New York", description: "Build.\nMust\nSQL" });
    const ashby = parseAshbyJobs({ jobs: [{ id: "1", title: "Hidden", isListed: false }, { id: "2", title: "Shown", location: "Remote", descriptionPlain: "Yes" }] }, "https://jobs.ashbyhq.com/ramp");
    expect(ashby.map((job) => job.title)).toEqual(["Shown"]);
    expect(ashby[0]?.url).toBe("https://jobs.ashbyhq.com/ramp/2?embed=js");
    expect(publicJobUrl("https://jobs.ashbyhq.com/cursor/32350e7d-b6c8-4556-b8ba-3e58490f7cb7")).toBe(
      "https://jobs.ashbyhq.com/cursor/32350e7d-b6c8-4556-b8ba-3e58490f7cb7?embed=js",
    );
    expect(publicJobUrl("https://jobs.ashbyhq.com/cursor")).toBe("https://jobs.ashbyhq.com/cursor");
    expect(publicJobUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    const workable = parseWorkableJobs({ jobs: [{ shortcode: "AB", title: "Designer", location: { city: "Dublin" }, url: "https://apply.workable.com/acme/j/AB" }] });
    expect(workable[0]).toMatchObject({ externalId: "AB", location: "Dublin" });
    const smart = parseSmartRecruitersPostings([{ id: "9", name: "Analyst", location: { city: "Austin" }, ref: "https://jobs.smartrecruiters.com/Visa/9" }], "https://jobs.smartrecruiters.com/Visa");
    expect(smart[0]).toMatchObject({ title: "Analyst", location: "Austin", description: "" });
    const workday = parseWorkdayPostings([{ title: "Engineer", locationsText: "Santa Clara", externalPath: "/job/Santa-Clara/Engineer_R1" }], "https://nvidia.wd5.myworkdayjobs.com");
    expect(workday[0]).toMatchObject({ externalId: "Engineer_R1", url: "https://nvidia.wd5.myworkdayjobs.com/job/Santa-Clara/Engineer_R1" });
  });

  it("reads a Teamtailor RSS item and a Recruitee offer", () => {
    const jobs = parseTeamtailorFeed(teamtailorRss);
    expect(jobs[0]).toMatchObject({
      externalId: "tt-17",
      title: "Product Engineer",
      location: "Stockholm HQ / London, United Kingdom",
      url: "https://example.teamtailor.com/jobs/17-product-engineer",
      description: "Ship the public careers page.",
    });
    expect(jobs[1]?.location).toBe("Remote");
    const offers = parseRecruiteeOffers(recruiteeOffers);
    expect(offers[0]).toMatchObject({ externalId: "9001", location: "Amsterdam, Netherlands" });
    expect(offers[1]?.expiresAt).toBe("2020-01-01T00:00:00.000Z");
    expect(isExpired(offers[1]?.expiresAt, Date.parse("2026-10-14T00:00:00.000Z"))).toBe(true);
    expect(recognizedListingPayload("greenhouse", greenhouseJobs)).toBe(true);
    expect(recognizedListingPayload("greenhouse", { error: "down" })).toBe(false);
    expect(recognizedListingPayload("lever", [])).toBe(true);
    expect(recognizedListingPayload("teamtailor", teamtailorRss)).toBe(true);
    expect(recognizedListingPayload("teamtailor", "<html>nope</html>")).toBe(false);
    expect(recognizedListingPayload("website", {})).toBe(false);
  });

  it("builds the same public listing addresses the readers already used", () => {
    expect(greenhouseJobsUrl("anthropic")).toBe("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs");
    expect(leverPostingsUrl("palantir")).toBe("https://api.lever.co/v0/postings/palantir?mode=json");
    expect(ashbyBoardUrl("ramp")).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp");
    expect(workableWidgetUrl("acme")).toBe("https://apply.workable.com/api/v1/widget/accounts/acme");
    expect(smartRecruitersPageUrl("Visa", 0)).toBe("https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=100&offset=0");
    expect(workdayJobsUrl("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite").url)
      .toBe("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs");
    expect(teamtailorFeedUrl("Example", 100)).toBe("https://example.teamtailor.com/jobs.rss?offset=100&per_page=100");
    expect(recruiteeOffersUrl("example-co")).toBe("https://example-co.recruitee.com/api/offers/");
    expect(() => hostedSlug("evil.com")).toThrow(/not valid/);
  });
});

describe("canonical openings", () => {
  it("prefers employer plus requisition, then the canonical URL, then title and location", () => {
    const withId = openingDedupKey({
      employerKey: "greenhouse:anthropic",
      externalId: "4461450008",
      url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008?utm_source=newsletter",
      title: "Research Engineer",
      location: "London",
    });
    expect(withId.dedupKey).toBe("req:greenhouse:anthropic:4461450008");
    expect(withId.canonicalUrl).toBe("https://job-boards.greenhouse.io/anthropic/jobs/4461450008");
    const urlOnly = openingDedupKey({ employerKey: "lever:acme", externalId: "", url: "https://jobs.lever.co/acme/abc/", title: "Engineer", location: "NYC" });
    expect(urlOnly.dedupKey).toBe("url:https://jobs.lever.co/acme/abc");
    const titleOnly = openingDedupKey({ employerKey: "ashby:ramp", externalId: "", url: "", title: "Staff Engineer!", location: "New York, NY" });
    expect(titleOnly.dedupKey).toBe("title:ashby:ramp:staff engineer:new york ny");
    expect(canonicalJobUrl("https://Example.com/jobs/1/?b=2&utm_medium=email&a=1")).toBe("https://example.com/jobs/1?a=1&b=2");
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/cursor/abc?embed=js")).toBe("https://jobs.ashbyhq.com/cursor/abc");
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/cursor/abc")).toBe("https://jobs.ashbyhq.com/cursor/abc");
  });

  it("collapses the same requisition or the same URL and keeps two different requisitions", () => {
    const rows = [
      { externalId: "1", url: "https://boards.greenhouse.io/acme/jobs/1?utm_source=x", title: "Engineer", location: "London" },
      { externalId: "1", url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer", location: "London, UK" },
      { externalId: "2", url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer", location: "London" },
      { externalId: "3", url: "https://boards.greenhouse.io/acme/jobs/3", title: "Engineer", location: "London" },
    ];
    expect(dedupeOpenings("greenhouse:acme", rows).map((row) => row.externalId)).toEqual(["1", "3"]);
  });
});

describe("curated employer catalog", () => {
  it("covers the nine markets with verified public board URLs only", () => {
    const rows = sourceCatalog();
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.length).toBeLessThanOrEqual(400);
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (const row of rows) {
      expect(FEATURED_MARKET_CODES).toContain(row.country);
      const board = detectBoard(row.careerUrl);
      expect(board, row.careerUrl).not.toBeNull();
      expect(SOURCES[board!.ats].listing).toBe("live");
      const key = employerKey(row.careerUrl);
      expect(key).toBeTruthy();
      expect(seen.has(key!)).toBe(false);
      seen.add(key!);
      counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
    }
    for (const country of FEATURED_MARKET_CODES) expect(counts.get(country) ?? 0).toBeGreaterThanOrEqual(2);
    const migration = migrationSql;
    for (const id of Object.keys(SOURCES)) {
      if (id === "greenhouse" || id === "lever" || id === "ashby" || id === "workable" || id === "smartrecruiters" || id === "workday" || id === "website") continue;
      expect(migration).toContain(`'${id}'`);
    }
  });

  it("covers every onboarding industry in the employer pool", () => {
    expect(industryEmployerCatalog().length).toBeGreaterThanOrEqual(40);
    for (const row of industryCatalogCoverage()) {
      expect(row.pool, row.industry).toBeGreaterThanOrEqual(1);
    }
  });
});
