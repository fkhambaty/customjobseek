import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ANALYTICS_COUNT_COPY, COOKIE_CHOICES, isPaidSku, type CookieChoice } from "../../shared/commercial";
import { inrLabel, offerFacts, type OrderView } from "../../shared/payments";
import { PLANS, type PlanId } from "../../shared/plans";
import { api, type AccountHome } from "../api";
import { WalletLine } from "../components/PayFacts";
import { creditAmount, isUnlimited, plural } from "../format";
import { useSession } from "../session";

export function AccountPage() {
  const { account, refresh } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [home, setHome] = useState<AccountHome | null>(null);
  const [cookies, setCookies] = useState<CookieChoice>("essential");
  const [transactionalEmail, setTransactionalEmail] = useState(true);
  const [marketingEmail, setMarketingEmail] = useState(false);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderView[]>([]);

  useEffect(() => {
    api.accountHome().then((next) => {
      setHome(next);
      setCookies(next.preferences.cookies);
      setTransactionalEmail(next.preferences.transactionalEmail);
      setMarketingEmail(next.preferences.marketingEmail);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load account details."));
    api.checkoutOrders().then((next) => setOrders(next.orders)).catch(() => undefined);
  }, []);

  if (!account) return null;
  const plan = PLANS[account.plan as PlanId] ?? PLANS.free;
  const steps = home
    ? [
        [home.onboarding.profile, "Save your profile"],
        [home.onboarding.resume, "Import a resume"],
        [home.onboarding.preferences, "Add the job titles you want"],
        [home.onboarding.firstCheck, "Check one job"],
      ] as const
    : [];
  const started = steps.length > 0 && steps.some(([done]) => !done);

  async function savePreferences() {
    setError("");
    setSaved("");
    setBusy(true);
    try {
      const next = await api.saveAccountPreferences({
        cookies,
        productEmail: marketingEmail,
        transactionalEmail,
        marketingEmail,
      });
      setHome((current) => (current ? { ...current, preferences: next } : current));
      setSaved("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setError("");
    try {
      const data = await api.accountExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "customjobseek-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
          <div className="stat"><span className={`stat-n${isUnlimited(account.evalCredits) ? " stat-word" : ""}`}>{creditAmount(account.evalCredits)}</span><span className="muted">fit checks left</span></div>
          <div className="stat"><span className={`stat-n${isUnlimited(account.resumeCredits) ? " stat-word" : ""}`}>{creditAmount(account.resumeCredits)}</span><span className="muted">tailored resumes left</span></div>
          <div className="stat"><span className={`stat-n${isUnlimited(account.scanRuns) ? " stat-word" : ""}`}>{creditAmount(account.scanRuns)}</span><span className="muted">scans left</span></div>
          <div className="stat"><span className="stat-n">{plan.name}</span><span className="muted">current plan</span></div>
        </div>
        <WalletLine wallet={{
          plan: account.plan,
          evalCredits: account.evalCredits,
          resumeCredits: account.resumeCredits,
          scanRuns: account.scanRuns,
          creditsExpireAt: account.creditsExpireAt,
        }} />
        {orders.length > 0 && (
          <ul className="order-list">
            {orders.map((order) => {
              const name = isPaidSku(order.sku) ? offerFacts(order.sku).name : order.sku;
              const price = order.currency === "INR" ? inrLabel(order.amountInr) : `${order.amountInr} ${order.currency}`;
              return (
                <li key={order.id}>
                  <span>{name}</span>
                  <code>{order.sku}</code>
                  <span>{price}</span>
                  <span>{order.oneTimeNote}</span>
                  <span>{order.status}</span>
                </li>
              );
            })}
          </ul>
        )}
        {account.creditsExpireAt && (
          <p className="muted small">Paid credits expire on {new Date(account.creditsExpireAt).toLocaleDateString()}.</p>
        )}
        <Link to="/pricing" className="btn btn-ghost">See plans</Link>
      </div>

      {started && (
        <div className="card">
          <h2>Getting started</h2>
          <ul className="ticks">
            {steps.map(([done, label]) => (
              <li key={label}>{done ? "Done: " : "Still to do: "}{label}</li>
            ))}
          </ul>
          {home && home.onboarding.step !== "done" && home.onboarding.step !== "" && (
            <p><Link to="/onboarding">Continue setup</Link></p>
          )}
        </div>
      )}

      <div className="card">
        <h2>Signed in as</h2>
        <p>{account.email}</p>
        <p className="muted">
          <button className="btn btn-ghost" onClick={download}>Download my data</button>
        </p>
        <p className="muted small">
          Read the <Link to="/privacy">Privacy</Link> page, or <Link to="/support">contact support</Link>.
        </p>
      </div>

      <div className="card">
        <h2>Email and cookies</h2>
        <label className="checkline">
          <input type="checkbox" checked={transactionalEmail} onChange={(e) => setTransactionalEmail(e.target.checked)} />
          <span>Email me when a scan finishes, credits run low, or a paid plan is about to expire.</span>
        </label>
        <label className="checkline">
          <input type="checkbox" checked={marketingEmail} onChange={(e) => setMarketingEmail(e.target.checked)} />
          <span>Email me a weekly priority note, and one reminder if setup is unfinished. Each message has a link to turn this off.</span>
        </label>
        {(Object.keys(COOKIE_CHOICES) as CookieChoice[]).map((choice) => (
          <label key={choice} className="checkline">
            <input type="radio" name="cookies" checked={cookies === choice} onChange={() => setCookies(choice)} />
            <span>
              {COOKIE_CHOICES[choice]}
              {choice === "analytics" ? ` ${ANALYTICS_COUNT_COPY}` : ""}
            </span>
          </label>
        ))}
        <button className="btn btn-ghost" onClick={savePreferences} disabled={busy}>{busy ? "Saving…" : "Save choices"}</button>
        {saved && <p className="muted small">{saved}</p>}
      </div>

      {home && (
        <div className="card">
          <h2>Invite code</h2>
          <p>
            Your code is <code>{home.referral.code}</code>. Someone can open <code>/signup?ref={home.referral.code}</code>.
            After their first successful payment, you receive 3 fit checks and 3 resumes, once. Their name, resume, and jobs stay private.
          </p>
          <p className="muted small">{plural(home.referral.uses, "signup")} recorded. {plural(home.referral.rewarded, "reward")} granted.</p>
        </div>
      )}

      <div className="card danger-zone">
        <h2>Delete account</h2>
        <p className="muted">
          Removes your profile, all jobs, all resumes and your credit history. This cannot be undone.
        </p>
        <div className="row-inline">
          <input type="password" aria-label="Password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-danger" onClick={remove} disabled={!password}>Delete everything</button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
