import { useState } from "react";
import { rowEvidence } from "../../shared/agency";
import { postingClosedCopy } from "../../shared/engine/liveness";
import { PAY_NOT_PUBLISHED, showPayNotPublished } from "../../shared/engine/searchPaths";
import type { JobRecord, JobStatus } from "../../shared/types";
import { api } from "../api";
import { useJobs } from "../data";
import { ago, formatPay, shortDate, today } from "../format";

export type LineMode = "apply" | "message" | "nudge" | "live" | "due";

function Score({ job }: { job: JobRecord }) {
  if (job.fit.imported && !job.fit.score) return <span className="score score-none" title="No score in your earlier records">–</span>;
  const tone = job.fit.score >= 70 ? "hi" : job.fit.score >= 50 ? "mid" : "lo";
  return <span className={`score score-${tone}`} title={job.fit.imported ? "Score from your earlier records" : "Fit score"}>{job.fit.score}</span>;
}

export function JobLine({ job, mode }: { job: JobRecord; mode: LineMode }) {
  const { put, open, currency, searchPaths } = useJobs();
  const [busy, setBusy] = useState(false);
  const pay = formatPay(job, currency);
  const evidence = rowEvidence(job, today());

  async function mark(status: JobStatus) {
    setBusy(true);
    try {
      put(await api.updateJob(job.id, { status }));
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    evidence.stage,
    job.lane,
    job.archivedAt ? "Archived" : "",
    showPayNotPublished(job, searchPaths.length > 0) ? PAY_NOT_PUBLISHED : "",
    pay,
    evidence.freshness.label,
    evidence.payProvenance === "unknown" ? "" : evidence.payLabel,
    mode === "apply" && evidence.coverage !== null ? `${evidence.coverage}% covered` : "",
    mode !== "apply" && job.appliedAt ? `applied ${shortDate(job.appliedAt)}` : "",
    mode === "nudge" && job.lastTouchAt ? `last message ${ago(job.lastTouchAt)}` : "",
    mode === "due" && job.nextActionAt ? `follow up ${shortDate(job.nextActionAt)}` : "",
    mode === "message" || mode === "nudge" ? evidence.outreach.note : "",
  ].filter(Boolean);

  const postingClosed = job.liveStatus === "closed";
  return (
    <li className={postingClosed ? "line posting-closed" : "line"}>
      <Score job={job} />
      <button className="line-main" onClick={() => open(job.id)}>
        <span className="line-title">{job.title}</span>
        <span className="line-company">
          {job.company}
          {job.requisition && <span className="ref">{job.requisition}</span>}
        </span>
        <span className="line-facts">
          {facts.map((f) => <span key={f} className={f === evidence.freshness.label ? evidence.freshness.status : ""}>{f}</span>)}
          {evidence.blocker && <span className="flag">{evidence.blocker}</span>}
          {mode === "message" && <span className="hint">{job.contactCount === 1 ? "1 person saved" : `${job.contactCount} people saved`}</span>}
        </span>
        {postingClosed && <span className="posting-closed-note">{postingClosedCopy(job.status)}</span>}
      </button>
      <span className="line-actions">
        {mode === "apply" && (
          <>
            {job.url && <a className="btn btn-primary btn-sm" href={job.url} target="_blank" rel="noreferrer">Apply ↗</a>}
            {evidence.packageReady ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(job.id, "resume")}>Resume</button>
            ) : (
              <button type="button" className={job.url ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"} onClick={() => open(job.id, job.hasResume ? "application" : "resume")}>Finish pack</button>
            )}
            {evidence.packageReady && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => mark("applied")}>Applied</button>
            )}
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => mark("withdrawn")} title="Take it off the list">Skip</button>
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
      {mode === "apply" && !evidence.packageReady && evidence.packageGaps.length > 0 && (
        <details className="quiet-fold line-gap">
          <summary>Pack still missing a piece</summary>
          <p className="muted small">{evidence.packageGaps.join(". ")}.</p>
        </details>
      )}
    </li>
  );
}
