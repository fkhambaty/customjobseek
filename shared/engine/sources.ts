import type { Ats } from "./boards";
import { FEATURED_MARKET_CODES, type FeaturedMarketCode } from "../geo";

export type SourceCapability =
  | "detect"
  | "list_openings"
  | "fetch_posting"
  | "paste_link"
  | "partnership"
  | "manual_review";

export type SourceCompliance =
  | "public_api"
  | "public_feed"
  | "public_site"
  | "paste_only"
  | "partnership_required"
  | "credential_required"
  | "not_crawled";

export type SourceListing = "live" | "none";

export interface SourceDefinition {
  id: Ats;
  label: string;
  capabilities: readonly SourceCapability[];
  compliance: SourceCompliance;
  /** Empty means the reader is not limited to one country. */
  countries: readonly string[];
  /** Hours between refreshes when listing is live. Null when this source is not scanned. */
  freshnessHours: number | null;
  listing: SourceListing;
  notes: string;
  savedNote: string;
}

const LIVE = ["detect", "list_openings", "fetch_posting"] as const satisfies readonly SourceCapability[];
const LIST_ONLY = ["detect", "list_openings"] as const satisfies readonly SourceCapability[];
const PASTE = ["detect", "paste_link", "manual_review"] as const satisfies readonly SourceCapability[];

export const SOURCES = {
  greenhouse: {
    id: "greenhouse",
    label: "Greenhouse",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Public Greenhouse job board. No login.",
    savedNote: "",
  },
  lever: {
    id: "lever",
    label: "Lever",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Public Lever job board. No login.",
    savedNote: "",
  },
  ashby: {
    id: "ashby",
    label: "Ashby",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Public Ashby job board. No login.",
    savedNote: "",
  },
  workable: {
    id: "workable",
    label: "Workable",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Public Workable job board. No login.",
    savedNote: "",
  },
  smartrecruiters: {
    id: "smartrecruiters",
    label: "SmartRecruiters",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Public SmartRecruiters job board. No login.",
    savedNote: "",
  },
  workday: {
    id: "workday",
    label: "Workday",
    capabilities: LIST_ONLY,
    compliance: "public_site",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "The company's public Workday career site. No login. The list endpoint does not include the full description.",
    savedNote: "",
  },
  teamtailor: {
    id: "teamtailor",
    label: "Teamtailor",
    capabilities: LIVE,
    compliance: "public_feed",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Documented public RSS at /jobs.rss. No API key. Pages of 100, up to 500 openings. Custom domains are not guessed.",
    savedNote: "",
  },
  recruitee: {
    id: "recruitee",
    label: "Recruitee",
    capabilities: LIVE,
    compliance: "public_api",
    countries: [],
    freshnessHours: 6,
    listing: "live",
    notes: "Documented careers-site API at /api/offers/. No key today. Recruitee says unauthenticated calls stop on 10 February 2027. A 401 is a failed read, not an empty board.",
    savedNote: "",
  },
  icims: {
    id: "icims",
    label: "iCIMS",
    capabilities: PASTE,
    compliance: "paste_only",
    countries: [],
    freshnessHours: null,
    listing: "none",
    notes: "The iCIMS job API needs the employer's own credentials. The public portal HTML is not a stable listing contract, so it is not scraped.",
    savedNote: "iCIMS needs the employer's API credentials. The portal was recognized and not scanned. Paste one job's description, or the employer's own posting.",
  },
  oracle_recruiting: {
    id: "oracle_recruiting",
    label: "Oracle Recruiting",
    capabilities: PASTE,
    compliance: "paste_only",
    countries: [],
    freshnessHours: null,
    listing: "none",
    notes: "Oracle documents recruitingCEJobRequisitions as internal-only. Calling it would need a site number scraped from the page. That is not a stable public API.",
    savedNote: "Oracle Recruiting was recognized and not scanned. Its candidate-experience API is for Oracle's own use. Paste the job description.",
  },
  successfactors: {
    id: "successfactors",
    label: "SAP SuccessFactors",
    capabilities: PASTE,
    compliance: "paste_only",
    countries: [],
    freshnessHours: null,
    listing: "none",
    notes: "SuccessFactors OData needs the tenant's credentials. Search pages differ by tenant, so they are not scraped.",
    savedNote: "SAP SuccessFactors was recognized and not scanned. There is no single public listing API. Paste the job description.",
  },
  public_feed: {
    id: "public_feed",
    label: "Public feed",
    capabilities: ["detect", "manual_review"],
    compliance: "credential_required",
    countries: [...FEATURED_MARKET_CODES],
    freshnessHours: null,
    listing: "none",
    notes: "Official government feeds are registered one by one. None is called unless that feed is marked live with a real address.",
    savedNote: "This public feed is registered and not called. No open listing address is connected for it.",
  },
  licensed: {
    id: "licensed",
    label: "Licensed provider",
    capabilities: ["partnership"],
    compliance: "partnership_required",
    countries: [...FEATURED_MARKET_CODES],
    freshnessHours: null,
    listing: "none",
    notes: "Reserved for a future licensed jobs contract. No provider is connected.",
    savedNote: "No licensed jobs provider is connected.",
  },
  aggregator: {
    id: "aggregator",
    label: "Job board",
    capabilities: ["detect", "paste_link", "partnership"],
    compliance: "partnership_required",
    countries: [...FEATURED_MARKET_CODES],
    freshnessHours: null,
    listing: "none",
    notes: "Protected job boards are not scraped. A partnership or a pasted employer posting is the path.",
    savedNote: "This is a job board we don't read. A partnership would be required to take its feed. Paste the employer's own career page, or paste the job description.",
  },
  website: {
    id: "website",
    label: "Company website",
    capabilities: ["paste_link"],
    compliance: "not_crawled",
    countries: [],
    freshnessHours: null,
    listing: "none",
    notes: "Ordinary company websites are not crawled.",
    savedNote: "The page was saved and is not crawled. If it is a Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Teamtailor, or Recruitee board, paste that board link.",
  },
} as const satisfies Record<Ats, SourceDefinition>;

export function sourceById(id: Ats): SourceDefinition {
  return SOURCES[id];
}

export function isAts(value: string): value is Ats {
  return Object.hasOwn(SOURCES, value);
}

export function liveListingAts(): Ats[] {
  return (Object.keys(SOURCES) as Ats[]).filter((id) => SOURCES[id].listing === "live");
}

export const DISCOVER_COVERAGE =
  "Openings here come from public career boards already read: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Teamtailor, and Recruitee. iCIMS, Oracle Recruiting, and SAP SuccessFactors are recognized and not scanned. LinkedIn, Indeed, Naukri, SEEK and other job boards are not read — paste the employer's posting.";

export function sourceLabel(ats: string): string {
  return isAts(ats) ? SOURCES[ats].label : ats;
}

export function capabilityPhrase(source: SourceDefinition): string {
  if (source.listing === "live") return "Reads public openings";
  if (source.capabilities.includes("partnership")) return "Partnership or a pasted link";
  if (source.capabilities.includes("paste_link")) return "Paste a link; not scanned";
  return "Not scanned";
}

export function freshnessPhrase(source: SourceDefinition): string {
  if (source.freshnessHours == null) return "Not refreshed";
  return `About every ${source.freshnessHours} hours`;
}

export type SourceHealth = "ok" | "failing" | "unscanned" | "not_scanned";

export function healthPhrase(listing: SourceListing, lastOkAt: string | null, failures: number): SourceHealth {
  if (listing !== "live") return "not_scanned";
  if (failures >= 5) return "failing";
  if (lastOkAt) return "ok";
  return "unscanned";
}

export function healthLabel(health: SourceHealth): string {
  switch (health) {
    case "ok":
      return "Healthy";
    case "failing":
      return "Failing";
    case "unscanned":
      return "No reads yet";
    case "not_scanned":
      return "Not scanned";
    default: {
      const unexpected: never = health;
      return unexpected;
    }
  }
}

export interface ProtectedAggregator {
  id: string;
  label: string;
  hosts: readonly string[];
  countries: readonly FeaturedMarketCode[];
}

export const PROTECTED_AGGREGATORS: readonly ProtectedAggregator[] = [
  { id: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"], countries: [...FEATURED_MARKET_CODES] },
  { id: "indeed", label: "Indeed", hosts: ["indeed.com", "indeed.co.uk", "indeed.co.in", "indeed.ca", "indeed.com.au", "indeed.ie", "indeed.co.za", "indeed.co.nz", "indeed.sg"], countries: [...FEATURED_MARKET_CODES] },
  { id: "naukri", label: "Naukri", hosts: ["naukri.com"], countries: ["IN"] },
  { id: "foundit", label: "Foundit", hosts: ["foundit.in", "foundit.sg"], countries: ["IN", "SG"] },
  { id: "shine", label: "Shine", hosts: ["shine.com"], countries: ["IN"] },
  { id: "instahyre", label: "Instahyre", hosts: ["instahyre.com"], countries: ["IN"] },
  { id: "hirist", label: "Hirist", hosts: ["hirist.com", "hirist.tech"], countries: ["IN"] },
  { id: "iimjobs", label: "iimjobs", hosts: ["iimjobs.com"], countries: ["IN"] },
  { id: "timesjobs", label: "TimesJobs", hosts: ["timesjobs.com"], countries: ["IN"] },
  { id: "cutshort", label: "Cutshort", hosts: ["cutshort.io"], countries: ["IN"] },
  { id: "glassdoor", label: "Glassdoor", hosts: ["glassdoor.com", "glassdoor.co.in", "glassdoor.co.uk", "glassdoor.ca", "glassdoor.com.au", "glassdoor.ie", "glassdoor.co.nz", "glassdoor.co.za", "glassdoor.sg"], countries: [...FEATURED_MARKET_CODES] },
  { id: "seek", label: "SEEK", hosts: ["seek.com.au", "seek.co.nz"], countries: ["AU", "NZ"] },
  { id: "reed", label: "Reed", hosts: ["reed.co.uk"], countries: ["GB"] },
  { id: "totaljobs", label: "Totaljobs", hosts: ["totaljobs.com"], countries: ["GB"] },
  { id: "cwjobs", label: "CWJobs", hosts: ["cwjobs.co.uk"], countries: ["GB"] },
  { id: "irishjobs", label: "IrishJobs", hosts: ["irishjobs.ie"], countries: ["IE"] },
  { id: "jobsie", label: "Jobs.ie", hosts: ["jobs.ie"], countries: ["IE"] },
  { id: "pnet", label: "PNet", hosts: ["pnet.co.za"], countries: ["ZA"] },
  { id: "careers24", label: "Careers24", hosts: ["careers24.com"], countries: ["ZA"] },
  { id: "jobstreet", label: "Jobstreet", hosts: ["jobstreet.com", "jobstreet.com.sg"], countries: ["SG"] },
  { id: "jobsdb", label: "Jobsdb", hosts: ["jobsdb.com"], countries: ["SG"] },
  { id: "ziprecruiter", label: "ZipRecruiter", hosts: ["ziprecruiter.com"], countries: ["US"] },
  { id: "monster", label: "Monster", hosts: ["monster.com", "monster.co.uk", "monster.ca", "monster.co.in", "monster.co.za"], countries: ["US", "GB", "CA", "IN", "ZA"] },
  { id: "simplyhired", label: "SimplyHired", hosts: ["simplyhired.com", "simplyhired.co.uk", "simplyhired.ca"], countries: ["US", "GB", "CA"] },
  { id: "wellfound", label: "Wellfound", hosts: ["wellfound.com"], countries: ["US"] },
  { id: "workopolis", label: "Workopolis", hosts: ["workopolis.com"], countries: ["CA"] },
  { id: "adzuna", label: "Adzuna", hosts: ["adzuna.com", "adzuna.co.uk", "adzuna.com.au", "adzuna.ca", "adzuna.co.nz", "adzuna.co.za", "adzuna.sg"], countries: ["US", "GB", "AU", "CA", "NZ", "ZA", "SG"] },
];

export function aggregatorForHost(host: string): ProtectedAggregator | null {
  const name = host.toLowerCase();
  for (const board of PROTECTED_AGGREGATORS) {
    if (board.hosts.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) return board;
  }
  return null;
}

export type PublicFeedAccess = "open_rss" | "api_key" | "not_automated";
export type PublicFeedListing = "live" | "credential_required" | "not_automated";

export interface PublicFeedDefinition {
  id: string;
  name: string;
  countries: readonly FeaturedMarketCode[];
  access: PublicFeedAccess;
  documentationUrl: string;
  feedUrl: string | null;
  listing: PublicFeedListing;
  notes: string;
}

/** Official services. A feed is callable only when listing is live and feedUrl is set. None are, today. */
export const PUBLIC_FEEDS: readonly PublicFeedDefinition[] = [
  {
    id: "usajobs",
    name: "USAJOBS",
    countries: ["US"],
    access: "api_key",
    documentationUrl: "https://developer.usajobs.gov/",
    feedUrl: null,
    listing: "credential_required",
    notes: "Official US federal jobs API. It requires an API key and a contact email. No key is shipped, and no request is sent.",
  },
  {
    id: "ncs-india",
    name: "National Career Service",
    countries: ["IN"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "India's National Career Service portal is not a stable no-auth job feed we call.",
  },
  {
    id: "govuk-find-a-job",
    name: "Find a job",
    countries: ["GB"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "The UK public employment service does not publish a stable no-auth listing feed we call.",
  },
  {
    id: "job-bank-canada",
    name: "Job Bank",
    countries: ["CA"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "Canada's Job Bank is not called. Employer boards in the catalog are read through their own public ATS.",
  },
  {
    id: "apsjobs",
    name: "APSjobs",
    countries: ["AU"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "The Australian Public Service jobs site is not a stable no-auth feed we call.",
  },
  {
    id: "careers-gov-sg",
    name: "Careers@Gov",
    countries: ["SG"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "The Careers@Gov portal is not scraped. GovTech's public Greenhouse board is read like any other Greenhouse board.",
  },
  {
    id: "careers-govt-nz",
    name: "careers.govt.nz",
    countries: ["NZ"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "New Zealand's careers service is not a live vacancy feed we call.",
  },
  {
    id: "publicjobs-ie",
    name: "publicjobs.ie",
    countries: ["IE"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "Ireland's public appointments service is not a stable no-auth feed we call.",
  },
  {
    id: "dpsa-za",
    name: "DPSA vacancies",
    countries: ["ZA"],
    access: "not_automated",
    documentationUrl: "",
    feedUrl: null,
    listing: "not_automated",
    notes: "South African public-service vacancies are published as circulars, not a job feed we call.",
  },
];

export function publicFeedById(id: string): PublicFeedDefinition | null {
  return PUBLIC_FEEDS.find((feed) => feed.id === id) ?? null;
}

/** A live open RSS would be returned here. Every registered feed currently refuses. */
export function callablePublicFeed(id: string): PublicFeedDefinition | null {
  const feed = publicFeedById(id);
  if (!feed || feed.listing !== "live" || feed.access !== "open_rss" || !feed.feedUrl) return null;
  return feed;
}

export interface KeyedFeedRefusal {
  called: false;
  reason: string;
}

/** Never performs a network call. A future key still has to be wired to a real client before this returns openings. */
export function keyedPublicFeedRequest(feedId: string, apiKey: string): KeyedFeedRefusal {
  const feed = publicFeedById(feedId);
  if (!feed) return { called: false, reason: "Unknown public feed." };
  if (feed.listing !== "credential_required" || feed.access !== "api_key") {
    return { called: false, reason: "This feed is not a keyed API." };
  }
  if (!apiKey.trim()) return { called: false, reason: "Missing API key." };
  return { called: false, reason: `${feed.name} is registered but not connected. No request was sent.` };
}

export interface LicensedSearch {
  country: string;
  title: string;
  limit: number;
}

export interface LicensedOpening {
  title: string;
  url: string;
  location: string;
}

export interface LicensedProviderClient {
  id: string;
  search(query: LicensedSearch): Promise<LicensedOpening[]>;
}

export interface LicensedProvider {
  id: string;
  name: string;
  status: "not_connected";
  countries: readonly FeaturedMarketCode[];
  notes: string;
}

export const LICENSED_PROVIDERS: readonly LicensedProvider[] = [
  {
    id: "reserved",
    name: "Licensed job data",
    status: "not_connected",
    countries: [...FEATURED_MARKET_CODES],
    notes: "Reserved for a future contract. No provider is connected and none is queried.",
  },
];

/** No licensed provider is connected. Callers must stop, not invent listings. */
export function licensedProviderClient(_id: string): LicensedProviderClient | null {
  return null;
}

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gh_src", "lever-source", "source", "ref", "fbclid", "gclid", "mc_cid", "mc_eid",
]);

export function canonicalJobUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function normalizedTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface OpeningIdentity {
  dedupKey: string;
  canonicalUrl: string;
  titleKey: string;
  locationKey: string;
}

export function openingDedupKey(input: {
  employerKey: string;
  externalId: string;
  url: string;
  title: string;
  location: string;
}): OpeningIdentity {
  const canonicalUrl = canonicalJobUrl(input.url);
  const titleKey = normalizedTitle(input.title);
  const locationKey = normalizedTitle(input.location);
  const employer = input.employerKey.trim().toLowerCase();
  const requisition = input.externalId.trim().toLowerCase();
  let dedupKey = "";
  if (employer && requisition) dedupKey = `req:${employer}:${requisition}`;
  else if (canonicalUrl) dedupKey = `url:${canonicalUrl}`;
  else dedupKey = `title:${employer}:${titleKey}:${locationKey}`;
  return { dedupKey, canonicalUrl, titleKey, locationKey };
}

export function isExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const then = Date.parse(expiresAt);
  if (Number.isNaN(then)) return false;
  return then <= nowMs;
}

export function dedupeOpenings<T extends { externalId: string; url: string; title: string; location: string }>(
  employerKey: string,
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const identity = openingDedupKey({
      employerKey,
      externalId: row.externalId,
      url: row.url,
      title: row.title,
      location: row.location,
    });
    const keys = [identity.dedupKey];
    if (identity.canonicalUrl) keys.push(`url:${identity.canonicalUrl}`);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    kept.push(row);
  }
  return kept;
}

const BOARD_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function hostedSlug(token: string): string {
  const slug = token.trim().toLowerCase();
  if (!BOARD_SLUG.test(slug)) throw new Error("Board name is not valid");
  return slug;
}
