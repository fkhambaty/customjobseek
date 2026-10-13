import { openingByUrl } from "./scan";

export interface FetchedJob {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
  source: "structured" | "page_text";
}

const MAX_BYTES = 1_500_000;

export function isFetchableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|li|div|h\d|tr|section)>|<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

type JsonLd = Record<string, unknown>;

function findJobPosting(node: unknown): JsonLd | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as JsonLd;
  const type = obj["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
  return findJobPosting(obj["@graph"]);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function locationOf(posting: JsonLd): string {
  const places = ([] as unknown[]).concat(posting.jobLocation ?? []);
  const names = places.map((p) => {
    const addr = (p as JsonLd)?.address as JsonLd | undefined;
    if (!addr) return str((p as JsonLd)?.name);
    return [str(addr.addressLocality), str(addr.addressRegion), str(addr.addressCountry)].filter(Boolean).join(", ");
  });
  if (str(posting.jobLocationType).toUpperCase() === "TELECOMMUTE") names.push("Remote");
  return Array.from(new Set(names.filter(Boolean))).join(" / ");
}

function salaryOf(posting: JsonLd): string {
  const base = posting.baseSalary as JsonLd | undefined;
  const value = base?.value as JsonLd | undefined;
  if (!value) return "";
  const currency = str(base?.currency) || "INR";
  const min = str(value.minValue) || str(value.value);
  const max = str(value.maxValue);
  const unit = str(value.unitText).toLowerCase();
  if (!min) return "";
  const range = max && max !== min ? `${min} - ${max}` : min;
  return `${currency === "INR" ? "₹" : currency + " "}${range}${unit === "month" ? " per month" : ""}`;
}

export function parseJobHtml(html: string): FetchedJob | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1] ?? "");
    } catch {
      continue;
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    const org = posting.hiringOrganization as JsonLd | undefined;
    const description = htmlToText(decodeEntities(str(posting.description)));
    if (description.length < 80) continue;
    return {
      title: str(posting.title),
      company: str(org?.name),
      location: locationOf(posting),
      salaryText: salaryOf(posting),
      description,
      source: "structured",
    };
  }

  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ?? "";
  const body = htmlToText(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
  if (body.length < 200) return null;
  return {
    title: decodeEntities(meta("og:title") || html.match(/<title>([^<]*)/i)?.[1] || "").trim(),
    company: decodeEntities(meta("og:site_name")).trim(),
    location: "",
    salaryText: "",
    description: body.slice(0, 20000),
    source: "page_text",
  };
}

async function getJson(url: string): Promise<JsonLd | null> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  return res.ok ? ((await res.json()) as JsonLd) : null;
}

// Greenhouse and Lever pages carry no JobPosting markup, but both publish the posting as JSON.
async function fetchFromAtsApi(url: URL): Promise<FetchedJob | null> {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "api.smartrecruiters.com" || host === "jobs.smartrecruiters.com") {
    const companiesAt = parts.indexOf("companies");
    const postingsAt = parts.indexOf("postings");
    const company = companiesAt >= 0 ? parts[companiesAt + 1] : parts[0];
    const id = postingsAt >= 0 ? parts[postingsAt + 1] : parts[1];
    if (!company || !id) return null;
    const d = await getJson(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
    );
    if (!d) return null;
    const location = (d.location as JsonLd | undefined) ?? {};
    const companyInfo = (d.company as JsonLd | undefined) ?? {};
    const jobAd = (d.jobAd as JsonLd | undefined) ?? {};
    const sections = (jobAd.sections as JsonLd | undefined) ?? {};
    const description = Object.values(sections)
      .map((section) => htmlToText(str((section as JsonLd | undefined)?.text)))
      .filter(Boolean)
      .join("\n");
    return {
      title: str(d.name),
      company: str(companyInfo.name) || company,
      location: [str(location.city), str(location.region), str(location.country)].filter(Boolean).join(", "),
      salaryText: "",
      description,
      source: "structured",
    };
  }

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const jobsAt = parts.indexOf("jobs");
    const board = parts[jobsAt - 1] ?? url.searchParams.get("for");
    const id = parts[jobsAt + 1] ?? url.searchParams.get("token");
    if (jobsAt < 0 || !board || !id) return null;
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`);
    if (!d) return null;
    return {
      title: str(d.title),
      company: str(d.company_name),
      location: str((d.location as JsonLd | undefined)?.name),
      salaryText: "",
      description: htmlToText(decodeEntities(str(d.content))),
      source: "structured",
    };
  }

  if (host === "jobs.lever.co" && parts.length >= 2) {
    const [company, id] = parts;
    const d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company!)}/${encodeURIComponent(id!)}`);
    if (!d) return null;
    const cats = (d.categories as JsonLd | undefined) ?? {};
    const lists = ((d.lists as JsonLd[] | undefined) ?? []).map((l) => `${str(l.text)}\n${htmlToText(str(l.content))}`);
    const range = d.salaryRange as JsonLd | undefined;
    return {
      title: str(d.text),
      company: company!.replace(/-/g, " "),
      location: [str(cats.location), str(d.workplaceType) === "remote" ? "Remote" : ""].filter(Boolean).join(" / "),
      salaryText: range ? `${str(range.currency) === "INR" ? "₹" : str(range.currency) + " "}${str(range.min)} - ${str(range.max)}` : "",
      description: [str(d.descriptionPlain), ...lists, str(d.additionalPlain)].filter(Boolean).join("\n"),
      source: "structured",
    };
  }
  return null;
}

export async function fetchJob(url: URL): Promise<FetchedJob | null> {
  const viaApi = await fetchFromAtsApi(url).catch(() => null);
  if (viaApi && viaApi.description.length >= 80) return viaApi;

  const listed = await openingByUrl(url.toString()).catch(() => null);
  if (listed && listed.description.length >= 80) {
    const board = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return {
      title: listed.title,
      company: board.replace(/-/g, " "),
      location: listed.location,
      salaryText: "",
      description: listed.description,
      source: "structured",
    };
  }

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; CustomJobSeek/0.1; +https://customjobseek.com)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) return null;
  const html = (await res.text()).slice(0, MAX_BYTES);
  return parseJobHtml(html);
}
