import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type DiscoverRow } from "../api";
import { useJobs } from "../data";
import { ago } from "../format";
import { useSession } from "../session";

export function DiscoverPage() {
  const { put, open, profile } = useJobs();
  const { account, refresh } = useSession();
  const [data, setData] = useState<{ needsTargets: boolean; rows: DiscoverRow[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.discover().then(setData, (e: Error) => setError(e.message));
  }, []);

  async function check(row: DiscoverRow) {
    setBusy(row.url);
    setError("");
    try {
      const fetched = await api.fetchJob(row.url);
      const job = await api.createJob({ ...fetched, company: fetched.company || row.company, location: fetched.location || row.location });
      put(job);
      await refresh();
      setHidden((h) => new Set(h).add(row.url));
      open(job.id);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 422 ? `${row.company}: ${e.message}` : (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const rows = (data?.rows ?? []).filter((r) => !hidden.has(r.url));
  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="lede">
            Openings on the <Link to="/companies">career pages we scan</Link> whose titles match what you are looking for, in places you accept.
            Browsing is free. A fit check uses one credit{account ? ` (you have ${account.evalCredits})` : ""}.
          </p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {data?.needsTargets && (
        <p className="first-run">Add the job titles you want on your <Link to="/profile">profile</Link> and matching openings show up here.</p>
      )}
      {data && !data.needsTargets && (
        <p className="muted small">
          Matching on {profile?.preferences.targetRoles.join(", ")}. {rows.length ? `${rows.length} openings.` : "Nothing new right now. Boards are re-read every hour."}
        </p>
      )}
      {data === null && !error && <p className="muted">Looking through the boards…</p>}
      <ul className="lines">
        {rows.map((r) => (
          <li className="line" key={r.url}>
            <span className={`score score-${r.match >= 80 ? "hi" : "mid"}`} title="How closely the title matches your targets">{r.match}</span>
            <a className="line-main" href={r.url} target="_blank" rel="noreferrer">
              <span className="line-title">{r.title}</span>
              <span className="line-company">{r.company}</span>
              <span className="line-facts">
                <span>{r.location || "Location not given"}</span>
                {r.locationNote && <span>{r.locationNote}</span>}
                <span>seen {ago(r.seenAt)}</span>
              </span>
            </a>
            <span className="line-actions">
              <button className="btn btn-primary btn-sm" disabled={busy !== "" || (account?.evalCredits ?? 0) < 1} onClick={() => check(r)}>
                {busy === r.url ? "Reading…" : "Check fit"}
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setHidden((h) => new Set(h).add(r.url))}>Hide</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
