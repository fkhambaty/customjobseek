import { employerKey } from "../shared/engine/catalog";
import type { Ats, BoardRef } from "../shared/engine/boards";
import { detectBoard } from "../shared/engine/boards";
import {
  ashbyBoardUrl,
  breezyJsonUrl,
  embeddedBoardFromHtml,
  greenhouseJobsUrl,
  type Opening,
  parseAshbyJobs,
  parseBreezyJobs,
  parseGreenhouseJobs,
  parseLeverPostings,
  parseRecruiteeOffers,
  parseSmartRecruitersPostings,
  parseTeamtailorFeed,
  parseWebsiteListings,
  parseWorkableJobs,
  parseWorkdayPostings,
  recognizedListingPayload,
  leverPostingsUrl,
  recruiteeOffersUrl,
  smartRecruitersPageUrl,
  teamtailorFeedUrl,
  workableWidgetUrl,
  workdayJobsUrl,
} from "../shared/engine/listings";
import { dedupeOpenings, isExpired, liveListingAts, openingDedupKey, sourceById } from "../shared/engine/sources";
import {
  capOpeningWrites,
  describeOpeningRead,
  nextRefreshDelayMs,
  planOpeningDelta,
  scanFailureSpike,
  shouldExpireOmittedOpenings,
  type OpeningRead,
} from "../shared/capacity";
import { noteAdapter } from "./adapters";
import { backgroundWorkAllowed } from "./dbCapacity";
import type { Env } from "./env";
import { notifyOwner } from "./notify";
import { scanFailureRecord } from "./publicError";
import { applyOpeningDelta, incomingFromListing, loadStoredOpenings } from "./openingsSync";

export type { Opening, OpeningRead };

const PAGE_CAP = 2000;
const TEAMTAILOR_CAP = 500;
/** A board with writes held back by the per-pass cap is read again in a few hours, not after its normal refresh. */
const DEFERRED_RESCAN_MS = 3 * 60 * 60_000;
const SCAN_PASS_MS = 25_000;
const SCAN_PASS_BOARDS = 30;
const FETCH_HEADERS = {
  accept: "application/json, text/html, application/xhtml+xml, application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 (compatible; CustomJobSeek/0.1; +https://customjobseek.com)",
};

function isIndiaLocation(location: string): boolean {
  return /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|mumbai|chennai|kolkata|ahmedabad)\b/i.test(location);
}

interface Row {
  id: string;
  name: string;
  career_url: string;
  ats: string;
  board_token: string;
  opening_count: number;
  scan_status: string;
  last_scan_at: string | null;
  scan_priority?: number;
  consecutive_failures?: number;
  unchanged_scans?: number;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { ...FETCH_HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Board responded ${res.status}`);
  return res.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...FETCH_HEADERS, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Board responded ${res.status}`);
  return res.json();
}

async function getText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, { headers: { ...FETCH_HEADERS, accept }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Board responded ${res.status}`);
  return res.text();
}

async function listWebsite(board: BoardRef): Promise<OpeningRead<Opening>> {
  const html = await getText(board.careerUrl, "text/html,application/xhtml+xml");
  const embedded = embeddedBoardFromHtml(html, board.careerUrl);
  if (embedded && embedded.ats !== "website" && sourceById(embedded.ats).listing === "live") {
    return listOpenings(embedded);
  }
  const openings = parseWebsiteListings(html, board.careerUrl);
  return describeOpeningRead(openings, {
    truncated: openings.length >= 200,
    recognized: recognizedListingPayload("website", html) && openings.length > 0,
  });
}

async function listTeamtailor(token: string): Promise<OpeningRead<Opening>> {
  const openings: Opening[] = [];
  const seen = new Set<string>();
  let recognized = false;
  let truncated = false;
  for (let offset = 0; offset < TEAMTAILOR_CAP; offset += 100) {
    const xml = await getText(teamtailorFeedUrl(token, offset), "application/rss+xml, application/xml, text/xml");
    const pageRecognized = recognizedListingPayload("teamtailor", xml);
    if (!pageRecognized && openings.length === 0) {
      return describeOpeningRead([], { truncated: true, recognized: false });
    }
    recognized = recognized || pageRecognized;
    const page = parseTeamtailorFeed(xml);
    let fresh = 0;
    for (const job of page) {
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      openings.push(job);
      fresh += 1;
    }
    if (page.length < 100 || fresh === 0) {
      return describeOpeningRead(openings, { truncated: false, recognized });
    }
    if (offset + 100 >= TEAMTAILOR_CAP) truncated = true;
  }
  return describeOpeningRead(openings, { truncated, recognized });
}

async function listSmartRecruiters(board: BoardRef): Promise<OpeningRead<Opening>> {
  const jobs: Record<string, unknown>[] = [];
  let recognized = false;
  for (let offset = 0; offset < PAGE_CAP; offset += 100) {
    const data = await getJson(smartRecruitersPageUrl(board.token, offset));
    const pageRecognized = recognizedListingPayload("smartrecruiters", data);
    if (!pageRecognized) {
      return describeOpeningRead(parseSmartRecruitersPostings(jobs, board.careerUrl), { truncated: true, recognized: jobs.length > 0 });
    }
    recognized = true;
    const content = (data as { content: Record<string, unknown>[]; totalFound?: number }).content;
    const total = Number((data as { totalFound?: number }).totalFound ?? jobs.length + content.length);
    if (content.length === 0 && total > jobs.length) {
      return describeOpeningRead(parseSmartRecruitersPostings(jobs, board.careerUrl), { truncated: true, recognized });
    }
    jobs.push(...content);
    if (content.length < 100 || jobs.length >= total) {
      return describeOpeningRead(parseSmartRecruitersPostings(jobs, board.careerUrl), { truncated: false, recognized });
    }
    if (offset + 100 >= PAGE_CAP) {
      return describeOpeningRead(parseSmartRecruitersPostings(jobs, board.careerUrl), { truncated: true, recognized });
    }
  }
  return describeOpeningRead(parseSmartRecruitersPostings(jobs, board.careerUrl), { truncated: true, recognized });
}

async function listWorkday(board: BoardRef): Promise<OpeningRead<Opening>> {
  const career = new URL(board.careerUrl);
  const target = workdayJobsUrl(board.careerUrl);
  const jobs: Record<string, unknown>[] = [];
  let total = 1;
  let recognized = false;
  for (let offset = 0; offset < total && offset < PAGE_CAP; offset += 20) {
    const data = await postJson(target.url, { appliedFacets: {}, limit: 20, offset, searchText: "" });
    const pageRecognized = recognizedListingPayload("workday", data);
    if (!pageRecognized) {
      return describeOpeningRead(parseWorkdayPostings(jobs, career.origin), { truncated: true, recognized: jobs.length > 0 });
    }
    recognized = true;
    const page = (data as { jobPostings: Record<string, unknown>[]; total?: number }).jobPostings;
    const reported = Number((data as { total?: number }).total ?? jobs.length + page.length);
    if (page.length === 0 && reported > jobs.length) {
      return describeOpeningRead(parseWorkdayPostings(jobs, career.origin), { truncated: true, recognized });
    }
    jobs.push(...page);
    total = reported;
    if (offset + 20 >= PAGE_CAP && jobs.length < total) {
      return describeOpeningRead(parseWorkdayPostings(jobs, career.origin), { truncated: true, recognized });
    }
  }
  const truncated = jobs.length < total;
  return describeOpeningRead(parseWorkdayPostings(jobs, career.origin), { truncated, recognized });
}

function oneShot(ats: BoardRef["ats"], payload: unknown, openings: Opening[]): OpeningRead<Opening> {
  return describeOpeningRead(openings, { truncated: false, recognized: recognizedListingPayload(ats, payload) });
}

export async function listOpenings(board: BoardRef): Promise<OpeningRead<Opening>> {
  const source = sourceById(board.ats);
  if (source.listing !== "live") return describeOpeningRead([], { truncated: false, recognized: false });
  switch (board.ats) {
    case "greenhouse": {
      const payload = await getJson(greenhouseJobsUrl(board.token));
      return oneShot(board.ats, payload, parseGreenhouseJobs(payload));
    }
    case "lever": {
      const payload = await getJson(leverPostingsUrl(board.token));
      return oneShot(board.ats, payload, parseLeverPostings(payload));
    }
    case "ashby": {
      const payload = await getJson(ashbyBoardUrl(board.token));
      return oneShot(board.ats, payload, parseAshbyJobs(payload, board.careerUrl));
    }
    case "workable": {
      const payload = await getJson(workableWidgetUrl(board.token));
      return oneShot(board.ats, payload, parseWorkableJobs(payload));
    }
    case "smartrecruiters":
      return listSmartRecruiters(board);
    case "workday":
      return listWorkday(board);
    case "teamtailor":
      return listTeamtailor(board.token);
    case "recruitee": {
      const payload = await getJson(recruiteeOffersUrl(board.token));
      return oneShot(board.ats, payload, parseRecruiteeOffers(payload));
    }
    case "breezy": {
      const payload = await getJson(breezyJsonUrl(board.token));
      return oneShot(board.ats, payload, parseBreezyJobs(payload, board.careerUrl));
    }
    case "website":
      return listWebsite(board);
    case "icims":
    case "oracle_recruiting":
    case "successfactors":
    case "public_feed":
    case "licensed":
    case "aggregator":
      return describeOpeningRead([], { truncated: false, recognized: false });
    default: {
      const never: never = board.ats;
      return never;
    }
  }
}

async function saveOpenings(
  env: Env,
  company: Row,
  employer: string,
  provenance: string,
  read: OpeningRead<Opening>,
): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();
  const listed = dedupeOpenings(
    employer,
    read.openings.filter((opening) => opening.externalId && opening.title && !isExpired(opening.expiresAt, now.getTime())),
  ).slice(0, 2000);
  const incoming = listed.map((opening) =>
    incomingFromListing(
      employer,
      provenance,
      opening,
      openingDedupKey({
        employerKey: employer,
        externalId: opening.externalId,
        url: opening.url,
        title: opening.title,
        location: opening.location,
      }),
    ),
  );
  const expireOmitted = shouldExpireOmittedOpenings(read);
  const delta = planOpeningDelta(await loadStoredOpenings(env.DB, company.id), incoming, nowIso, expireOmitted);
  const capped = capOpeningWrites(delta.ops);
  await applyOpeningDelta(env.DB, company.id, capped.ops, nowIso);
  const quiet = delta.ops.length === 0;
  const unchangedScans = quiet ? (company.unchanged_scans ?? 0) + 1 : 0;
  const source = sourceById(company.ats as Ats);
  const nextAt = new Date(now.getTime() + (capped.deferred > 0 ? DEFERRED_RESCAN_MS : nextRefreshDelayMs({
    priority: company.scan_priority ?? 0,
    consecutiveFailures: 0,
    unchangedScans,
    freshnessHours: source.freshnessHours,
  }))).toISOString();
  const hasIndiaOpenings = incoming.some((row) => isIndiaLocation(row.location));
  await env.DB.prepare(
    `UPDATE companies SET scan_status = 'ok', last_error = '', opening_count = ?, last_scan_at = ?,
     next_scan_at = ?, consecutive_failures = 0, unchanged_scans = ?,
     country = CASE WHEN ? = 1 THEN 'IN' ELSE country END,
     source_url = CASE WHEN ? = 1 AND source_url = '' THEN career_url ELSE source_url END,
     verified_at = CASE WHEN ? = 1 THEN COALESCE(verified_at, ?) ELSE verified_at END
     WHERE id = ?`,
  ).bind(
    expireOmitted ? delta.liveCount : company.opening_count, nowIso, nextAt, unchangedScans,
    hasIndiaOpenings ? 1 : 0, hasIndiaOpenings ? 1 : 0, hasIndiaOpenings ? 1 : 0, nowIso, company.id,
  ).run();
  return delta.liveCount;
}

export async function scanCompany(env: Env, companyId: string): Promise<{ count: number; error: string }> {
  const company = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first<Row>();
  if (!company) return { count: 0, error: "Company not found" };
  const ats = company.ats as Ats;
  if (!liveListingAts().includes(ats)) {
    await env.DB.prepare(
      "UPDATE companies SET scan_status = 'unsupported', last_scan_at = ?, next_scan_at = ?, last_error = '' WHERE id = ?",
    )
      .bind(new Date().toISOString(), new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(), companyId)
      .run();
    return { count: 0, error: "" };
  }
  try {
    const read = await listOpenings({
      ats,
      token: company.board_token,
      careerUrl: company.career_url,
      nameHint: company.name,
    });
    const employer = employerKey(company.career_url) ?? `${ats}:${company.board_token.toLowerCase()}`;
    const count = await saveOpenings(env, company, employer, `${ats}:${sourceById(ats).compliance}`, read);
    await noteAdapter(env, company.ats, true);
    return { count, error: "" };
  } catch (err) {
    const failure = scanFailureRecord(err, `/internal/company-scan/${companyId}`);
    console.error(failure.log);
    const failures = (company.consecutive_failures ?? 0) + 1;
    const nextAt = new Date(Date.now() + nextRefreshDelayMs({
      priority: company.scan_priority ?? 0,
      consecutiveFailures: failures,
      unchangedScans: company.unchanged_scans ?? 0,
      freshnessHours: sourceById(ats).freshnessHours,
    })).toISOString();
    await env.DB.prepare(
      `UPDATE companies SET scan_status = 'error', last_error = ?, last_scan_at = ?,
       consecutive_failures = ?, next_scan_at = ?
       WHERE id = ?`,
    )
      .bind(failure.message.slice(0, 300), new Date().toISOString(), failures, nextAt, companyId)
      .run();
    await noteAdapter(env, company.ats, false);
    return { count: 0, error: failure.message };
  }
}

export interface AddedCareerPage {
  companyId: string;
  name: string;
  ats: Ats;
  count: number;
  error: string;
  coverage: "live" | "unsupported" | "partnership";
  message: string;
}

export async function addCareerPage(env: Env, rawUrl: string, userId: string | null, note = ""): Promise<AddedCareerPage> {
  const board = detectBoard(rawUrl);
  if (!board) throw new Error("That link is not a web address.");
  const source = sourceById(board.ats);
  const existing = await env.DB.prepare("SELECT id FROM companies WHERE career_url = ?").bind(board.careerUrl).first<{ id: string }>();
  const companyId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    const domain = new URL(board.careerUrl).hostname.toLowerCase().replace(/^www\./, "");
    await env.DB.prepare(
      `INSERT INTO companies
       (id, name, career_url, ats, board_token, added_by, country, source_url, normalized_domain, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    )
      .bind(companyId, board.nameHint, board.careerUrl, board.ats, board.token, userId, rawUrl, domain, new Date().toISOString())
      .run();
  }
  if (userId) {
    await env.DB.prepare("INSERT INTO missed_reports (id, user_id, url, note, company_id) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), userId, rawUrl.slice(0, 1000), note.slice(0, 500), companyId)
      .run();
  }
  const scanned = await scanCompany(env, companyId);
  const coverage = source.listing === "live" ? "live" : board.ats === "aggregator" || board.ats === "licensed" ? "partnership" : "unsupported";
  const message = source.listing === "live"
    ? (scanned.error || `${scanned.count} open roles found.`)
    : source.savedNote;
  return { companyId, name: board.nameHint, ats: board.ats, count: scanned.count, error: scanned.error, coverage, message };
}

export async function scanDue(env: Env): Promise<void> {
  const live = liveListingAts();
  const { results } = await env.DB.prepare(
    `SELECT id FROM companies
     WHERE active = 1 AND ats IN (${live.map(() => "?").join(", ")})
       AND (next_scan_at IS NULL OR next_scan_at <= ?)
     ORDER BY scan_priority DESC, last_scan_at IS NOT NULL, last_scan_at LIMIT ?`,
  ).bind(...live, new Date().toISOString(), SCAN_PASS_BOARDS).all<{ id: string }>();
  let failed = 0;
  let attempted = 0;
  const deadline = Date.now() + SCAN_PASS_MS;
  for (const row of results) {
    if (Date.now() >= deadline) break;
    if (!(await backgroundWorkAllowed(env))) {
      console.log("Daily database budget for background work reached; employer refresh stops until midnight UTC.");
      break;
    }
    attempted += 1;
    const scanned = await scanCompany(env, row.id);
    if (scanned.error) failed += 1;
  }
  if (!scanFailureSpike(attempted, failed)) return;
  const hour = new Date().toISOString().slice(0, 13);
  await notifyOwner(env, {
    kind: "scan_failure_spike",
    dedupeKey: `scan-spike:${hour}`,
    summary: `${failed} of ${results.length} employer scans failed in one pass.`,
  }).catch((err: unknown) => console.error("scan spike alert failed", err));
}

export async function openingByUrl(rawUrl: string): Promise<Opening | null> {
  const board = detectBoard(rawUrl);
  if (!board || sourceById(board.ats).listing !== "live") return null;
  const read = await listOpenings(board).catch(() => describeOpeningRead([], { truncated: true, recognized: false }));
  const id = new URL(rawUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  return read.openings.find((opening) => opening.url === rawUrl || opening.externalId === id || (id && opening.url.includes(id))) ?? null;
}
