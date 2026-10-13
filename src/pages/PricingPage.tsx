import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isPaidSku, type PaidSku } from "../../shared/commercial";
import { offerFacts, perApplicationPriceLabel, type WalletView } from "../../shared/payments";
import { PLANS, PLAN_ORDER, RUN_PACKS } from "../../shared/plans";
import { api } from "../api";
import { PayFacts, WalletLine } from "../components/PayFacts";
import { checkoutReturnPath, startPurchase } from "../checkout";
import { useJobsOptional } from "../data";
import { useSession } from "../session";

export function PricingPage() {
  const { account, refresh } = useSession();
  const jobs = useJobsOptional();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<{ sku: string; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null);
  const currency = jobs?.currency;

  useEffect(() => {
    api.billingStatus().then((status) => setPaymentsEnabled(status.paymentsEnabled)).catch(() => setPaymentsEnabled(false));
  }, []);

  async function buy(sku: PaidSku) {
    if (!account || paymentsEnabled !== true) return;
    setBusy(sku);
    setMsg(null);
    try {
      await startPurchase({
        sku,
        email: account.email,
        displayCurrency: currency,
        onDone: (orderId, end) => navigate(checkoutReturnPath(orderId, end)),
      });
      await refresh();
    } catch (err) {
      setMsg({ sku, text: err instanceof Error ? err.message : "Checkout could not be opened." });
    } finally {
      setBusy("");
    }
  }

  const wallet: WalletView | null = account
    ? {
      plan: account.plan,
      evalCredits: account.evalCredits,
      resumeCredits: account.resumeCredits,
      scanRuns: account.scanRuns,
      creditsExpireAt: account.creditsExpireAt,
    }
    : null;

  return (
    <div className="page">
      <div className="center">
        <h1>Pay per application, not per month</h1>
        <p className="muted lede-sm">
          One application pack is a fit check plus a tailored resume for that job. Every paid price below is a one-time
          charge in INR. Nothing renews.
        </p>
        {wallet && <WalletLine wallet={wallet} />}
      </div>
      <div className="plans">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const facts = isPaidSku(id) ? offerFacts(id, currency) : null;
          const perApplication = perApplicationPriceLabel(plan.priceInr, plan.resumeCredits);
          const checkoutClosed = paymentsEnabled !== true;
          return (
            <div key={id} className="card plan">
              <h2>{plan.name}</h2>
              <div className="price">{plan.priceInr === 0 ? "Free" : <>₹{plan.priceInr.toLocaleString("en-IN")}</>}</div>
              {perApplication && <div className="muted small">{perApplication}</div>}
              <p className="muted">{plan.blurb}</p>
              <ul className="ticks">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              {facts && <PayFacts facts={facts} />}
              {id === "free" ? (
                account ? (
                  <Link to="/jobs/new" className="btn btn-ghost btn-block">Use free credits</Link>
                ) : (
                  <Link to="/signup" className="btn btn-ghost btn-block">Start free</Link>
                )
              ) : account && isPaidSku(id) ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => buy(id)}
                  disabled={checkoutClosed || busy === id}
                  aria-describedby={paymentsEnabled === false ? "checkout-closed" : undefined}
                >
                  {paymentsEnabled === false ? "Checkout closed" : busy === id ? "Opening checkout…" : `Buy ${plan.name}`}
                </button>
              ) : (
                <Link to="/signup" className="btn btn-ghost btn-block">
                  Start free, upgrade later
                </Link>
              )}
              {msg?.sku === id && <div className="alert alert-info small">{msg.text}</div>}
            </div>
          );
        })}
      </div>
      <section className="run-packs">
        <h2>Add scan runs</h2>
        <p>A run is one press of Scan for jobs, or one day of the daily scan. It prepares up to three jobs and uses one application pack for each.</p>
        <div className="run-pack-grid">
          {RUN_PACKS.map((pack) => {
            const facts = offerFacts(pack.id, currency);
            return (
              <div key={pack.id} className="card run-pack">
                <h3>{pack.runs} runs · ₹{pack.priceInr}</h3>
                <PayFacts facts={facts} />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!account || paymentsEnabled !== true || busy === pack.id}
                  aria-describedby={paymentsEnabled === false ? "checkout-closed" : undefined}
                  onClick={() => buy(pack.id)}
                >
                  {paymentsEnabled === false ? "Checkout closed" : busy === pack.id ? "Opening checkout…" : `Buy ${pack.runs} runs`}
                </button>
              </div>
            );
          })}
        </div>
        {!account && <p className="muted small">Sign in before buying runs.</p>}
        {msg?.sku === "runs5" || msg?.sku === "runs15" || msg?.sku === "runs30" ? <div className="alert alert-info small">{msg.text}</div> : null}
      </section>
      {paymentsEnabled === false && (
        <p id="checkout-closed" className="alert alert-info" role="status">
          Checkout is closed. The buy buttons are off, and nothing on this page charges a card. Free credits still work.
        </p>
      )}
      <p className="muted small center">
        {paymentsEnabled
          ? "Checkout opens Razorpay. Credits are added only after Razorpay confirms the payment."
          : "Buying stays off until checkout is opened. A closed checkout cannot take a payment."}{" "}
        <Link to="/refunds">Refunds</Link> and <Link to="/terms">terms</Link> are written in plain language.
      </p>
    </div>
  );
}
