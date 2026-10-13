import {
  entitlementExpiry,
  grantForPaidSku,
  grantForSku,
  isPaidSku,
  parseOrderStatus,
  utcDay,
  type OrderStatus,
} from "../shared/commercial";
import { planRank } from "../shared/plans";
import {
  buildCheckoutSession,
  buildOrderView,
  inspectPayments,
  isOrderId,
  paymentFromProviderSnapshot,
  paymentsAreOpen,
  razorpayOrderPayload,
  readVerifiedWebhook,
  settleIncomingPayment,
  shouldAlertOwner,
  shouldEmailUser,
  unspentRefundTake,
  userPaymentText,
  type RefundProgress,
  WEBHOOK_MAX_BYTES,
  type CheckoutRequest,
  type CheckoutSession,
  type IncomingPayment,
  type OrderView,
  type Settlement,
  type StoredOrder,
  type WalletView,
} from "../shared/payments";
import { abortBatchWhen } from "./batchGuard";
import { HttpError, type Env, type UserRow } from "./env";
import { sendMail } from "./mail";
import { notifyOwner } from "./notify";
import { reconcileReferralRewards } from "./referrals";
import { createRazorpayOrder, fetchRazorpayOrder, fetchRazorpayPayments, razorpayCredentials } from "./razorpay";

export type GrantResult = "applied" | "already" | "not_payable";

/**
 * Keys alone do not open checkout. PAYMENTS_ENABLED must be the string "true",
 * and the key id, key secret, and webhook secret must all validate.
 */
export function razorpayKeysPresent(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
}

export function assertCheckoutClosed(env: Env): never {
  const payments = inspectPayments(env);
  if (!payments.enabled && payments.reason !== "disabled") {
    console.error("Razorpay checkout is incomplete", payments.reason);
    throw new HttpError(501, "Payments are not ready yet. Your free credits are ready to use now.");
  }
  if (razorpayKeysPresent(env)) {
    console.info("Razorpay keys are set. Checkout stays closed until PAYMENTS_ENABLED is true.");
  }
  throw new HttpError(501, "Payments open soon. Your free credits are ready to use now.");
}

interface OrderRow {
  id: string;
  user_id: string;
  sku: string;
  status: string;
}

/**
 * Adds the credits for a paid order exactly once.
 * A later webhook should mark the order paid, then call this. It does not talk to Razorpay.
 * The insert, wallet update, ledger line, and applied flag commit together.
 */
export async function applyPaidOrder(env: Env, orderId: string, nowMs = Date.now()): Promise<GrantResult> {
  const order = await env.DB.prepare("SELECT id, user_id, sku, status FROM orders WHERE id = ?")
    .bind(orderId)
    .first<OrderRow>();
  if (!order) return "not_payable";
  const status: OrderStatus | null = parseOrderStatus(order.status);
  if (status !== "paid") return "not_payable";
  const grant = grantForSku(order.sku);
  if (!grant) return "not_payable";
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(order.user_id).first<{ id: string }>();
  if (!user) return "not_payable";

  const nowIso = new Date(nowMs).toISOString();
  const expiry = entitlementExpiry(grant.validityDays, nowMs);
  const nextRank = grant.plan ? planRank(grant.plan) : 0;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entitlements (id, user_id, order_id, sku, eval_credits, resume_credits, scan_runs, applied)
       SELECT ?, ?, ?, ?, ?, ?, ?, 0
       WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid')
       ON CONFLICT(order_id) DO NOTHING`,
    ).bind(crypto.randomUUID(), order.user_id, order.id, grant.sku, grant.evalCredits, grant.resumeCredits, grant.scanRuns, order.id),
    env.DB.prepare(
      `UPDATE users SET
         eval_credits = eval_credits + (SELECT eval_credits FROM entitlements WHERE order_id = ? AND applied = 0),
         resume_credits = resume_credits + (SELECT resume_credits FROM entitlements WHERE order_id = ? AND applied = 0),
         scan_runs = COALESCE(scan_runs, 0) + (SELECT scan_runs FROM entitlements WHERE order_id = ? AND applied = 0),
         -- Same rule as mergePaidPlan: a cheaper plan must not replace a higher plan or a later expiry.
         plan = CASE
           WHEN ? != 'plan' THEN plan
           WHEN CASE plan WHEN 'pro' THEN 3 WHEN 'growth' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END >= ? THEN plan
           ELSE ?
         END,
         credits_expire_at = CASE
           WHEN ? != 'plan' THEN credits_expire_at
           WHEN credits_expire_at IS NOT NULL AND credits_expire_at > ? THEN credits_expire_at
           ELSE COALESCE(NULLIF(?, ''), credits_expire_at)
         END
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM entitlements WHERE order_id = ? AND applied = 0)
         AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid')`,
    ).bind(
      order.id,
      order.id,
      order.id,
      grant.kind,
      nextRank,
      grant.plan ?? "",
      grant.kind,
      expiry ?? "",
      expiry ?? "",
      order.user_id,
      order.id,
      order.id,
    ),
    env.DB.prepare(
      `INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, runs_delta, note)
       SELECT user_id, 'grant', eval_credits, resume_credits, scan_runs, 'paid ' || sku
       FROM entitlements WHERE order_id = ? AND applied = 0
         AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid')`,
    ).bind(order.id, order.id),
    env.DB.prepare(
      `UPDATE entitlements SET applied = 1, applied_at = ?
       WHERE order_id = ? AND applied = 0
         AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid')`,
    ).bind(nowIso, order.id, order.id),
  ]);
  const applied = results[3]?.meta.changes ?? 0;
  if (applied > 0) {
    await reconcileReferralRewards(env, nowMs).catch((err: unknown) => console.error("referral reward failed", err));
    await notifyOwner(env, {
      kind: "payment_needs_attention",
      dedupeKey: `payment-applied:${order.id}`,
      summary: "A paid order applied credits. No card number is stored.",
    }).catch((err: unknown) => console.error("payment alert failed", err));
  }
  return applied > 0 ? "applied" : "already";
}

interface RefundEntitlement {
  user_id: string;
  eval_credits: number;
  resume_credits: number;
  scan_runs: number;
  refunded_eval: number;
  refunded_resume: number;
  refunded_runs: number;
  refund_status: string;
  applied: number;
}

function refundProgress(value: string): RefundProgress | null {
  switch (value) {
    case "none":
    case "partial":
    case "full":
      return value;
    default:
      return null;
  }
}

/**
 * Reverses whatever part of this purchase is still in the pooled wallet.
 * A second call does nothing. The balance is not taken below zero.
 * See REFUND_WALLET_LIMITATION: mixed purchases cannot be separated.
 */
export async function reverseRefundedPurchase(env: Env, orderId: string, nowMs = Date.now()): Promise<RefundProgress | "skipped"> {
  const order = await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(orderId).first<{ status: string }>();
  if (parseOrderStatus(order?.status ?? "") !== "refunded") return "skipped";
  const entitlement = await env.DB.prepare(
    `SELECT user_id, eval_credits, resume_credits, scan_runs, refunded_eval, refunded_resume, refunded_runs, refund_status, applied
     FROM entitlements WHERE order_id = ?`,
  ).bind(orderId).first<RefundEntitlement>();
  if (!entitlement || entitlement.applied !== 1) return "skipped";
  const progress = refundProgress(entitlement.refund_status);
  if (!progress) return "skipped";
  const wallet = await env.DB.prepare("SELECT eval_credits, resume_credits, scan_runs FROM users WHERE id = ?")
    .bind(entitlement.user_id)
    .first<{ eval_credits: number; resume_credits: number; scan_runs: number | null }>();
  if (!wallet) return "skipped";
  const take = unspentRefundTake({
    status: progress,
    grantedEval: entitlement.eval_credits,
    grantedResume: entitlement.resume_credits,
    grantedRuns: entitlement.scan_runs,
    refundedEval: entitlement.refunded_eval,
    refundedResume: entitlement.refunded_resume,
    refundedRuns: entitlement.refunded_runs,
    walletEval: wallet.eval_credits,
    walletResume: wallet.resume_credits,
    walletRuns: wallet.scan_runs ?? 0,
  });
  if (take.alreadyClosed) return take.status;
  const nowIso = new Date(nowMs).toISOString();
  const note = `refund ${orderId}`;
  const taken = take.evalCredits + take.resumeCredits + take.scanRuns;
  const outcome = await env.DB.batch([
    env.DB.prepare(
      `UPDATE entitlements
       SET refunded_eval = refunded_eval + ?,
           refunded_resume = refunded_resume + ?,
           refunded_runs = refunded_runs + ?,
           refund_status = ?,
           refunded_at = ?
       WHERE order_id = ? AND applied = 1 AND refund_status = 'none'`,
    ).bind(take.evalCredits, take.resumeCredits, take.scanRuns, take.status, nowIso, orderId),
    env.DB.prepare(
      `UPDATE users
       SET eval_credits = eval_credits - ?,
           resume_credits = resume_credits - ?,
           scan_runs = COALESCE(scan_runs, 0) - ?
       WHERE id = ?
         AND eval_credits >= ?
         AND resume_credits >= ?
         AND COALESCE(scan_runs, 0) >= ?
         AND changes() = 1
         AND EXISTS (
           SELECT 1 FROM entitlements
           WHERE order_id = ? AND refunded_at = ? AND refund_status = ?
         )`,
    ).bind(
      take.evalCredits,
      take.resumeCredits,
      take.scanRuns,
      entitlement.user_id,
      take.evalCredits,
      take.resumeCredits,
      take.scanRuns,
      orderId,
      nowIso,
      take.status,
    ),
    env.DB.prepare(abortBatchWhen(
      "? > 0 AND EXISTS (SELECT 1 FROM entitlements WHERE order_id = ? AND refunded_at = ?) AND changes() = 0",
    )).bind(taken, orderId, nowIso),
    env.DB.prepare(
      `INSERT INTO credit_ledger (user_id, kind, eval_delta, resume_delta, runs_delta, note)
       SELECT ?, 'refund', ?, ?, ?, ?
       WHERE ? + ? + ? > 0
         AND EXISTS (SELECT 1 FROM entitlements WHERE order_id = ? AND refunded_at = ?)
         AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ? AND kind = 'refund' AND note = ?)`,
    ).bind(
      entitlement.user_id,
      -take.evalCredits,
      -take.resumeCredits,
      -take.scanRuns,
      note,
      take.evalCredits,
      take.resumeCredits,
      take.scanRuns,
      orderId,
      nowIso,
      entitlement.user_id,
      note,
    ),
  ]);
  if (!outcome[0]?.meta.changes) return "skipped";
  return take.status;
}

/** Stores a provider event once. Does not accept a raw webhook body. */
export async function recordPaymentEvent(
  env: Env,
  event: { orderId: string; provider: "razorpay"; providerEventId: string; kind: string; status: string },
): Promise<"stored" | "duplicate"> {
  const res = await env.DB.prepare(
    `INSERT INTO payment_events (id, order_id, provider, provider_event_id, kind, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_event_id) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    event.orderId,
    event.provider,
    event.providerEventId.slice(0, 120),
    event.kind.slice(0, 80),
    event.status.slice(0, 40),
  ).run();
  if (res.meta.changes && (event.status === "failed" || event.status === "refunded")) {
    await notifyOwner(env, {
      kind: "payment_needs_attention",
      dedupeKey: `payment-${event.status}:${event.orderId}`,
      summary: event.status === "refunded" ? "A payment was marked refunded." : "A payment was marked failed.",
    }).catch((err: unknown) => console.error("payment alert failed", err));
  }
  return res.meta.changes ? "stored" : "duplicate";
}

function walletOf(user: Pick<UserRow, "plan" | "eval_credits" | "resume_credits" | "scan_runs" | "credits_expire_at">): WalletView {
  return {
    plan: user.plan,
    evalCredits: user.eval_credits,
    resumeCredits: user.resume_credits,
    scanRuns: user.scan_runs ?? 0,
    creditsExpireAt: user.credits_expire_at,
  };
}

interface DbOrder {
  id: string;
  user_id: string;
  sku: string;
  amount_inr: number;
  currency: string;
  status: string;
  provider_order_id: string | null;
  applied: number;
  created_at?: string;
}

function storedOrder(row: DbOrder): StoredOrder | null {
  const status = parseOrderStatus(row.status);
  if (!status || !row.provider_order_id) return null;
  return {
    id: row.id,
    sku: row.sku,
    amountInr: row.amount_inr,
    currency: row.currency,
    status,
    providerOrderId: row.provider_order_id,
    applied: row.applied === 1,
  };
}

const ORDER_SQL = `SELECT o.id, o.user_id, o.sku, o.amount_inr, o.currency, o.status, o.provider_order_id,
  COALESCE(e.applied, 0) AS applied
  FROM orders o
  LEFT JOIN entitlements e ON e.order_id = o.id`;

async function orderById(env: Env, orderId: string): Promise<DbOrder | null> {
  return env.DB.prepare(`${ORDER_SQL} WHERE o.id = ?`).bind(orderId).first<DbOrder>();
}

async function orderByProvider(env: Env, providerOrderId: string): Promise<DbOrder | null> {
  return env.DB.prepare(`${ORDER_SQL} WHERE o.provider = 'razorpay' AND o.provider_order_id = ?`)
    .bind(providerOrderId)
    .first<DbOrder>();
}

async function freshUser(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
}

export async function startCheckout(env: Env, user: UserRow, request: CheckoutRequest): Promise<CheckoutSession> {
  if (!paymentsAreOpen(env)) assertCheckoutClosed(env);
  const creds = razorpayCredentials(env);
  if (!creds) assertCheckoutClosed(env);
  const grant = grantForPaidSku(request.sku);
  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO orders (id, user_id, provider, provider_order_id, kind, sku, amount_inr, currency, status, idempotency_key, created_at, updated_at)
     VALUES (?, ?, 'razorpay', NULL, ?, ?, ?, 'INR', 'created', ?, ?, ?)
     ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
  ).bind(orderId, user.id, grant.kind, request.sku, grant.amountInr, request.idempotencyKey, now, now).run();

  const row = await env.DB.prepare(
    "SELECT id, user_id, sku, amount_inr, currency, status, provider_order_id, 0 AS applied FROM orders WHERE user_id = ? AND idempotency_key = ?",
  ).bind(user.id, request.idempotencyKey).first<DbOrder>();
  if (!row) throw new HttpError(500, "Could not open checkout. Nothing was charged.");
  if (row.sku !== request.sku || row.amount_inr !== grant.amountInr || row.currency !== "INR") {
    throw new HttpError(409, "This checkout attempt does not match the price. Start again.");
  }
  const status = parseOrderStatus(row.status);
  if (status === "paid") throw new HttpError(409, "This purchase is already confirmed.");
  if (status === "refunded") throw new HttpError(409, "This purchase was refunded. Start a new one from pricing.");
  if (!status) throw new HttpError(500, "Could not open checkout. Nothing was charged.");

  let providerOrderId = row.provider_order_id;
  if (!providerOrderId) {
    const payload = razorpayOrderPayload(request.sku, row.id);
    providerOrderId = await createRazorpayOrder(env, payload);
    const saved = await env.DB.prepare(
      "UPDATE orders SET provider_order_id = ?, updated_at = ? WHERE id = ? AND provider_order_id IS NULL",
    ).bind(providerOrderId, new Date().toISOString(), row.id).run();
    if (!saved.meta.changes) {
      const again = await orderById(env, row.id);
      providerOrderId = again?.provider_order_id ?? null;
    }
  }
  if (!providerOrderId) throw new HttpError(502, "Razorpay did not open the order. Nothing was charged.");
  return buildCheckoutSession({
    orderId: row.id,
    keyId: creds.keyId,
    razorpayOrderId: providerOrderId,
    sku: request.sku,
    wallet: walletOf(user),
    displayCurrency: request.displayCurrency,
  });
}

export async function orderForUser(env: Env, user: UserRow, orderId: string, displayCurrency?: string | null): Promise<OrderView> {
  if (!isOrderId(orderId)) throw new HttpError(400, "Unknown purchase.");
  const row = await orderById(env, orderId);
  if (!row || row.user_id !== user.id) throw new HttpError(404, "Unknown purchase.");
  const view = buildOrderView({
    id: row.id,
    sku: row.sku,
    status: row.status,
    amountInr: row.amount_inr,
    currency: row.currency,
    applied: row.applied === 1,
    wallet: walletOf(user),
    displayCurrency,
  });
  if (!view) throw new HttpError(404, "Unknown purchase.");
  return view;
}

export async function listOrders(env: Env, user: UserRow): Promise<OrderView[]> {
  const rows = await env.DB.prepare(
    `${ORDER_SQL} WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 10`,
  ).bind(user.id).all<DbOrder>();
  const wallet = walletOf(user);
  return rows.results.flatMap((row) => {
    const view = buildOrderView({
      id: row.id,
      sku: row.sku,
      status: row.status,
      amountInr: row.amount_inr,
      currency: row.currency,
      applied: row.applied === 1,
      wallet,
    });
    return view ? [view] : [];
  });
}

async function rememberStatus(env: Env, order: DbOrder, settlement: Settlement, previous: OrderStatus): Promise<void> {
  if (!settlement.nextStatus || !order.provider_order_id) return;
  await env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = ?
     WHERE id = ? AND provider = 'razorpay' AND provider_order_id = ? AND amount_inr = ? AND currency = 'INR' AND status = ?`,
  ).bind(settlement.nextStatus, new Date().toISOString(), order.id, order.provider_order_id, order.amount_inr, previous).run();
}

async function eventSeen(env: Env, eventId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM payment_events WHERE provider = 'razorpay' AND provider_event_id = ?",
  ).bind(eventId.slice(0, 120)).first<{ id: string }>();
  return Boolean(row);
}

interface PersistResult {
  settlement: Settlement;
  grant: GrantResult;
  email: Promise<void>;
}

async function mailUser(env: Env, email: string, sku: string, amountInr: number, kind: "paid" | "failed" | "refunded"): Promise<void> {
  if (!isPaidSku(sku)) return;
  const note = userPaymentText(kind, sku, amountInr);
  await sendMail(env, email, note.subject, note.text);
}

async function persistPayment(env: Env, order: DbOrder, payment: IncomingPayment): Promise<PersistResult> {
  const previous = parseOrderStatus(order.status);
  const stored = storedOrder(order);
  if (!previous || !stored) {
    return { settlement: settleIncomingPayment(null, false, payment), grant: "not_payable", email: Promise.resolve() };
  }
  const seen = await eventSeen(env, payment.eventId);
  const settlement = settleIncomingPayment(stored, seen, payment);
  await rememberStatus(env, order, settlement, previous);
  const fresh = await orderById(env, order.id);
  let grant: GrantResult = "not_payable";
  if (fresh && parseOrderStatus(fresh.status) === "refunded") {
    await reverseRefundedPurchase(env, order.id);
  }
  if (settlement.grant && fresh && parseOrderStatus(fresh.status) === "paid") {
    grant = await applyPaidOrder(env, order.id);
  }
  const recorded = settlement.storeEvent
    ? await recordPaymentEvent(env, {
      orderId: order.id,
      provider: "razorpay",
      providerEventId: payment.eventId,
      kind: payment.kind,
      status: settlement.eventStatus,
    })
    : "duplicate";
  const emailKind = shouldEmailUser(settlement, grant, recorded === "stored");
  const email = (async () => {
    if (!emailKind) return;
    const person = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(order.user_id).first<{ email: string }>();
    if (!person) return;
    await mailUser(env, person.email, order.sku, order.amount_inr, emailKind);
  })().catch((err: unknown) => console.error("payment email failed", err));
  if (shouldAlertOwner(settlement.reason)) {
    const summary = settlement.reason === "blocked_refunded"
      ? `A later payment notice for refunded order ${order.id} did not add credits.`
      : `A payment notice for order ${order.id} did not match the stored price. No credits were added.`;
    await notifyOwner(env, {
      kind: "payment_needs_attention",
      dedupeKey: `payment-mismatch:${order.id}`,
      summary,
    }).catch((err: unknown) => console.error("payment alert failed", err));
  }
  return { settlement, grant, email };
}

export async function acceptRazorpayWebhook(
  env: Env,
  rawBody: string,
  signature: string | null,
  eventId: string | null,
): Promise<{ status: 200 | 400; body: { ok: true } | { error: string }; email: Promise<void> }> {
  if (rawBody.length > WEBHOOK_MAX_BYTES) return { status: 400, body: { error: "Payload too large." }, email: Promise.resolve() };
  const creds = razorpayCredentials(env, { whenClosed: true });
  if (!creds) {
    console.error("Razorpay webhook arrived without a usable webhook secret");
    return { status: 400, body: { error: "Invalid signature." }, email: Promise.resolve() };
  }
  const verified = await readVerifiedWebhook(creds.webhookSecret, rawBody, signature, eventId);
  if (!verified.ok) {
    if (verified.reason === "bad_signature") console.error("Rejected Razorpay webhook signature");
    const error = verified.reason === "bad_signature" ? "Invalid signature." : "Invalid body.";
    return { status: 400, body: { error }, email: Promise.resolve() };
  }
  if (!verified.payment) return { status: 200, body: { ok: true }, email: Promise.resolve() };
  const order = await orderByProvider(env, verified.payment.providerOrderId);
  if (!order) {
    await notifyOwner(env, {
      kind: "payment_needs_attention",
      dedupeKey: `payment-unknown:${utcDay()}`,
      summary: "A Razorpay notice did not match a stored order. No credits were added.",
    }).catch((err: unknown) => console.error("payment alert failed", err));
    return { status: 200, body: { ok: true }, email: Promise.resolve() };
  }
  const result = await persistPayment(env, order, verified.payment);
  return { status: 200, body: { ok: true }, email: result.email };
}

export async function recoverCheckout(
  env: Env,
  user: UserRow,
  orderId: string,
  displayCurrency?: string | null,
): Promise<{ view: OrderView; email: Promise<void> }> {
  if (!isOrderId(orderId)) throw new HttpError(400, "Unknown purchase.");
  const row = await orderById(env, orderId);
  if (!row || row.user_id !== user.id) throw new HttpError(404, "Unknown purchase.");
  let email = Promise.resolve();
  const status = parseOrderStatus(row.status);
  if (row.provider_order_id && paymentsAreOpen(env) && status !== "paid" && status !== "refunded") {
    const [remoteOrder, remotePayments] = await Promise.all([
      fetchRazorpayOrder(env, row.provider_order_id),
      fetchRazorpayPayments(env, row.provider_order_id),
    ]);
    const payment = paymentFromProviderSnapshot({
      ourOrderId: row.id,
      providerOrderId: row.provider_order_id,
      remoteOrder,
      remotePayments,
    });
    if (payment) {
      const result = await persistPayment(env, row, payment);
      email = result.email;
    }
  }
  const current = (await freshUser(env, user.id)) ?? user;
  return { view: await orderForUser(env, current, orderId, displayCurrency), email };
}
