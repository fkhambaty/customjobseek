export type MobilePlatform = "ios" | "android";

export interface MobileSessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface MobileAuthResponse {
  ok: true;
  session: MobileSessionTokens;
}

export interface MobileRefreshRequest {
  refreshToken: string;
}

export const MOBILE_CLIENT_HEADER = "x-cjs-client";
export const MOBILE_PLATFORM_HEADER = "x-cjs-platform";
export const MOBILE_DEVICE_HEADER = "x-cjs-device-name";
export const MOBILE_VERSION_HEADER = "x-cjs-app-version";
export const MOBILE_CLIENT_VALUE = "mobile";

export function parseMobilePlatform(value: unknown): MobilePlatform | null {
  if (value === "ios" || value === "android") return value;
  return null;
}

function validToken(value: unknown, prefix: string): value is string {
  return typeof value === "string"
    && value.startsWith(prefix)
    && value.length >= prefix.length + 40
    && value.length <= prefix.length + 100
    && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isMobileAccessToken(value: unknown): value is string {
  return validToken(value, "cjsma_");
}

export function isMobileRefreshToken(value: unknown): value is string {
  return validToken(value, "cjsmr_");
}

export function parseMobileSessionTokens(value: unknown): MobileSessionTokens | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isMobileAccessToken(row.accessToken) || !isMobileRefreshToken(row.refreshToken)) return null;
  if (typeof row.accessExpiresAt !== "string" || Number.isNaN(Date.parse(row.accessExpiresAt))) return null;
  if (typeof row.refreshExpiresAt !== "string" || Number.isNaN(Date.parse(row.refreshExpiresAt))) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessExpiresAt: row.accessExpiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
  };
}

export function parseMobileAuthResponse(value: unknown): MobileAuthResponse | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const session = parseMobileSessionTokens(row.session);
  return row.ok === true && session ? { ok: true, session } : null;
}
