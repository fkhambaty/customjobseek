import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type CompanyRow, type MarketStats } from "../api";
import { useSession } from "../session";

const SCANNED = new Set(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday"]);

const ATS_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  website: "Company website",
};

function lastScan(c: CompanyRow): string {
  if (!SCANNED.has(c.ats)) return "Saved, not read automatically yet";
  if (!c.last_scan_at) return "Waiting for its first scan";
  const when = new Date(c.last_scan_at.includes("T") ? c.last_scan_at : `${c.last_scan_at.replace(" ", "T")}Z`);
  return `${c.opening_count} openings · scanned ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

export function CompaniesPage() {
  const { account } = useSession();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ title: string; location: string; url: string }[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api.companies().then(setRows, (e: Error) => setError(e.message));
    api.companyStats().then(setStats, () => undefined);
  }
  useEffect(load, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((c) => c.name.toLowerCase().includes(q) || c.career_url.toLowerCase().includes(q));
  }, [rows, query]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const added = await api.reportMissed(url, note);
      const scan = added.error ? `Scan problem: ${added.error}` : `${added.count} open roles found.`;
      setMsg(`${added.name} is on the scan list (${ATS_LABEL[added.ats] ?? added.ats}). ${scan}`);
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
        A source-qualified catalog of employers hiring in India across technology, consulting, GCCs, telecom, media and communications.
        Verified career boards are refreshed continuously; unsupported websites stay visible and are never presented as scanned.
      </p>
      {stats && (
        <div className="market-ready company-coverage">
          <div><strong>{stats.employers.toLocaleString("en-IN")}</strong><span>India employers</span></div>
          <div><strong>{stats.readable.toLocaleString("en-IN")}</strong><span>boards refreshed</span></div>
          <div><strong>{stats.openings.toLocaleString("en-IN")}</strong><span>current openings</span></div>
          <p>The catalog has no fixed cap. A reported career page is verified, deduplicated and added to the same refresh queue.</p>
        </div>
      )}

      {account ? (
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
      ) : (
        <div className="card">
          <strong>Found a job we missed?</strong>{" "}
          <span className="muted"><Link to="/signup">Create a free account</Link> and paste the link. The whole company is added to this list.</span>
        </div>
      )}

      <label className="field">
        <span>Search</span>
        <input value={query} placeholder="Company name or link" onChange={(e) => setQuery(e.target.value)} />
      </label>

      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">No companies yet. The first missed link starts the list.</p>}
      <div className="job-list">
        {shown.map((c) => (
          <div className="card job-row" key={c.id}>
            <div className="job-row-main">
              <div className="job-row-title">{c.name}</div>
              <div className="muted small">
                {ATS_LABEL[c.ats] ?? c.ats} · {lastScan(c)}
                {c.country === "IN" && " · India catalog"}
                {!c.active && " · needs URL review"}
              </div>
              {open === c.id && (
                <ul className="notes">
                  {jobs.length === 0 && <li>No openings stored yet.</li>}
                  {jobs.map((j) => (
                    <li key={j.url}><a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>{j.location && ` · ${j.location}`}</li>
                  ))}
                </ul>
              )}
            </div>
            <a className="btn btn-ghost btn-sm" href={c.career_url} target="_blank" rel="noreferrer">Career page</a>
            {c.opening_count > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  if (open === c.id) {
                    setOpen(null);
                    return;
                  }
                  setOpen(c.id);
                  setJobs(await api.openings(c.id));
                }}
              >
                {open === c.id ? "Hide roles" : "Roles"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
