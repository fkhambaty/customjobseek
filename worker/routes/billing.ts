import { Hono } from "hono";
import { utcDay } from "../../shared/commercial";
import { inspectPayments, parseCheckoutRequest, paymentsAreOpen, publicPaymentStatus } from "../../shared/payments";
import {
  acceptRazorpayWebhook,
  assertCheckoutClosed,
  listOrders,
  orderForUser,
  recoverCheckout,
  startCheckout,
} from "../billing";
import { HttpError, type AppEnv } from "../env";
import { notifyOwner } from "../notify";
import { enforceRateLimit } from "../rateLimit";
import { requireUser } from "../session";
import { noteProductEvent } from "../usage";

function displayCurrencyOf(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) return null;
  return value.toUpperCase();
}

export const billing = new Hono<AppEnv>()
  .get("/status", (c) => c.json(publicPaymentStatus(c.env)))
  .post("/razorpay/webhook", async (c) => {
    const result = await acceptRazorpayWebhook(
      c.env,
      await c.req.text(),
      c.req.header("x-razorpay-signature") ?? null,
      c.req.header("x-razorpay-event-id") ?? null,
    );
    c.executionCtx?.waitUntil(result.email);
    return c.json(result.body, result.status);
  });

export const checkout = new Hono<AppEnv>()
  .post("/", requireUser, async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "checkout", user.id);
    await noteProductEvent(c.env.DB, user.id, "checkout_attempt");
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = parseCheckoutRequest(body);
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    if (!paymentsAreOpen(c.env)) {
      const payments = inspectPayments(c.env);
      const closed = !payments.enabled && payments.reason === "disabled";
      c.executionCtx?.waitUntil(notifyOwner(c.env, {
        kind: "payment_needs_attention",
        dedupeKey: closed ? `checkout-closed:${utcDay()}` : `checkout-misconfigured:${utcDay()}`,
        summary: closed
          ? "Someone opened checkout. Payments are still closed."
          : "Checkout is turned on but the Razorpay settings are incomplete. No charge was made.",
      }).catch((err: unknown) => console.error("checkout alert failed", err)));
      assertCheckoutClosed(c.env);
    }
    return c.json(await startCheckout(c.env, user, parsed.value));
  })
  .get("/orders", requireUser, async (c) => {
    return c.json({ orders: await listOrders(c.env, c.get("user")) });
  })
  .get("/orders/:id", requireUser, async (c) => {
    return c.json(await orderForUser(c.env, c.get("user"), c.req.param("id"), displayCurrencyOf(c.req.query("displayCurrency"))));
  })
  .post("/orders/:id/recover", requireUser, async (c) => {
    const user = c.get("user");
    await enforceRateLimit(c.env.DB, "checkout_recover", user.id);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await recoverCheckout(c.env, user, c.req.param("id"), displayCurrencyOf(body.displayCurrency));
    c.executionCtx?.waitUntil(result.email);
    return c.json(result.view);
  });
