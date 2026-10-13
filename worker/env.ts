import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DATA_KEY: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PAYMENTS_ENABLED?: string;
  /** Inbox for operational alerts. Those notes never include a resume, password, or support message. */
  OWNER_EMAIL?: string;
  /** Public checkout key. Safe to show in the browser. Never the key secret. */
  RAZORPAY_KEY_ID?: string;
  /** Server-only. Used to create orders and read them back. Never sent to the browser. */
  RAZORPAY_KEY_SECRET?: string;
  /** Server-only. Used to verify webhook bodies. Never sent to the browser. */
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** Reserved. Product counts stay in D1 until a later release reads the stored cookie choice. */
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_API_TOKEN?: string;
  /** Public site origin for links in lifecycle email. Defaults to https://customjobseek.com. */
  PUBLIC_ORIGIN?: string;
  /** Real operator name for the legal pages. Leave unset rather than inventing one. */
  LEGAL_NAME?: string;
  /** Real postal address for the legal pages. Leave unset rather than inventing one. */
  LEGAL_ADDRESS?: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified: number;
  plan: string;
  eval_credits: number;
  resume_credits: number;
  scan_runs?: number;
  last_manual_scan_at?: string | null;
  scan_lock_until?: string | null;
  credits_expire_at: string | null;
  created_at: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: UserRow } };
export type AppContext = Context<AppEnv>;

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 501 | 502,
    message: string,
  ) {
    super(message);
  }
}
