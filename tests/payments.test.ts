import { describe, expect, it } from "vitest";
import { PLANS } from "../shared/plans";
import {
  buildCheckoutSession,
  contextualUpgrade,
  inspectPayments,
  offerFacts,
  parseCheckoutRequest,
  parseProviderEvent,
  paymentFromProviderSnapshot,
  legalOperatorCopy,
  perApplicationPriceLabel,
  publicPaymentStatus,
  razorpayHmacHex,
  razorpayOrderPayload,
  readVerifiedWebhook,
  REFUND_WALLET_LIMITATION,
  settleIncomingPayment,
  shouldEmailUser,
  unspentRefundTake,
  userPaymentText,
  type IncomingPayment,
  type StoredOrder,
} from "../shared/payments";
import { razorpayCredentials } from "../worker/razorpay";

const SECRET = "webhook_test_secret_value";
const KEY_SECRET = "key_secret_value_123";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ORDER = "order_TestOrder123";

function stored(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: ORDER_ID,
    sku: "starter",
    amountInr: PLANS.starter.priceInr,
    currency: "INR",
    status: "created",
    providerOrderId: PROVIDER_ORDER,
    applied: false,
    ...overrides,
  };
}

function notice(overrides: Partial<IncomingPayment> = {}): IncomingPayment {
  return {
    eventId: "evt_captured_01",
    kind: "payment.captured",
    action: "grant",
    providerOrderId: PROVIDER_ORDER,
    amountMinor: PLANS.starter.priceInr * 100,
    currency: "INR",
    receipt: null,
    linkedOrderId: ORDER_ID,
    linkBroken: false,
    ...overrides,
  };
}

function capturedBody(amount = PLANS.starter.priceInr * 100): string {
  return JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_TestPayment1",
          amount,
          currency: "INR",
          status: "captured",
          order_id: PROVIDER_ORDER,
          email: "buyer@example.com",
          contact: "+919800000000",
          card_id: "card_secret",
          notes: { sku: "starter", order_id: ORDER_ID },
        },
      },
    },
  });
}

const ready = {
  PAYMENTS_ENABLED: "true",
  RAZORPAY_KEY_ID: "rzp_test_abcdefgh",
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: SECRET,
};

describe("Razorpay checkout", () => {
  it("verifies the raw body before parsing and ignores a rewritten JSON body", async () => {
    const raw = capturedBody();
    const signature = await razorpayHmacHex(SECRET, raw);
    const spaced = raw.replace("payment.captured", "payment.captured");
    const pretty = JSON.stringify(JSON.parse(raw), null, 2);
    const verified = await readVerifiedWebhook(SECRET, raw, signature, "evt_captured_01");
    expect(verified.ok).toBe(true);
    if (!verified.ok || !verified.payment) throw new Error("expected a payment");
    expect(verified.payment.action).toBe("grant");
    expect(JSON.stringify(verified.payment)).not.toContain("buyer@example.com");
    expect(JSON.stringify(verified.payment)).not.toContain("card_secret");
    expect(await readVerifiedWebhook(SECRET, pretty, signature, "evt_captured_01")).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(spaced).toBe(raw);

    const parse = JSON.parse;
    let calls = 0;
    JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
      calls += 1;
      return parse(text, reviver);
    }) as typeof JSON.parse;
    try {
      expect(await readVerifiedWebhook(SECRET, "{{{", "ab", "evt_12345678")).toEqual({ ok: false, reason: "bad_signature" });
      expect(await readVerifiedWebhook(SECRET, "{{{", "a".repeat(64), null)).toEqual({ ok: false, reason: "bad_signature" });
      expect(calls).toBe(0);
    } finally {
      JSON.parse = parse;
    }
  });

  it("stores one grant for a duplicate webhook and does not grant a second time", () => {
    const order = stored();
    const payment = notice();
    const first = settleIncomingPayment(order, false, payment);
    expect(first).toMatchObject({ grant: true, storeEvent: true, nextStatus: "paid", reason: "granted" });
    order.status = "paid";
    order.applied = true;
    const second = settleIncomingPayment(order, true, payment);
    expect(second).toMatchObject({ grant: false, storeEvent: false, reason: "already_applied" });
    expect(shouldEmailUser(first, "applied", true)).toBe("paid");
    expect(shouldEmailUser(second, "already", false)).toBeNull();
  });

  it("finishes a grant if the first webhook stored the event and then stopped", () => {
    const order = stored({ status: "paid", applied: false });
    const again = settleIncomingPayment(order, true, notice());
    expect(again.grant).toBe(true);
    expect(again.storeEvent).toBe(false);
    order.applied = true;
    expect(settleIncomingPayment(order, true, notice()).grant).toBe(false);
  });

  it("does not grant when the amount, currency, or order does not match", () => {
    expect(settleIncomingPayment(stored(), false, notice({ amountMinor: 100 }))).toMatchObject({
      grant: false,
      nextStatus: null,
      reason: "amount_mismatch",
    });
    expect(settleIncomingPayment(stored(), false, notice({ currency: "USD" }))).toMatchObject({
      grant: false,
      reason: "currency_mismatch",
    });
    expect(settleIncomingPayment(stored(), false, notice({ providerOrderId: "order_OtherOrder99" }))).toMatchObject({
      grant: false,
      reason: "order_mismatch",
    });
    expect(settleIncomingPayment(stored(), false, notice({ linkedOrderId: "22222222-2222-4222-8222-222222222222" }))).toMatchObject({
      grant: false,
      reason: "order_mismatch",
    });
    expect(settleIncomingPayment(null, false, notice())).toMatchObject({ grant: false, storeEvent: false, reason: "unknown_order" });
  });

  it("records failures and refunds without granting, including a capture after a refund", () => {
    const failed = settleIncomingPayment(stored(), false, notice({ eventId: "evt_failed_01", kind: "payment.failed", action: "fail" }));
    expect(failed).toMatchObject({ grant: false, nextStatus: "failed", eventStatus: "failed" });
    expect(shouldEmailUser(failed, "not_payable", true)).toBe("failed");

    const refunded = settleIncomingPayment(stored({ status: "paid", applied: true }), false, notice({
      eventId: "evt_refund_01",
      kind: "refund.processed",
      action: "refund",
    }));
    expect(refunded).toMatchObject({ grant: false, nextStatus: "refunded" });
    expect(shouldEmailUser(refunded, "not_payable", true)).toBe("refunded");

    const afterRefund = settleIncomingPayment(stored({ status: "refunded" }), false, notice({ eventId: "evt_late_01" }));
    expect(afterRefund).toMatchObject({ grant: false, nextStatus: null, reason: "blocked_refunded" });
    expect(settleIncomingPayment(stored(), false, notice({ action: "ignore", kind: "payment.authorized" }))).toMatchObject({
      grant: false,
      nextStatus: null,
      reason: "ignored",
    });
  });

  it("parses captured, failed, and refunded notices without keeping the buyer email", async () => {
    const raw = capturedBody();
    const verified = await readVerifiedWebhook(SECRET, raw, await razorpayHmacHex(SECRET, raw), "evt_captured_01");
    expect(verified.ok).toBe(true);
    const failedRaw = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_Fail1", amount: 59900, currency: "INR", status: "failed", order_id: PROVIDER_ORDER, email: "buyer@example.com" } } },
    });
    const failed = parseProviderEvent(JSON.parse(failedRaw), "evt_failed_01");
    expect(failed).toMatchObject({ action: "fail", amountMinor: 59900 });
    expect(JSON.stringify(failed)).not.toContain("buyer@example.com");
    const refunded = parseProviderEvent({
      event: "refund.processed",
      payload: {
        refund: { entity: { id: "rfnd_1", amount: 59900, currency: "INR" } },
        payment: { entity: { id: "pay_1", order_id: PROVIDER_ORDER, amount: 59900, currency: "INR", email: "buyer@example.com" } },
      },
    }, "evt_refund_01");
    expect(refunded).toMatchObject({ action: "refund", amountMinor: 59900 });
    const paid = parseProviderEvent({
      event: "order.paid",
      payload: {
        order: { entity: { id: PROVIDER_ORDER, amount: 59900, currency: "INR", status: "paid", receipt: ORDER_ID, notes: { order_id: ORDER_ID } } },
        payment: { entity: { id: "pay_1", amount: 59900, currency: "INR", status: "captured", order_id: PROVIDER_ORDER, email: "buyer@example.com" } },
      },
    }, "evt_order_paid_01");
    expect(paid).toMatchObject({ action: "grant", kind: "order.paid", amountMinor: 59900 });
    if (paid && paid !== "skip") expect(settleIncomingPayment(stored(), false, paid).grant).toBe(true);
    const partial = parseProviderEvent({
      event: "refund.processed",
      payload: {
        refund: { entity: { id: "rfnd_2", amount: 100, currency: "INR" } },
        payment: { entity: { order_id: PROVIDER_ORDER, currency: "INR" } },
      },
    }, "evt_partial_01");
    expect(partial).toMatchObject({ action: "refund", amountMinor: 100 });
    if (partial && partial !== "skip") {
      expect(settleIncomingPayment(stored({ status: "paid", applied: true }), false, partial).grant).toBe(false);
      expect(settleIncomingPayment(stored({ status: "paid", applied: true }), false, partial).nextStatus).toBeNull();
    }
  });

  it("keeps the Razorpay charge in INR even when a regional currency is displayed", () => {
    const parsed = parseCheckoutRequest({ sku: "growth", amount: 1, currency: "USD", idempotencyKey: "idempotency-key-0001", displayCurrency: "USD" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const payload = razorpayOrderPayload(parsed.value.sku, ORDER_ID);
    expect(payload).toMatchObject({ amount: PLANS.growth.priceInr * 100, currency: "INR", payment_capture: 1 });
    expect(payload.notes).toEqual({ sku: "growth", order_id: ORDER_ID });
    expect(offerFacts("starter", "USD").regionalNote).toContain("INR");
    expect(offerFacts("starter", "USD").regionalNote).toContain("do not convert");
    expect(offerFacts("starter", "USD").currency).toBe("INR");
    expect(offerFacts("starter", "USD").amountMinor).toBe(59900);
    const session = buildCheckoutSession({
      orderId: ORDER_ID,
      keyId: "rzp_test_abcdefgh",
      razorpayOrderId: PROVIDER_ORDER,
      sku: "starter",
      displayCurrency: "USD",
      wallet: { plan: "free", evalCredits: 0, resumeCredits: 0, scanRuns: 0, creditsExpireAt: null },
    });
    expect(session.amount).toBe(59900);
    expect(session.currency).toBe("INR");
    expect(session.recurring).toBe(false);
    expect(JSON.stringify(session)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(session)).not.toContain(SECRET);
  });

  it("requires the payments flag and all three credentials, and does not publish secrets", () => {
    expect(inspectPayments({ ...ready, PAYMENTS_ENABLED: "false" })).toMatchObject({ enabled: false, reason: "disabled" });
    expect(inspectPayments({ ...ready, PAYMENTS_ENABLED: "TRUE" })).toMatchObject({ reason: "disabled" });
    expect(inspectPayments({ ...ready, RAZORPAY_KEY_ID: "" })).toMatchObject({ reason: "missing_key_id" });
    expect(inspectPayments({ ...ready, RAZORPAY_KEY_SECRET: "" })).toMatchObject({ reason: "missing_key_secret" });
    expect(inspectPayments({ ...ready, RAZORPAY_WEBHOOK_SECRET: "" })).toMatchObject({ reason: "missing_webhook_secret" });
    expect(inspectPayments({ ...ready, RAZORPAY_KEY_ID: "pk_test_abcdefgh" })).toMatchObject({ reason: "bad_key_id" });
    expect(inspectPayments({ ...ready, RAZORPAY_KEY_SECRET: ready.RAZORPAY_KEY_ID })).toMatchObject({ reason: "bad_key_secret" });
    expect(inspectPayments({ ...ready, RAZORPAY_WEBHOOK_SECRET: KEY_SECRET })).toMatchObject({ reason: "bad_webhook_secret" });
    expect(inspectPayments(ready)).toEqual({ enabled: true, mode: "test", keyId: "rzp_test_abcdefgh" });
    expect(publicPaymentStatus(ready)).toEqual({ paymentsEnabled: true, operator: null });
    expect(JSON.stringify(publicPaymentStatus(ready))).not.toContain(KEY_SECRET);
    expect(JSON.stringify(publicPaymentStatus({ ...ready, PAYMENTS_ENABLED: "false" }))).not.toContain(SECRET);
    const named = publicPaymentStatus({ ...ready, LEGAL_NAME: "Example Ltd", LEGAL_ADDRESS: "1 Example Road" });
    expect(named.operator).toEqual({ name: "Example Ltd", address: "1 Example Road" });
    expect(publicPaymentStatus({ ...ready, LEGAL_NAME: " ", LEGAL_ADDRESS: "" }).operator).toBeNull();
    const withInbox = {
      ...ready,
      PAYMENTS_ENABLED: "false",
      OWNER_EMAIL: "owner@example.com",
      MAIL_FROM: "CustomJobSeek <no-reply@funberrykids.in>",
    };
    const published = JSON.stringify(publicPaymentStatus(withInbox));
    expect(published).not.toContain(SECRET);
    expect(published).not.toContain("owner@example.com");
    expect(published).not.toContain("funberry");
    expect(legalOperatorCopy({ paymentsEnabled: false, operator: null })).not.toContain("@");
    expect(legalOperatorCopy({ paymentsEnabled: false, operator: null })).toContain("Checkout is closed");
    expect(legalOperatorCopy({ paymentsEnabled: false, operator: null })).not.toMatch(/Ltd|Street|Road/);
    expect(legalOperatorCopy({ paymentsEnabled: false, operator: { name: "Example Ltd", address: "" } })).toContain("Operated by Example Ltd");
    expect(legalOperatorCopy({ paymentsEnabled: false, operator: { name: "Example Ltd", address: "" } })).toContain("street address is not configured");
    expect(perApplicationPriceLabel(599, 10)).toBe("₹59.90 per application");
    expect(perApplicationPriceLabel(999, 25)).toBe("₹39.96 per application");
    expect(perApplicationPriceLabel(1999, 60)).toBe("about ₹33 per application");
    expect(perApplicationPriceLabel(100, 4)).toBe("₹25 per application");
    expect(razorpayCredentials({ ...ready, PAYMENTS_ENABLED: "false" })).toBeNull();
    expect(razorpayCredentials({ ...ready, PAYMENTS_ENABLED: "false" }, { whenClosed: true })?.keyId).toBe("rzp_test_abcdefgh");
  });

  it("recovers only a captured paid order and never from the browser return alone", () => {
    const remoteOrder = { id: PROVIDER_ORDER, status: "paid", amount: 59900, currency: "INR", receipt: ORDER_ID };
    const captured = { items: [{ id: "pay_1", status: "captured", order_id: PROVIDER_ORDER, amount: 59900, currency: "INR" }] };
    const payment = paymentFromProviderSnapshot({ ourOrderId: ORDER_ID, providerOrderId: PROVIDER_ORDER, remoteOrder, remotePayments: captured });
    expect(payment?.action).toBe("grant");
    expect(paymentFromProviderSnapshot({
      ourOrderId: ORDER_ID,
      providerOrderId: PROVIDER_ORDER,
      remoteOrder: { ...remoteOrder, status: "attempted" },
      remotePayments: captured,
    })).toBeNull();
    expect(paymentFromProviderSnapshot({
      ourOrderId: ORDER_ID,
      providerOrderId: PROVIDER_ORDER,
      remoteOrder,
      remotePayments: { items: [{ status: "authorized", order_id: PROVIDER_ORDER, amount: 59900, currency: "INR" }] },
    })).toBeNull();
    expect(settleIncomingPayment(stored(), false, notice({ action: "ignore", kind: "browser.return" })).grant).toBe(false);
  });

  it("offers the next one-time price only after useful evidence and an empty balance", () => {
    const wallet = { plan: "free", evalCredits: 0, resumeCredits: 0, scanRuns: 0 };
    expect(contextualUpgrade({ ...wallet, evidence: false, blocked: "checks" })).toBeNull();
    expect(contextualUpgrade({ ...wallet, evidence: true, blocked: "checks" })?.sku).toBe("starter");
    expect(contextualUpgrade({ plan: "starter", evalCredits: 2, resumeCredits: 2, scanRuns: 0, evidence: true, blocked: "scans" })?.sku).toBe("runs5");
    const facts = offerFacts("starter");
    expect(facts).toMatchObject({ sku: "starter", currency: "INR", amountInr: 599, recurring: false, validityDays: 180 });
    expect(userPaymentText("paid", "starter", 599).text).toContain("starter");
    expect(userPaymentText("paid", "starter", 599).text).toContain("₹599 INR");
    expect(userPaymentText("failed", "runs5", 149).text).toContain("No credits were added");
    expect(userPaymentText("refunded", "starter", 599).text).not.toMatch(/rzp_|card_secret|buyer@example.com/);
    expect(userPaymentText("refunded", "starter", 599).text).toContain("will not add credits again");
    expect(offerFacts("starter").refundNote).toBe(REFUND_WALLET_LIMITATION);
  });

  it("reverses only the unspent part of a purchase and refuses a second pass", () => {
    const first = unspentRefundTake({
      status: "none",
      grantedEval: 10,
      grantedResume: 10,
      grantedRuns: 4,
      refundedEval: 0,
      refundedResume: 0,
      refundedRuns: 0,
      walletEval: 4,
      walletResume: 10,
      walletRuns: 0,
    });
    expect(first).toMatchObject({ evalCredits: 4, resumeCredits: 10, scanRuns: 0, status: "partial", alreadyClosed: false });
    const again = unspentRefundTake({
      status: first.status,
      grantedEval: 10,
      grantedResume: 10,
      grantedRuns: 4,
      refundedEval: 4,
      refundedResume: 10,
      refundedRuns: 0,
      walletEval: 0,
      walletResume: 0,
      walletRuns: 0,
    });
    expect(again.alreadyClosed).toBe(true);
    expect(again.evalCredits).toBe(0);
    const spent = unspentRefundTake({
      status: "none",
      grantedEval: 10,
      grantedResume: 10,
      grantedRuns: 4,
      refundedEval: 0,
      refundedResume: 0,
      refundedRuns: 0,
      walletEval: 0,
      walletResume: 0,
      walletRuns: 0,
    });
    expect(spent).toMatchObject({ evalCredits: 0, resumeCredits: 0, scanRuns: 0, status: "partial" });
    expect(REFUND_WALLET_LIMITATION).toMatch(/not taken below zero|never more than the balance/i);
  });
});
