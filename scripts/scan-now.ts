// Scans every supported board once, from this machine, using the same reader as the hourly job.
// Writes only added, changed, expired, and reactivated openings. Requires migration 0010.
// Run: npx esbuild scripts/scan-now.ts --bundle --platform=node --format=esm --external:./cloud.mjs --outfile=scripts/.scan-now.mjs && node scripts/.scan-now.mjs; rm scripts/.scan-now.mjs
import type { Ats } from "../shared/engine/boards";
import { employerKey } from "../shared/engine/catalog";
import { dedupeOpenings, isExpired, liveListingAts, openingDedupKey, sourceById } from "../shared/engine/sources";
import { nextRefreshDelayMs, planOpeningDelta, shouldExpireOmittedOpenings, type StoredOpening } from "../shared/capacity";
import { incomingFromListing } from "../worker/openingsSync";
import { listOpenings } from "../worker/scan";
// @ts-expect-error plain JS helper shared with the seed scripts
import { d1 } from "./cloud.mjs";

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const query = d1 as Query;

interface Company {
  id: string;
  name: string;
  ats: Ats;
  board_token: string;
  career_url: string;
  scan_priority?: number;
  unchanged_scans?: number;
}

async function save(company: Company, read: Awaited<ReturnType<typeof listOpenings>>): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();
  const employer = employerKey(company.career_url) ?? `${company.ats}:${company.board_token.toLowerCase()}`;
  const provenance = `${company.ats}:${sourceById(company.ats).compliance}`;
  const expireOmitted = shouldExpireOmittedOpenings(read);
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
  const prior = await query(
    "SELECT external_id, dedup_key, canonical_url, content_hash, first_seen_at, provenance, expires_at FROM openings WHERE company_id = ?",
    [company.id],
  );
  const stored: StoredOpening[] = prior.map((row) => ({
    externalId: String(row.external_id ?? ""),
    dedupKey: String(row.dedup_key ?? ""),
    canonicalUrl: String(row.canonical_url ?? ""),
    contentHash: String(row.content_hash ?? ""),
    firstSeenAt: row.first_seen_at ? String(row.first_seen_at) : null,
    provenance: String(row.provenance ?? ""),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  }));
  const delta = planOpeningDelta(stored, incoming, nowIso, expireOmitted);
  for (const op of delta.ops) {
    if (op.kind === "expire") {
      await query(
        "UPDATE openings SET expires_at = ?, updated_at = ? WHERE company_id = ? AND external_id = ? AND (expires_at IS NULL OR expires_at > ?)",
        [nowIso, nowIso, company.id, op.externalId, nowIso],
      );
      await query("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?", [company.id, op.externalId]);
      continue;
    }
    const row = op.row;
    if ((op.kind === "change" || op.kind === "reactivate") && op.storedExternalId !== row.externalId) {
      await query("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?", [company.id, op.storedExternalId]);
      await query("UPDATE openings SET external_id = ? WHERE company_id = ? AND external_id = ?", [row.externalId, company.id, op.storedExternalId]);
    }
    await query(
      `INSERT INTO openings
       (company_id, external_id, title, location, url, updated_at, dedup_key, canonical_url, title_key, location_key, employer_key, provenance, expires_at, first_seen_at, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, external_id) DO UPDATE SET
         title = excluded.title, location = excluded.location, url = excluded.url, updated_at = excluded.updated_at,
         dedup_key = excluded.dedup_key,
         canonical_url = CASE WHEN excluded.canonical_url != '' THEN excluded.canonical_url ELSE openings.canonical_url END,
         title_key = excluded.title_key, location_key = excluded.location_key, employer_key = excluded.employer_key,
         provenance = CASE WHEN openings.provenance != '' THEN openings.provenance ELSE excluded.provenance END,
         expires_at = excluded.expires_at, content_hash = excluded.content_hash,
         first_seen_at = COALESCE(openings.first_seen_at, excluded.first_seen_at)`,
      [
        company.id, row.externalId, row.title.slice(0, 200), row.location.slice(0, 200), row.url.slice(0, 1000), nowIso,
        row.dedupKey, row.canonicalUrl.slice(0, 1000), row.titleKey.slice(0, 200), row.locationKey.slice(0, 200),
        row.employerKey.slice(0, 200), row.provenance.slice(0, 80), row.expiresAt, row.firstSeenAt, row.contentHash,
      ],
    );
    await query("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?", [company.id, row.externalId]);
    for (const token of row.tokens) {
      await query("INSERT OR IGNORE INTO opening_search (token, company_id, external_id) VALUES (?, ?, ?)", [token, company.id, row.externalId]);
    }
  }
  const quiet = delta.ops.length === 0;
  const unchangedScans = quiet ? Number(company.unchanged_scans ?? 0) + 1 : 0;
  const nextAt = new Date(now.getTime() + nextRefreshDelayMs({
    priority: Number(company.scan_priority ?? 0),
    consecutiveFailures: 0,
    unchangedScans,
    freshnessHours: sourceById(company.ats).freshnessHours,
  })).toISOString();
  await query(
    expireOmitted
      ? `UPDATE companies SET scan_status = 'ok', last_error = '', opening_count = ?, last_scan_at = ?, next_scan_at = ?,
         consecutive_failures = 0, unchanged_scans = ? WHERE id = ?`
      : `UPDATE companies SET scan_status = 'ok', last_error = '', last_scan_at = ?, next_scan_at = ?,
         consecutive_failures = 0, unchanged_scans = ? WHERE id = ?`,
    expireOmitted
      ? [delta.liveCount, nowIso, nextAt, unchangedScans, company.id]
      : [nowIso, nextAt, unchangedScans, company.id],
  );
  return delta.liveCount;
}

async function scan(company: Company): Promise<void> {
  try {
    const openings = await listOpenings({ ats: company.ats, token: company.board_token, careerUrl: company.career_url, nameHint: company.name });
    console.log(`${company.name.padEnd(32)} ${String(await save(company, openings)).padStart(5)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await query("UPDATE companies SET scan_status = 'error', last_error = ?, last_scan_at = ? WHERE id = ?", [message.slice(0, 300), new Date().toISOString(), company.id]);
    console.log(`${company.name.padEnd(32)} error: ${message}`);
  }
}

const live = liveListingAts().map((ats) => `'${ats}'`).join(",");
const companies = (await query(
  `SELECT id, name, ats, board_token, career_url, scan_priority, unchanged_scans FROM companies
   WHERE active = 1 AND ats IN (${live})
   ORDER BY scan_priority DESC, last_scan_at IS NOT NULL, last_scan_at`,
)) as unknown as Company[];

const queue = [...companies];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) await scan(c);
}));
const [total] = await query("SELECT count(*) AS n FROM openings");
console.log(`\n${companies.length} boards read, ${String(total?.n)} openings stored.`);
