import { useState } from "react";
import { Link } from "react-router-dom";
import { PLANS, PLAN_ORDER, type PlanId } from "../../shared/plans";
import { api } from "../api";
import { useSession } from "../session";

export function PricingPage() {
  const { account } = useSession();
  const [msg, setMsg] = useState<{ plan: PlanId; text: string } | null>(null);

  async function buy(plan: PlanId) {
    try {
      const { url } = await api.checkout(plan);
      window.location.href = url;
    } catch (e) {
      setMsg({ plan, text: (e as Error).message });
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
    </div>
  );
}
