import { useState } from "react";
import type { JobRecord, JobStatus } from "../../shared/types";
import { api } from "../api";
import { useJobs } from "../data";
import { ago, formatPay, shortDate } from "../format";
import { statusLabel } from "./FitCard";

export type LineMode = "apply" | "message" | "nudge" | "live" | "due";

function Score({ job }: { job: JobRecord }) {
  if (job.fit.imported && !job.fit.score) return <span className="score score-none" title="No score in your earlier records">–</span>;
  const tone = job.fit.score >= 70 ? "hi" : job.fit.score >= 50 ? "mid" : "lo";
  return <span className={`score score-${tone}`} title={job.fit.imported ? "Score from your earlier records" : "Fit score"}>{job.fit.score}</span>;
}

export function JobLine({ job, mode }: { job: JobRecord; mode: LineMode }) {
  const { put, open, currency } = useJobs();
  const [busy, setBusy] = useState(false);
  const pay = formatPay(job, currency);

  async function mark(status: JobStatus) {
    setBusy(true);
    try {
      put(await api.updateJob(job.id, { status }));
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    job.lane,
    pay,
    job.postedAt ? `posted ${ago(job.postedAt)}` : mode === "apply" ? `added ${ago(job.createdAt)}` : "",
    mode !== "apply" && job.appliedAt ? `applied ${shortDate(job.appliedAt)}` : "",
    mode === "nudge" && job.lastTouchAt ? `last message ${ago(job.lastTouchAt)}` : "",
    mode === "due" && job.nextActionAt ? `follow up ${shortDate(job.nextActionAt)}` : "",
  ].filter(Boolean);

  return (
    <li className="line">
      <Score job={job} />
      <button className="line-main" onClick={() => open(job.id)}>
        <span className="line-title">{job.title}</span>
        <span className="line-company">
          {job.company}
          {job.requisition && <span className="ref">{job.requisition}</span>}
        </span>
        <span className="line-facts">
          {facts.map((f) => <span key={f}>{f}</span>)}
          {job.fit.blockers.length > 0 && <span className="flag">{job.fit.blockers[0]!.message}</span>}
          {mode === "message" && <span className="hint">{job.contactCount === 1 ? "1 person saved" : `${job.contactCount} people saved`}</span>}
          {mode === "apply" && !job.hasResume && <span className="hint">no resume yet</span>}
          {mode === "live" && <span className="hint">{statusLabel(job.status)}</span>}
        </span>
      </button>
      <span className="line-actions">
        {mode === "apply" && (
          <>
            {job.url && <a className="btn btn-primary btn-sm" href={job.url} target="_blank" rel="noreferrer">Apply ↗</a>}
            <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "resume")}>Resume</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => mark("applied")}>Applied</button>
            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => mark("withdrawn")} title="Take it off the list">Skip</button>
          </>
        )}
        {(mode === "message" || mode === "nudge") && (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => open(job.id, "people")}>{mode === "message" ? "Write message" : "Send nudge"}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => mark("rejected")}>Rejected</button>
          </>
        )}
        {(mode === "live" || mode === "due") && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "history")}>History</button>
            <button className="btn btn-ghost btn-sm" onClick={() => open(job.id, "people")}>People</button>
          </>
        )}
      </span>
    </li>
  );
}
