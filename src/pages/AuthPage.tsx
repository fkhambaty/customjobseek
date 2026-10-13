import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { account, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;
  if (account) return <Navigate to={mode === "signup" ? "/profile" : (from ?? "/jobs")} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await api.signup(email, password);
        navigate(`/verify?email=${encodeURIComponent(email)}`);
        return;
      }
      await api.login(email, password);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>{mode === "signup" ? "Create your free account" : "Welcome back"}</h1>
        <p className="muted">
          {mode === "signup" ? "3 fit checks and 1 tailored resume, free." : "Sign in to your job search."}
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
            {mode === "signup" ? <small className="muted">At least 10 characters. We email you a 6-digit code.</small> : <small className="muted"><Link to="/reset">Forgot password?</Link></small>}
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
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
