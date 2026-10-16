import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CODE_TTL_MINUTES, passwordRuleStates, validatePassword } from "../../shared/password";
import { api, ApiError } from "../api";
import { CapacityNotice } from "../components/CapacityNotice";
import { useSession } from "../session";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { account, pause, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const referralCode = params.get("ref") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rules = passwordRuleStates(password);

  const from = (location.state as { from?: string } | null)?.from;
  if (account) return <Navigate to={from ?? "/today"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "signup") {
      const problem = validatePassword(password);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        sessionStorage.setItem("cjs_referral", referralCode);
        const result = await api.signup(email, password, referralCode);
        const expiresAt = result.codeExpiresAt ?? "";
        const minutes = result.codeExpiresInMinutes ?? CODE_TTL_MINUTES;
        if (expiresAt) sessionStorage.setItem("cjs_code_expires", expiresAt);
        sessionStorage.setItem("cjs_code_minutes", String(minutes));
        navigate(`/verify?email=${encodeURIComponent(email)}`);
        return;
      }
      await api.login(email, password);
      await refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.pause)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>{mode === "signup" ? "Create your free account" : "Welcome back"}</h1>
        <p className="muted">
          {mode === "signup"
            ? `3 application packs to start. We email you a code that expires in ${CODE_TTL_MINUTES} minutes.`
            : "Sign in to your job search."}
        </p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" ? (
              <ul className="password-hints" aria-live="polite">
                {rules.map((rule) => (
                  <li key={rule.id} className={rule.met ? "ok" : ""}>
                    {rule.met ? "Met" : "Needed"}: {rule.label}
                  </li>
                ))}
              </ul>
            ) : (
              <small className="muted"><Link to="/reset">Forgot password?</Link></small>
            )}
          </label>
          {pause && <CapacityNotice pause={pause} compact />}
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          {mode === "signup" && (
            <p className="muted small">
              By creating an account you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy</Link> pages.
            </p>
          )}
        </form>
        <p className="muted small center">
          {mode === "signup" ? (
            <>Already have an account? <Link to="/login">Sign in</Link></>
          ) : (
            <>New here? <Link to="/signup">Create a free account</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
