import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PUBLIC_FEEDS, SOURCES, capabilityPhrase, freshnessPhrase, healthLabel, healthPhrase, isAts, sourceLabel } from "../../shared/engine/sources";
import { api, type CompanyRow, type MarketStats } from "../api";
import { jobOpenUrl } from "../format";
import { useSession } from "../session";

function statusLine(company: CompanyRow): string {
  const source = isAts(company.ats) ? SOURCES[company.ats] : null;
  if (!source || source.listing !== "live") return source?.savedNote || "Saved, and not read automatically";
  if (company.scan_status === "error") return "The last read failed";
  if (!company.last_scan_at) return "Waiting for its first read";
  const when = new Date(company.last_scan_at.includes("T") ? company.last_scan_at : `${company.last_scan_at.replace(" ", "T")}Z`);
  return `${company.opening_count} openings · read ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

export function CompaniesPage() {
  const { account } = useSession();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ title: string; location: string; url: string }[]>([]);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.companyStats().then(setStats, () => undefined);
  }, [reload]);

  useEffect(() => {
    let cancel = false;
    const handle = setTimeout(() => {
      api.companies(undefined, query.trim()).then((page) => {
        if (cancel) return;
        setRows(page.companies);
        setNextCursor(page.nextCursor);
        setError("");
      }, (e: Error) => {
        if (!cancel) setError(e.message);
      });
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(handle);
    };
  }, [query, reload]);

  async function more() {
    if (!nextCursor || busy) return;
    setBusy(true);
    try {
      const page = await api.companies(nextCursor, query.trim());
      setRows((current) => [...(current ?? []), ...page.companies]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const health = useMemo(() => new Map((stats?.health ?? []).map((row) => [row.ats, row])), [stats]);
  const liveSources = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).filter((id) => SOURCES[id].listing === "live");
  const heldSources = (["icims", "oracle_recruiting", "successfactors"] as const).map((id) => SOURCES[id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const added = await api.reportMissed(url, note);
      const detail = added.message ?? (added.error ? `Scan problem: ${added.error}` : `${added.count} open roles found.`);
      setMsg(`${added.name} (${sourceLabel(added.ats)}). ${detail}`);
      setUrl("");
      setNote("");
      setReload((value) => value + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fresh = stats?.freshestAt
    ? new Date(stats.freshestAt.includes("T") ? stats.freshestAt : `${stats.freshestAt.replace(" ", "T")}Z`)
    : null;

  return (
    <div className="page">
      <h1>Companies we scan</h1>
      <p className="muted">
        A curated set of public career boards in India, the United States, the United Kingdom, Canada, Australia, Singapore, New Zealand, Ireland, and South Africa.
        The curated count is only the boards we have checked. It is not every employer in those countries.
        A successful read is a board whose public listing answered. Unsupported portals stay visible and are never shown as scanned.
      </p>
      {stats && (
        <div className="market-ready company-coverage">
          <div><strong>{(stats.catalogBoards ?? 0).toLocaleString("en-IN")}</strong><span>curated public boards</span></div>
          <div><strong>{stats.readable.toLocaleString("en-IN")}</strong><span>boards with a successful read</span></div>
          <div><strong>{stats.openings.toLocaleString("en-IN")}</strong><span>current openings</span></div>
          <div><strong>{(stats.unsupported ?? 0).toLocaleString("en-IN")}</strong><span>saved, not scanned</span></div>
          <p>
            {fresh && !Number.isNaN(fresh.getTime())
              ? `Newest successful read ${fresh.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. `
              : "No successful read is stored yet. "}
            Live boards are refreshed about every six hours. Reporting a career page adds it to the same queue when that source can be read.
          </p>
        </div>
      )}

      {stats?.countries && stats.countries.length > 0 && (
        <ul className="coverage-countries">
          {stats.countries.map((country) => (
            <li key={country.code}>
              <strong>{country.name}</strong>
              <span>{country.catalog} curated · {country.readable} read</span>
            </li>
          ))}
        </ul>
      )}

      <h2>What each source can do</h2>
      <ul className="source-rows">
        {liveSources.map((id) => {
          const source = SOURCES[id];
          const row = health.get(id);
          const healthName = healthPhrase(source.listing, row?.lastOkAt ?? null, row?.failures ?? 0);
          return (
            <li key={id}>
              <strong>{source.label}</strong>
              <span>{capabilityPhrase(source)} · {freshnessPhrase(source)} · {source.compliance.replaceAll("_", " ")}</span>
              <span>{healthLabel(healthName)}</span>
            </li>
          );
        })}
        {heldSources.map((source) => (
          <li key={source.id}>
            <strong>{source.label}</strong>
            <span>{source.notes}</span>
            <span>{healthLabel("not_scanned")}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        LinkedIn, Indeed, Naukri, SEEK, Glassdoor and the other protected job boards are a partnership or a pasted employer link.
        Official feeds we know about ({PUBLIC_FEEDS.map((feed) => feed.name).join(", ")}) are registered and not called: none has a live open address connected.
      </p>

      {account ? (
        <form className="card stack" onSubmit={submit}>
          <h2>Report a missed link</h2>
          <p className="muted small">Paste the employer's own career page. Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Teamtailor, Recruitee, Breezy, and ordinary career sites are read. iCIMS, Oracle, and SuccessFactors still need a pasted description. LinkedIn, Indeed, Naukri, and Shine are not scraped.</p>
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
          <span className="muted"><Link to="/signup">Create a free account</Link> and paste the employer's career page. Job-board links are kept, and not fetched.</span>
        </div>
      )}

      <label className="field">
        <span>Search</span>
        <input value={query} placeholder="Company name, source, or link" onChange={(e) => setQuery(e.target.value)} />
      </label>

      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows?.length === 0 && <p className="muted">No companies yet. The first missed link starts the list.</p>}
      <div className="job-list">
        {(rows ?? []).map((c) => (
          <div className="card job-row" key={c.id}>
            <div className="job-row-main">
              <div className="job-row-title">{c.name}</div>
              <div className="muted small">
                {sourceLabel(c.ats)} · {statusLine(c)}
                {c.country ? ` · ${c.country}` : ""}
                {!c.active && " · needs URL review"}
              </div>
              {open === c.id && (
                <ul className="notes">
                  {jobs.length === 0 && <li>No openings stored yet.</li>}
                  {jobs.map((j) => (
                    <li key={j.url}><a href={jobOpenUrl(j.url)} target="_blank" rel="noreferrer">{j.title}</a>{j.location && ` · ${j.location}`}</li>
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
      {nextCursor && (
        <button className="btn btn-ghost" type="button" onClick={more} disabled={busy}>
          {busy ? "Loading…" : "Load more companies"}
        </button>
      )}
    </div>
  );
}
