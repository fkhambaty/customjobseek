import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DATA_KEY: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PAYMENTS_ENABLED?: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified: number;
  plan: string;
  eval_credits: number;
  resume_credits: number;
  credits_expire_at: string | null;
  created_at: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: UserRow } };
export type AppContext = Context<AppEnv>;

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 500 | 501 | 502,
    message: string,
  ) {
    super(message);
  }
}
