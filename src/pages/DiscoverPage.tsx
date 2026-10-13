import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatIstHour } from "../../shared/engine/scanRules";
import { api, ApiError, type DiscoverRow, type DiscoverScan, type ScanSchedule } from "../api";
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
  const [scan, setScan] = useState<DiscoverScan | null>(null);
  const [quota, setQuota] = useState<ScanSchedule | null>(null);
  const [hourIst, setHourIst] = useState(13);

  useEffect(() => {
    api.discover().then(setData, (e: Error) => setError(e.message));
    api.scanSchedule().then((row) => {
      setQuota(row);
      if (row.schedule) setHourIst(row.schedule.hourIst);
    }, () => undefined);
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

  async function scanForJobs() {
    setBusy("scan");
    setError("");
    try {
      const result = await api.scanDiscover();
      setScan(result);
      result.prepared.forEach(put);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      api.scanSchedule().then(setQuota, () => undefined);
    }
  }

  async function saveSchedule(enabled: boolean, hour = hourIst) {
    setError("");
    try {
      setQuota(await api.saveScanSchedule({ enabled, hourIst: hour }));
      setHourIst(hour);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows = (scan?.locked ?? data?.rows ?? []).filter((r) => !hidden.has(r.url));
  const runsLeft = quota?.scanRuns ?? account?.scanRuns ?? 0;
  const packsLeft = Math.min(account?.evalCredits ?? 0, account?.resumeCredits ?? 0);
  const paid = account !== null && account.plan !== "free";
  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="lede">
            Openings on the <Link to="/companies">career pages we scan</Link> whose titles match what you are looking for, in places you accept.
            One scan prepares the strongest three matches as complete application packs.
          </p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {data?.needsTargets && (
        <p className="first-run">Add the job titles you want on your <Link to="/profile">profile</Link> and matching openings show up here.</p>
      )}
      {data && !data.needsTargets && (
        <div className="scan-callout">
          <div>
            <strong>{scan ? `${scan.prepared.length} application packs are ready` : "Let the shortlist do the work"}</strong>
            <p>
              {scan
                ? `The strongest ${scan.checked} title matches were read against your profile. Open a prepared job below; the other ${rows.length} matches stay visible as a preview.`
                : `Matching on ${profile?.preferences.targetRoles.join(", ")}. ${runsLeft === 1 ? "1 scan" : `${runsLeft} scans`} left. One scan reads the strongest matches and prepares up to three resumes, application files and outreach notes.`}
            </p>
            {quota?.manualNote && <p className="scan-wait">{quota.manualNote}</p>}
          </div>
          {!scan && (
            <button
              className="btn btn-primary"
              disabled={busy !== "" || runsLeft < 1 || packsLeft < 1 || Boolean(quota?.manualAllowedAt)}
              onClick={scanForJobs}
            >
              {busy === "scan" ? "Reading and preparing…" : "Scan for jobs · prepare top 3"}
            </button>
          )}
        </div>
      )}
      {data && !data.needsTargets && (
        <section className="daily-scan">
          <div>
            <h2>Daily scan</h2>
            {paid ? (
              <p>
                {quota?.schedule?.enabled
                  ? `On, every day at ${formatIstHour(quota.schedule.hourIst)}.${quota.schedule.pausedReason ? ` Paused: ${quota.schedule.pausedReason}` : ""}`
                  : "Off. Pick an hour in India time and it prepares up to three jobs once a day."}
              </p>
            ) : (
              <p>Daily scans come with any paid plan. The free scan is the one you start yourself.</p>
            )}
          </div>
          {paid ? (
            <div className="daily-controls">
              <select
                value={hourIst}
                onChange={(e) => {
                  const hour = Number(e.target.value);
                  setHourIst(hour);
                  if (quota?.schedule?.enabled) void saveSchedule(true, hour);
                }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{formatIstHour(hour)}</option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => saveSchedule(!(quota?.schedule?.enabled ?? false))}>
                {quota?.schedule?.enabled ? "Turn off" : "Turn on"}
              </button>
            </div>
          ) : (
            <Link to="/pricing" className="btn btn-ghost btn-sm">See plans</Link>
          )}
        </section>
      )}
      {quota && quota.runs.length > 0 && (
        <section className="last-runs">
          <h2>Last runs</h2>
          <ul>
            {quota.runs.map((run) => (
              <li key={run.id}>
                <span>{run.trigger === "scheduled" ? "Daily" : "By hand"}</span>
                <span>{run.preparedCount ? `${run.preparedCount} prepared` : "Nothing prepared"}</span>
                <span>{run.charged ? "1 scan used" : "Not charged"}</span>
                {run.note && <span>{run.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data === null && !error && <p className="muted">Looking through the boards…</p>}
      {scan?.prepared.length ? (
        <section className="scan-results">
          <div className="queue-head">
            <h2>Prepared for you <span>{scan.prepared.length}</span></h2>
            <p>Fit checked, resume built and application pack saved.</p>
          </div>
          <ul className="lines scan-ready">
            {scan.prepared.map((job) => (
              <li className="line" key={job.id}>
                <span className={`score score-${job.fit.score >= 70 ? "hi" : job.fit.score >= 50 ? "mid" : "lo"}`}>{job.fit.score}</span>
                <button className="line-main" onClick={() => open(job.id)}>
                  <span className="line-title">{job.title}</span>
                  <span className="line-company">{job.company}</span>
                  <span className="line-facts">
                    <span>{job.location || "Location not given"}</span>
                    <span>resume and pack ready</span>
                    {job.contactCount > 0 && <span>{job.contactCount} contact{job.contactCount === 1 ? "" : "s"} from the posting</span>}
                  </span>
                </button>
                <span className="line-actions">
                  <a className="btn btn-primary btn-sm" href={job.url} target="_blank" rel="noreferrer">Apply ↗</a>
                  <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "resume")}>Resume</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "application")}>Application pack</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "people")}>People &amp; messages</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {scan && rows.length > 0 && (
        <div className="queue-head locked-head">
          <h2>Other matches <span>{rows.length}</span></h2>
          <p>Kept visible so you can judge the scan. The free tier fully prepares three.</p>
        </div>
      )}
      <ul className="lines">
        {rows.map((r) => (
          <li className={`line${scan ? " scan-locked" : ""}`} key={r.url}>
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
              {scan ? (
                <span className="scan-lock">Preview only</span>
              ) : (
                <>
                  <button className="btn btn-primary btn-sm" disabled={busy !== "" || (account?.evalCredits ?? 0) < 1} onClick={() => check(r)}>
                    {busy === r.url ? "Reading…" : "Check fit"}
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={() => setHidden((h) => new Set(h).add(r.url))}>Hide</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
