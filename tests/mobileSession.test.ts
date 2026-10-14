import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { describe, expect, it } from "vitest";
import {
  isMobileAccessToken,
  isMobileRefreshToken,
  parseMobileAuthResponse,
  parseMobileSessionTokens,
  type MobileSessionTokens,
} from "../shared/mobileApi";
import {
  mobileUserFromAccess,
  revokeAllMobileSessions,
  rotateMobileSession,
  startMobileSession,
} from "../worker/mobileSession";
import { hashPassword } from "../worker/crypto";
import type { Env } from "../worker/env";
import worker from "../worker/index";

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

describe("mobile sessions", () => {
  it("parses only complete prefixed token pairs", () => {
    const session = {
      accessToken: `cjsma_${"a".repeat(43)}`,
      refreshToken: `cjsmr_${"b".repeat(43)}`,
      accessExpiresAt: "2026-10-14T12:15:00.000Z",
      refreshExpiresAt: "2026-11-13T12:00:00.000Z",
    };
    expect(isMobileAccessToken(session.accessToken)).toBe(true);
    expect(isMobileRefreshToken(session.refreshToken)).toBe(true);
    expect(parseMobileSessionTokens(session)).toEqual(session);
    expect(parseMobileAuthResponse({ ok: true, session })).toEqual({ ok: true, session });
    expect(parseMobileAuthResponse({ ok: true, session: { ...session, refreshToken: "bad" } })).toBeNull();
  });

  it("rotates refresh tokens, expires the old access token, and revokes a device", async () => {
    const proxy = await getPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const env = { ...proxy.env, DB: db } as unknown as Env;
    const userId = crypto.randomUUID();
    const now = new Date("2026-10-14T12:00:00.000Z");
    const metadata = { platform: "ios" as const, deviceName: "iPhone", appVersion: "1.0.0" };
    try {
      await db.prepare(
        "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, '!', 1)",
      ).bind(userId, `${userId}@mobile.test`).run();

      const first = await startMobileSession(db, userId, metadata, now);
      expect((await mobileUserFromAccess(db, first.accessToken, now))?.id).toBe(userId);

      const second = await rotateMobileSession(env, first.refreshToken, { ...metadata, platform: "android" }, new Date(now.getTime() + 1_000));
      expect(await mobileUserFromAccess(db, first.accessToken, new Date(now.getTime() + 2_000))).toBeNull();
      expect((await mobileUserFromAccess(db, second.accessToken, new Date(now.getTime() + 2_000)))?.id).toBe(userId);
      await expect(
        rotateMobileSession(env, first.refreshToken, metadata, new Date(now.getTime() + 3_000)),
      ).rejects.toMatchObject({ status: 409 });
      expect(await mobileUserFromAccess(db, second.accessToken, new Date(now.getTime() + 4_000))).toBeNull();

      await revokeAllMobileSessions(db, userId, new Date(now.getTime() + 5_000));
      expect(await mobileUserFromAccess(db, second.accessToken, new Date(now.getTime() + 6_000))).toBeNull();
    } finally {
      await db.prepare("DELETE FROM mobile_refresh_tokens WHERE session_id IN (SELECT id FROM mobile_sessions WHERE user_id = ?)").bind(userId).run();
      await db.prepare("DELETE FROM mobile_sessions WHERE user_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  });

  it("allows one concurrent refresh and revokes the token family when the other request replays it", async () => {
    const proxy = await getPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const env = { ...proxy.env, DB: db } as unknown as Env;
    const userId = crypto.randomUUID();
    const now = new Date("2026-10-14T12:00:00.000Z");
    const metadata = { platform: "android" as const, deviceName: "Pixel", appVersion: "1.0.0" };
    try {
      await db.prepare(
        "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, '!', 1)",
      ).bind(userId, `${userId}@mobile.test`).run();
      const first = await startMobileSession(db, userId, metadata, now);
      const results = await Promise.allSettled([
        rotateMobileSession(env, first.refreshToken, metadata, new Date(now.getTime() + 1_000)),
        rotateMobileSession(env, first.refreshToken, metadata, new Date(now.getTime() + 1_000)),
      ]);
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<MobileSessionTokens> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ status: 409 });
      expect(await mobileUserFromAccess(db, fulfilled[0]!.value.accessToken, new Date(now.getTime() + 2_000))).toBeNull();
    } finally {
      await db.prepare("DELETE FROM mobile_refresh_tokens WHERE session_id IN (SELECT id FROM mobile_sessions WHERE user_id = ?)").bind(userId).run();
      await db.prepare("DELETE FROM mobile_sessions WHERE user_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  });

  it("keeps web auth intact while mobile login, refresh, me, and logout use bearer tokens", async () => {
    const proxy = await getPlatformProxy();
    const db = proxy.env.DB as D1Database;
    const env = { ...proxy.env, DB: db } as unknown as Env;
    const userId = crypto.randomUUID();
    const email = `${userId}@mobile.test`;
    const password = "mobile-password-123";
    const mobileHeaders = {
      "content-type": "application/json",
      "x-cjs-client": "mobile",
      "x-cjs-platform": "android",
      "x-cjs-device-name": "Pixel test",
      "x-cjs-app-version": "1.0.0",
    };
    try {
      await db.prepare(
        "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
      ).bind(userId, email, await hashPassword(password)).run();

      const webLogin = await worker.fetch(new Request("https://x.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }), env, ctx);
      expect(webLogin.status).toBe(200);
      expect(webLogin.headers.get("set-cookie")).toContain("cjs_session=");
      expect(await webLogin.json()).toEqual({ ok: true });

      const login = await worker.fetch(new Request("https://x.test/api/auth/login", {
        method: "POST",
        headers: mobileHeaders,
        body: JSON.stringify({ email, password }),
      }), env, ctx);
      expect(login.status).toBe(200);
      expect(login.headers.get("set-cookie")).toBeNull();
      const loginBody = parseMobileAuthResponse(await login.json());
      expect(loginBody).not.toBeNull();
      if (!loginBody) throw new Error("mobile login did not return tokens");

      const me = await worker.fetch(new Request("https://x.test/api/auth/me", {
        headers: { authorization: `Bearer ${loginBody.session.accessToken}` },
      }), env, ctx);
      expect(me.status).toBe(200);
      expect((await me.json() as { email: string }).email).toBe(email);

      const refresh = await worker.fetch(new Request("https://x.test/api/auth/refresh", {
        method: "POST",
        headers: mobileHeaders,
        body: JSON.stringify({ refreshToken: loginBody.session.refreshToken }),
      }), env, ctx);
      expect(refresh.status).toBe(200);
      const refreshBody = parseMobileAuthResponse(await refresh.json());
      expect(refreshBody).not.toBeNull();
      if (!refreshBody) throw new Error("mobile refresh did not return tokens");

      const oldMe = await worker.fetch(new Request("https://x.test/api/auth/me", {
        headers: { authorization: `Bearer ${loginBody.session.accessToken}` },
      }), env, ctx);
      expect(oldMe.status).toBe(401);

      const logout = await worker.fetch(new Request("https://x.test/api/auth/logout", {
        method: "POST",
        headers: { ...mobileHeaders, authorization: `Bearer ${refreshBody.session.accessToken}` },
        body: "{}",
      }), env, ctx);
      expect(logout.status).toBe(200);
      const afterLogout = await worker.fetch(new Request("https://x.test/api/auth/me", {
        headers: { authorization: `Bearer ${refreshBody.session.accessToken}` },
      }), env, ctx);
      expect(afterLogout.status).toBe(401);
    } finally {
      await db.prepare("DELETE FROM rate_limits").run();
      await db.prepare("DELETE FROM mobile_refresh_tokens WHERE session_id IN (SELECT id FROM mobile_sessions WHERE user_id = ?)").bind(userId).run();
      await db.prepare("DELETE FROM mobile_sessions WHERE user_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      await proxy.dispose();
    }
  });
});
