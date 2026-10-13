import { useState } from "react";
import { Link } from "react-router-dom";
import { PLANS, PLAN_ORDER, RUN_PACKS, type PlanId, type RunPack } from "../../shared/plans";
import { api } from "../api";
import { useSession } from "../session";

export function PricingPage() {
  const { account } = useSession();
  const [msg, setMsg] = useState<{ plan: string; text: string } | null>(null);

  async function buy(plan: PlanId) {
    try {
      const { url } = await api.checkout(plan);
      window.location.href = url;
    } catch (e) {
      setMsg({ plan, text: (e as Error).message });
    }
  }

  async function buyRuns(pack: RunPack) {
    try {
      const { url } = await api.checkoutRuns(pack.id);
      window.location.href = url;
    } catch (e) {
      setMsg({ plan: "runs", text: (e as Error).message });
    }
  }

  return (
    <div className="page">
      <div className="center">
        <h1>Pay per application, not per month</h1>
        <p className="muted lede-sm">
          One application pack is a fit check plus a tailored resume for that job. Credits last six months, because a
          job search should end.
        </p>
      </div>
      <div className="plans">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const featured = id === "growth";
          return (
            <div key={id} className={featured ? "card plan featured" : "card plan"}>
              {featured && <span className="plan-tag">Most chosen</span>}
              <h2>{p.name}</h2>
              <div className="price">
                {p.priceInr === 0 ? "Free" : <>₹{p.priceInr.toLocaleString("en-IN")}</>}
              </div>
              {p.priceInr > 0 && (
                <div className="muted small">₹{Math.round(p.priceInr / p.resumeCredits)} per application</div>
              )}
              <p className="muted">{p.blurb}</p>
              <ul className="ticks">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {id === "free" ? (
                account ? (
                  <Link to="/jobs/new" className="btn btn-ghost btn-block">Use free credits</Link>
                ) : (
                  <Link to="/signup" className="btn btn-ghost btn-block">Start free</Link>
                )
              ) : account ? (
                <button className={featured ? "btn btn-primary btn-block" : "btn btn-ghost btn-block"} onClick={() => buy(id)}>
                  Buy {p.name}
                </button>
              ) : (
                <Link to="/signup" className={featured ? "btn btn-primary btn-block" : "btn btn-ghost btn-block"}>
                  Start free, upgrade later
                </Link>
              )}
              {msg?.plan === id && <div className="alert alert-info small">{msg.text}</div>}
            </div>
          );
        })}
      </div>
      <section className="run-packs">
        <h2>Add scan runs</h2>
        <p>A run is one press of Scan for jobs, or one day of the daily scan. It prepares up to three jobs and uses one application pack for each.</p>
        <div className="run-pack-row">
          {RUN_PACKS.map((pack) => (
            <button key={pack.id} className="btn btn-ghost" disabled={!account} onClick={() => buyRuns(pack)}>
              {pack.runs} runs · ₹{pack.priceInr}
            </button>
          ))}
        </div>
        {!account && <p className="muted small">Sign in before buying runs.</p>}
        {msg?.plan === "runs" && <div className="alert alert-info small">{msg.text}</div>}
      </section>
    </div>
  );
}
