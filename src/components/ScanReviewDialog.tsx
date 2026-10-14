import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { countryByCode } from "../../shared/geo";
import { SEARCH_PATH_LIMIT } from "../../shared/engine/searchPaths";
import type { Preferences } from "../../shared/types";
import { api, type MarketScan, type ScanSchedule } from "../api";
import { useJobs } from "../data";
import { plural } from "../format";
import { useSession } from "../session";

export const SCAN_STARTED_EVENT = "cjs:scan-started";
export const SCAN_FINISHED_EVENT = "cjs:scan-finished";

function placeSummary(prefs: Preferences): string[] {
  const country = countryByCode(prefs.country)?.name || "Any country";
  const cities = prefs.cities.length ? prefs.cities.join(", ") : "every city";
  const pay = prefs.minSalary === null ? "No minimum pay" : `Pay from ${prefs.minSalary} ${prefs.currency}${prefs.salaryPeriod === "lpa" ? " LPA" : ` per ${prefs.salaryPeriod}`}`;
  return [`${country} · ${cities}`, prefs.remoteOk ? "Remote roles welcome" : "No remote roles", pay];
}

/** Shows what a scan will look for, and starts it only after the person confirms. */
export function ScanReviewDialog({ onClose, onStarted }: { onClose: () => void; onStarted?: (scan: MarketScan) => void }) {
  const { profile, searchPaths } = useJobs();
  const { account, refresh } = useSession();
  const [quota, setQuota] = useState<ScanSchedule | null>(null);
  const [active, setActive] = useState<MarketScan | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.scanSchedule(), api.currentMarketScan()]).then(([schedule, current]) => {
      setQuota(schedule);
      const scan = current.scan;
      setActive(scan && (scan.status === "queued" || scan.status === "processing") ? scan : null);
    }, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titles = profile?.preferences.targetRoles ?? [];
  const scansLeft = quota?.scanRuns ?? account?.scanRuns ?? 0;
  const packsLeft = Math.min(account?.evalCredits ?? 0, account?.resumeCredits ?? 0);
  const blocker = !titles.length
    ? "Add at least one job title first."
    : scansLeft < 1
      ? "You have used your scans."
      : packsLeft < 1
        ? "You have no application packs left."
        : quota?.manualNote || "";

  async function scanNow() {
    setStarting(true);
    setError("");
    try {
      const { scan } = await api.scanDiscover();
      window.dispatchEvent(new CustomEvent<MarketScan>(SCAN_STARTED_EVENT, { detail: scan }));
      void refresh();
      onStarted?.(scan);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
      <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="scan-review-title">
        <div className="modal-card scan-review">
          <p className="kicker">Before we scan</p>
          <h2 id="scan-review-title">Here is what we will look for</h2>
          <p className="scan-review-lede">
            We read every career page we cover and keep only jobs that match everything below. The best {Math.min(3, Math.max(packsLeft, 1))} become ready-to-send application packs.
          </p>

          <section className="scan-review-block">
            <header>
              <h3>Job titles</h3>
              <Link to="/profile" onClick={onClose}>Edit</Link>
            </header>
            {titles.length ? (
              <div className="chips">{titles.map((title) => <span key={title} className="chip chip-static">{title}</span>)}</div>
            ) : (
              <p className="muted small">No titles yet.</p>
            )}
          </section>

          <section className="scan-review-block">
            <header>
              <h3>Search paths <span className="n">{searchPaths.length} of {SEARCH_PATH_LIMIT}</span></h3>
              <Link to="/search-paths" onClick={onClose}>{searchPaths.length ? "Edit" : "Add paths"}</Link>
            </header>
            {searchPaths.length ? (
              <ol className="scan-review-paths">
                {searchPaths.map((path, index) => (
                  <li key={path.id}>
                    <span className="scan-review-num">{index + 1}</span>
                    <span>{path.name}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <>
                <ul className="scan-review-place">
                  {profile && placeSummary(profile.preferences).map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="muted small">Add search paths, such as Pune · Below ₹35 LPA or Remote · Above ₹30 LPA, to sort jobs into the groups you care about.</p>
              </>
            )}
            <p className="muted small">Jobs that publish no pay are kept for you to review. We never guess a salary.</p>
          </section>

          <dl className="scan-review-cost">
            <div><dt>Uses</dt><dd>1 of {plural(scansLeft, "scan")} left</dd></div>
            <div><dt>Prepares</dt><dd>Up to {Math.min(3, packsLeft)} packs</dd></div>
            <div><dt>Takes</dt><dd>About 1–3 min</dd></div>
          </dl>

          {active && <div className="alert alert-info">A scan is already running. <Link to="/discover" onClick={onClose}>Watch its progress</Link>.</div>}
          {!active && blocker && (
            <div className="alert alert-warn">
              {blocker}
              {(scansLeft < 1 || packsLeft < 1) && <> <Link to="/pricing" onClick={onClose}>See plans</Link></>}
            </div>
          )}
          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <div className="row-end">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={starting}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void scanNow()}
              disabled={starting || quota === null || Boolean(active) || Boolean(blocker)}
            >
              {starting ? "Starting…" : "Scan now"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
