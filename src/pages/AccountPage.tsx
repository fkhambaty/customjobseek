import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PLANS, type PlanId } from "../../shared/plans";
import { api } from "../api";
import { useSession } from "../session";

export function AccountPage() {
  const { account, refresh } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!account) return null;
  const plan = PLANS[account.plan as PlanId] ?? PLANS.free;

  async function remove() {
    setError("");
    if (!confirm("This permanently deletes your profile, every job and every resume. Continue?")) return;
    try {
      await api.deleteAccount(password);
      await refresh();
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="page narrow-wide">
      <h1>Account</h1>
      <div className="card">
        <h2>Credits</h2>
        <div className="stat-row">
          <div className="stat"><span className="stat-n">{account.evalCredits}</span><span className="muted">fit checks left</span></div>
          <div className="stat"><span className="stat-n">{account.resumeCredits}</span><span className="muted">tailored resumes left</span></div>
          <div className="stat"><span className="stat-n">{plan.name}</span><span className="muted">current plan</span></div>
        </div>
        {account.creditsExpireAt && (
          <p className="muted small">Paid credits expire on {new Date(account.creditsExpireAt).toLocaleDateString()}.</p>
        )}
        <Link to="/pricing" className="btn btn-ghost">See plans</Link>
      </div>

      <div className="card">
        <h2>Signed in as</h2>
        <p>{account.email}</p>
      </div>

      <div className="card danger-zone">
        <h2>Delete account</h2>
        <p className="muted">
          Removes your profile, all jobs, all resumes and your credit history. This cannot be undone.
        </p>
        <div className="row-inline">
          <input type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-danger" onClick={remove} disabled={!password}>Delete everything</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>
    </div>
  );
}
