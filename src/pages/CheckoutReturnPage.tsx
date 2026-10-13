import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isPaidSku } from "../../shared/commercial";
import { inrLabel, offerFacts, type OrderView } from "../../shared/payments";
import { api } from "../api";
import { PayFacts, WalletLine } from "../components/PayFacts";
import { CHECKOUT_POLL_LIMIT, checkoutAbandoned, checkoutShowsIncomplete, shouldPollCheckout } from "../checkout";
import { useJobsOptional } from "../data";
import { useSession } from "../session";

const NOT_COMPLETED = "The payment was not completed. No credits were added.";

function statusLine(order: OrderView, incomplete: boolean): string {
  if (order.status === "created" && incomplete) return NOT_COMPLETED;
  switch (order.status) {
    case "paid":
      return order.granted
        ? "Razorpay confirmed this payment. The credits are in your wallet."
        : "Razorpay confirmed this payment. Credits are being added.";
    case "failed":
      return NOT_COMPLETED;
    case "refunded":
      return "This purchase was refunded. It will not add credits again.";
    case "created":
      return "Waiting for Razorpay to confirm the payment. Opening this page does not add credits.";
    default: {
      const unexpected: never = order.status;
      return unexpected;
    }
  }
}

export function CheckoutReturnPage() {
  const [params] = useSearchParams();
  const orderId = params.get("order") ?? "";
  const abandoned = checkoutAbandoned(params.get("result"));
  const jobs = useJobsOptional();
  const { refresh } = useSession();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) {
      setError("This return link has no purchase on it.");
      setAttempts(CHECKOUT_POLL_LIMIT);
      return;
    }
    let stop = false;
    let timer = 0;
    const currency = jobs?.currency;
    const load = (recover: boolean, attempt: number) => {
      const request = recover ? api.recoverCheckout(orderId, currency) : api.checkoutOrder(orderId, currency);
      request.then((next) => {
        if (stop) return;
        setOrder(next);
        setError("");
        if (next.status === "paid") void refresh();
        const nextAttempt = attempt + 1;
        setAttempts(nextAttempt);
        if (!shouldPollCheckout({ status: next.status, abandoned, attempts: nextAttempt })) return;
        timer = window.setTimeout(() => load(nextAttempt === 4, nextAttempt), 3000);
      }).catch((err: unknown) => {
        if (stop) return;
        setAttempts(CHECKOUT_POLL_LIMIT);
        setError(err instanceof Error ? err.message : "Could not read the purchase.");
      });
    };
    load(true, 0);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [orderId, abandoned, jobs?.currency, refresh]);

  const incomplete = checkoutShowsIncomplete({ status: order?.status ?? null, abandoned, attempts }) && (abandoned || !error);
  const facts = order && isPaidSku(order.sku) ? offerFacts(order.sku, jobs?.currency) : null;
  const waiting = !error && !order && !incomplete;
  return (
    <div className="page narrow-wide">
      <h1>Checkout</h1>
      <p className="lede">This page checks whether Razorpay has confirmed the payment. The address itself does not add credits.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {waiting && <p className="muted">Checking the purchase…</p>}
      {(order || incomplete) && (
        <div className="card">
          <p>{order ? statusLine(order, incomplete) : NOT_COMPLETED}</p>
          {order && facts ? <PayFacts facts={facts} /> : order && (
            <dl className="pay-facts">
              <div><dt>SKU</dt><dd><code>{order.sku}</code></dd></div>
              <div><dt>Price</dt><dd>{order.currency === "INR" ? inrLabel(order.amountInr) : `${order.amountInr} ${order.currency}`}</dd></div>
              <div><dt>Billing</dt><dd>{order.oneTimeNote}</dd></div>
            </dl>
          )}
          {order && (
            <p className="muted small">Charged amount on this order: {order.currency === "INR" ? inrLabel(order.amountInr) : `${order.amountInr} ${order.currency}`}. Status: {order.status}.</p>
          )}
          {order && <WalletLine wallet={order.wallet} />}
          <p className="row-inline">
            <Link to="/account" className="btn btn-ghost">Wallet</Link>
            <Link to="/pricing" className="btn btn-ghost">Pricing</Link>
          </p>
        </div>
      )}
    </div>
  );
}
