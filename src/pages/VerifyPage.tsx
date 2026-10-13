import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("Enter the 6-digit code we emailed you. It expires in 15 minutes.");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.verify(email, code);
      await refresh();
      navigate("/profile");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>Confirm your email</h1>
        <p className="muted">{info}</p>
        <form onSubmit={submit} className="stack">
          <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Code</span><input inputMode="numeric" pattern="\d{6}" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
        </form>
        <p className="muted small center">
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await api.resendCode(email, "signup").catch((err: Error) => setError(err.message));
              setInfo("If that account is waiting, a new code is on its way.");
            }}
          >
            Send a new code
          </button>
          {" · "}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export function ResetPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useSession();

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.forgot(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.reset(email, code, password);
      await refresh();
      navigate("/today");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>Set a new password</h1>
        {!sent ? (
          <form onSubmit={send} className="stack">
            <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>Email me a code</button>
          </form>
        ) : (
          <form onSubmit={apply} className="stack">
            <p className="muted">If an account exists for that email, the code is on its way.</p>
            <label className="field"><span>Code</span><input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label className="field"><span>New password</span><input type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>Save password</button>
          </form>
        )}
      </div>
    </div>
  );
}
