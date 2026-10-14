import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DISCOVER_COVERAGE } from "../../shared/engine/sources";
import { pipelineCountLabel } from "../../shared/engine/liveness";
import { formatZonedHour } from "../../shared/engine/scanRules";
import { api, ApiError, type DiscoverRow, type LastScan, type ScanSchedule } from "../api";
import { MarketScanConsole } from "../components/MarketScanConsole";
import { SCAN_FINISHED_EVENT } from "../components/ScanReviewDialog";
import { UpgradePrompt } from "../components/UpgradePrompt";
import { useJobs } from "../data";
import { ago, dateTime, duration, timeAgo } from "../format";
import { useSession } from "../session";

function LastScanPanel({ scan, matches }: { scan: LastScan; matches: number | null }) {
  const when = scan.completedAt ?? scan.startedAt ?? scan.queuedAt;
  const readRate = scan.candidateCount ? Math.round((scan.checkedCount / scan.candidateCount) * 100) : null;
  const kpis: { value: string; label: string; tone?: "good" | "warn" }[] = [
    { value: String(scan.candidateCount), label: "openings matched your titles and places" },
    { value: String(scan.checkedCount), label: readRate === null ? "postings read in full" : `postings read in full (${readRate}%)` },
    { value: String(scan.handpickedCount), label: "handpicked with resume and pack", tone: scan.handpickedCount > 0 ? "good" : undefined },
    { value: String(scan.pipelineChecked), label: "pipeline jobs rechecked" },
    { value: String(scan.pipelineClosed), label: "found closed", tone: scan.pipelineClosed > 0 ? "warn" : undefined },
    { value: duration(scan.durationSeconds), label: "time taken" },
  ];
  return (
    <section className="last-scan" aria-labelledby="last-scan-title">
      <header>
        <div>
          <p className="kicker">Last scan</p>
          <h2 id="last-scan-title">{dateTime(when)} <span className="muted">· {timeAgo(when)}</span></h2>
        </div>
        <div className="last-scan-tags">
          <span className={`tag ${scan.status === "failed" ? "tag-warn" : "tag-ok"}`}>{scan.status === "failed" ? "Stopped safely" : "Finished"}</span>
          <span className="tag">{scan.trigger === "scheduled" ? "Daily scan" : "Started by you"}</span>
          <span className="tag">{scan.charged ? "1 scan used" : "Not charged"}</span>
        </div>
      </header>
      <dl className="last-scan-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={kpi.tone ? `kpi-${kpi.tone}` : ""}>
            <dt>{kpi.label}</dt>
            <dd>{kpi.value}</dd>
          </div>
        ))}
      </dl>
      {matches !== null && matches > 0 && <p className="muted small">{matches} opening{matches === 1 ? "" : "s"} on the boards match you right now, listed below.</p>}
      {scan.status === "failed" && scan.error && <p className="muted small">{scan.error}</p>}
    </section>
  );
}

export function DiscoverPage() {
  const { put, open, jobs, searchPaths } = useJobs();
  const { account, refresh } = useSession();
  const [data, setData] = useState<{ needsTargets: boolean; rows: DiscoverRow[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [quota, setQuota] = useState<ScanSchedule | null>(null);
  const [hourIst, setHourIst] = useState(13);

  useEffect(() => {
    api.discover().then(setData, (e: Error) => setError(e.message));
    const loadQuota = () => api.scanSchedule().then((row) => {
      setQuota(row);
      if (row.schedule) setHourIst(row.schedule.hourIst);
    }, () => undefined);
    void loadQuota();
    window.addEventListener(SCAN_FINISHED_EVENT, loadQuota);
    return () => window.removeEventListener(SCAN_FINISHED_EVENT, loadQuota);
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

  async function saveSchedule(enabled: boolean, hour = hourIst) {
    setError("");
    try {
      setQuota(await api.saveScanSchedule({ enabled, hourIst: hour }));
      setHourIst(hour);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const rows = (data?.rows ?? []).filter((r) => !hidden.has(r.url));
  const paid = account !== null && account.plan !== "free";
  const evidence = (jobs ?? []).some((job) => job.fit.score > 0) || (quota?.runs.some((run) => run.preparedCount > 0) ?? false);
  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="lede">
            Openings on the <Link to="/companies">career pages we scan</Link> whose titles match what you are looking for, in places you accept.
            One scan prepares the strongest three matches as complete application packs.
          </p>
          <p className="muted small">{DISCOVER_COVERAGE}</p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {data?.needsTargets && (
        <p className="first-run">Add the job titles you want on your <Link to="/profile">profile</Link> and matching openings show up here.</p>
      )}
      {data && !data.needsTargets && <MarketScanConsole compact />}
      {quota?.lastScan && <LastScanPanel scan={quota.lastScan} matches={data?.rows.length ?? null} />}
      {data && !data.needsTargets && (account?.evalCredits ?? 1) < 1 && (
        <UpgradePrompt evidence={evidence} blocked="checks" />
      )}
      {data && !data.needsTargets && (
        <section className="daily-scan">
          <div>
            <h2>Daily scan</h2>
            {paid ? (
              <p>
                {quota?.schedule?.enabled
                  ? `On, every day at ${formatZonedHour(quota.schedule.hourLocal, quota.timeZone)}.${quota.schedule.pausedReason ? ` Paused: ${quota.schedule.pausedReason}` : ""}`
                  : `Off. Pick an hour in ${quota?.timeZoneLabel || "your time zone"} and it prepares up to three jobs once a day.`}
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
                  <option key={hour} value={hour}>{formatZonedHour(hour, quota?.timeZone || "Asia/Kolkata")}</option>
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
                <span className="run-when">{dateTime(run.startedAt)}</span>
                <span>{run.trigger === "scheduled" ? "Daily" : "By hand"}</span>
                <span>{run.preparedCount ? `${run.preparedCount} prepared` : "Nothing prepared"}</span>
                <span>{run.charged ? "1 scan used" : "Not charged"}</span>
                <span>{pipelineCountLabel(run.pipelineChecked, run.pipelineClosed)}</span>
                {run.note && <span>{run.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {searchPaths.length > 0 && (
        <p className="muted small">Openings are limited to your search paths. A job matches on the midpoint of the published pay. If the posting has no pay, it can be saved for review as “Pay not published”.</p>
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
                {r.pathLabel && <span>{r.pathLabel}</span>}
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
