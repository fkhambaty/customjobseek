import type { Ats } from "./boards";
import { hostedSlug } from "./sources";

export interface Opening {
  externalId: string;
  title: string;
  location: string;
  url: string;
  description: string;
  expiresAt?: string | null;
}

export function listingHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** True when the payload is the documented list shape, including a real empty list. */
export function recognizedListingPayload(ats: Ats, payload: unknown): boolean {
  switch (ats) {
    case "greenhouse":
    case "ashby":
      return isRecord(payload) && Array.isArray(payload.jobs);
    case "lever":
      return Array.isArray(payload);
    case "workable":
      return isRecord(payload) && (Array.isArray(payload.jobs) || Array.isArray(payload.results));
    case "smartrecruiters":
      return isRecord(payload) && Array.isArray(payload.content);
    case "workday":
      return isRecord(payload) && Array.isArray(payload.jobPostings);
    case "teamtailor":
      return typeof payload === "string" && /<(rss|feed|channel)\b/i.test(payload);
    case "recruitee":
      if (Array.isArray(payload)) return true;
      return isRecord(payload) && (Array.isArray(payload.offers) || isRecord(payload.offer) || typeof payload.title === "string");
    case "icims":
    case "oracle_recruiting":
    case "successfactors":
    case "public_feed":
    case "licensed":
    case "aggregator":
    case "website":
      return false;
    default: {
      const unexpected: never = ats;
      return unexpected;
    }
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

export function greenhouseJobsUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
}

export function greenhouseJobUrl(token: string, id: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`;
}

export function leverPostingsUrl(token: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
}

export function leverPostingUrl(token: string, id: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(id)}`;
}

export function ashbyBoardUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
}

/**
 * URL a person can open in a normal browser.
 * Ashby hosted job pages are SPAs: the bare link often renders "Page not found"
 * while the same path with embed=js server-renders the posting.
 */
export function publicJobUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return url.toString();
  const parts = url.pathname.split("/").filter(Boolean);
  // Need board + job id (optional /application). Board roots stay unchanged.
  if (parts.length < 2) return url.toString();
  if (!url.searchParams.has("embed")) url.searchParams.set("embed", "js");
  return url.toString();
}

export function workableWidgetUrl(token: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`;
}

export function smartRecruitersPageUrl(token: string, offset: number): string {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=${offset}`;
}

export function smartRecruitersPostingUrl(token: string, id: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(id)}`;
}

export function workdayJobsUrl(careerUrl: string): { url: string; tenant: string; site: string } {
  const career = new URL(careerUrl);
  const tenant = career.hostname.split(".")[0] ?? "";
  const site = career.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!tenant || !site) throw new Error("Workday board needs its public site name");
  return {
    tenant,
    site,
    url: `${career.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
  };
}

export function teamtailorFeedUrl(token: string, offset: number): string {
  const slug = hostedSlug(token);
  return `https://${slug}.teamtailor.com/jobs.rss?offset=${offset}&per_page=100`;
}

export function recruiteeOffersUrl(token: string): string {
  const slug = hostedSlug(token);
  return `https://${slug}.recruitee.com/api/offers/`;
}

export function recruiteeOfferUrl(token: string, id: string): string {
  const slug = hostedSlug(token);
  return `https://${slug}.recruitee.com/api/offers/${encodeURIComponent(id)}`;
}

export function parseGreenhouseJobs(data: unknown): Opening[] {
  const jobs = asList((data as { jobs?: unknown } | null)?.jobs);
  return jobs.map((job) => ({
    externalId: text(job.id),
    title: text(job.title),
    location: text((job.location as { name?: string } | undefined)?.name),
    url: text(job.absolute_url),
    description: listingHtmlToText(text(job.content)),
    expiresAt: null,
  }));
}

export function parseLeverPostings(data: unknown): Opening[] {
  return asList(data).map((job) => {
    const cats = (job.categories as Record<string, unknown> | undefined) ?? {};
    const lists = asList(job.lists).map((list) => `${text(list.text)}\n${listingHtmlToText(text(list.content))}`);
    return {
      externalId: text(job.id),
      title: text(job.text),
      location: text(cats.location),
      url: text(job.hostedUrl),
      description: [text(job.descriptionPlain), ...lists].filter(Boolean).join("\n"),
      expiresAt: null,
    };
  });
}

export function parseAshbyJobs(data: unknown, careerUrl: string): Opening[] {
  const jobs = asList((data as { jobs?: unknown } | null)?.jobs);
  return jobs
    .filter((job) => job.isListed !== false)
    .map((job) => ({
      externalId: text(job.id),
      title: text(job.title),
      location: text(job.location),
      url: publicJobUrl(text(job.jobUrl) || `${careerUrl.replace(/\/$/, "")}/${text(job.id)}`),
      description: text(job.descriptionPlain) || listingHtmlToText(text(job.descriptionHtml)),
      expiresAt: null,
    }));
}

export function parseWorkableJobs(data: unknown): Opening[] {
  const root = (data as { jobs?: unknown; results?: unknown } | null) ?? {};
  return asList(root.jobs ?? root.results).map((job) => ({
    externalId: text(job.shortcode) || text(job.id),
    title: text(job.title),
    location: text(job.location) || text((job.location as { city?: string } | undefined)?.city),
    url: text(job.url) || text(job.application_url),
    description: listingHtmlToText(text(job.description)),
    expiresAt: null,
  }));
}

export function parseSmartRecruitersPostings(jobs: unknown, careerUrl: string): Opening[] {
  return asList(jobs).map((job) => ({
    externalId: text(job.id),
    title: text(job.name),
    location: text((job.location as { city?: string } | undefined)?.city),
    url: text(job.ref) || `${careerUrl}/${text(job.id)}`,
    description: "",
    expiresAt: null,
  }));
}

export function parseWorkdayPostings(jobs: unknown, origin: string): Opening[] {
  return asList(jobs).map((job) => ({
    externalId: text(job.externalPath).split("/").filter(Boolean).at(-1) ?? text(job.externalPath),
    title: text(job.title),
    location: text(job.locationsText),
    url: `${origin}${text(job.externalPath)}`,
    description: "",
    expiresAt: null,
  }));
}

function decodeXml(value: string): string {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return unwrapped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tagText(block: string, name: string): string {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "i"));
  return match ? decodeXml(match[1] ?? "") : "";
}

function teamtailorPlaces(block: string): string[] {
  const chunks = block.match(/<(?:[\w.-]+:)?location\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?location>/gi) ?? [];
  const places: string[] = [];
  for (const chunk of chunks) {
    const name = tagText(chunk, "name");
    const city = tagText(chunk, "city");
    const country = tagText(chunk, "country");
    const place = name || [city, country].filter(Boolean).join(", ");
    if (place) places.push(place);
  }
  const remote = tagText(block, "remoteStatus").toLowerCase();
  if (remote.includes("fully") || remote === "remote") places.push("Remote");
  return places;
}

/** Teamtailor's documented public jobs RSS, including the tt: location fields. */
export function parseTeamtailorFeed(xml: string): Opening[] {
  const items = xml.split(/<item\b/i).slice(1);
  const openings: Opening[] = [];
  for (const item of items) {
    const block = item.split(/<\/item>/i)[0] ?? "";
    const title = tagText(block, "title");
    const link = tagText(block, "link") || tagText(block, "url");
    const guid = tagText(block, "guid");
    const externalId = guid || link;
    if (!title || !externalId) continue;
    openings.push({
      externalId,
      title,
      location: teamtailorPlaces(block).join(" / "),
      url: link,
      description: listingHtmlToText(tagText(block, "description")),
      expiresAt: null,
    });
  }
  return openings;
}

function recruiteeLocation(offer: Record<string, unknown>): string {
  const direct = text(offer.location);
  const places = asList(offer.locations).map((place) => {
    const city = text(place.city);
    const country = text(place.country);
    const name = text(place.name);
    return [city, country].filter(Boolean).join(", ") || name;
  }).filter(Boolean);
  if (direct && places.length === 0) places.push(direct);
  if (offer.remote === true) places.push("Remote");
  return [...new Set(places)].join(" / ");
}

function recruiteeOpening(offer: Record<string, unknown>): Opening | null {
  const title = text(offer.title);
  const externalId = text(offer.id) || text(offer.slug);
  if (!title || !externalId) return null;
  const description = [text(offer.description), text(offer.requirements)].filter(Boolean).map(listingHtmlToText).filter(Boolean).join("\n");
  const closed = text(offer.closed_at) || text(offer.close_at);
  return {
    externalId,
    title,
    location: recruiteeLocation(offer),
    url: text(offer.careers_url),
    description,
    expiresAt: closed || null,
  };
}

export function parseRecruiteeOffers(data: unknown): Opening[] {
  if (Array.isArray(data)) {
    return data.map((item) => (item && typeof item === "object" ? recruiteeOpening(item as Record<string, unknown>) : null)).filter((row): row is Opening => !!row);
  }
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  if (Array.isArray(root.offers)) return parseRecruiteeOffers(root.offers);
  const wrapped = root.offer && typeof root.offer === "object" ? recruiteeOpening(root.offer as Record<string, unknown>) : recruiteeOpening(root);
  return wrapped ? [wrapped] : [];
}
