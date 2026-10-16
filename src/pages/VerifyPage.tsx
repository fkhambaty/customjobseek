import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CODE_TTL_MINUTES, passwordRuleStates, validatePassword } from "../../shared/password";
import { api } from "../api";
import { useSession } from "../session";

function readStoredExpiry(): { expiresAt: string | null; minutes: number } {
  const expiresAt = sessionStorage.getItem("cjs_code_expires");
  const minutes = Number(sessionStorage.getItem("cjs_code_minutes") || CODE_TTL_MINUTES);
  return { expiresAt, minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : CODE_TTL_MINUTES };
}

function rememberExpiry(expiresAt: string | null, minutes: number) {
  if (expiresAt) sessionStorage.setItem("cjs_code_expires", expiresAt);
  sessionStorage.setItem("cjs_code_minutes", String(minutes));
}

function expiryCopy(expiresAt: string | null, minutes: number, nowMs: number): string {
  if (expiresAt) {
    const leftMs = Date.parse(expiresAt) - nowMs;
    if (Number.isFinite(leftMs)) {
      if (leftMs <= 0) return "This code has expired. Request a new one.";
      const leftMin = Math.max(1, Math.ceil(leftMs / 60_000));
      return `This code expires in ${leftMin} minute${leftMin === 1 ? "" : "s"} (codes last ${minutes} minutes).`;
    }
  }
  return `Enter the 6-digit code we emailed you. It expires in ${minutes} minutes.`;
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const stored = readStoredExpiry();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(stored.expiresAt);
  const [minutes, setMinutes] = useState(stored.minutes);
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const info = expiryCopy(expiresAt, minutes, nowMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const storedReferral = sessionStorage.getItem("cjs_referral");
      await api.verify(email, code, storedReferral ?? undefined);
      sessionStorage.removeItem("cjs_referral");
      sessionStorage.removeItem("cjs_code_expires");
      sessionStorage.removeItem("cjs_code_minutes");
      await refresh();
      navigate("/onboarding");
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
              try {
                const result = await api.resendCode(email, "signup");
                rememberExpiry(result.codeExpiresAt, result.codeExpiresInMinutes);
                setExpiresAt(result.codeExpiresAt);
                setMinutes(result.codeExpiresInMinutes);
                setNowMs(Date.now());
                setError("");
              } catch (err) {
                setError((err as Error).message);
              }
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
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(CODE_TTL_MINUTES);
  const [nowMs, setNowMs] = useState(Date.now());
  const navigate = useNavigate();
  const { refresh } = useSession();
  const rules = passwordRuleStates(password);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [sent]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.forgot(email);
      rememberExpiry(result.codeExpiresAt, result.codeExpiresInMinutes);
      setExpiresAt(result.codeExpiresAt);
      setMinutes(result.codeExpiresInMinutes);
      setNowMs(Date.now());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    const problem = validatePassword(password);
    if (problem) {
      setError(problem);
      return;
    }
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
            <p className="muted">
              If an account exists for that email, the code is on its way. {expiryCopy(expiresAt, minutes, nowMs)}
            </p>
            <label className="field"><span>Code</span><input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label className="field">
              <span>New password</span>
              <input type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <ul className="password-hints" aria-live="polite">
                {rules.map((rule) => (
                  <li key={rule.id} className={rule.met ? "ok" : ""}>
                    {rule.met ? "Met" : "Needed"}: {rule.label}
                  </li>
                ))}
              </ul>
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>Save password</button>
          </form>
        )}
      </div>
    </div>
  );
}
