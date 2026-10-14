import { abortBatchWhen } from "./batchGuard";
import { randomToken, sha256 } from "./crypto";
import { HttpError, type AppContext, type Env, type UserRow } from "./env";
import {
  isMobileAccessToken,
  isMobileRefreshToken,
  MOBILE_CLIENT_HEADER,
  MOBILE_CLIENT_VALUE,
  MOBILE_DEVICE_HEADER,
  MOBILE_PLATFORM_HEADER,
  MOBILE_VERSION_HEADER,
  parseMobilePlatform,
  type MobilePlatform,
  type MobileSessionTokens,
} from "../shared/mobileApi";

export const MOBILE_ACCESS_MS = 15 * 60_000;
export const MOBILE_REFRESH_MS = 30 * 86_400_000;

interface MobileMetadata {
  platform: MobilePlatform;
  deviceName: string;
  appVersion: string;
}

interface RefreshRow {
  token_hash: string;
  session_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  user_id: string;
}

function safeLabel(value: string | undefined, max: number): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function makeAccessToken(): string {
  return `cjsma_${randomToken()}`;
}

function makeRefreshToken(): string {
  return `cjsmr_${randomToken()}`;
}

export function isMobileClient(c: AppContext): boolean {
  return c.req.header(MOBILE_CLIENT_HEADER) === MOBILE_CLIENT_VALUE;
}

export function mobileMetadata(c: AppContext): MobileMetadata {
  const platform = parseMobilePlatform(c.req.header(MOBILE_PLATFORM_HEADER));
  if (!platform) throw new HttpError(400, "Choose a supported mobile platform.");
  return {
    platform,
    deviceName: safeLabel(c.req.header(MOBILE_DEVICE_HEADER), 80),
    appVersion: safeLabel(c.req.header(MOBILE_VERSION_HEADER), 40),
  };
}

export function bearerAccessToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token, extra] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || extra || !isMobileAccessToken(token)) return null;
  return token;
}

export async function startMobileSession(
  db: D1Database,
  userId: string,
  metadata: MobileMetadata,
  now = new Date(),
): Promise<MobileSessionTokens> {
  const id = crypto.randomUUID();
  const accessToken = makeAccessToken();
  const refreshToken = makeRefreshToken();
  const accessExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_MS).toISOString();
  const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_MS).toISOString();
  const [accessHash, refreshHash] = await Promise.all([sha256(accessToken), sha256(refreshToken)]);
  await db.batch([
    db.prepare(
      `INSERT INTO mobile_sessions
       (id, user_id, access_token_hash, access_expires_at, platform, device_name, app_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      accessHash,
      accessExpiresAt,
      metadata.platform,
      metadata.deviceName,
      metadata.appVersion,
      now.toISOString(),
      now.toISOString(),
    ),
    db.prepare(
      `INSERT INTO mobile_refresh_tokens (token_hash, session_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(refreshHash, id, refreshExpiresAt, now.toISOString()),
  ]);
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

export async function rotateMobileSession(
  env: Env,
  refreshToken: string,
  metadata: MobileMetadata,
  now = new Date(),
): Promise<MobileSessionTokens> {
  if (!isMobileRefreshToken(refreshToken)) throw new HttpError(401, "Your mobile session has ended. Sign in again.");
  const refreshHash = await sha256(refreshToken);
  const row = await env.DB.prepare(
    `SELECT r.token_hash, r.session_id, r.expires_at, r.used_at, s.revoked_at, s.user_id
     FROM mobile_refresh_tokens r
     JOIN mobile_sessions s ON s.id = r.session_id
     WHERE r.token_hash = ?`,
  ).bind(refreshHash).first<RefreshRow>();
  if (!row || row.revoked_at) throw new HttpError(401, "Your mobile session has ended. Sign in again.");
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await env.DB.prepare("UPDATE mobile_sessions SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(now.toISOString(), now.toISOString(), row.session_id)
      .run();
    throw new HttpError(401, "Your mobile session has expired. Sign in again.");
  }
  if (row.used_at) {
    await env.DB.prepare("UPDATE mobile_sessions SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(now.toISOString(), now.toISOString(), row.session_id)
      .run();
    throw new HttpError(409, "That refresh token was already used. Sign in again.");
  }

  const accessToken = makeAccessToken();
  const nextRefreshToken = makeRefreshToken();
  const accessExpiresAt = new Date(now.getTime() + MOBILE_ACCESS_MS).toISOString();
  const refreshExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_MS).toISOString();
  const [accessHash, nextRefreshHash] = await Promise.all([sha256(accessToken), sha256(nextRefreshToken)]);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE mobile_refresh_tokens SET used_at = ?, replaced_by_hash = ?
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
      ).bind(now.toISOString(), nextRefreshHash, refreshHash, now.toISOString()),
      env.DB.prepare(abortBatchWhen("changes() = 0")),
      env.DB.prepare(
        `INSERT INTO mobile_refresh_tokens (token_hash, session_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(nextRefreshHash, row.session_id, refreshExpiresAt, now.toISOString()),
      env.DB.prepare(
        `UPDATE mobile_sessions
         SET access_token_hash = ?, access_expires_at = ?, platform = ?, device_name = ?,
             app_version = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      ).bind(
        accessHash,
        accessExpiresAt,
        metadata.platform,
        metadata.deviceName,
        metadata.appVersion,
        now.toISOString(),
        row.session_id,
        row.user_id,
      ),
      env.DB.prepare(abortBatchWhen("changes() = 0")),
    ]);
  } catch {
    const consumed = await env.DB.prepare(
      "SELECT used_at FROM mobile_refresh_tokens WHERE token_hash = ?",
    ).bind(refreshHash).first<{ used_at: string | null }>();
    if (consumed?.used_at) {
      await env.DB.prepare("UPDATE mobile_sessions SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now.toISOString(), now.toISOString(), row.session_id)
        .run();
    }
    throw new HttpError(409, "That refresh token was already used. Sign in again.");
  }
  return { accessToken, refreshToken: nextRefreshToken, accessExpiresAt, refreshExpiresAt };
}

export async function mobileUserFromAccess(db: D1Database, accessToken: string, now = new Date()): Promise<UserRow | null> {
  if (!isMobileAccessToken(accessToken)) return null;
  return db.prepare(
    `SELECT u.* FROM mobile_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.access_token_hash = ? AND s.access_expires_at > ? AND s.revoked_at IS NULL`,
  ).bind(await sha256(accessToken), now.toISOString()).first<UserRow>();
}

export async function revokeMobileSessionByAccess(db: D1Database, accessToken: string, now = new Date()): Promise<void> {
  if (!isMobileAccessToken(accessToken)) return;
  await db.prepare(
    "UPDATE mobile_sessions SET revoked_at = ?, updated_at = ? WHERE access_token_hash = ? AND revoked_at IS NULL",
  ).bind(now.toISOString(), now.toISOString(), await sha256(accessToken)).run();
}

export async function revokeAllMobileSessions(db: D1Database, userId: string, now = new Date()): Promise<void> {
  await db.prepare(
    "UPDATE mobile_sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL",
  ).bind(now.toISOString(), now.toISOString(), userId).run();
}

export async function mobileAccessIsPaid(db: D1Database, accessToken: string): Promise<boolean> {
  if (!isMobileAccessToken(accessToken)) return false;
  const row = await db.prepare(
    `SELECT (u.plan <> 'free' OR EXISTS (
       SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'
     )) AS paid
     FROM mobile_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.access_token_hash = ? AND s.access_expires_at > ? AND s.revoked_at IS NULL`,
  ).bind(await sha256(accessToken), new Date().toISOString()).first<{ paid: number }>();
  return Boolean(row?.paid);
}

export async function mobileRefreshIsPaid(db: D1Database, refreshToken: string): Promise<boolean> {
  if (!isMobileRefreshToken(refreshToken)) return false;
  const row = await db.prepare(
    `SELECT (u.plan <> 'free' OR EXISTS (
       SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'
     )) AS paid
     FROM mobile_refresh_tokens r
     JOIN mobile_sessions s ON s.id = r.session_id
     JOIN users u ON u.id = s.user_id
     WHERE r.token_hash = ? AND r.expires_at > ? AND r.used_at IS NULL AND s.revoked_at IS NULL`,
  ).bind(await sha256(refreshToken), new Date().toISOString()).first<{ paid: number }>();
  return Boolean(row?.paid);
}
