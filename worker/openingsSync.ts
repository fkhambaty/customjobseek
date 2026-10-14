import { openingDedupKey } from "../shared/engine/sources";
import {
  openingContentHash,
  searchTokens,
  type IncomingOpening,
  type OpeningOp,
  type StoredOpening,
} from "../shared/capacity";
import type { Opening } from "../shared/engine/listings";
import type { Env } from "./env";

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

const WRITE = `INSERT INTO openings
  (company_id, external_id, title, location, url, updated_at, dedup_key, canonical_url, title_key, location_key, employer_key, provenance, expires_at, first_seen_at, content_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(company_id, external_id) DO UPDATE SET
    title = excluded.title,
    location = excluded.location,
    url = excluded.url,
    updated_at = excluded.updated_at,
    dedup_key = excluded.dedup_key,
    canonical_url = CASE WHEN excluded.canonical_url != '' THEN excluded.canonical_url ELSE openings.canonical_url END,
    title_key = excluded.title_key,
    location_key = excluded.location_key,
    employer_key = excluded.employer_key,
    provenance = CASE WHEN openings.provenance != '' THEN openings.provenance ELSE excluded.provenance END,
    expires_at = excluded.expires_at,
    first_seen_at = COALESCE(openings.first_seen_at, excluded.first_seen_at),
    content_hash = excluded.content_hash`;

function tokenStatements(db: D1Database, companyId: string, externalId: string, tokens: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?").bind(companyId, externalId),
    ...tokens.map((token) =>
      db.prepare("INSERT OR IGNORE INTO opening_search (token, company_id, external_id) VALUES (?, ?, ?)").bind(token, companyId, externalId),
    ),
  ];
}

function bindWrite(db: D1Database, companyId: string, row: OpeningOp & { kind: "add" | "change" | "reactivate" }, nowIso: string): D1PreparedStatement {
  const opening = row.row;
  return db.prepare(WRITE).bind(
    companyId,
    opening.externalId,
    opening.title.slice(0, 200),
    opening.location.slice(0, 200),
    opening.url.slice(0, 1000),
    nowIso,
    opening.dedupKey,
    opening.canonicalUrl.slice(0, 1000),
    opening.titleKey.slice(0, 200),
    opening.locationKey.slice(0, 200),
    opening.employerKey.slice(0, 200),
    opening.provenance.slice(0, 80),
    opening.expiresAt,
    opening.firstSeenAt,
    opening.contentHash,
  );
}

/** Writes added, changed, expired, and reactivated rows only. */
export async function applyOpeningDelta(db: D1Database, companyId: string, ops: OpeningOp[], nowIso: string): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "expire":
        statements.push(
          db.prepare(
            `UPDATE openings SET expires_at = ?, updated_at = ?
             WHERE company_id = ? AND external_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
          ).bind(nowIso, nowIso, companyId, op.externalId, nowIso),
          db.prepare("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?").bind(companyId, op.externalId),
        );
        break;
      case "add":
        statements.push(bindWrite(db, companyId, op, nowIso), ...tokenStatements(db, companyId, op.row.externalId, op.row.tokens));
        break;
      case "change":
      case "reactivate":
        if (op.storedExternalId !== op.row.externalId) {
          statements.push(
            db.prepare("DELETE FROM opening_search WHERE company_id = ? AND external_id = ?").bind(companyId, op.storedExternalId),
            db.prepare(
              `UPDATE openings SET external_id = ? WHERE company_id = ? AND external_id = ?`,
            ).bind(op.row.externalId, companyId, op.storedExternalId),
          );
        }
        statements.push(bindWrite(db, companyId, op, nowIso), ...tokenStatements(db, companyId, op.row.externalId, op.row.tokens));
        break;
      default: {
        const unexpected: never = op;
        throw new Error(String(unexpected));
      }
    }
  }
  for (const group of chunk(statements, 40)) {
    if (group.length) await db.batch(group);
  }
}

export async function loadStoredOpenings(db: D1Database, companyId: string): Promise<StoredOpening[]> {
  const { results } = await db.prepare(
    `SELECT external_id, dedup_key, canonical_url, content_hash, first_seen_at, provenance, expires_at
     FROM openings WHERE company_id = ?`,
  ).bind(companyId).all<{
    external_id: string;
    dedup_key: string;
    canonical_url: string;
    content_hash: string;
    first_seen_at: string | null;
    provenance: string;
    expires_at: string | null;
  }>();
  return results.map((row) => ({
    externalId: row.external_id,
    dedupKey: row.dedup_key,
    canonicalUrl: row.canonical_url,
    contentHash: row.content_hash,
    firstSeenAt: row.first_seen_at,
    provenance: row.provenance,
    expiresAt: row.expires_at,
  }));
}

export function incomingFromListing(
  employer: string,
  provenance: string,
  opening: Opening,
  identity: ReturnType<typeof openingDedupKey>,
): IncomingOpening {
  return {
    externalId: opening.externalId,
    title: opening.title,
    location: opening.location,
    url: opening.url,
    dedupKey: identity.dedupKey,
    canonicalUrl: identity.canonicalUrl,
    titleKey: identity.titleKey,
    locationKey: identity.locationKey,
    employerKey: employer,
    provenance,
    contentHash: openingContentHash({
      externalId: opening.externalId,
      canonicalUrl: identity.canonicalUrl,
      title: identity.titleKey,
      location: identity.locationKey,
    }),
    expiresAt: opening.expiresAt ?? null,
    tokens: searchTokens(opening.title),
  };
}
