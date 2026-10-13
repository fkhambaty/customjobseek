import {
  isProviderOrderId,
  inspectPayments,
  parseProviderOrder,
  type PaymentEnv,
  type RazorpayOrderPayload,
} from "../shared/payments";
import { HttpError, type Env } from "./env";

interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Server-only. Callers must not put this object on a response or in a log line. */
export function razorpayCredentials(env: PaymentEnv, options?: { whenClosed?: boolean }): RazorpayCredentials | null {
  const inspected = inspectPayments(options?.whenClosed ? { ...env, PAYMENTS_ENABLED: "true" } : env);
  if (!inspected.enabled) return null;
  const keySecret = env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!keySecret || !webhookSecret) return null;
  return { keyId: inspected.keyId, keySecret, webhookSecret };
}

async function razorpayJson(env: Env, path: string, body?: string): Promise<{ status: number; json: unknown }> {
  const creds = razorpayCredentials(env);
  if (!creds) throw new HttpError(501, "Payments are not ready yet.");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Basic ${btoa(`${creds.keyId}:${creds.keySecret}`)}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, json };
}

export async function createRazorpayOrder(env: Env, payload: RazorpayOrderPayload): Promise<string> {
  const { status, json } = await razorpayJson(env, "/orders", JSON.stringify(payload));
  if (status < 200 || status >= 300) {
    console.error("Razorpay order was not created", status);
    throw new HttpError(502, "Razorpay did not open the order. Nothing was charged.");
  }
  const parsed = parseProviderOrder(json, { amount: payload.amount, currency: "INR", receipt: payload.receipt });
  if (!parsed.ok) {
    console.error("Razorpay order did not match the server price", parsed.reason);
    throw new HttpError(502, "Razorpay returned a different amount. Nothing was charged.");
  }
  return parsed.id;
}

export async function fetchRazorpayOrder(env: Env, providerOrderId: string): Promise<unknown | null> {
  if (!isProviderOrderId(providerOrderId)) return null;
  const { status, json } = await razorpayJson(env, `/orders/${providerOrderId}`);
  if (status < 200 || status >= 300) {
    console.error("Razorpay order could not be read", status);
    return null;
  }
  return json;
}

export async function fetchRazorpayPayments(env: Env, providerOrderId: string): Promise<unknown | null> {
  if (!isProviderOrderId(providerOrderId)) return null;
  const { status, json } = await razorpayJson(env, `/orders/${providerOrderId}/payments`);
  if (status < 200 || status >= 300) {
    console.error("Razorpay payments could not be read", status);
    return null;
  }
  return json;
}
