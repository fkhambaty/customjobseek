import { grantForPaidSku, isPaidSku, parseOrderStatus, type OrderStatus, type PaidSku } from "./commercial";
import { PLANS, RUN_PACKS, type PlanId } from "./plans";

/**
 * Razorpay is charged in INR only. A viewer's currency can be named beside the price.
 * It is never converted, and it is never sent as the Razorpay amount.
 */
export const CHARGE_CURRENCY = "INR" as const;
export const WEBHOOK_MAX_BYTES = 65_536;

const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,}$/;
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_ORDER_ID = /^order_[A-Za-z0-9]{8,40}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{8,120}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;
const DISPLAY_CURRENCY = /^[A-Z]{3}$/;

const encoder = new TextEncoder();

export interface PaymentEnv {
  PAYMENTS_ENABLED?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** Real legal name, only when the operator has set it. Never invent one. */
  LEGAL_NAME?: string;
  /** Real postal address, only when the operator has set it. Never invent one. */
  LEGAL_ADDRESS?: string;
}

export type PaymentBlock =
  | "disabled"
  | "missing_key_id"
  | "missing_key_secret"
  | "missing_webhook_secret"
  | "bad_key_id"
  | "bad_key_secret"
  | "bad_webhook_secret";

export type PaymentInspection =
  | { enabled: true; mode: "test" | "live"; keyId: string }
  | { enabled: false; reason: PaymentBlock };

function usableSecret(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 200 || /\s/.test(value)) return null;
  return value;
}

/** True only when checkout is explicitly on and all three Razorpay values are usable. Secrets are not returned. */
export function inspectPayments(env: PaymentEnv): PaymentInspection {
  if (env.PAYMENTS_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  const keyId = env.RAZORPAY_KEY_ID ?? "";
  const keySecret = env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!keyId) return { enabled: false, reason: "missing_key_id" };
  if (!keySecret) return { enabled: false, reason: "missing_key_secret" };
  if (!webhookSecret) return { enabled: false, reason: "missing_webhook_secret" };
  if (!KEY_ID.test(keyId)) return { enabled: false, reason: "bad_key_id" };
  const secret = usableSecret(keySecret);
  if (!secret || secret === keyId || secret.startsWith("rzp_")) return { enabled: false, reason: "bad_key_secret" };
  const hook = usableSecret(webhookSecret);
  if (!hook || hook === keyId || hook === secret) return { enabled: false, reason: "bad_webhook_secret" };
  return { enabled: true, mode: keyId.startsWith("rzp_live_") ? "live" : "test", keyId };
}

export function paymentsAreOpen(env: PaymentEnv): boolean {
  return inspectPayments(env).enabled;
}

export interface PublicOperator {
  name: string;
  address: string;
}

export interface PublicBillingStatus {
  paymentsEnabled: boolean;
  operator: PublicOperator | null;
}

function publicLabel(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 180) return "";
  return text;
}

/** Returns a name or address only when that value was configured. Missing values stay blank. */
export function configuredOperator(env: Pick<PaymentEnv, "LEGAL_NAME" | "LEGAL_ADDRESS">): PublicOperator | null {
  const name = publicLabel(env.LEGAL_NAME);
  const address = publicLabel(env.LEGAL_ADDRESS);
  if (!name && !address) return null;
  return { name, address };
}

/** Plain sentence for the legal pages. It does not invent a company or a street. */
export function legalOperatorCopy(status: PublicBillingStatus): string {
  const name = status.operator?.name ?? "";
  const address = status.operator?.address ?? "";
  if (!name && !address) {
    return status.paymentsEnabled
      ? "No legal name or street address is configured for this site. Do not treat these pages as naming a seller."
      : "No legal name or street address is configured for this site. Checkout is closed, so these pages do not name a seller.";
  }
  const who = name ? `Operated by ${name}.` : "A legal name is not configured.";
  const where = address ? ` Address: ${address}.` : " A street address is not configured.";
  const pay = status.paymentsEnabled
    ? " The pricing page is what checkout charges."
    : " Checkout is closed, so this site is not taking payment.";
  return `${who}${where}${pay}`;
}

/** Safe to send to the browser. Never includes a key secret, a webhook secret, or an inbox address. */
export function publicPaymentStatus(env: PaymentEnv): PublicBillingStatus {
  return { paymentsEnabled: paymentsAreOpen(env), operator: configuredOperator(env) };
}

/** Label a per-application figure without pretending a rounded rupee is exact. */
export function perApplicationPriceLabel(priceInr: number, packs: number): string {
  if (!Number.isFinite(priceInr) || !Number.isFinite(packs) || packs <= 0 || priceInr <= 0) return "";
  const exact = priceInr / packs;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) < 0.005) return `₹${rounded.toLocaleString("en-IN")} per application`;
  const cents = Math.round(exact * 100) / 100;
  if (Math.abs(exact - cents) < 0.000_5) {
    return `₹${cents.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per application`;
  }
  return `about ₹${rounded.toLocaleString("en-IN")} per application`;
}

export function isPublicKeyId(value: string): boolean {
  return KEY_ID.test(value);
}

export function isOrderId(value: string): boolean {
  return ORDER_ID.test(value);
}

export function isProviderOrderId(value: string): boolean {
  return PROVIDER_ORDER_ID.test(value);
}

export interface WalletView {
  plan: string;
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  creditsExpireAt: string | null;
}

export interface OfferFacts {
  sku: PaidSku;
  name: string;
  amountInr: number;
  currency: typeof CHARGE_CURRENCY;
  amountMinor: number;
  recurring: false;
  validityDays: number;
  oneTimeNote: string;
  expiresNote: string;
  refundNote: string;
  regionalNote: string | null;
}

export function inrLabel(amountInr: number): string {
  return `₹${amountInr.toLocaleString("en-IN")} INR`;
}

function regionalNote(amountInr: number, viewerCurrency: string | null | undefined): string | null {
  if (!viewerCurrency || viewerCurrency === CHARGE_CURRENCY || !DISPLAY_CURRENCY.test(viewerCurrency)) return null;
  return `Your profile currency is ${viewerCurrency}. Razorpay charges ${inrLabel(amountInr)}. We do not convert it, so a bank rate is not shown as our price.`;
}

export function offerFacts(sku: PaidSku, viewerCurrency?: string | null): OfferFacts {
  const grant = grantForPaidSku(sku);
  const pack = RUN_PACKS.find((item) => item.id === sku);
  const name = grant.kind === "plan" ? PLANS[sku as Exclude<PlanId, "free">].name : `${pack?.runs ?? grant.scanRuns} scan runs`;
  const expiresNote = grant.validityDays > 0
    ? `Credits last ${grant.validityDays} days after Razorpay confirms the payment. They do not renew.`
    : "These scan runs stay until you use them. They do not renew, and they do not change when your plan credits expire.";
  return {
    sku,
    name,
    amountInr: grant.amountInr,
    currency: CHARGE_CURRENCY,
    amountMinor: grant.amountInr * 100,
    recurring: false,
    validityDays: grant.validityDays,
    oneTimeNote: "One-time payment. This is not a subscription.",
    expiresNote,
    refundNote: REFUND_WALLET_LIMITATION,
    regionalNote: regionalNote(grant.amountInr, viewerCurrency),
  };
}

export interface RazorpayOrderPayload {
  amount: number;
  currency: typeof CHARGE_CURRENCY;
  receipt: string;
  payment_capture: 1;
  notes: { sku: PaidSku; order_id: string };
}

/** The body we send to Razorpay. The price comes from the catalog. A display currency cannot be passed in. */
export function razorpayOrderPayload(sku: PaidSku, orderId: string): RazorpayOrderPayload {
  if (!isOrderId(orderId)) throw new Error("Order id must be the server id.");
  const facts = offerFacts(sku);
  if (!Number.isInteger(facts.amountInr) || facts.amountInr <= 0 || facts.amountMinor !== facts.amountInr * 100) {
    throw new Error("Price list is not billable.");
  }
  return {
    amount: facts.amountMinor,
    currency: CHARGE_CURRENCY,
    receipt: orderId,
    payment_capture: 1,
    notes: { sku, order_id: orderId },
  };
}

export function parseProviderOrder(
  body: unknown,
  expected: { amount: number; currency: typeof CHARGE_CURRENCY; receipt: string },
): { ok: true; id: string } | { ok: false; reason: "shape" | "amount" | "currency" | "receipt" } {
  const row = asRecord(body);
  const id = row && typeof row.id === "string" ? row.id : "";
  if (!row || !isProviderOrderId(id)) return { ok: false, reason: "shape" };
  if (row.amount !== expected.amount) return { ok: false, reason: "amount" };
  if (row.currency !== expected.currency) return { ok: false, reason: "currency" };
  if (row.receipt !== expected.receipt) return { ok: false, reason: "receipt" };
  return { ok: true, id };
}

export interface CheckoutRequest {
  sku: PaidSku;
  idempotencyKey: string;
  displayCurrency: string | null;
}

function skuField(body: Record<string, unknown>, key: "sku" | "plan" | "runPack"): string | null {
  const value = body[key];
  if (value == null || value === "") return null;
  return typeof value === "string" ? value : "";
}

/** Reads the SKU the person asked for. Amount and currency on the body are ignored. */
export function parseCheckoutRequest(body: unknown): { ok: true; value: CheckoutRequest } | { ok: false; error: string } {
  const row = asRecord(body);
  if (!row) return { ok: false, error: "Choose a plan or a run pack." };
  const fields = [skuField(row, "sku"), skuField(row, "plan"), skuField(row, "runPack")];
  if (fields.some((field) => field === "")) return { ok: false, error: "Choose a plan or a run pack." };
  const present = fields.filter((field): field is string => Boolean(field));
  if (present.length !== 1) return { ok: false, error: "Choose one plan or one run pack." };
  const sku = present[0];
  if (!sku || !isPaidSku(sku)) return { ok: false, error: "Pick a paid plan." };
  const idempotencyKey = typeof row.idempotencyKey === "string" ? row.idempotencyKey : "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return { ok: false, error: "Start the purchase again." };
  const display = typeof row.displayCurrency === "string" ? row.displayCurrency.toUpperCase() : "";
  return {
    ok: true,
    value: { sku, idempotencyKey, displayCurrency: DISPLAY_CURRENCY.test(display) ? display : null },
  };
}

export interface CheckoutSession {
  orderId: string;
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: typeof CHARGE_CURRENCY;
  sku: PaidSku;
  name: string;
  description: string;
  recurring: false;
  validityDays: number;
  oneTimeNote: string;
  expiresNote: string;
  refundNote: string;
  regionalNote: string | null;
  wallet: WalletView;
}

export function buildCheckoutSession(input: {
  orderId: string;
  keyId: string;
  razorpayOrderId: string;
  sku: PaidSku;
  wallet: WalletView;
  displayCurrency?: string | null;
}): CheckoutSession {
  if (!isPublicKeyId(input.keyId)) throw new Error("Checkout key must be a public Razorpay key id.");
  if (!isProviderOrderId(input.razorpayOrderId)) throw new Error("Missing Razorpay order id.");
  const facts = offerFacts(input.sku, input.displayCurrency);
  const payload = razorpayOrderPayload(input.sku, input.orderId);
  return {
    orderId: input.orderId,
    keyId: input.keyId,
    razorpayOrderId: input.razorpayOrderId,
    amount: payload.amount,
    currency: payload.currency,
    sku: facts.sku,
    name: facts.name,
    description: `${facts.name} (${facts.sku}) · ${inrLabel(facts.amountInr)} · one-time, not a subscription`.slice(0, 255),
    recurring: false,
    validityDays: facts.validityDays,
    oneTimeNote: facts.oneTimeNote,
    expiresNote: facts.expiresNote,
    refundNote: facts.refundNote,
    regionalNote: facts.regionalNote,
    wallet: input.wallet,
  };
}

export interface OrderView {
  id: string;
  sku: string;
  name: string;
  status: OrderStatus;
  amountInr: number;
  currency: string;
  recurring: false;
  oneTimeNote: string;
  expiresNote: string;
  refundNote: string;
  regionalNote: string | null;
  wallet: WalletView;
  granted: boolean;
}

export function buildOrderView(input: {
  id: string;
  sku: string;
  status: string;
  amountInr: number;
  currency: string;
  applied: boolean;
  wallet: WalletView;
  displayCurrency?: string | null;
}): OrderView | null {
  const status = parseOrderStatus(input.status);
  if (!status || !isOrderId(input.id)) return null;
  const known = isPaidSku(input.sku) ? offerFacts(input.sku, input.displayCurrency) : null;
  return {
    id: input.id,
    sku: input.sku,
    name: known?.name ?? input.sku,
    status,
    amountInr: input.amountInr,
    currency: input.currency,
    recurring: false,
    oneTimeNote: known?.oneTimeNote ?? "One-time payment. This is not a subscription.",
    expiresNote: known?.expiresNote ?? "Expiry is shown on your account after Razorpay confirms the payment.",
    refundNote: known?.refundNote ?? "Write to support about a refund. Opening this page does not add credits.",
    regionalNote: known?.regionalNote ?? null,
    wallet: input.wallet,
    granted: input.applied && status === "paid",
  };
}

export type UpgradeBlock = "checks" | "resumes" | "scans";

function nextPlanSku(plan: string): "starter" | "growth" | "pro" {
  switch (plan) {
    case "starter":
      return "growth";
    case "growth":
      return "pro";
    case "pro":
      return "pro";
    case "free":
      return "starter";
    default:
      return "starter";
  }
}

/** Shown after a real fit result or a prepared scan, and only when that balance is actually used up. */
export function contextualUpgrade(input: {
  plan: string;
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  evidence: boolean;
  blocked: UpgradeBlock;
  displayCurrency?: string | null;
}): { sku: PaidSku; because: string; facts: OfferFacts } | null {
  if (!input.evidence) return null;
  const checksOut = input.evalCredits < 1;
  const resumesOut = input.resumeCredits < 1;
  const scansOut = input.scanRuns < 1;
  if (checksOut || resumesOut) {
    const sku = nextPlanSku(input.plan);
    const because = resumesOut && !checksOut
      ? "You have already seen a fit result. Resume credits are used up."
      : "You have already seen a fit result. Fit checks are used up.";
    return { sku, because, facts: offerFacts(sku, input.displayCurrency) };
  }
  if (scansOut) {
    return {
      sku: "runs5",
      because: "A scan already prepared jobs. Scan runs are used up.",
      facts: offerFacts("runs5", input.displayCurrency),
    };
  }
  return null;
}

/**
 * The wallet is one pool. A refund can only take back what this purchase added
 * and what is still sitting in the wallet. It cannot tell a later purchase's
 * credits apart, so it stops at the current balance and never goes below zero.
 * A partial reversal is recorded once. A later capture of the same order does not grant again.
 */
export const REFUND_WALLET_LIMITATION =
  "A refund removes only the unused credits and scan runs from that purchase, and never more than the balance still in the wallet. The wallet is one pool, so we cannot see which purchase a remaining credit came from. Balances are not taken below zero. Credits you already used stay used. If only part of the purchase is still there, the refund is partial and is recorded once. That order will not add credits again.";

export type RefundProgress = "none" | "partial" | "full";

export interface RefundTake {
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  status: Exclude<RefundProgress, "none">;
  alreadyClosed: boolean;
}

export function unspentRefundTake(input: {
  status: RefundProgress;
  grantedEval: number;
  grantedResume: number;
  grantedRuns: number;
  refundedEval: number;
  refundedResume: number;
  refundedRuns: number;
  walletEval: number;
  walletResume: number;
  walletRuns: number;
}): RefundTake {
  if (input.status === "partial" || input.status === "full") {
    return { evalCredits: 0, resumeCredits: 0, scanRuns: 0, status: input.status, alreadyClosed: true };
  }
  if (input.status !== "none") {
    const unexpected: never = input.status;
    throw new Error(String(unexpected));
  }
  const evalCredits = Math.min(Math.max(0, input.grantedEval - input.refundedEval), Math.max(0, input.walletEval));
  const resumeCredits = Math.min(Math.max(0, input.grantedResume - input.refundedResume), Math.max(0, input.walletResume));
  const scanRuns = Math.min(Math.max(0, input.grantedRuns - input.refundedRuns), Math.max(0, input.walletRuns));
  const coversGrant =
    input.refundedEval + evalCredits >= input.grantedEval
    && input.refundedResume + resumeCredits >= input.grantedResume
    && input.refundedRuns + scanRuns >= input.grantedRuns;
  return {
    evalCredits,
    resumeCredits,
    scanRuns,
    status: coversGrant ? "full" : "partial",
    alreadyClosed: false,
  };
}

export function userPaymentText(kind: "paid" | "failed" | "refunded", sku: PaidSku, amountInr: number): { subject: string; text: string } {
  const facts = offerFacts(sku);
  const price = inrLabel(amountInr);
  const tail = "This email does not include a card number, a bank account, or a payment secret.";
  switch (kind) {
    case "paid":
      return {
        subject: `CustomJobSeek: ${facts.name} is confirmed`,
        text: [`${facts.name} (${facts.sku}) is confirmed at ${price}.`, facts.oneTimeNote, facts.expiresNote, "The credits are in your wallet.", tail].join("\n\n"),
      };
    case "failed":
      return {
        subject: "CustomJobSeek: payment was not completed",
        text: [`${facts.name} (${facts.sku}) at ${price} was not completed.`, "No credits were added. You can try again from the pricing page.", tail].join("\n\n"),
      };
    case "refunded":
      return {
        subject: `CustomJobSeek: refund recorded for ${facts.name}`,
        text: [`A refund was recorded for ${facts.name} (${facts.sku}) at ${price}.`, "Unused credits from that purchase were removed up to the balance still in the wallet. Used credits stay used. That purchase will not add credits again.", facts.refundNote, tail].join("\n\n"),
      };
    default: {
      const unexpected: never = kind;
      throw new Error(String(unexpected));
    }
  }
}

export type PaymentAction = "grant" | "fail" | "refund" | "ignore";

export interface IncomingPayment {
  eventId: string;
  kind: string;
  action: PaymentAction;
  providerOrderId: string;
  amountMinor: number;
  currency: string;
  receipt: string | null;
  linkedOrderId: string | null;
  linkBroken: boolean;
}

export interface StoredOrder {
  id: string;
  sku: string;
  amountInr: number;
  currency: string;
  status: OrderStatus;
  providerOrderId: string;
  applied: boolean;
}

export type SettlementReason =
  | "granted"
  | "already_applied"
  | "duplicate_ignored"
  | "amount_mismatch"
  | "order_mismatch"
  | "currency_mismatch"
  | "failed"
  | "refunded"
  | "ignored"
  | "unknown_order"
  | "blocked_refunded";

export interface Settlement {
  reason: SettlementReason;
  duplicate: boolean;
  storeEvent: boolean;
  eventStatus: string;
  nextStatus: OrderStatus | null;
  grant: boolean;
}

function settled(
  reason: SettlementReason,
  eventSeen: boolean,
  eventStatus: string,
  nextStatus: OrderStatus | null,
  grant: boolean,
): Settlement {
  return { reason, duplicate: eventSeen, storeEvent: !eventSeen, eventStatus, nextStatus, grant };
}

function priceProblem(order: StoredOrder, payment: IncomingPayment): SettlementReason | null {
  if (payment.linkBroken || payment.providerOrderId !== order.providerOrderId) return "order_mismatch";
  if (payment.linkedOrderId && payment.linkedOrderId !== order.id) return "order_mismatch";
  if (payment.receipt && payment.receipt !== order.id) return "order_mismatch";
  if (!isPaidSku(order.sku)) return "order_mismatch";
  if (payment.currency !== CHARGE_CURRENCY || order.currency !== CHARGE_CURRENCY) return "currency_mismatch";
  if (!Number.isInteger(order.amountInr) || payment.amountMinor !== order.amountInr * 100) return "amount_mismatch";
  return null;
}

/**
 * Decides what a verified provider notice may change.
 * A browser return is not an input. Grant stays false unless the notice is a matching capture or paid order.
 */
export function settleIncomingPayment(order: StoredOrder | null, eventSeen: boolean, payment: IncomingPayment): Settlement {
  if (!order) {
    return { reason: "unknown_order", duplicate: false, storeEvent: false, eventStatus: "ignored", nextStatus: null, grant: false };
  }
  const problem = priceProblem(order, payment);
  if (problem) return settled(problem, eventSeen, "mismatch", null, false);

  switch (payment.action) {
    case "ignore":
      return settled(eventSeen ? "duplicate_ignored" : "ignored", eventSeen, "ignored", null, false);
    case "fail":
      if (order.status === "paid" || order.status === "refunded") {
        return settled(eventSeen ? "duplicate_ignored" : "ignored", eventSeen, "ignored", null, false);
      }
      return settled("failed", eventSeen, "failed", order.status === "created" ? "failed" : null, false);
    case "refund":
      return settled("refunded", eventSeen, "refunded", order.status === "refunded" ? null : "refunded", false);
    case "grant":
      if (order.status === "refunded") return settled("blocked_refunded", eventSeen, "ignored", null, false);
      if (order.applied) {
        return settled("already_applied", eventSeen, "paid", order.status === "paid" ? null : "paid", false);
      }
      return settled("granted", eventSeen, payment.kind === "order.paid" ? "paid" : "captured", order.status === "paid" ? null : "paid", true);
    default: {
      const unexpected: never = payment.action;
      throw new Error(String(unexpected));
    }
  }
}

export type GrantEmail = "applied" | "already" | "not_payable";

export function shouldEmailUser(settlement: Settlement, grantResult: GrantEmail, eventStored: boolean): "paid" | "failed" | "refunded" | null {
  if (grantResult === "applied" && settlement.grant) return "paid";
  if (!eventStored) return null;
  switch (settlement.reason) {
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "granted":
    case "already_applied":
    case "duplicate_ignored":
    case "amount_mismatch":
    case "order_mismatch":
    case "currency_mismatch":
    case "ignored":
    case "unknown_order":
    case "blocked_refunded":
      return null;
    default: {
      const unexpected: never = settlement.reason;
      throw new Error(String(unexpected));
    }
  }
}

export function shouldAlertOwner(reason: SettlementReason): boolean {
  switch (reason) {
    case "amount_mismatch":
    case "order_mismatch":
    case "currency_mismatch":
    case "unknown_order":
    case "blocked_refunded":
      return true;
    case "granted":
    case "already_applied":
    case "duplicate_ignored":
    case "failed":
    case "refunded":
    case "ignored":
      return false;
    default: {
      const unexpected: never = reason;
      throw new Error(String(unexpected));
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nestedEntity(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const wrap = asRecord(payload[key]);
  return wrap ? asRecord(wrap.entity) : null;
}

function minor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function currencyOf(value: unknown): string | null {
  return typeof value === "string" && DISPLAY_CURRENCY.test(value) ? value : null;
}

function linkedId(notes: unknown): { id: string | null; broken: boolean } {
  const row = asRecord(notes);
  if (!row || row.order_id == null || row.order_id === "") return { id: null, broken: false };
  if (typeof row.order_id === "string" && isOrderId(row.order_id)) return { id: row.order_id.toLowerCase(), broken: false };
  return { id: null, broken: true };
}

function actionFor(name: string): PaymentAction | "unknown" {
  switch (name) {
    case "payment.captured":
    case "order.paid":
      return "grant";
    case "payment.failed":
      return "fail";
    case "refund.created":
    case "refund.processed":
      return "refund";
    case "payment.authorized":
      return "ignore";
    default:
      return "unknown";
  }
}

function paymentNotice(
  eventId: string,
  kind: string,
  action: PaymentAction,
  providerOrderId: string,
  amountMinor: number,
  currency: string,
  receipt: string | null,
  link: { id: string | null; broken: boolean },
): IncomingPayment {
  return {
    eventId,
    kind,
    action,
    providerOrderId,
    amountMinor,
    currency,
    receipt,
    linkedOrderId: link.id,
    linkBroken: link.broken,
  };
}

export function parseProviderEvent(body: unknown, eventId: string): IncomingPayment | "skip" | null {
  const root = asRecord(body);
  const payload = root ? asRecord(root.payload) : null;
  const kind = root && typeof root.event === "string" ? root.event : "";
  if (!payload || !kind || (!EVENT_ID.test(eventId) && !/^[0-9a-f]{64}$/.test(eventId))) return null;
  const action = actionFor(kind);
  const payment = nestedEntity(payload, "payment");
  const order = nestedEntity(payload, "order");
  const refund = nestedEntity(payload, "refund");

  if (kind === "order.paid") {
    const providerOrderId = typeof order?.id === "string" ? order.id : "";
    const amountMinor = minor(order?.amount);
    const currency = currencyOf(order?.currency);
    if (!order || !isProviderOrderId(providerOrderId) || amountMinor == null || !currency) return null;
    const captured = payment?.status === "captured"
      && payment.order_id === providerOrderId
      && payment.amount === amountMinor
      && payment.currency === currency;
    const link = linkedId(order.notes ?? payment?.notes);
    const receipt = typeof order.receipt === "string" && isOrderId(order.receipt) ? order.receipt.toLowerCase() : null;
    const receiptBroken = typeof order.receipt === "string" && order.receipt !== "" && receipt == null;
    return paymentNotice(eventId, kind, captured && order.status === "paid" ? "grant" : "ignore", providerOrderId, amountMinor, currency, receipt, {
      id: link.id,
      broken: link.broken || receiptBroken,
    });
  }

  if (kind === "refund.created" || kind === "refund.processed") {
    const providerOrderId = typeof payment?.order_id === "string" ? payment.order_id : "";
    const amountMinor = minor(refund?.amount);
    const currency = currencyOf(refund?.currency) ?? currencyOf(payment?.currency);
    if (!isProviderOrderId(providerOrderId) || amountMinor == null || !currency) return null;
    return paymentNotice(eventId, kind, "refund", providerOrderId, amountMinor, currency, null, linkedId(payment?.notes));
  }

  const providerOrderId = typeof payment?.order_id === "string" ? payment.order_id : "";
  const amountMinor = minor(payment?.amount);
  const currency = currencyOf(payment?.currency);
  if (!payment || !isProviderOrderId(providerOrderId) || amountMinor == null || !currency) {
    return action === "unknown" ? "skip" : null;
  }
  const status = typeof payment.status === "string" ? payment.status : "";
  let resolved: PaymentAction = "ignore";
  if (action === "grant" && status === "captured") resolved = "grant";
  else if (action === "fail" && status === "failed") resolved = "fail";
  else if (action === "ignore" || action === "unknown") resolved = "ignore";
  return paymentNotice(eventId, kind, resolved, providerOrderId, amountMinor, currency, null, linkedId(payment.notes));
}

/**
 * A captured payment Razorpay itself reports during recovery.
 * Returns null when the remote order is not paid or the capture does not agree with it.
 */
export function paymentFromProviderSnapshot(input: {
  ourOrderId: string;
  providerOrderId: string;
  remoteOrder: unknown;
  remotePayments: unknown;
}): IncomingPayment | null {
  if (!isOrderId(input.ourOrderId) || !isProviderOrderId(input.providerOrderId)) return null;
  const remote = asRecord(input.remoteOrder);
  const amountMinor = minor(remote?.amount);
  const currency = currencyOf(remote?.currency);
  if (!remote || remote.id !== input.providerOrderId || remote.status !== "paid" || amountMinor == null || !currency) return null;
  const items = asRecord(input.remotePayments)?.items;
  if (!Array.isArray(items)) return null;
  const captured = items.some((item) => {
    const row = asRecord(item);
    return Boolean(row && row.status === "captured" && row.order_id === input.providerOrderId && row.amount === amountMinor && row.currency === currency);
  });
  if (!captured) return null;
  const receipt = typeof remote.receipt === "string" && isOrderId(remote.receipt) ? remote.receipt.toLowerCase() : null;
  return paymentNotice(
    `recover:${input.providerOrderId}`.slice(0, 120),
    "order.paid",
    "grant",
    input.providerOrderId,
    amountMinor,
    currency,
    receipt,
    { id: input.ourOrderId.toLowerCase(), broken: false },
  );
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function razorpayHmacHex(secret: string, body: string): Promise<string> {
  return hmacHex(secret, body);
}

function hexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function digestHex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type VerifiedWebhook =
  | { ok: false; reason: "bad_signature" | "bad_json" | "bad_shape" }
  | { ok: true; payment: IncomingPayment | null };

/**
 * Checks the HMAC of the raw body before JSON.parse.
 * The webhook secret is the only key used here. The key secret is not.
 */
export async function readVerifiedWebhook(webhookSecret: string, rawBody: string, signature: string | null, eventIdHeader: string | null): Promise<VerifiedWebhook> {
  const header = (signature ?? "").trim().toLowerCase();
  const secret = usableSecret(webhookSecret);
  if (!secret || !(await verifySignature(secret, rawBody, header))) return { ok: false, reason: "bad_signature" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  const eventId = eventIdHeader && EVENT_ID.test(eventIdHeader) ? eventIdHeader : await digestHex(rawBody);
  const payment = parseProviderEvent(parsed, eventId);
  if (payment === "skip") return { ok: true, payment: null };
  if (!payment) return { ok: false, reason: "bad_shape" };
  return { ok: true, payment };
}

async function verifySignature(secret: string, rawBody: string, header: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(header)) return false;
  return hexEqual(header, await hmacHex(secret, rawBody));
}
