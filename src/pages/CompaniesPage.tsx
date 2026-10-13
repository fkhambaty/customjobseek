import { useEffect, useState, type FormEvent } from "react";
import { api, type CompanyRow } from "../api";

export function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ title: string; location: string; url: string }[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api.companies().then(setRows, (e: Error) => setError(e.message));
  }
  useEffect(load, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const added = await api.reportMissed(url, note);
      const scan = added.error ? `Scan problem: ${added.error}` : `${added.count} open roles found.`;
      setMsg(`${added.name} is on the scan list (${added.ats}). ${scan}`);
      setUrl("");
      setNote("");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Companies we scan</h1>
      <p className="muted">
        Career pages are added when someone reports a link we missed. Greenhouse, Lever, Ashby, Workable and SmartRecruiters
        boards are read on a schedule. Workday and other sites are saved so they can be scanned once an adapter exists.
      </p>

      <form className="card stack" onSubmit={submit}>
        <h2>Report a missed link</h2>
        <label className="field">
          <span>Job link or career page</span>
          <input type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Note, optional</span>
          <input value={note} placeholder="The Data Engineer role posted this week" onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        {msg && <div className="alert alert-ok">{msg}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add this company"}</button>
      </form>

      {rows?.length === 0 && <p className="muted">No companies yet. The first missed link starts the list.</p>}
      <div className="job-list">
        {(rows ?? []).map((c) => (
          <div className="card job-row" key={c.id}>
            <div className="job-row-main">
              <div className="job-row-title">{c.name}</div>
              <div className="muted small">{c.ats} · {c.opening_count} openings · {c.scan_status}</div>
            </div>
            <a className="btn btn-ghost btn-sm" href={c.career_url} target="_blank" rel="noreferrer">Career page</a>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                setOpen(c.id);
                setJobs(await api.openings(c.id));
              }}
            >
              Roles
            </button>
            {open === c.id && (
              <ul className="notes">
                {jobs.length === 0 && <li>No openings stored yet.</li>}
                {jobs.map((j) => (
                  <li key={j.url}><a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>{j.location && ` · ${j.location}`}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
