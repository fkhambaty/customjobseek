import { useState, type FormEvent } from "react";
import { SUPPORT_TOPICS, parseSupportTopic, supportTopicLabel, type SupportTopic } from "../../shared/commercial";
import { api } from "../api";
import { SiteLinks } from "../components/SiteLinks";
import { useSession } from "../session";

export function SupportPage() {
  const { account, loading } = useSession();
  const [email, setEmail] = useState(account?.email ?? "");
  const [topic, setTopic] = useState<SupportTopic>("account");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.support({ email: account ? undefined : email, topic, message });
      setSent(result.id);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="boot">Opening…</div>;

  return (
    <div className="page narrow">
      <div className="card">
        <h1>Support</h1>
        <p className="muted">
          Tell us what happened in a few sentences. We reply by email. The note we send ourselves does not include this message.
        </p>
        {sent ? (
          <div className="alert alert-ok">We have it. We'll reply to {account?.email ?? email}. Reference {sent}.</div>
        ) : (
          <form onSubmit={submit} className="stack">
            {account ? (
              <p>We'll reply to {account.email}.</p>
            ) : (
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>What is it about?</span>
              <select value={topic} onChange={(e) => {
                const next = parseSupportTopic(e.target.value);
                if (next) setTopic(next);
              }}>
                {SUPPORT_TOPICS.map((item) => (
                  <option key={item} value={item}>{supportTopicLabel(item)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What should we know?</span>
              <textarea rows={6} required minLength={20} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
          </form>
        )}
      </div>
      <p className="muted small">
        <SiteLinks />
      </p>
    </div>
  );
}
