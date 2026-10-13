import type { PaidSku } from "../shared/commercial";
import { isPublicKeyId, type CheckoutSession } from "../shared/payments";
import { api } from "./api";

interface RazorpayCheckout {
  open: () => void;
  on: (event: "payment.failed", handler: () => void) => void;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  order_id: string;
  prefill?: { email?: string };
  notes?: { sku: string; order_id: string };
  theme?: { color: string };
  handler: () => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}

interface RazorpayConstructor {
  new (options: RazorpayOptions): RazorpayCheckout;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export type CheckoutEnd = "completed" | "dismissed" | "failed";

/** Reads after a completed handler. A dismissed or failed checkout does not use this. */
export const CHECKOUT_POLL_LIMIT = 8;

export function checkoutReturnPath(orderId: string, end: CheckoutEnd): string {
  const params = new URLSearchParams({ order: orderId });
  if (end !== "completed") params.set("result", end);
  return `/checkout/return?${params}`;
}

export function checkoutAbandoned(result: string | null): boolean {
  return result === "dismissed" || result === "failed";
}

/** Terminal statuses and a closed checkout stop. A waiting order polls only up to the limit. */
export function shouldPollCheckout(input: {
  status: "created" | "paid" | "failed" | "refunded" | null;
  abandoned: boolean;
  attempts: number;
}): boolean {
  if (input.abandoned) return false;
  if (input.status === "paid" || input.status === "failed" || input.status === "refunded") return false;
  return input.attempts < CHECKOUT_POLL_LIMIT;
}

/** Dismiss, failure, or a poll that ended still on "created" means the payment was not completed. */
export function checkoutShowsIncomplete(input: {
  status: "created" | "paid" | "failed" | "refunded" | null;
  abandoned: boolean;
  attempts: number;
}): boolean {
  if (input.status === "paid" || input.status === "failed" || input.status === "refunded") return false;
  if (input.abandoned) return true;
  return input.attempts >= CHECKOUT_POLL_LIMIT;
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay checkout could not be loaded. Nothing was charged."));
    document.body.appendChild(script);
  });
}

/**
 * Opens Razorpay's own checkout. The handler does not read the payment signature.
 * Credits are added only after the signed webhook, or a server read of Razorpay, says the payment was captured.
 */
export async function openRazorpayCheckout(session: CheckoutSession, email: string, onDone: (orderId: string, end: CheckoutEnd) => void): Promise<void> {
  if (!isPublicKeyId(session.keyId) || session.currency !== "INR" || session.recurring !== false) {
    throw new Error("Checkout could not be opened.");
  }
  await loadRazorpay();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("Razorpay checkout could not be loaded. Nothing was charged.");
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (end: CheckoutEnd) => {
      if (finished) return;
      finished = true;
      onDone(session.orderId, end);
      resolve();
    };
    const checkout = new Razorpay({
      key: session.keyId,
      amount: session.amount,
      currency: session.currency,
      name: "CustomJobSeek",
      description: session.description,
      order_id: session.razorpayOrderId,
      prefill: email ? { email } : undefined,
      notes: { sku: session.sku, order_id: session.orderId },
      theme: { color: "#1b1a17" },
      handler: () => finish("completed"),
      modal: { ondismiss: () => finish("dismissed"), confirm_close: true },
    });
    checkout.on("payment.failed", () => finish("failed"));
    checkout.open();
  });
}

export async function startPurchase(input: {
  sku: PaidSku;
  email: string;
  displayCurrency?: string;
  onDone: (orderId: string, end: CheckoutEnd) => void;
}): Promise<void> {
  const session = await api.checkout({
    sku: input.sku,
    idempotencyKey: crypto.randomUUID(),
    displayCurrency: input.displayCurrency,
  });
  await openRazorpayCheckout(session, input.email, input.onDone);
}
