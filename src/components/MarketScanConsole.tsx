import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SCAN_STAGE_LABELS, type ScanStage } from "../../shared/engine/scanRules";
import { api, type MarketScan, type MarketStats, type ScanSchedule } from "../api";
import { useJobs } from "../data";
import { useSession } from "../session";

const STAGES: ScanStage[] = ["searching", "reading", "checking_fit", "building_resumes", "building_packs", "complete"];

function remaining(scan: MarketScan): string {
  if (scan.status === "complete" || scan.status === "failed") return "";
  const seconds = Math.max(15, scan.estimatedSeconds - scan.elapsedSeconds);
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

function stageDone(scan: MarketScan, stage: ScanStage): boolean {
  if (scan.status === "complete") return true;
  return STAGES.indexOf(stage) < STAGES.indexOf(scan.stage);
}

function marketCoverage(stats: MarketStats | null): string {
  if (!stats) return "India career pages, refreshed continuously";
  const raw = stats.freshestAt;
  const parsed = raw ? new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`) : null;
  const fresh = parsed && !Number.isNaN(parsed.getTime())
    ? ` · latest refresh ${parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  return `${stats.employers.toLocaleString("en-IN")} India employers · ${stats.openings.toLocaleString("en-IN")} current openings${fresh}`;
}

export function MarketScanConsole({ compact = false }: { compact?: boolean }) {
  const { account, refresh } = useSession();
  const { open, reload } = useJobs();
  const [scan, setScan] = useState<MarketScan | null>(null);
  const [quota, setQuota] = useState<ScanSchedule | null>(null);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const finalised = useRef("");

  useEffect(() => {
    Promise.all([api.currentMarketScan(), api.scanSchedule(), api.companyStats()])
      .then(([current, schedule, market]) => {
        setScan(current.scan);
        setQuota(schedule);
        setStats(market);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!scan || (scan.status !== "queued" && scan.status !== "processing")) return;
    const timer = window.setTimeout(() => {
      api.marketScan(scan.id).then(({ scan: next }) => setScan(next), (e: Error) => setError(e.message));
    }, scan.stage === "queued" ? 4_000 : 2_000);
    return () => window.clearTimeout(timer);
  }, [scan]);

  useEffect(() => {
    if (!scan || scan.status !== "complete" || finalised.current === scan.id) return;
    finalised.current = scan.id;
    void Promise.all([reload(), refresh(), api.scanSchedule().then(setQuota)]);
  }, [refresh, reload, scan]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const result = await api.scanDiscover();
      setScan(result.scan);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (loading) return <section className={`market-scan ${compact ? "market-scan-compact" : ""}`}><p className="muted">Checking the market…</p></section>;

  const active = scan?.status === "queued" || scan?.status === "processing";
  const complete = scan?.status === "complete";
  const canStart = (quota?.scanRuns ?? account?.scanRuns ?? 0) > 0
    && Math.min(account?.evalCredits ?? 0, account?.resumeCredits ?? 0) > 0
    && !quota?.manualAllowedAt
    && !active;
  const coverage = marketCoverage(stats);

  return (
    <section className={`market-scan ${compact ? "market-scan-compact" : ""}`}>
      <div className="market-scan-head">
        <div>
          <p className="kicker">{active ? "Market scan in progress" : complete ? "Latest market scan" : "India job market"}</p>
          <h2>
            {active
              ? SCAN_STAGE_LABELS[scan.stage]
              : complete
                ? `${scan.handpickedCount} handpicked job${scan.handpickedCount === 1 ? "" : "s"}`
                : "Find the work worth applying for"}
          </h2>
          <p>{coverage}</p>
        </div>
        {!active && !complete && (
          <button className="btn btn-primary btn-lg" disabled={!canStart || starting} onClick={start}>
            {starting ? "Starting…" : "Scan for jobs"}
          </button>
        )}
        {active && <div className="scan-time"><strong>{remaining(scan)}</strong><span>You can leave this page.</span></div>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!active && !complete && (
        <div className="market-ready">
          <div><strong>Up to 24</strong><span>strong openings read</span></div>
          <div><strong>Best 3</strong><span>prepared for you</span></div>
          <div><strong>{quota?.scanRuns ?? account?.scanRuns ?? 0}</strong><span>scan{(quota?.scanRuns ?? 0) === 1 ? "" : "s"} left</span></div>
          <p>Usually 1–3 minutes. Fit, resume, application notes and named contacts are prepared together.</p>
        </div>
      )}

      {active && (
        <>
          <div className={`market-progress ${scan.progress === null ? "market-progress-live" : ""}`} aria-hidden>
            <span style={{ width: `${scan.progress ?? 18}%` }} />
          </div>
          <ol className="scan-stages" aria-live="polite">
            {STAGES.map((stage) => {
              const done = stageDone(scan, stage);
              const current = scan.stage === stage;
              return (
                <li key={stage} className={done ? "done" : current ? "current" : ""}>
                  <span>{done ? "Done" : current ? "Now" : "Next"}</span>
                  <div>
                    <strong>{SCAN_STAGE_LABELS[stage]}</strong>
                    {stage === "reading" && scan.candidateCount > 0 && (
                      <small>{scan.checkedCount} of {scan.candidateCount} openings read</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {scan.queueAhead > 0 && <p className="scan-queue">{scan.queueAhead} earlier scan{scan.queueAhead === 1 ? "" : "s"} ahead of yours.</p>}
        </>
      )}

      {scan?.status === "failed" && (
        <div className="market-failed">
          <strong>This scan stopped safely.</strong>
          <p>{scan.error || "Nothing was charged. Please start it again."}</p>
          <button className="btn btn-primary" disabled={!canStart} onClick={start}>Try again</button>
        </div>
      )}

      {complete && (
        <div className="market-complete">
          {scan.prepared.length > 0 ? (
            <ul className="lines scan-ready">
              {scan.prepared.map((job) => (
                <li className="line" key={job.id}>
                  <span className={`score score-${job.fit.score >= 70 ? "hi" : job.fit.score >= 50 ? "mid" : "lo"}`}>{job.fit.score}</span>
                  <button className="line-main" onClick={() => open(job.id)}>
                    <span className="line-title">{job.title}</span>
                    <span className="line-company">{job.company}</span>
                    <span className="line-facts">
                      <span>fit checked</span><span>resume ready</span><span>application pack ready</span>
                      {job.contactCount > 0 && <span>{job.contactCount} contact{job.contactCount === 1 ? "" : "s"}</span>}
                    </span>
                  </button>
                  <span className="line-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => open(job.id, "application")}>Open pack</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "resume")}>Resume</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="market-empty">No safe match was prepared, so this scan cost nothing.</p>
          )}
          <div className="market-complete-foot">
            <span>{scan.charged ? "1 scan used" : "Not charged"}</span>
            <span className="row-inline">
              {canStart && <button className="linkish" onClick={start}>Scan again</button>}
              <Link to="/discover">See the full market</Link>
            </span>
          </div>
        </div>
      )}

      {quota?.manualNote && !active && <p className="scan-wait">{quota.manualNote}</p>}
    </section>
  );
}
