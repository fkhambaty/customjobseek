import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { JOB_STATUSES, type JobRecord, type JobStatus } from "../../shared/types";
import { api } from "../api";
import { ScoreRing, statusLabel } from "../components/FitCard";

function isDue(j: JobRecord): boolean {
  return Boolean(j.nextActionAt && j.nextActionAt <= new Date().toISOString().slice(0, 10));
}

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<JobStatus | "all">("all");

  useEffect(() => {
    api.listJobs().then(setJobs, (e: Error) => setError(e.message));
  }, []);

  const counts = useMemo(() => {
    const c: Partial<Record<JobStatus, number>> = {};
    for (const j of jobs ?? []) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  const due = (jobs ?? []).filter(isDue);
  const shown = (jobs ?? []).filter((j) => filter === "all" || j.status === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your jobs</h1>
          <p className="muted">Every job you have checked, and where it stands.</p>
        </div>
        <Link to="/jobs/new" className="btn btn-primary">+ Check a job</Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {due.length > 0 && (
        <div className="alert alert-info">
          <strong>Follow up today:</strong>{" "}
          {due.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ", "}
              <Link to={`/jobs/${j.id}`}>{j.title}{j.company && ` at ${j.company}`}</Link>
            </span>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={filter === "all" ? "tab active" : "tab"} onClick={() => setFilter("all")}>
          All <span className="count">{jobs?.length ?? 0}</span>
        </button>
        {JOB_STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} className={filter === s ? "tab active" : "tab"} onClick={() => setFilter(s)}>
            {statusLabel(s)} <span className="count">{counts[s]}</span>
          </button>
        ))}
      </div>

      {jobs === null && !error && <p className="muted">Loading…</p>}
      {jobs?.length === 0 && (
        <div className="card empty">
          <h2>No jobs yet</h2>
          <p className="muted">Paste a job link or description to see how well it fits you.</p>
          <Link to="/jobs/new" className="btn btn-primary">Check your first job</Link>
        </div>
      )}

      <div className="job-list">
        {shown.map((j) => (
          <Link to={`/jobs/${j.id}`} key={j.id} className="card job-row">
            <ScoreRing score={j.fit.score} size="sm" />
            <div className="job-row-main">
              <div className="job-row-title">{j.title}</div>
              <div className="muted small">
                {[j.company, j.location].filter(Boolean).join(" · ") || "Company not set"}
              </div>
            </div>
            {j.fit.blockers.length > 0 && <span className="badge badge-warn">Deal-breaker</span>}
            <span className={`badge badge-${j.status}`}>{statusLabel(j.status)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
